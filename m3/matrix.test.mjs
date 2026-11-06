/**
 * Paper snag matrix T01–T40, exercised against the M3 v4 reference engine.
 *
 * Kind 6 (twin) is a label on a kind 1 or kind 2 snag, not a second snag.
 * Kind 11 is a tag (`tag11` / `exposedBy`) on the underlying snag.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  carry,
  carryRaft,
  checkin,
  createRepo,
  defineRaft,
  exportStream,
  forkStream,
  inspect,
  landEvent,
  movesOn,
  pull,
  restore,
  saveScript,
  setPolicy,
  snagKey,
  submitEvent,
  syncScripts,
  replayRepo,
  project,
} from './engine.mjs';
import { insideWorktree, forbiddenName } from './names.mjs';
import { END, START } from './weave.mjs';
import {
  makeOdbcRepo,
  O,
  RELEASE,
  STEP4,
  STEP5,
  STEP7,
  script121,
  script122,
} from './fixture.mjs';

function text(repo, stream, path) {
  const file = inspect(repo, stream).files.find((item) => item.path === path);
  return file ? file.bytes : null;
}

function kinds(repo, stream) {
  return inspect(repo, stream).snags.map((snag) => snag.kind);
}

test('T01 kind 1: Joy replacing L4.1 stays on beside move 118 and blocks export', () => {
  const repo = makeOdbcRepo();
  const landed = checkin(repo, 'dev', script121());
  assert.equal(landed.ok, true);
  const view = inspect(repo, 'dev');
  const snag = view.snags.find((item) => item.kind === 1);
  assert.ok(snag);
  assert.equal(snag.twin, false);
  assert.equal(snag.tag11, false);
  assert.deepEqual(snag.lines.slice().sort(), ['L118.0', 'L121.0']);
  assert.ok(movesOn(repo, 'dev').includes(O.m118));
  assert.ok(movesOn(repo, 'dev').includes(O.m121));
  assert.equal(view.exportable, false);
  assert.equal(exportStream(repo, 'dev').ok, false);
});

test('T02 kind 1 labelled twin: byte-identical replacements are one snag', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', script121('int open(int flags);\n'));
  const view = inspect(repo, 'dev');
  const slots = view.snags.filter((snag) => snag.kind === 1);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].twin, true);
  assert.equal(view.snags.some((snag) => snag.kind === 6), false);
  assert.equal(view.exportable, false);
});

test('T03 kind 2: same-gap inserts stay in order_key order and still snag', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'release', {
    id: 'gap.high',
    orderKey: '20',
    lines: [{ id: 'GH', node: O.file, bytes: 'HIGH\n', after: 'L4.0', before: 'L4.1' }],
  });
  checkin(repo, 'release', {
    id: 'gap.low',
    orderKey: '10',
    lines: [{ id: 'GL', node: O.file, bytes: 'LOW\n', after: 'L4.0', before: 'L4.1' }],
  });
  const view = inspect(repo, 'release');
  const snag = view.snags.find((item) => item.kind === 2);
  assert.ok(snag);
  assert.equal(snag.twin, false);
  const body = text(repo, 'release', 'src/odbc.c');
  assert.ok(body.indexOf('LOW\n') < body.indexOf('HIGH\n'));
  assert.equal(view.exportable, false);
});

test('T04 kind 3: an insert whose after-anchor is a replaced line snags', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', {
    id: 'joy.insert',
    orderKey: '200',
    author: 'joy',
    site: 'lap',
    saw: [O.seed1, O.seed4],
    lines: [{ id: 'J1', node: O.file, bytes: '/* beside */\n', after: 'L4.1', before: 'L4.2' }],
  });
  const view = inspect(repo, 'dev');
  assert.ok(view.snags.some((snag) => snag.kind === 3 && snag.spot === 'L4.1'));
  assert.ok(text(repo, 'dev', 'src/db.c').includes('/* beside */\n'));
  assert.equal(view.exportable, false);
});

test('T05 kind 4: anchoring on a pulled move is missing-need, not a waiting notice', () => {
  const repo = makeOdbcRepo();
  pull(repo, 'dev', O.m117);
  checkin(repo, 'dev', {
    id: 'move.B',
    orderKey: '9',
    lines: [{ id: 'B1', node: O.file, bytes: 'x\n', after: 'L117.0', before: END }],
  });
  const view = inspect(repo, 'dev');
  assert.ok(view.snags.some((snag) => snag.kind === 4 && snag.need === O.m117));
  assert.equal(view.notices.some((notice) => notice.kind === 'waiting'), false);
});

