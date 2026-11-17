/**
 * S3: derived vs authored needs, carry codes, waiver, parent_pool_missing (spec v6 4.9, 4.11, 12).
 * Rows T45, T46, T47, T48 (delegator A-Q9-1, A-Q9a-1..3, A-Q9b-1,2, A-Q9c-1, A-Q10-1..3).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assemble,
  carry,
  carryPreview,
  checkin,
  deriveNeeds,
  forkStream,
  inspect,
  movesOn,
  needsReport,
  pull,
  recordWaiver,
  replayRepo,
  restore,
  saveScript,
} from './engine.mjs';
import { canonJson } from './canon.mjs';
import { indexScripts } from './model.mjs';
import { directNeedIds, START, END } from './weave.mjs';
import { NEEDS_ALGO, NEED_REASONS, PARENT_POOL_OPTIONS } from './codes.mjs';
import { deriveEdges } from './needs.mjs';
import { makeDemoRepo, makeOdbcRepo, O, script121, script122, withIntent } from './fixture.mjs';

const V1 = ['1', '2', '3', '4', '5'];
const SIGNER = 'rich@desk';

function snapshot(repo) {
  return JSON.stringify({ scripts: repo.scripts, streams: repo.streams, repoEvents: repo.repoEvents, seq: repo.seq });
}

function save(repo) {
  return JSON.parse(JSON.stringify({ scripts: repo.scripts, streams: repo.streams, repoEvents: repo.repoEvents, seq: repo.seq }));
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

/** Collect every object in a value that looks like a needs report or needs notice. */
function needsObjects(value, out = []) {
  if (Array.isArray(value)) for (const item of value) needsObjects(item, out);
  else if (value && typeof value === 'object') {
    if ('needs_derived' in value || value.code === 'needs_authored_unproven' || value.code === 'needs_derived_missing' && 'waived' in value) out.push(value);
    for (const key of Object.keys(value)) if (key !== 'event') needsObjects(value[key], out);
  }
  return out;
}

test('S3 deriveNeeds: move 10 edges are exact, sorted, and tagged needs-v1', () => {
  const repo = makeDemoRepo();
  const derived = deriveNeeds(repo, '10');
  assert.deepEqual(derived, {
    derive_algo: 'needs-v1',
    move_id: '10',
    script_present: true,
    needs_derived: [
      { move_id: '1', via_node_id: 'n:main', reason_code: 'anchor' },
      { move_id: '7', via_node_id: 'n:main', reason_code: 'anchor' },
      { move_id: '7', via_node_id: 'n:main', reason_code: 'replaces' },
      { move_id: '7', via_node_id: 'n:main', reason_code: 'switch_off' },
    ],
  });
  assert.equal(NEEDS_ALGO, 'needs-v1');
  for (const edge of derived.needs_derived) assert.ok(NEED_REASONS.includes(edge.reason_code));
  const missing = deriveNeeds(repo, 'no.such.move');
  assert.deepEqual(missing, { derive_algo: 'needs-v1', move_id: 'no.such.move', script_present: false, needs_derived: [] });
});

test('S3 deriveNeeds: reason codes for pools, entries, resolution inputs; move set equals directNeedIds', () => {
  const repo = t34Repo();
  saveScript(repo, script121());
  saveScript(repo, script122());
  assert.deepEqual(deriveNeeds(repo, 'file.db').needs_derived, [
    { move_id: 'pool.db', via_node_id: 'p:db', reason_code: 'parent_pool' },
  ]);
  assert.deepEqual(deriveNeeds(repo, O.m118).needs_derived, [
    { move_id: O.seed1, via_node_id: O.src, reason_code: 'parent_pool' },
    { move_id: O.seed4, via_node_id: O.file, reason_code: 'anchor' },
    { move_id: O.seed4, via_node_id: O.file, reason_code: 'replaces' },
    { move_id: O.seed4, via_node_id: O.file, reason_code: 'switch_off' },
    { move_id: O.seed4, via_node_id: O.file, reason_code: 'entry_visible' },
  ]);
  const r122 = deriveNeeds(repo, O.m122).needs_derived;
  assert.deepEqual(
    r122.filter((edge) => edge.reason_code === 'resolution_input'),
    [
      { move_id: O.m118, via_node_id: null, reason_code: 'resolution_input' },
      { move_id: O.m121, via_node_id: null, reason_code: 'resolution_input' },
    ],
  );
  for (const fixtureRepo of [repo, makeDemoRepo()]) {
    const idx = indexScripts(fixtureRepo.scripts);
    for (const script of Object.values(fixtureRepo.scripts)) {
      const fromEdges = [...new Set(deriveEdges(idx, script).map((edge) => edge.move_id))].sort();
      assert.deepEqual(fromEdges, directNeedIds(idx, script).slice().sort(), `move ${script.id}`);
    }
  }
});

