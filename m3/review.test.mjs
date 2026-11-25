/**
 * Review findings at main 03b8202 (automated review H1-H7, M1, M4, L1; second review: resolution
 * then normal mint edit). Each test is the repro of one finding. Ids: RV-<finding>.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  carry, carryRaft, checkin, createRepo, defineRaft, forkStream, inspect, landEvent, lock, movesOn, saveScript,
} from './engine.mjs';
import { START, END } from './weave.mjs';
import { withIntent } from './fixture.mjs';
import { cmpOrderKey } from './model.mjs';
import { beforeFromView, mintScript } from './mint.mjs';

const FILE = 'f';
const PATH = 't.txt';

function seedRepo(bytes) {
  const repo = createRepo();
  const m = mintScript(FILE, [], bytes, 'seed');
  const res = checkin(repo, 'dev', withIntent({
    id: 'seed', orderKey: '1',
    nodes: [{ id: 'root', kind: 'pool', root: true }, { id: FILE, kind: 'file' }],
    entries: [{ id: 'Ef', pool: 'root', node: FILE, name: PATH }],
    lines: m.lines,
  }));
  assert.equal(res.ok, true, res.message);
  return repo;
}
const fileOf = (view) => view.files.find((file) => file.path === PATH);
function mintIn(repo, stream, moveId, orderKey, after) {
  const view = inspect(repo, stream);
  const m = mintScript(FILE, beforeFromView(repo, view, FILE), after, moveId);
  const res = checkin(repo, stream, withIntent({ id: moveId, orderKey, saw: m.saw, lines: m.lines, off: m.off }, { targets: [{ node: FILE }] }));
  assert.equal(res.ok, true, res.message);
  return m;
}
function handIn(repo, stream, script) {
  const res = checkin(repo, stream, withIntent(script, { targets: [{ node: FILE }] }));
  assert.equal(res.ok, true, res.message);
  return res;
}
const dormant = (view) => view.notices.filter((n) => n.kind === 'dormant_resolution').map((n) => n.detail);

// ---------------------------------------------------------------- H1 resolution activity is a fixed point (D-M1-19)

function resolutionsOnOneLine(count) {
  const repo = seedRepo('X\nY\n');
  for (let i = 1; i <= count; i++) {
    handIn(repo, 'dev', {
      id: `R${i}`, orderKey: String(1 + i), saw: ['seed'], off: ['L:seed:0'],
      resolves: { kind: 'same_slot', inputs: ['seed'], absent: [], contested: ['L:seed:0'], saw: ['L:seed:0'], decision: 'new_text' },
      lines: [{ id: `LR${i}`, node: FILE, bytes: `R${i}\n`, after: START, before: 'L:seed:1', replaces: 'L:seed:0' }],
    });
  }
  return repo;
}

test('RV-H1 two resolutions that saw the same spot: the first in order_key order is active, the other is dormant; no oscillation to the seed text', () => {
  const view = inspect(resolutionsOnOneLine(2), 'dev');
  assert.equal(fileOf(view).bytes, 'R1\nY\n');
  assert.deepEqual(dormant(view), ['R2 dormant: spot changed']);
  assert.deepEqual(view.snags, []);
});

test('RV-H1 three resolutions of the same shape: still exactly one active (R1); the preview is not the text of three dormant resolutions', () => {
  const view = inspect(resolutionsOnOneLine(3), 'dev');
  assert.equal(fileOf(view).bytes, 'R1\nY\n');
  assert.deepEqual(dormant(view), ['R2 dormant: spot changed', 'R3 dormant: spot changed']);
  assert.deepEqual(view.snags, []);
});

// ---------------------------------------------------------------- H2 resolution spot follows replacement chains (D-M1-20)

test('RV-H2 a resolution whose saw is the lines of a chain kind 1 snag becomes active and clears it', () => {
  const repo = seedRepo('X\nY\n');
  forkStream(repo, 'dev', 'C');
  mintIn(repo, 'dev', 'A', '2', 'R1\nY\n');
  mintIn(repo, 'dev', 'B', '3', 'R2\nY\n');
  mintIn(repo, 'C', 'C', '4', 'R3\nY\n');
  assert.equal(carry(repo, 'dev', 'C').ok, true);
  const before = inspect(repo, 'dev');
  assert.deepEqual(before.snags.map((s) => [s.kind, s.spot, s.lines.slice().sort()]), [[1, 'L:seed:0', ['L:B:0', 'L:C:0']]]);
  handIn(repo, 'dev', {
    id: 'R', orderKey: '5', saw: ['B', 'C', 'seed'], off: ['L:B:0', 'L:C:0'],
    resolves: { kind: 'same_slot', inputs: ['B', 'C'], absent: [], contested: ['L:seed:0'], saw: ['L:B:0', 'L:C:0'], decision: 'new_text' },
    lines: [{ id: 'LR', node: FILE, bytes: 'R\n', after: START, before: 'L:seed:1', replaces: 'L:seed:0' }],
  });
  const view = inspect(repo, 'dev');
  assert.deepEqual(dormant(view), []);
  assert.equal(fileOf(view).bytes, 'R\nY\n');
  assert.deepEqual(view.snags, []);
});

// ---------------------------------------------------------------- resolution, then a normal mint edit (D-M1-21)

function resolvedDeleteVsModify() {
  const repo = seedRepo('X\nY\n');
  forkStream(repo, 'dev', 'B');
  mintIn(repo, 'dev', 'A', '2', 'X2\nY\n');
  mintIn(repo, 'B', 'B', '3', 'Y\n');
  assert.equal(carry(repo, 'dev', 'B').ok, true);
  handIn(repo, 'dev', {
    id: 'R', orderKey: '4', off: ['L:A:0'],
    resolves: { kind: 'same_slot', inputs: ['A', 'B'], absent: [], contested: ['L:seed:0'], saw: ['L:A:0'], decision: 'keep_one' },
    lines: [{ id: 'RX', node: FILE, bytes: 'X2\n', after: START, before: 'L:seed:1', replaces: 'L:seed:0' }],
  });
  assert.deepEqual(inspect(repo, 'dev').snags, []);
  return repo;
}

test('RV-RES a normal mint edit of an active resolution\'s line does not bring back the delete-vs-modify kind 1 it settled', () => {
  const repo = resolvedDeleteVsModify();
  const m = mintIn(repo, 'dev', 'M', '5', 'X3\nY\n');
  assert.deepEqual(m.saw, ['R', 'seed']);
  assert.equal(m.lines[0].replaces, 'RX');
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'X3\nY\n');
  assert.deepEqual(dormant(view), []);
  assert.deepEqual(view.snags, []);
});

test('RV-RES control: a new unseen deleter of the settled line is still kind 1 (only the resolution\'s inputs are settled)', () => {
  const repo = resolvedDeleteVsModify();
  forkStream(repo, 'dev', 'D');
  mintIn(repo, 'dev', 'M', '5', 'X3\nY\n');
  handIn(repo, 'D', { id: 'D2', orderKey: '6', saw: ['seed'], off: ['L:seed:0'] });
  assert.equal(carry(repo, 'dev', 'D2').ok, true);
  const view = inspect(repo, 'dev');
  assert.deepEqual(view.snags.map((s) => [s.kind, s.spot, s.moves.slice().sort()]), [[1, 'L:seed:0', ['D2', 'M']]]);
});

// ---------------------------------------------------------------- H6 snag report order (D-M1-23)

function twoReplacers(order) {
  const repo = seedRepo('X\nY\n');
  forkStream(repo, 'dev', 'sa');
  forkStream(repo, 'dev', 'sb');
  handIn(repo, 'sb', { id: 'm.b', orderKey: '5', saw: ['seed'], off: ['L:seed:0'], lines: [{ id: 'Lb', node: FILE, bytes: 'b\n', after: START, before: 'L:seed:1', replaces: 'L:seed:0' }] });
  handIn(repo, 'sa', { id: 'm.a', orderKey: '9', saw: ['seed'], off: ['L:seed:0'], lines: [{ id: 'La', node: FILE, bytes: 'a\n', after: START, before: 'L:seed:1', replaces: 'L:seed:0' }] });
  for (const id of order) assert.equal(carry(repo, 'dev', id).ok, true);
  return inspect(repo, 'dev');
}

test('RV-H6 kind 1: moves by move id, sides by order_key then id, lines follow sides; arrival order does not matter', () => {
  for (const order of [['m.b', 'm.a'], ['m.a', 'm.b']]) {
    const snag = twoReplacers(order).snags[0];
    assert.equal(snag.kind, 1);
    assert.deepEqual(snag.moves, ['m.a', 'm.b']);
    assert.deepEqual(snag.sides.map((side) => side.move), ['m.b', 'm.a']);
    assert.deepEqual(snag.lines, ['Lb', 'La']);
  }
});

function threeInserts(order) {
  const repo = seedRepo('X\nY\n');
  const keys = { 'm.c': '6', 'm.a': '8', 'm.b': '7' };
  for (const id of ['m.c', 'm.a', 'm.b']) {
    forkStream(repo, 'dev', `s.${id}`);
    handIn(repo, `s.${id}`, { id, orderKey: keys[id], saw: ['seed'], lines: [{ id: `L${id.slice(2)}`, node: FILE, bytes: `${id.slice(2)}\n`, after: 'L:seed:0', before: 'L:seed:1' }] });
  }
  for (const id of order) assert.equal(carry(repo, 'dev', id).ok, true);
  return inspect(repo, 'dev');
}

test('RV-H6 kind 2 with three sides: moves by id, sides and lines by order_key; same report for two arrival orders (T61b)', () => {
  const one = threeInserts(['m.c', 'm.a', 'm.b']);
  const two = threeInserts(['m.b', 'm.c', 'm.a']);
  for (const view of [one, two]) {
    const snag = view.snags[0];
    assert.equal(snag.kind, 2);
    assert.deepEqual(snag.moves, ['m.a', 'm.b', 'm.c']);
    assert.deepEqual(snag.sides.map((side) => side.move), ['m.c', 'm.b', 'm.a']);
    assert.deepEqual(snag.lines, ['Lc', 'Lb', 'La']);
    assert.equal(fileOf(view).bytes, 'X\nc\nb\na\nY\n');
  }
  assert.deepEqual(two.snags, one.snags);
});

// ---------------------------------------------------------------- M4 order_key comparison (D-M1-22)

test('RV-M4 cmpOrderKey is locale-free: non-integer keys compare by UTF-16 code unit; integer keys compare exactly (no Number rounding)', () => {
  assert.equal(Math.sign(cmpOrderKey('a', 'B')), 1);
  assert.equal(Math.sign(cmpOrderKey('B', 'a')), -1);
  assert.equal(Math.sign(cmpOrderKey('ä', 'z')), 1);
  assert.equal(Math.sign(cmpOrderKey('2', '10')), -1);
  assert.equal(Math.sign(cmpOrderKey('9007199254740993', '9007199254740992')), 1);
  assert.equal(Math.sign(cmpOrderKey('-3', '2')), -1);
  assert.equal(Math.sign(cmpOrderKey('01', '1')), -1);
  assert.equal(cmpOrderKey('7', '7'), 0);
});

test('RV-M4 pool entries are walked in UTF-16 name order (B before a)', () => {
  const repo = createRepo();
  assert.equal(checkin(repo, 'dev', withIntent({
    id: 'seed', orderKey: '1',
    nodes: [{ id: 'root', kind: 'pool', root: true }, { id: 'na', kind: 'file' }, { id: 'nB', kind: 'file' }],
    entries: [{ id: 'Ea', pool: 'root', node: 'na', name: 'a' }, { id: 'EB', pool: 'root', node: 'nB', name: 'B' }],
    lines: [{ id: 'la', node: 'na', bytes: 'a\n' }, { id: 'lB', node: 'nB', bytes: 'B\n' }],
  })).ok, true);
  assert.deepEqual(inspect(repo, 'dev').files.map((file) => file.path), ['B', 'a']);
});

// ---------------------------------------------------------------- H3 withNeeds applies pool preconditions to the closure

function poolRepo() {
  const repo = createRepo();
  assert.equal(checkin(repo, 'dev', withIntent({
    id: 'seed', orderKey: '1',
    nodes: [{ id: 'root', kind: 'pool', root: true }, { id: 'src', kind: 'pool' }],
    entries: [{ id: 'Esrc', pool: 'root', node: 'src', name: 'src' }],
  })).ok, true);
  assert.equal(checkin(repo, 'dev', withIntent({
    id: 'P', orderKey: '2', nodes: [{ id: 'sub', kind: 'pool' }], entries: [{ id: 'Esub', pool: 'src', node: 'sub', name: 'sub' }],
  })).ok, true);
  assert.equal(checkin(repo, 'dev', withIntent({ id: 'D', orderKey: '3', entryOff: ['Esub'] }, { targets: [{ node: 'sub' }] })).ok, true);
  saveScript(repo, withIntent({
    id: 'C', orderKey: '4', nodes: [{ id: 'rowc', kind: 'file' }], entries: [{ id: 'Erow', pool: 'sub', node: 'rowc', name: 'row.c' }],
    lines: [{ id: 'Lc', node: 'rowc', bytes: 'int row;\n', after: START, before: END }],
  }));
  saveScript(repo, withIntent({
    id: 'R', orderKey: '5', lines: [{ id: 'Lr', node: 'rowc', bytes: 'int r;\n', after: 'Lc', before: END }],
  }));
  return repo;
}

test('RV-H3 carry withNeeds refuses parent_pool_missing when a closure member\'s parent pool is unreachable; nothing lands', () => {
  const repo = poolRepo();
  const single = carry(repo, 'dev', 'C');
  assert.equal(single.code, 'parent_pool_missing');
  const before = movesOn(repo, 'dev');
  const res = carry(repo, 'dev', 'R', { withNeeds: true });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'parent_pool_missing');
  assert.equal(res.node_id, 'sub');
  assert.equal(res.parent_move_id, 'P');
  assert.equal(res.parent_pool_missing[0].child_node_id, 'rowc');
  assert.deepEqual(movesOn(repo, 'dev'), before);
});

// ---------------------------------------------------------------- H4 a node lock covers attrOff

test('RV-H4 a lock on node f refuses a check-in whose only record switches off an attribute of f', () => {
  const repo = createRepo();
  assert.equal(checkin(repo, 'dev', withIntent({
    id: 'seed', orderKey: '1',
    nodes: [{ id: 'root', kind: 'pool', root: true }, { id: 'f', kind: 'file' }],
    entries: [{ id: 'Ef', pool: 'root', node: 'f', name: 'f.txt' }],
    attributes: [{ id: 'm1', node: 'f', key: 'mode', value: 'rw' }],
  })).ok, true);
  lock(repo, 'dev', 'f');
  const res = checkin(repo, 'dev', withIntent({ id: 'x', orderKey: '2', attrOff: ['m1'] }, { targets: [{ node: 'f' }] }));
  assert.equal(res.ok, false);
  assert.match(res.message, /f is locked/);
  assert.equal(inspect(repo, 'dev').files[0].meta.mode, 'rw');
});

// ---------------------------------------------------------------- H5 raft carry treats a bad signature as a missing script

test('RV-H5 carryRaft of a member whose signature is bad is refused script_missing and appends nothing', () => {
  const repo = seedRepo('X\n');
  saveScript(repo, withIntent({ id: 'bad', orderKey: '2', signature: 'bad', lines: [{ id: 'Lbad', node: FILE, bytes: 'b\n', after: 'L:seed:0', before: END }] }));
  assert.equal(defineRaft(repo, { id: 'raft.bad', members: ['bad'] }).ok, true);
  assert.equal(carry(repo, 'dev', 'bad').ok, false);
  const res = carryRaft(repo, 'dev', 'raft.bad');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'script_missing');
  assert.deepEqual(movesOn(repo, 'dev'), ['seed']);
});

// ---------------------------------------------------------------- L1 a deleter side is never twin

test('RV-L1 kind 1 with a deleter side and an empty-bytes replacement is not twin', () => {
  const repo = seedRepo('X\nY\n');
  forkStream(repo, 'dev', 'B');
  handIn(repo, 'dev', { id: 'A', orderKey: '2', saw: ['seed'], off: ['L:seed:0'], lines: [{ id: 'La', node: FILE, bytes: '', after: START, before: 'L:seed:1', replaces: 'L:seed:0' }] });
  handIn(repo, 'B', { id: 'B', orderKey: '3', saw: ['seed'], off: ['L:seed:0'] });
  assert.equal(carry(repo, 'dev', 'B').ok, true);
  const snag = inspect(repo, 'dev').snags[0];
  assert.equal(snag.kind, 1);
  assert.equal(snag.twin, false);
  assert.deepEqual(snag.sides.map((side) => [side.move, side.lines]), [['A', ['La']], ['B', []]]);
});