test('T06 waiting: a missing script is a notice that holds export and is not kind 4', () => {
  const repo = createRepo();
  checkin(repo, 'dev', {
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'f', kind: 'file' },
    ],
    entries: [{ id: 'Ef', pool: 'root', node: 'f', name: 't.txt' }],
    lines: [{ id: 'L0', node: 'f', bytes: 'base\n', after: START, before: END }],
  });
  landEvent(repo, 'dev', { kind: 'checkin', move: 'move.117', site: 'desk' });
  checkin(repo, 'dev', {
    id: 'move.B',
    orderKey: '2',
    lines: [{ id: 'B1', node: 'f', bytes: 'x\n', after: 'L117.0', before: END }],
  });
  const view = inspect(repo, 'dev');
  const waiting = view.notices.find((notice) => notice.kind === 'waiting');
  assert.ok(waiting);
  assert.equal(waiting.move, 'move.117');
  assert.equal(waiting.site, 'desk');
  assert.equal(view.snags.some((snag) => snag.kind === 4), false);
  assert.equal(view.exportable, false);
});

test('T07 kind 5: an anchor switched off with no replacement is lost, and the weave still orders', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', { id: 'off42', orderKey: '201', off: ['L4.2'] });
  checkin(repo, 'dev', {
    id: 'insD',
    orderKey: '202',
    lines: [{ id: 'D1', node: O.file, bytes: 'tail\n', after: 'L4.2', before: END }],
  });
  const view = inspect(repo, 'dev');
  const lost = view.snags.filter((snag) => snag.kind === 5 && snag.spot === 'L4.2');
  assert.equal(lost.length, 1);
  const body = text(repo, 'dev', 'src/db.c');
  assert.ok(body.includes('tail\n'));
  assert.equal(body.includes('int close();\n'), false);
});

test('T08 twin label: a identical 3-line run is one kind-2 snag, labelled twin', () => {
  const repo = createRepo();
  checkin(repo, 'dev', {
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'f', kind: 'file' },
    ],
    entries: [{ id: 'Ef', pool: 'root', node: 'f', name: 't.txt' }],
    lines: [
      { id: 'A', node: 'f', bytes: 'before\n', after: START, before: END },
      { id: 'B', node: 'f', bytes: 'after\n', after: 'A', before: END },
    ],
  });
  const run = (id, key) => checkin(repo, 'dev', {
    id,
    orderKey: key,
    lines: [1, 2, 3].map((n) => ({
      id: `${id}.${n}`,
      node: 'f',
      bytes: `line ${n}\n`,
      after: 'A',
      before: 'B',
    })),
  });
  run('fix.a', '2');
  run('fix.b', '3');
  const view = inspect(repo, 'dev');
  const snags = view.snags.filter((snag) => snag.kind === 2);
  assert.equal(snags.length, 1);
  assert.equal(snags[0].twin, true);
  assert.equal(view.snags.some((snag) => snag.kind === 6), false);
});

test('T09 a lone closing brace in the same gap is kind 2 and not a twin', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'release', {
    id: 'brace.a',
    orderKey: '2',
    lines: [{ id: 'BA', node: O.file, bytes: '}\n', after: 'L4.0', before: 'L4.1' }],
  });
  checkin(repo, 'release', {
    id: 'brace.b',
    orderKey: '3',
    lines: [{ id: 'BB', node: O.file, bytes: '}\n', after: 'L4.0', before: 'L4.1' }],
  });
  const snag = inspect(repo, 'release').snags.find((item) => item.kind === 2);
  assert.ok(snag);
  assert.equal(snag.twin, false);
});

test('T10 carrying a move that is already on writes no event', () => {
  const repo = makeOdbcRepo();
  const before = repo.streams.dev.events.length;
  const result = carry(repo, 'dev', O.m117);
  assert.equal(result.ok, true);
  assert.equal(result.alreadyOn, true);
  assert.match(result.message, /already on in dev/);
  assert.match(result.message, /nothing to do/);
  assert.equal(repo.streams.dev.events.length, before);
});

test('T11 carrying a twin tags the kind-1 snag with the carry', () => {
  const repo = makeOdbcRepo();
  const ontoRelease = carry(repo, 'release', O.m118);
  assert.equal(ontoRelease.ok, true);
  checkin(repo, 'dev', script121('int open(int flags);\n'));
  const carried = carry(repo, 'release', O.m121);
  assert.equal(carried.ok, true);
  const snag = inspect(repo, 'release').snags.find((item) => item.kind === 1);
  assert.ok(snag);
  assert.equal(snag.twin, true);
  assert.equal(snag.tag11, true);
  assert.equal(snag.exposedByKind, 'carry');
  assert.equal(snag.exposedBy, carried.event.id);
});

test('T12 kind 7: two entries named util.c in one pool', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', {
    id: 'u1',
    orderKey: '30',
    nodes: [{ id: 'n:u1', kind: 'file' }],
    entries: [{ id: 'E:u1', pool: O.src, node: 'n:u1', name: 'util.c' }],
  });
  checkin(repo, 'dev', {
    id: 'u2',
    orderKey: '31',
    nodes: [{ id: 'n:u2', kind: 'file' }],
    entries: [{ id: 'E:u2', pool: O.src, node: 'n:u2', name: 'util.c' }],
  });
  const snag = inspect(repo, 'dev').snags.find((item) => item.kind === 7);
  assert.ok(snag);
  assert.equal(snag.code, 'duplicate_name');
});