test('T45 carry of move 10 into v1: needs_derived_missing names the group; withNeeds lands it in one event', () => {
  const repo = makeDemoRepo();
  const before = snapshot(repo);
  const preview = carryPreview(repo, 'v1', '10');
  assert.equal(snapshot(repo), before);
  const refused = carry(repo, 'v1', '10');
  assert.equal(refused.ok, false);
  assert.equal(refused.refused, true);
  assert.equal(refused.code, 'needs_derived_missing');
  assert.deepEqual(refused.move_ids, ['6', '7']);
  assert.deepEqual(refused.group_moves, ['6', '7', '10']);
  assert.equal(refused.needs_report.derive_algo, 'needs-v1');
  assert.deepEqual(refused.needs_report.needs_authored, []);
  assert.deepEqual(refused.needs_report.needs_derived_only, ['1', '7']);
  assert.deepEqual(refused.needs_report.needs_authored_only, []);
  assert.equal(snapshot(repo), before, 'no event, no script change');
  assert.deepEqual(movesOn(repo, 'v1'), V1);
  assert.deepEqual({ ...preview, preview: undefined }, { ...refused, preview: undefined });

  const wouldLand = carryPreview(repo, 'v1', '10', { withNeeds: true });
  assert.equal(snapshot(repo), before);
  assert.deepEqual(wouldLand.would_add, ['6', '7', '10']);
  const events = repo.streams.v1.events.length;
  const carried = carry(repo, 'v1', '10', { withNeeds: true });
  assert.equal(carried.ok, true);
  assert.deepEqual(carried.added, refused.group_moves);
  assert.deepEqual(carried.added, wouldLand.would_add);
  assert.equal(repo.streams.v1.events.length, events + 1);
  assert.deepEqual(carried.event.moves, ['6', '7', '10']);
  assert.deepEqual(movesOn(repo, 'v1'), [...V1, '6', '7', '10']);
  assert.equal(inspect(repo, 'v1').snags.length, 0);
  assert.deepEqual(carried.notices, []);
});

test('T46 authored-only need: carry lands with notice needs_authored_unproven, never a refusal', () => {
  const repo = makeOdbcRepo();
  const claim = withIntent({
    id: 'claim',
    orderKey: '300',
    lines: [{ id: 'Lclaim', node: O.file, bytes: '/* claim */\n', after: 'L4.2', before: END }],
  }, { needs: [O.m118] });
  assert.equal(checkin(repo, 'dev', claim).ok, true);
  const report = needsReport(repo, 'claim');
  assert.deepEqual(report.needs_authored, [O.m118]);
  assert.deepEqual(report.needs_authored_only, [O.m118]);
  assert.deepEqual(report.needs_derived_only, [O.seed4]);

  const events = repo.streams.release.events.length;
  const landed = carry(repo, 'release', 'claim');
  assert.equal(landed.ok, true);
  assert.equal(landed.refused, undefined);
  assert.deepEqual(landed.added, ['claim']);
  assert.deepEqual(landed.notices, [
    { code: 'needs_authored_unproven', move: 'claim', move_ids: [O.m118], derive_algo: 'needs-v1' },
  ]);
  assert.equal(repo.streams.release.events.length, events + 1);
  assert.equal(movesOn(repo, 'release').includes(O.m118), false, 'authored need is not pulled in');

  const intentReport = inspect(repo, 'release').intent_reports.find((item) => item.move === 'claim');
  assert.deepEqual(intentReport, { move: 'claim', need: O.m118, code: 'intent_need_absent', provenance: 'authored_only' });

  // With withNeeds the authored-only need is still not carried; notice unchanged.
  const repo2 = makeOdbcRepo();
  checkin(repo2, 'dev', claim);
  const withNeeds = carry(repo2, 'release', 'claim', { withNeeds: true });
  assert.equal(withNeeds.ok, true);
  assert.deepEqual(withNeeds.added, ['claim']);
  assert.equal(withNeeds.notices[0].code, 'needs_authored_unproven');
});

