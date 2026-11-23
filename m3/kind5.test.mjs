/**
 * Kind 5 `anchor_lost` same-move exemption (D-K5-01; external review Q2/Q7, remedy reanchor_or_exempt).
 * Rows K5-01..05. T07 (matrix.test.mjs) is unchanged and still flags a later insert on a lost line.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkin, createRepo, exportStream, inspect, pull, restore } from './engine.mjs';
import { START, END } from './weave.mjs';
import { withIntent } from './fixture.mjs';

function seedRepo(lines) {
  const repo = createRepo();
  const seeded = checkin(repo, 'dev', withIntent({
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'f', kind: 'file' },
    ],
    entries: [{ id: 'Ef', pool: 'root', node: 'f', name: 't.txt' }],
    lines,
  }));
  assert.equal(seeded.ok, true, seeded.message);
  return repo;
}

const ABC = [
  { id: 'A', node: 'f', bytes: 'a\n', after: START, before: END },
  { id: 'B', node: 'f', bytes: 'b\n', after: 'A', before: END },
  { id: 'C', node: 'f', bytes: 'c\n', after: 'B', before: END },
];

function del(id, orderKey, off) {
  return withIntent({ id, orderKey, off }, { targets: [{ node: 'f' }] });
}

function text(repo) {
  return inspect(repo, 'dev').files.find((file) => file.path === 't.txt').bytes;
}

function kind5(repo) {
  return inspect(repo, 'dev').snags.filter((snag) => snag.kind === 5);
}

test('K5-01 seed A,B,C then off:[B]: view a\\nc\\n, no kind 5 on original successor C, exportable', () => {
  const repo = seedRepo(ABC);
  assert.equal(checkin(repo, 'dev', del('delB', '2', ['B'])).ok, true);
  assert.equal(text(repo), 'a\nc\n');
  assert.deepEqual(kind5(repo), []);
  const view = inspect(repo, 'dev');
  assert.deepEqual(view.snags, []);
  assert.equal(view.exportable, true);
  assert.equal(exportStream(repo, 'dev').ok, true);
});

test('K5-02 T07 shape kept: a later insert anchored on switched-off B is kind 5; C is not listed', () => {
  const repo = seedRepo(ABC);
  assert.equal(checkin(repo, 'dev', del('delB', '2', ['B'])).ok, true);
  assert.equal(checkin(repo, 'dev', withIntent({
    id: 'insD',
    orderKey: '3',
    lines: [{ id: 'D', node: 'f', bytes: 'd\n', after: 'B', before: 'C' }],
  })).ok, true);
  const lost = kind5(repo);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].code, 'anchor_lost');
  assert.equal(lost[0].spot, 'B');
  assert.deepEqual(lost[0].lines, ['D']);
  assert.deepEqual(lost[0].moves.slice().sort(), ['delB', 'insD']);
  assert.equal(text(repo), 'a\nd\nc\n');
  assert.equal(inspect(repo, 'dev').exportable, false);
});

test('K5-03 same-move `before` anchor: C minted before B, off:[B] gives a\\nc\\n with no kind 5', () => {
  const repo = seedRepo([
    { id: 'A', node: 'f', bytes: 'a\n', after: START, before: END },
    { id: 'B', node: 'f', bytes: 'b\n', after: 'A', before: END },
    { id: 'C', node: 'f', bytes: 'c\n', after: 'A', before: 'B' },
  ]);
  assert.equal(text(repo), 'a\nc\nb\n');
  assert.equal(checkin(repo, 'dev', del('delB', '2', ['B'])).ok, true);
  assert.equal(text(repo), 'a\nc\n');
  assert.deepEqual(kind5(repo), []);
});

test('K5-04 two-line run deleted mid-file (off:[B, C] of A,B,C,D): view a\\nd\\n, no kind 5', () => {
  const repo = seedRepo([
    ...ABC,
    { id: 'D', node: 'f', bytes: 'd\n', after: 'C', before: END },
  ]);
  assert.equal(checkin(repo, 'dev', del('delBC', '2', ['B', 'C'])).ok, true);
  assert.equal(text(repo), 'a\nd\n');
  assert.deepEqual(kind5(repo), []);
});

test('K5-05 pull and restore of the deleting move: b comes back and goes again; no kind 5 either way', () => {
  const repo = seedRepo(ABC);
  assert.equal(checkin(repo, 'dev', del('delB', '2', ['B'])).ok, true);
  assert.equal(pull(repo, 'dev', 'delB').ok, true);
  assert.equal(text(repo), 'a\nb\nc\n');
  assert.deepEqual(kind5(repo), []);
  assert.equal(restore(repo, 'dev', 'delB').ok, true);
  assert.equal(text(repo), 'a\nc\n');
  assert.deepEqual(kind5(repo), []);
});