test('T13 kind 7: divergent renames put one node under two names', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', {
    id: 'rename.dbx',
    orderKey: '40',
    entryOff: [O.eOdbc],
    entries: [{ id: 'E:dbx', pool: O.src, node: O.file, name: 'dbx.c' }],
  });
  const snag = inspect(repo, 'dev').snags.find((item) => item.code === 'node_two_names');
  assert.ok(snag);
  assert.equal(snag.kind, 7);
  assert.ok(snag.names.includes('db.c'));
  assert.ok(snag.names.includes('dbx.c'));
});

test('T14 kind 7: Readme and README collide on every site under the case policy', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', {
    id: 'readme.lower',
    orderKey: '50',
    nodes: [{ id: 'n:r1', kind: 'file' }],
    entries: [{ id: 'E:r1', pool: O.src, node: 'n:r1', name: 'Readme' }],
  });
  checkin(repo, 'dev', {
    id: 'readme.upper',
    orderKey: '51',
    nodes: [{ id: 'n:r2', kind: 'file' }],
    entries: [{ id: 'E:r2', pool: O.src, node: 'n:r2', name: 'README' }],
  });
  const snag = inspect(repo, 'dev').snags.find((item) => item.code === 'duplicate_name');
  assert.ok(snag);
  assert.equal(snag.kind, 7);
});

test('T15 a case-only rename in one move is clean', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', {
    id: 'readme.seed',
    orderKey: '52',
    nodes: [{ id: 'n:readme', kind: 'file' }],
    entries: [{ id: 'E:readme', pool: O.src, node: 'n:readme', name: 'Readme' }],
    lines: [{ id: 'RL', node: 'n:readme', bytes: 'hi\n', after: START, before: END }],
  });
  const renamed = checkin(repo, 'dev', {
    id: 'readme.rename',
    orderKey: '53',
    entryOff: ['E:readme'],
    entries: [{ id: 'E:README', pool: O.src, node: 'n:readme', name: 'README' }],
  });
  assert.equal(renamed.ok, true);
  const view = inspect(repo, 'dev');
  assert.equal(view.snags.some((snag) => snag.kind === 7 && snag.names?.includes('README')), false);
  assert.equal(text(repo, 'dev', 'src/README'), 'hi\n');
  assert.equal(text(repo, 'dev', 'src/Readme'), null);
});

test('T16 NFC and NFD café.c collide under the unicode policy', () => {
  const repo = makeOdbcRepo();
  const nfc = 'caf\u00e9.c';
  const nfd = 'cafe\u0301.c';
  assert.notEqual(nfc, nfd);
  checkin(repo, 'dev', {
    id: 'cafe.nfc',
    orderKey: '60',
    nodes: [{ id: 'n:c1', kind: 'file' }],
    entries: [{ id: 'E:c1', pool: O.src, node: 'n:c1', name: nfc }],
  });
  checkin(repo, 'dev', {
    id: 'cafe.nfd',
    orderKey: '61',
    nodes: [{ id: 'n:c2', kind: 'file' }],
    entries: [{ id: 'E:c2', pool: O.src, node: 'n:c2', name: nfd }],
  });
  assert.ok(inspect(repo, 'dev').snags.some((snag) => snag.kind === 7 && snag.code === 'duplicate_name'));
});

test('T17 kind 8: a file added under a deleted pool is an orphan', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', { id: 'del.src', orderKey: '70', entryOff: [O.eSrc] });
  checkin(repo, 'dev', {
    id: 'add.inside',
    orderKey: '71',
    nodes: [{ id: 'n:util', kind: 'file' }],
    entries: [{ id: 'E:util', pool: O.src, node: 'n:util', name: 'util.c' }],
    lines: [{ id: 'U1', node: 'n:util', bytes: 'int u;\n', after: START, before: END }],
  });
  const snag = inspect(repo, 'dev').snags.find((item) => item.kind === 8);
  assert.ok(snag);
  assert.ok(snag.choices.includes('restore the pool'));
  assert.ok(snag.choices.includes('move the file elsewhere'));
  assert.equal(inspect(repo, 'dev').exportable, false);
});