test('T46b an authored need that is also derived follows the derived rule; provenance is derived', () => {
  const repo = makeOdbcRepo();
  const both = withIntent({
    id: 'both',
    orderKey: '301',
    lines: [{ id: 'Lboth', node: O.file, bytes: '/* after ext */\n', after: 'L117.0', before: 'L4.1' }],
  }, { needs: [O.m117] });
  assert.equal(checkin(repo, 'dev', both).ok, true);
  const report = needsReport(repo, 'both');
  assert.deepEqual(report.needs_authored_only, []);
  assert.ok(report.needs_derived.some((edge) => edge.move_id === O.m117 && edge.reason_code === 'anchor'));
  const refused = carry(repo, 'release', 'both');
  assert.equal(refused.code, 'needs_derived_missing');
  assert.deepEqual(refused.move_ids, [O.m117]);
  const view = assemble(repo, { moves: [O.seed1, O.seed4, 'both'] });
  assert.deepEqual(
    view.intent_reports.find((item) => item.code === 'intent_need_absent' && item.move === 'both'),
    { move: 'both', need: O.m117, code: 'intent_need_absent', provenance: 'derived' },
  );
  assert.deepEqual(view.intent_need_absent.find((item) => item.move === 'both').provenance, 'derived');
});

test('T47 a waiver for the exact edge lets the carry land; the derived-missing notice stays', () => {
  const repo = makeDemoRepo();
  const waived = recordWaiver(repo, { move_id: '10', need_move_id: '7', reason: 'backport runSafe without init' }, { signer: SIGNER });
  assert.equal(waived.ok, true);
  assert.equal(waived.event.kind, 'waiver');
  assert.equal(waived.event.signer, SIGNER);
  assert.deepEqual(waived.event.waiver, { move_id: '10', need_move_id: '7', reason: 'backport runSafe without init' });
  assert.ok(repo.repoEvents.includes(waived.event));

  const again = recordWaiver(repo, { move_id: '10', need_move_id: '7', reason: 'same edge' }, { signer: SIGNER });
  assert.equal(again.alreadyWaived, true);
  assert.equal(repo.repoEvents.length, 1);

  const preview = carryPreview(repo, 'v1', '10');
  assert.deepEqual(preview.would_add, ['10']);
  const landed = carry(repo, 'v1', '10');
  assert.equal(landed.ok, true);
  assert.deepEqual(landed.added, ['10']);
  assert.deepEqual(landed.notices, [
    {
      code: 'needs_derived_missing',
      move: '10',
      move_ids: ['7'],
      waived: [{ move_id: '10', need_move_id: '7', event: waived.event.id }],
      derive_algo: 'needs-v1',
    },
  ]);
  assert.deepEqual(landed.event.waivers, [waived.event.id]);
  assert.deepEqual(movesOn(repo, 'v1'), [...V1, '10']);
  // The waiver lets the carry land; the missing maker still shows as a snag after it.
  assert.ok(inspect(repo, 'v1').snags.some((snag) => snag.kind === 4 && snag.need === '7'));

  // Waivers are repo events and survive a replay.
  const replayed = replayRepo(save(makeDemoRepoWithWaiver()));
  assert.equal(carry(replayed, 'v1', '10').ok, true);
});

function makeDemoRepoWithWaiver() {
  const repo = makeDemoRepo();
  recordWaiver(repo, { move_id: '10', need_move_id: '7', reason: 'backport runSafe without init' }, { signer: SIGNER });
  return repo;
}

