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