test('T18 kind 9: two moves that swap pools form a cycle', () => {
  const repo = createRepo();
  checkin(repo, 'dev', {
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'a', kind: 'pool' },
      { id: 'b', kind: 'pool' },
    ],
    entries: [
      { id: 'Ea', pool: 'root', node: 'a', name: 'a' },
      { id: 'Eb', pool: 'root', node: 'b', name: 'b' },
    ],
  });
  checkin(repo, 'dev', {
    id: 'move.A',
    orderKey: '2',
    entryOff: ['Ea'],
    entries: [{ id: 'Ea2', pool: 'b', node: 'a', name: 'a' }],
  });
  checkin(repo, 'dev', {
    id: 'move.B',
    orderKey: '3',
    entryOff: ['Eb'],
    entries: [{ id: 'Eb2', pool: 'a', node: 'b', name: 'b' }],
  });
  assert.ok(inspect(repo, 'dev').snags.some((snag) => snag.kind === 9));
});

test('T19 a move that conflicts with itself is refused and does not land', () => {
  const repo = createRepo();
  checkin(repo, 'dev', {
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'f', kind: 'file' },
    ],
    entries: [{ id: 'Ef', pool: 'root', node: 'f', name: 't.txt' }],
  });
  const cycle = checkin(repo, 'dev', {
    id: 'cycle',
    orderKey: '2',
    nodes: [
      { id: 'a', kind: 'pool' },
      { id: 'b', kind: 'pool' },
    ],
    entries: [
      { id: 'e1', pool: 'a', node: 'b', name: 'b' },
      { id: 'e2', pool: 'b', node: 'a', name: 'a' },
    ],
  });
  assert.equal(cycle.ok, false);
  assert.equal(cycle.refused, true);
  assert.ok(cycle.reasons.some((reason) => reason.code === 'cycle'));
  assert.equal(movesOn(repo, 'dev').includes('cycle'), false);

  const twoNames = checkin(repo, 'dev', {
    id: 'two',
    orderKey: '3',
    entries: [
      { id: 'n1', pool: 'root', node: 'f', name: 'a.c' },
      { id: 'n2', pool: 'root', node: 'f', name: 'b.c' },
    ],
  });
  assert.equal(twoNames.refused, true);
  assert.ok(twoNames.reasons.some((reason) => reason.code === 'two_names'));

  const twoAttrs = checkin(repo, 'dev', {
    id: 'attrs',
    orderKey: '4',
    attributes: [
      { node: 'f', key: 'mode', value: '755' },
      { node: 'f', key: 'mode', value: '600' },
    ],
  });
  assert.equal(twoAttrs.refused, true);
  assert.ok(twoAttrs.reasons.some((reason) => reason.code === 'two_attributes'));
  assert.deepEqual(movesOn(repo, 'dev'), ['seed']);
});

test('T20 kind 10: two visible modes snag, and switching the old value off is clean', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', {
    id: 'mode.755',
    orderKey: '80',
    attrOff: ['seed.4:mode'],
    attributes: [{ id: 'mode.755:mode', node: O.file, key: 'mode', value: '755' }],
  });
  checkin(repo, 'dev', {
    id: 'mode.600',
    orderKey: '81',
    attrOff: ['seed.4:mode'],
    attributes: [{ id: 'mode.600:mode', node: O.file, key: 'mode', value: '600' }],
  });
  const snag = inspect(repo, 'dev').snags.find((item) => item.kind === 10);
  assert.ok(snag);
  assert.equal(snag.key, 'mode');

  const clean = makeOdbcRepo();
  checkin(clean, 'dev', {
    id: 'mode.755',
    orderKey: '80',
    attrOff: ['seed.4:mode'],
    attributes: [{ id: 'mode.755:mode', node: O.file, key: 'mode', value: '755' }],
  });
  checkin(clean, 'dev', {
    id: 'mode.600',
    orderKey: '81',
    attrOff: ['mode.755:mode'],
    attributes: [{ id: 'mode.600:mode', node: O.file, key: 'mode', value: '600' }],
  });
  assert.equal(inspect(clean, 'dev').snags.some((item) => item.kind === 10), false);
  assert.equal(inspect(clean, 'dev').files.find((file) => file.node === O.file).meta.mode, '600');
});

test('T21 kind 10: two whole-content values on a binary node', () => {
  const repo = createRepo();
  checkin(repo, 'dev', {
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'bin', kind: 'file' },
    ],
    entries: [{ id: 'Eb', pool: 'root', node: 'bin', name: 'blob.bin' }],
    attributes: [{ id: 'seed:content', node: 'bin', key: 'content', value: 'v1' }],
  });
  checkin(repo, 'dev', {
    id: 'bin.a',
    orderKey: '2',
    attrOff: ['seed:content'],
    attributes: [{ id: 'bin.a:content', node: 'bin', key: 'content', value: 'aaaa' }],
  });
  checkin(repo, 'dev', {
    id: 'bin.b',
    orderKey: '3',
    attrOff: ['seed:content'],
    attributes: [{ id: 'bin.b:content', node: 'bin', key: 'content', value: 'bbbb' }],
  });
  const snag = inspect(repo, 'dev').snags.find((item) => item.kind === 10);
  assert.ok(snag);
  assert.equal(snag.key, 'content');
});