test('T47b a waiver for another edge does not help: needs_derived_missing, no event', () => {
  const other = makeDemoRepo();
  assert.equal(recordWaiver(other, { move_id: '10', need_move_id: '6', reason: 'not a direct edge' }, { signer: SIGNER }).ok, true);
  const events = other.streams.v1.events.length;
  const r1 = carry(other, 'v1', '10');
  assert.equal(r1.code, 'needs_derived_missing');
  assert.deepEqual(r1.move_ids, ['6', '7']);
  assert.equal(other.streams.v1.events.length, events);

  const inner = makeDemoRepo();
  assert.equal(recordWaiver(inner, { move_id: '7', need_move_id: '6', reason: 'inner edge only' }, { signer: SIGNER }).ok, true);
  const r2 = carry(inner, 'v1', '10');
  assert.equal(r2.code, 'needs_derived_missing');
  assert.deepEqual(r2.move_ids, ['7']);
  assert.deepEqual(movesOn(inner, 'v1'), V1);
});

test('T47c a malformed waiver is waiver_invalid: nothing recorded; a stored malformed waiver refuses the carry', () => {
  const ok = { move_id: '10', need_move_id: '7', reason: 'r' };
  const cases = [
    [null, SIGNER, '/', 'wrong_type'],
    [['10', '7'], SIGNER, '/', 'wrong_type'],
    [{ ...ok, stream: 'v1' }, SIGNER, '/stream', 'unknown_field'],
    [{ move_id: '10', need_move_id: '7' }, SIGNER, '/reason', 'missing'],
    [{ need_move_id: '7', reason: 'r' }, SIGNER, '/move_id', 'missing'],
    [{ ...ok, move_id: 10 }, SIGNER, '/move_id', 'wrong_type'],
    [{ ...ok, need_move_id: 'bad id' }, SIGNER, '/need_move_id', 'bad_id'],
    [{ ...ok, need_move_id: '10' }, SIGNER, '/need_move_id', 'self_reference'],
    [{ ...ok, reason: '' }, SIGNER, '/reason', 'empty'],
    [{ ...ok, reason: '  ' }, SIGNER, '/reason', 'blank'],
    [{ ...ok, reason: 'a\nb' }, SIGNER, '/reason', 'control_char'],
    [{ ...ok, reason: 'x'.repeat(201) }, SIGNER, '/reason', 'too_long'],
    [ok, undefined, '/signer', 'missing'],
    [ok, 'bad signer', '/signer', 'bad_id'],
  ];
  for (const [waiver, signer, field, reason] of cases) {
    const repo = makeDemoRepo();
    const before = snapshot(repo);
    const refused = recordWaiver(repo, waiver, { signer });
    assert.equal(refused.ok, false, `${field} ${reason}`);
    assert.equal(refused.code, 'waiver_invalid');
    assert.equal(refused.field, field);
    assert.equal(refused.reason, reason);
    assert.equal(snapshot(repo), before);
    assert.equal(carry(repo, 'v1', '10').code, 'needs_derived_missing');
  }

  const saved = save(makeDemoRepo());
  saved.seq += 1;
  saved.repoEvents.push({ id: `ev.${saved.seq}`, seq: saved.seq, kind: 'waiver', waiver: { move_id: '10', need_move_id: '7' }, signer: SIGNER });
  const repo = replayRepo(saved);
  const events = repo.streams.v1.events.length;
  const refused = carry(repo, 'v1', '10');
  assert.equal(refused.code, 'waiver_invalid');
  assert.equal(refused.field, '/reason');
  assert.equal(refused.reason, 'missing');
  assert.equal(refused.event, `ev.${saved.seq}`);
  assert.equal(repo.streams.v1.events.length, events);
  // withNeeds does not consult waivers and carries the full group.
  assert.deepEqual(carry(repo, 'v1', '10', { withNeeds: true }).added, ['6', '7', '10']);
});

