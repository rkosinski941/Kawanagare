/**
 * G-41: raft carry reply parity with a single-move carry (spec v6 4.9; D-S3-06, D-S3-08).
 * Rows R-G41-01..06. External review gaps Q5a (waived notice) and Q5b (problem fields).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  carry,
  carryPreview,
  carryRaft,
  checkin,
  defineRaft,
  forkStream,
  movesOn,
  recordWaiver,
  replayRepo,
} from './engine.mjs';
import { START, END } from './weave.mjs';
import { makeDemoRepo, makeOdbcRepo, O, withIntent } from './fixture.mjs';

const V1 = ['1', '2', '3', '4', '5'];
const SIGNER = 'rich@desk';
const RANK = ['waiver_invalid', 'parent_pool_missing', 'needs_derived_missing', 'entry_not_visible', 'script_missing'];

function snapshot(repo) {
  return JSON.stringify({ scripts: repo.scripts, streams: repo.streams, repoEvents: repo.repoEvents, seq: repo.seq });
}

function t34Repo() {
  const repo = makeOdbcRepo();
  forkStream(repo, 'release', 'feature');
  assert.equal(checkin(repo, 'feature', withIntent({
    id: 'pool.db',
    orderKey: '50',
    nodes: [{ id: 'p:db', kind: 'pool' }],
    entries: [{ id: 'E:dbpool', pool: O.src, node: 'p:db', name: 'db' }],
  })).ok, true);
  assert.equal(checkin(repo, 'feature', withIntent({
    id: 'file.db',
    orderKey: '51',
    nodes: [{ id: 'n:row', kind: 'file' }],
    entries: [{ id: 'E:row', pool: 'p:db', node: 'n:row', name: 'row.c' }],
    lines: [{ id: 'Row', node: 'n:row', bytes: 'int row;\n', after: START, before: END }],
  })).ok, true);
  return repo;
}

test('R-G41-01 raft [10] into v1 with no waiver: code needs_derived_missing; problem fields match carry', () => {
  const repo = makeDemoRepo();
  defineRaft(repo, { id: 'raft.10', members: ['10'] });
  const single = carryPreview(repo, 'v1', '10');
  const before = snapshot(repo);
  const r = carryRaft(repo, 'v1', 'raft.10');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'needs_derived_missing');
  assert.equal(r.problems.length, 1);
  const p = r.problems[0];
  assert.equal(p.move, '10');
  assert.equal(p.code, single.code);
  assert.deepEqual(p.move_ids, single.move_ids);
  assert.deepEqual(p.needs_report, single.needs_report);
  assert.deepEqual(p.notices, []);
  assert.deepEqual(r.needs_reports, { 10: single.needs_report });
  assert.deepEqual(r.notices, []);
  assert.equal(snapshot(repo), before);
});

test('R-G41-02 raft [10] with a waiver on edge 10->7 lands; needs_derived_missing notice equals single carry (Q5a)', () => {
  const repo = makeDemoRepo();
  const waived = recordWaiver(repo, { move_id: '10', need_move_id: '7', reason: 'backport runSafe without init' }, { signer: SIGNER });
  assert.equal(waived.ok, true);
  defineRaft(repo, { id: 'raft.10', members: ['10'] });
  const single = carryPreview(repo, 'v1', '10');
  assert.equal(single.ok, true);
  const r = carryRaft(repo, 'v1', 'raft.10');
  assert.equal(r.ok, true);
  assert.deepEqual(r.added, ['10']);
  assert.deepEqual(r.notices, single.notices);
  assert.deepEqual(r.notices, [
    {
      code: 'needs_derived_missing',
      move: '10',
      move_ids: ['7'],
      waived: [{ move_id: '10', need_move_id: '7', event: waived.event.id }],
      derive_algo: 'needs-v1',
    },
  ]);
  assert.deepEqual(r.needs_reports, { 10: single.needs_report });
  assert.deepEqual(r.event.waivers, [waived.event.id]);
  assert.equal(r.event.via, 'raft');
  assert.deepEqual(movesOn(repo, 'v1'), [...V1, '10']);
});

test('R-G41-03 raft [6, 7, 10]: members meet each other; one event, no waivers field, no notices', () => {
  const repo = makeDemoRepo();
  defineRaft(repo, { id: 'raft.group', members: ['6', '7', '10'] });
  const r = carryRaft(repo, 'v1', 'raft.group');
  assert.equal(r.ok, true);
  assert.deepEqual(r.added, ['6', '7', '10']);
  assert.deepEqual(r.notices, []);
  assert.equal('waivers' in r.event, false);
  assert.deepEqual(Object.keys(r.needs_reports).sort(), ['10', '6', '7']);
  assert.deepEqual(movesOn(repo, 'v1'), [...V1, '6', '7', '10']);
});

test('R-G41-04 raft [file.db] (T34 setup): parent_pool_missing first; problem fields match carry (Q5b)', () => {
  const repo = t34Repo();
  defineRaft(repo, { id: 'raft.row', members: ['file.db'] });
  const single = carry(repo, 'dev', 'file.db');
  assert.equal(single.code, 'parent_pool_missing');
  const before = snapshot(repo);
  const r = carryRaft(repo, 'dev', 'raft.row');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'parent_pool_missing');
  assert.deepEqual(r.problems.map((p) => p.code), ['parent_pool_missing', 'needs_derived_missing']);
  const p = r.problems[0];
  assert.equal(p.move, 'file.db');
  assert.equal(p.node_id, single.node_id);
  assert.equal(p.parent_move_id, single.parent_move_id);
  assert.equal(p.parent_move_id, 'pool.db');
  assert.deepEqual(p.options, ['add_parent', 'refuse']);
  const item = single.parent_pool_missing[0];
  assert.equal(p.child_node_id, item.child_node_id);
  assert.equal(p.entry_id, item.entry_id);
  assert.deepEqual(p.needs_report, single.needs_report);
  assert.deepEqual(p.notices, []);
  assert.deepEqual(r.problems[1].move_ids, ['pool.db']);
  assert.equal(snapshot(repo), before);

  // A waiver cannot bypass a pool precondition (same as T48).
  recordWaiver(repo, { move_id: 'file.db', need_move_id: 'pool.db', reason: 'try without parent' }, { signer: SIGNER });
  const again = carryRaft(repo, 'dev', 'raft.row');
  assert.equal(again.code, 'parent_pool_missing');
  assert.deepEqual(again.problems.map((q) => q.code), ['parent_pool_missing']);

  // The parent in the raft meets both preconditions.
  defineRaft(repo, { id: 'raft.both', members: ['pool.db', 'file.db'] });
  const both = carryRaft(repo, 'dev', 'raft.both');
  assert.equal(both.ok, true);
  assert.deepEqual(both.event.moves, ['pool.db', 'file.db']);
});

test('R-G41-05 stored malformed waiver: raft code waiver_invalid ranks first, fields match carry', () => {
  const saved = JSON.parse(JSON.stringify((() => {
    const repo = makeDemoRepo();
    defineRaft(repo, { id: 'raft.10', members: ['10'] });
    return { scripts: repo.scripts, streams: repo.streams, repoEvents: repo.repoEvents, seq: repo.seq };
  })()));
  saved.seq += 1;
  saved.repoEvents.push({ id: `ev.${saved.seq}`, seq: saved.seq, kind: 'waiver', waiver: { move_id: '10', need_move_id: '7' }, signer: SIGNER });
  const repo = replayRepo(saved);
  const single = carryPreview(repo, 'v1', '10');
  assert.equal(single.code, 'waiver_invalid');
  const events = repo.streams.v1.events.length;
  const r = carryRaft(repo, 'v1', 'raft.10');
  assert.equal(r.code, 'waiver_invalid');
  assert.deepEqual(r.problems.map((p) => p.code), ['waiver_invalid', 'needs_derived_missing']);
  const p = r.problems[0];
  assert.equal(p.event, single.event);
  assert.equal(p.field, '/reason');
  assert.equal(p.reason, 'missing');
  assert.deepEqual(p.needs_report, single.needs_report);
  assert.deepEqual(p.notices, []);
  assert.equal(repo.streams.v1.events.length, events);
});

test('R-G41-06 problems are sorted by refusal rank, stable in member order; message names the first code', () => {
  const repo = t34Repo();
  defineRaft(repo, { id: 'raft.mix', members: ['ghost', 'file.db'] });
  const r = carryRaft(repo, 'dev', 'raft.mix');
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems.map((p) => p.code), ['parent_pool_missing', 'needs_derived_missing', 'script_missing']);
  assert.deepEqual(r.problems.map((p) => p.move), ['file.db', 'file.db', 'ghost']);
  const ranks = r.problems.map((p) => RANK.indexOf(p.code));
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b));
  assert.equal(r.code, 'parent_pool_missing');
  assert.equal(r.message, 'raft raft.mix refused: parent_pool_missing: file.db, ghost');
  assert.deepEqual(Object.keys(r.needs_reports), ['file.db']);
});