test('T22 kind 10: two symlink targets', () => {
  const repo = createRepo();
  checkin(repo, 'dev', {
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'link', kind: 'file' },
    ],
    entries: [{ id: 'El', pool: 'root', node: 'link', name: 'alias' }],
    attributes: [{ id: 'seed:symlink', node: 'link', key: 'symlink', value: 'a' }],
  });
  checkin(repo, 'dev', {
    id: 'sym.a',
    orderKey: '2',
    attrOff: ['seed:symlink'],
    attributes: [{ id: 'sym.a:symlink', node: 'link', key: 'symlink', value: 'one' }],
  });
  checkin(repo, 'dev', {
    id: 'sym.b',
    orderKey: '3',
    attrOff: ['seed:symlink'],
    attributes: [{ id: 'sym.b:symlink', node: 'link', key: 'symlink', value: 'two' }],
  });
  const snag = inspect(repo, 'dev').snags.find((item) => item.kind === 10);
  assert.ok(snag);
  assert.equal(snag.key, 'symlink');
});

test('T23 pulling an input makes the resolution dormant and clears the snag', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', script121());
  checkin(repo, 'dev', script122());
  assert.equal(text(repo, 'dev', 'src/db.c'), STEP7);
  pull(repo, 'dev', O.m121);
  const view = inspect(repo, 'dev');
  assert.equal(text(repo, 'dev', 'src/db.c'), STEP4);
  assert.equal(view.snags.length, 0);
  assert.ok(view.notices.some((notice) => notice.detail === 'move.122 dormant: input move.joy@lap.121 is off'));
  assert.equal(view.exportable, true);
});

test('T24 restoring the input wakes the resolution', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', script121());
  checkin(repo, 'dev', script122());
  pull(repo, 'dev', O.m121);
  restore(repo, 'dev', O.m121);
  const view = inspect(repo, 'dev');
  assert.equal(text(repo, 'dev', 'src/db.c'), STEP7);
  assert.equal(view.snags.length, 0);
  assert.equal(view.notices.some((notice) => notice.kind === 'dormant_resolution'), false);
});

test('T25 pull then restore of move 118 returns the renamed file exactly', () => {
  const repo = makeOdbcRepo();
  assert.equal(text(repo, 'dev', 'src/db.c'), STEP4);
  pull(repo, 'dev', O.m118);
  assert.equal(text(repo, 'dev', 'src/odbc.c'), STEP5);
  assert.equal(text(repo, 'dev', 'src/db.c'), null);
  restore(repo, 'dev', O.m118);
  assert.equal(text(repo, 'dev', 'src/db.c'), STEP4);
  assert.equal(kinds(repo, 'dev').length, 0);
});

test('T26 kind 4 tagged 11: pulling a needed move names the pull event', () => {
  const repo = createRepo();
  checkin(repo, 'dev', {
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'f', kind: 'file' },
    ],
    entries: [{ id: 'Ef', pool: 'root', node: 'f', name: 't.txt' }],
    lines: [{ id: 'Base', node: 'f', bytes: 'base\n', after: START, before: END }],
  });
  checkin(repo, 'dev', {
    id: 'move.A',
    orderKey: '2',
    lines: [{ id: 'La', node: 'f', bytes: 'from A\n', after: 'Base', before: END }],
  });
  checkin(repo, 'dev', {
    id: 'move.B',
    orderKey: '3',
    lines: [{ id: 'Lb', node: 'f', bytes: 'from B\n', after: 'La', before: END }],
  });
  assert.equal(inspect(repo, 'dev').snags.length, 0);
  const pulled = pull(repo, 'dev', 'move.A');
  const snag = inspect(repo, 'dev').snags.find((item) => item.kind === 4);
  assert.ok(snag);
  assert.equal(snag.need, 'move.A');
  assert.equal(snag.tag11, true);
  assert.equal(snag.exposedBy, pulled.event.id);
  assert.equal(snag.exposedByKind, 'pull');
});

test('T27 kind 1 tagged 11: restoring move 118 reopens the replacement snag', () => {
  const repo = makeOdbcRepo();
  pull(repo, 'dev', O.m118);
  checkin(repo, 'dev', script121());
  assert.equal(inspect(repo, 'dev').snags.some((snag) => snag.kind === 1), false);
  const restored = restore(repo, 'dev', O.m118);
  const snag = inspect(repo, 'dev').snags.find((item) => item.kind === 1);
  assert.ok(snag);
  assert.equal(snag.tag11, true);
  assert.equal(snag.exposedBy, restored.event.id);
  assert.equal(snag.exposedByKind, 'restore');
});