test('T48 T34 setup: parent_pool_missing with options [add_parent, refuse]; withNeeds carries parent and child in one event', () => {
  const repo = t34Repo();
  const before = snapshot(repo);
  const refused = carry(repo, 'dev', 'file.db');
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'parent_pool_missing');
  assert.equal(refused.node_id, 'p:db');
  assert.equal(refused.parent_move_id, 'pool.db');
  assert.deepEqual(refused.options, ['add_parent', 'refuse']);
  assert.deepEqual(PARENT_POOL_OPTIONS, ['add_parent', 'refuse']);
  assert.deepEqual(refused.parent_pool_missing, [
    { node_id: 'p:db', parent_move_id: 'pool.db', child_node_id: 'n:row', entry_id: 'E:row', options: ['add_parent', 'refuse'] },
  ]);
  assert.equal(canonJson(refused).includes('reparent'), false, 'no reparent option (ask_10b)');
  assert.equal(refused.node_id.includes('/'), false, 'identity is a node id, not a path');
  assert.equal(snapshot(repo), before);
  assert.equal(inspect(repo, 'dev').snags.some((snag) => snag.kind === 8), false);

  // A waiver cannot bypass a pool precondition.
  recordWaiver(repo, { move_id: 'file.db', need_move_id: 'pool.db', reason: 'try without parent' }, { signer: SIGNER });
  const stillRefused = carry(repo, 'dev', 'file.db');
  assert.equal(stillRefused.code, 'parent_pool_missing');

  const events = repo.streams.dev.events.length;
  const carried = carry(repo, 'dev', 'file.db', { withNeeds: true });
  assert.equal(carried.ok, true);
  assert.deepEqual(carried.event.moves, ['pool.db', 'file.db']);
  assert.equal(repo.streams.dev.events.length, events + 1);
  const view = inspect(repo, 'dev');
  assert.ok(view.files.some((file) => file.path === 'src/db/row.c'));
  assert.equal(view.snags.some((snag) => snag.kind === 8), false);
});

test('S3 derive_algo is in every needs report and two runs give byte-identical canonJson', () => {
  const run = () => {
    const demo = makeDemoRepo();
    const odbc = t34Repo();
    checkin(odbc, 'dev', withIntent({
      id: 'claim',
      orderKey: '300',
      lines: [{ id: 'Lclaim', node: O.file, bytes: '/* claim */\n', after: 'L4.2', before: END }],
    }, { needs: [O.m118] }));
    const out = {
      derive: deriveNeeds(demo, '10'),
      report: needsReport(demo, '10'),
      assembleV2: assemble(demo, { stream: 'v2' }).needs_reports,
      assembleDev: assemble(odbc, { stream: 'dev' }).needs_reports,
      intentReports: assemble(odbc, { moves: [O.seed1, O.seed4, 'claim'] }).intent_reports,
      refusal: carry(demo, 'v1', '10'),
      previewWith: carryPreview(demo, 'v1', '10', { withNeeds: true }),
      pool: carry(odbc, 'dev', 'file.db'),
      authored: carryPreview(odbc, 'release', 'claim'),
    };
    return out;
  };
  const a = run();
  const b = run();
  assert.equal(canonJson(a), canonJson(b));
  const reports = needsObjects(a);
  assert.ok(reports.length >= 20, `found ${reports.length} needs reports`);
  for (const report of reports) assert.equal(report.derive_algo, 'needs-v1');
  for (const report of Object.values(a.assembleV2)) {
    assert.deepEqual(Object.keys(report).sort(), [
      'derive_algo', 'move_id', 'needs_authored', 'needs_authored_only', 'needs_derived', 'needs_derived_only', 'script_present',
    ]);
  }
});

test('S3 T26 T27 rule: pull and restore never consult needs and land', () => {
  const repo = makeDemoRepo();
  const saved = save(repo);
  saved.seq += 1;
  saved.repoEvents.push({ id: `ev.${saved.seq}`, seq: saved.seq, kind: 'waiver', waiver: 'junk', signer: SIGNER });
  const replayed = replayRepo(saved);
  assert.equal(restore(replayed, 'v1', '10').ok, true);
  assert.ok(inspect(replayed, 'v1').snags.some((snag) => snag.kind === 4 && snag.need === '7'));
  assert.equal(pull(replayed, 'v2', '7').ok, true);
});

test('S3 T31 resolution without inputs: refusal code needs_derived_missing, message unchanged', () => {
  const repo = makeOdbcRepo();
  saveScript(repo, script121());
  saveScript(repo, script122());
  const refused = carry(repo, 'release', O.m122);
  assert.equal(refused.code, 'needs_derived_missing');
  assert.ok(refused.move_ids.includes(O.m118));
  assert.ok(refused.move_ids.includes(O.m121));
  assert.match(refused.message, /not in this stream; carry them as a raft or leave the resolution behind/);
});