test('T28 a removal resolution goes dormant when the absent move is restored', () => {
  const repo = createRepo();
  checkin(repo, 'dev', {
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'f', kind: 'file' },
    ],
    entries: [{ id: 'Ef', pool: 'root', node: 'f', name: 't.txt' }],
    lines: [{ id: 'L', node: 'f', bytes: 'base\n', after: START, before: END }],
  });
  checkin(repo, 'dev', {
    id: 'A',
    orderKey: '2',
    off: ['L'],
    lines: [{ id: 'La', node: 'f', bytes: 'A\n', after: START, before: END, replaces: 'L' }],
  });
  checkin(repo, 'dev', {
    id: 'B',
    orderKey: '3',
    off: ['L'],
    lines: [{ id: 'Lb', node: 'f', bytes: 'B\n', after: START, before: END, replaces: 'L' }],
  });
  pull(repo, 'dev', 'A');
  checkin(repo, 'dev', {
    id: 'R',
    orderKey: '4',
    resolves: {
      kind: 'removal',
      inputs: ['B'],
      absent: ['A'],
      contested: ['L'],
      saw: ['Lb'],
      decision: 'B without A',
    },
  });
  assert.equal(inspect(repo, 'dev').snags.length, 0);
  const restored = restore(repo, 'dev', 'A');
  const view = inspect(repo, 'dev');
  const snag = view.snags.find((item) => item.kind === 1);
  assert.ok(snag);
  assert.equal(snag.tag11, true);
  assert.equal(snag.exposedBy, restored.event.id);
  assert.ok(view.notices.some((notice) => notice.detail === 'R dormant: absent A is on'));
  pull(repo, 'dev', 'A');
  const again = inspect(repo, 'dev');
  assert.equal(again.snags.length, 0);
  assert.equal(again.files[0].bytes, 'B\n');
});

test('T29 a new move in a resolved spot dormants the resolution and opens a fresh snag', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', script121());
  checkin(repo, 'dev', script122());
  checkin(repo, 'dev', {
    id: 'move.130',
    orderKey: '130',
    off: ['L4.1'],
    lines: [{ id: 'L130.0', node: O.file, bytes: 'int open(int extra);\n', after: 'L4.0', before: 'L4.2', replaces: 'L4.1' }],
  });
  const view = inspect(repo, 'dev');
  const snag = view.snags.find((item) => item.kind === 1);
  assert.ok(snag);
  assert.ok(snag.moves.includes('move.130'));
  assert.ok(snag.moves.includes(O.m118));
  assert.ok(snag.moves.includes(O.m121));
  assert.ok(snag.choices.some((choice) => choice.dormant && choice.bytes === 'int open(int flags, int mode);\n'));
  assert.ok(view.notices.some((notice) => notice.move === O.m122 && notice.kind === 'dormant_resolution'));
  assert.equal(view.exportable, false);
});

test('T30 a raft carry is one event and brings the resolution along', () => {
  const repo = makeOdbcRepo();
  const carriedInclude = carry(repo, 'release', O.m117);
  assert.equal(carriedInclude.ok, true);
  saveScript(repo, script121());
  saveScript(repo, script122());
  defineRaft(repo, { id: 'open-sig', members: [O.m118, O.m121, O.m122] });
  const before = repo.streams.release.events.length;
  const carried = carryRaft(repo, 'release', 'open-sig');
  assert.equal(carried.ok, true);
  assert.deepEqual(carried.added, [O.m118, O.m121, O.m122]);
  assert.equal(repo.streams.release.events.length, before + 1);
  const view = inspect(repo, 'release');
  assert.equal(text(repo, 'release', 'src/db.c'), STEP7);
  assert.equal(view.snags.length, 0);
  assert.equal(view.exportable, true);
});

test('T31 carrying a resolution without its inputs is refused', () => {
  const repo = makeOdbcRepo();
  saveScript(repo, script121());
  saveScript(repo, script122());
  const before = repo.streams.release.events.length;
  const refused = carry(repo, 'release', O.m122);
  assert.equal(refused.ok, false);
  assert.equal(refused.refused, true);
  assert.match(refused.message, /not in this stream/);
  assert.match(refused.message, /move\.118/);
  assert.match(refused.message, /move\.joy@lap\.121/);
  assert.equal(repo.streams.release.events.length, before);
  assert.equal(text(repo, 'release', 'src/odbc.c'), RELEASE);
});

test('T32 a raft whose member has a twin still carries whole, and the twin is tagged', () => {
  const repo = makeOdbcRepo();
  const ontoRelease = carry(repo, 'release', O.m118);
  assert.equal(ontoRelease.ok, true);
  checkin(repo, 'dev', script121('int open(int flags);\n'));
  checkin(repo, 'dev', {
    id: 'move.Z',
    orderKey: '130',
    lines: [{ id: 'LZ', node: O.file, bytes: '/* raft */\n', after: 'L4.0', before: 'L4.1' }],
  });
  defineRaft(repo, { id: 'twin-raft', members: [O.m121, 'move.Z'] });
  const carried = carryRaft(repo, 'release', 'twin-raft');
  assert.equal(carried.ok, true);
  assert.deepEqual(carried.added, [O.m121, 'move.Z']);
  const view = inspect(repo, 'release');
  const snag = view.snags.find((item) => item.kind === 1);
  assert.ok(snag);
  assert.equal(snag.twin, true);
  assert.equal(snag.tag11, true);
  assert.equal(snag.exposedByKind, 'carry');
  assert.ok(text(repo, 'release', 'src/db.c').includes('/* raft */\n'));
});

test('T33 pulling one raft member is allowed and leaves a partly-on notice', () => {
  const repo = makeOdbcRepo();
  carry(repo, 'release', O.m117);
  saveScript(repo, script121());
  saveScript(repo, script122());
  defineRaft(repo, { id: 'open-sig', members: [O.m118, O.m121, O.m122] });
  carryRaft(repo, 'release', 'open-sig');
  pull(repo, 'release', O.m121);
  const view = inspect(repo, 'release');
  const notice = view.notices.find((item) => item.kind === 'raft_partial');
  assert.ok(notice);
  assert.equal(notice.detail, 'open-sig: 2 of 3 members on');
  assert.equal(view.snags.length, 0);
  assert.equal(view.exportable, true);
  assert.equal(exportStream(repo, 'release').ok, true);
});

test('T34 carrying a file whose parent pool is absent is refused', () => {
  const repo = makeOdbcRepo();
  forkStream(repo, 'release', 'feature');
  checkin(repo, 'feature', {
    id: 'pool.db',
    orderKey: '50',
    nodes: [{ id: 'p:db', kind: 'pool' }],
    entries: [{ id: 'E:dbpool', pool: O.src, node: 'p:db', name: 'db' }],
  });
  checkin(repo, 'feature', {
    id: 'file.db',
    orderKey: '51',
    nodes: [{ id: 'n:row', kind: 'file' }],
    entries: [{ id: 'E:row', pool: 'p:db', node: 'n:row', name: 'row.c' }],
    lines: [{ id: 'Row', node: 'n:row', bytes: 'int row;\n', after: START, before: END }],
  });
  const before = movesOn(repo, 'dev').slice();
  const events = repo.streams.dev.events.length;
  const refused = carry(repo, 'dev', 'file.db');
  assert.equal(refused.refused, true);
  assert.ok(refused.missing.includes('pool.db'));
  assert.deepEqual(movesOn(repo, 'dev'), before);
  assert.equal(repo.streams.dev.events.length, events);
  assert.equal(inspect(repo, 'dev').snags.some((snag) => snag.kind === 8), false);
});

test('T35 pulling a delete brings the file back with edits made since', () => {
  const repo = createRepo();
  checkin(repo, 'dev', {
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'f', kind: 'file' },
    ],
    entries: [{ id: 'Ef', pool: 'root', node: 'f', name: 'F.txt' }],
    lines: [{ id: 'L', node: 'f', bytes: 'old\n', after: START, before: END }],
  });
  forkStream(repo, 'dev', 'feature');
  checkin(repo, 'dev', { id: 'delete.F', orderKey: '2', entryOff: ['Ef'] });
  checkin(repo, 'feature', {
    id: 'edit.F',
    orderKey: '3',
    off: ['L'],
    lines: [{ id: 'L2', node: 'f', bytes: 'new\n', after: START, before: END, replaces: 'L' }],
  });
  const carried = carry(repo, 'dev', 'edit.F');
  assert.equal(carried.ok, true);
  assert.equal(text(repo, 'dev', 'F.txt'), null);
  pull(repo, 'dev', 'delete.F');
  assert.equal(text(repo, 'dev', 'F.txt'), 'new\n');
});

test('T36 a flow-log fork with changed meaning is an event snag; an unchanged one is re-issued', () => {
  const repo = makeOdbcRepo();
  const parent = repo.streams.dev.events.at(-1).id;
  const first = submitEvent(repo, 'dev', { kind: 'pull', move: O.m118, parent, site: 'desk' });
  assert.equal(first.ok, true);
  const second = submitEvent(repo, 'dev', { kind: 'restore', move: O.m118, parent, site: 'lap' });
  assert.equal(second.eventSnag, true);
  const view = inspect(repo, 'dev');
  assert.ok(view.eventSnags.some((snag) => snag.code === 'fork'));
  assert.equal(view.exportable, false);
  assert.equal(movesOn(repo, 'dev').includes(O.m118), false);

  const again = makeOdbcRepo();
  const head = again.streams.dev.events.at(-1).id;
  submitEvent(again, 'dev', { kind: 'pull', move: O.m118, parent: head, site: 'desk' });
  const reissue = submitEvent(again, 'dev', { kind: 'pull', move: O.m118, parent: head, site: 'lap' });
  assert.equal(reissue.reissued, true);
  assert.equal(inspect(again, 'dev').eventSnags.length, 0);
  assert.equal(movesOn(again, 'dev').includes(O.m118), false);
});

test('T37 syncing scripts never revives a pull', () => {
  const repo = makeOdbcRepo();
  pull(repo, 'dev', O.m118);
  const script = repo.scripts[O.m118];
  delete repo.scripts[O.m118];
  syncScripts(repo, [script]);
  assert.equal(movesOn(repo, 'dev').includes(O.m118), false);
  assert.equal(text(repo, 'dev', 'src/odbc.c'), STEP5);
});

test('T38 a script saved without its event stays off and unattached', () => {
  const repo = makeOdbcRepo();
  const before = movesOn(repo, 'dev').slice();
  saveScript(repo, script121());
  const view = inspect(repo, 'dev');
  assert.deepEqual(view.moves, before);
  assert.ok(view.notices.some((notice) => notice.kind === 'unattached' && notice.move === O.m121));
  assert.equal(view.exportable, true);
  const replayed = replayRepo(JSON.parse(JSON.stringify({
    scripts: repo.scripts,
    streams: repo.streams,
    repoEvents: repo.repoEvents,
    seq: repo.seq,
  })));
  assert.equal(movesOn(replayed, 'dev').includes(O.m121), false);
  assert.ok(inspect(replayed, 'dev').notices.some((notice) => notice.kind === 'unattached'));
});

test('T39 rebuilding from scripts and the flow log reproduces the tree and the snags', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', script121());
  const first = inspect(repo, 'dev');
  repo.rafts = { bogus: { id: 'bogus', members: [] } };
  repo.policy = { case: 'sensitive', unicode: 'nfd', forbidden: 'none', maxPath: 1 };
  project(repo);
  const rebuilt = inspect(repo, 'dev');
  const replayed = replayRepo(JSON.parse(JSON.stringify({
    scripts: repo.scripts,
    streams: repo.streams,
    repoEvents: repo.repoEvents,
    seq: repo.seq,
  })));
  const third = inspect(replayed, 'dev');
  assert.equal(rebuilt.files[0].bytes, first.files[0].bytes);
  assert.equal(third.files[0].bytes, first.files[0].bytes);
  assert.deepEqual(rebuilt.snags.map(snagKey).sort(), first.snags.map(snagKey).sort());
  assert.deepEqual(third.snags.map(snagKey).sort(), first.snags.map(snagKey).sort());
});

test('T40 path identity, inside-repo checks, forbidden names, and max_path', () => {
  const repo = makeOdbcRepo();
  assert.equal(repo.scripts[O.seed4].nodes[0].id, O.file);
  assert.equal(text(repo, 'dev', 'src/db.c') !== null, true);
  assert.equal(repo.scripts[O.m118].entries[0].node, O.file);

  assert.equal(insideWorktree('C:\\repo\\wt', 'C:\\repo\\wt\\src\\file.c'), true);
  assert.equal(insideWorktree('C:\\repo\\wt', 'C:\\repo\\wt2\\file.c'), false);
  assert.equal(insideWorktree('C:/repo/wt', 'C:\\repo\\wt2\\file.c'), false);
  assert.equal(insideWorktree('c:\\Repo', 'C:\\repo\\wt\\a', { foldCase: true }), true);
  assert.equal(
    insideWorktree('C:\\PROGRA~1\\repo', 'C:\\Program Files\\repo\\file.c', {
      aliases: { 'PROGRA~1': 'Program Files' },
    }),
    true,
  );

  assert.ok(forbiddenName('CON'));
  assert.ok(forbiddenName('aux.txt'));
  assert.ok(forbiddenName('file.'));
  assert.ok(forbiddenName('file '));
  assert.ok(forbiddenName('a:b'));
  assert.equal(forbiddenName('concert'), null);

  const refusedName = checkin(repo, 'dev', {
    id: 'bad.name',
    orderKey: '90',
    nodes: [{ id: 'n:con', kind: 'file' }],
    entries: [{ id: 'E:con', pool: O.src, node: 'n:con', name: 'CON' }],
  });
  assert.equal(refusedName.refused, true);
  assert.equal(repo.scripts['bad.name'], undefined);

  setPolicy(repo, { maxPath: 10 });
  const refusedPath = checkin(repo, 'dev', {
    id: 'long.name',
    orderKey: '91',
    nodes: [{ id: 'n:long', kind: 'file' }],
    entries: [{ id: 'E:long', pool: O.src, node: 'n:long', name: 'toolongname.c' }],
  });
  assert.equal(refusedPath.refused, true);
  assert.match(refusedPath.message, /toolongname\.c/);
  assert.equal(movesOn(repo, 'dev').includes('long.name'), false);
});
