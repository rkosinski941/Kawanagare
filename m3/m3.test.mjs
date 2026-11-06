/**
 * Reference-engine tests beyond the numbered matrix:
 * read-only assemble, the move-10 backport, anchor ordering,
 * open-water bots, line endings, redaction, locks, and export notices.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assemble,
  carry,
  checkin,
  createRepo,
  defineRaft,
  exportStream,
  forkStream,
  importTree,
  inspect,
  isKeepPath,
  landEvent,
  lock,
  movesOn,
  pull,
  redact,
  restore,
  setPolicy,
  syncScripts,
  unlock,
} from './engine.mjs';
import { END, START } from './weave.mjs';
import {
  makeDemoRepo,
  makeOdbcRepo,
  O,
  STEP4,
  V1_BACKPORT_TEXT,
  V1_TEXT,
  V2_TEXT,
} from './fixture.mjs';

function snapshot(repo) {
  return JSON.stringify({
    scripts: repo.scripts,
    streams: repo.streams,
    repoEvents: repo.repoEvents,
    seq: repo.seq,
  });
}

function fileRepo(lines) {
  const repo = createRepo();
  checkin(repo, 'dev', {
    id: 'seed',
    orderKey: '1',
    author: 'ada',
    site: 'bot',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'f', kind: 'file' },
    ],
    entries: [{ id: 'Ef', pool: 'root', node: 'f', name: 't.txt' }],
    lines,
  });
  return repo;
}

test('worked example step 4 is clean and release is the seed file', () => {
  const repo = makeOdbcRepo();
  const dev = inspect(repo, 'dev');
  assert.equal(dev.snags.length, 0);
  assert.equal(dev.exportable, true);
  assert.equal(dev.files[0].path, 'src/db.c');
  assert.equal(dev.files[0].bytes, STEP4);
  assert.equal(dev.files[0].node, O.file);
  assert.equal(exportStream(repo, 'release').files['src/odbc.c'].includes('int open();\n'), true);
});

test('assemble is read-only and returns text beside snags', () => {
  const repo = makeDemoRepo();
  const before = snapshot(repo);
  const preview = assemble(repo, { stream: 'v1', with: ['10'] });
  assert.equal(snapshot(repo), before);
  assert.ok(preview.text.includes('runSafe();\n'));
  assert.ok(preview.snags.some((snag) => snag.kind === 4 && snag.need === '7'));
  const byMoves = assemble(repo, ['1', '2', '3', '4', '5', '10']);
  assert.equal(snapshot(repo), before);
  assert.equal(byMoves.text, preview.text);
  const pulled = assemble(repo, { stream: 'v2', without: ['10'] });
  assert.equal(snapshot(repo), before);
  assert.ok(pulled.text.includes('  run();\n'));
  assert.equal(pulled.text.includes('runSafe()'), false);
  assert.deepEqual(movesOn(repo, 'v1'), ['1', '2', '3', '4', '5']);
  assert.ok(movesOn(repo, 'v2').includes('10'));
});

test('move 10 backport keeps its id, refuses without needs, and carries the transitive group', () => {
  const repo = makeDemoRepo();
  assert.equal(inspect(repo, 'v1').files[0].bytes, V1_TEXT);
  assert.equal(inspect(repo, 'v2').files[0].bytes, V2_TEXT);
  assert.equal(Object.keys(repo.scripts).filter((id) => id === '10').length, 1);

  const refused = carry(repo, 'v1', '10');
  assert.equal(refused.refused, true);
  assert.deepEqual(refused.missing, ['6', '7']);
  assert.deepEqual(refused.proposed, ['6', '7', '10']);
  assert.equal(refused.group, 'needs:10');
  assert.deepEqual(movesOn(repo, 'v1'), ['1', '2', '3', '4', '5']);

  const preview = assemble(repo, { moves: [...movesOn(repo, 'v1'), ...refused.proposed] });
  assert.equal(preview.text, V1_BACKPORT_TEXT);
  assert.equal(preview.snags.length, 0);

  const carried = carry(repo, 'v1', '10', { withNeeds: true });
  assert.equal(carried.ok, true);
  assert.deepEqual(carried.added, ['6', '7', '10']);
  assert.equal(carried.group, 'needs:10');
  assert.equal(carried.event.moves.join(','), '6,7,10');
  assert.ok(movesOn(repo, 'v1').includes('10'));
  assert.ok(movesOn(repo, 'v2').includes('10'));
  assert.equal(inspect(repo, 'v1').files[0].bytes, V1_BACKPORT_TEXT);
  assert.equal(inspect(repo, 'v1').snags.length, 0);

  pull(repo, 'v2', '10');
  assert.ok(inspect(repo, 'v2').files[0].bytes.includes('  run();\n'));
  assert.equal(inspect(repo, 'v2').files[0].bytes.includes('runSafe()'), false);
  restore(repo, 'v2', '10');
  assert.ok(inspect(repo, 'v2').files[0].bytes.includes('runSafe();\n'));
  assert.equal(repo.scripts['10'].id, '10');
});

test('restore lands a move whose needs are missing and assemble shows the snag', () => {
  const repo = makeDemoRepo();
  const restored = restore(repo, 'v1', '10');
  assert.equal(restored.ok, true);
  assert.ok(movesOn(repo, 'v1').includes('10'));
  const view = assemble(repo, { stream: 'v1' });
  assert.ok(view.snags.some((snag) => snag.kind === 4 && snag.need === '7'));
  assert.ok(view.text.includes('runSafe();\n'));
});

test('an insert stays in its gap when the right-hand line is replaced', () => {
  const repo = fileRepo([
    { id: 'A', node: 'f', bytes: 'A\n', after: START, before: END },
    { id: 'B', node: 'f', bytes: 'B\n', after: 'A', before: END },
    { id: 'C', node: 'f', bytes: 'C\n', after: 'B', before: END },
  ]);
  checkin(repo, 'dev', {
    id: 'replace',
    orderKey: '2',
    off: ['B'],
    lines: [{ id: 'B2', node: 'f', bytes: 'B2\n', after: 'A', before: 'C', replaces: 'B' }],
  });
  checkin(repo, 'dev', {
    id: 'insert',
    orderKey: '3',
    lines: [{ id: 'I', node: 'f', bytes: 'I\n', after: 'A', before: 'B' }],
  });
  const view = inspect(repo, 'dev');
  assert.equal(view.files[0].bytes, 'A\nI\nB2\nC\n');
  assert.equal(view.snags.some((snag) => snag.kind === 3), false);
  assert.deepEqual(view.files[0].lineIds, ['A', 'I', 'B2', 'C']);
});

test('same-gap inserts use order_key, not check-in order, and the snag remains', () => {
  const repo = fileRepo([
    { id: 'A', node: 'f', bytes: 'A\n', after: START, before: END },
    { id: 'B', node: 'f', bytes: 'B\n', after: 'A', before: END },
  ]);
  checkin(repo, 'dev', {
    id: 'later',
    orderKey: '30',
    author: 'bo',
    site: 'bot',
    lines: [{ id: 'S', node: 'f', bytes: 'second\n', after: 'A', before: 'B' }],
  });
  checkin(repo, 'dev', {
    id: 'earlier',
    orderKey: '10',
    author: 'ada',
    site: 'bot',
    lines: [{ id: 'F', node: 'f', bytes: 'first\n', after: 'A', before: 'B' }],
  });
  const view = inspect(repo, 'dev');
  assert.equal(view.files[0].bytes, 'A\nfirst\nsecond\nB\n');
  assert.equal(view.snags.filter((snag) => snag.kind === 2).length, 1);
  assert.equal(view.exportable, false);
});

test('seeing the replacement keeps an after-anchor from becoming kind 3', () => {
  const repo = makeOdbcRepo();
  checkin(repo, 'dev', {
    id: 'joy.saw',
    orderKey: '200',
    saw: [O.m118],
    lines: [{ id: 'J1', node: O.file, bytes: '/* saw it */\n', after: 'L4.1', before: 'L4.2' }],
  });
  assert.equal(inspect(repo, 'dev').snags.some((snag) => snag.kind === 3), false);
});

test('two bots can insert in different gaps, and a third move resolves an overlap', () => {
  const repo = fileRepo([
    { id: 'A', node: 'f', bytes: 'A\n', after: START, before: END },
    { id: 'B', node: 'f', bytes: 'B\n', after: 'A', before: 'C' },
    { id: 'C', node: 'f', bytes: 'C\n', after: 'B', before: 'D' },
    { id: 'D', node: 'f', bytes: 'D\n', after: 'C', before: END },
  ]);
  checkin(repo, 'dev', {
    id: 'ada.gap',
    orderKey: '2',
    author: 'ada',
    site: 'bot',
    lines: [{ id: 'Ada', node: 'f', bytes: 'ada\n', after: 'A', before: 'B' }],
  });
  checkin(repo, 'dev', {
    id: 'bo.gap',
    orderKey: '3',
    author: 'bo',
    site: 'bot',
    lines: [{ id: 'Bo', node: 'f', bytes: 'bo\n', after: 'C', before: 'D' }],
  });
  const calm = inspect(repo, 'dev');
  assert.equal(calm.snags.length, 0);
  assert.equal(calm.files[0].bytes, 'A\nada\nB\nC\nbo\nD\n');
  assert.equal(calm.exportable, true);

  checkin(repo, 'dev', {
    id: 'ada.edit',
    orderKey: '4',
    author: 'ada',
    site: 'bot',
    off: ['B'],
    lines: [{ id: 'Bada', node: 'f', bytes: 'one\n', after: 'A', before: 'C', replaces: 'B' }],
  });
  checkin(repo, 'dev', {
    id: 'bo.edit',
    orderKey: '5',
    author: 'bo',
    site: 'bot',
    off: ['B'],
    lines: [{ id: 'Bbo', node: 'f', bytes: 'two\n', after: 'A', before: 'C', replaces: 'B' }],
  });
  const hit = inspect(repo, 'dev');
  assert.equal(hit.snags.filter((snag) => snag.kind === 1).length, 1);
  assert.equal(hit.exportable, false);
  assert.ok(movesOn(repo, 'dev').includes('ada.edit'));
  assert.ok(movesOn(repo, 'dev').includes('bo.edit'));

  checkin(repo, 'dev', {
    id: 'resolution',
    orderKey: '6',
    author: 'ada',
    site: 'bot',
    resolves: {
      kind: 'same_slot',
      inputs: ['ada.edit', 'bo.edit'],
      absent: [],
      contested: ['B'],
      saw: ['Bada', 'Bbo'],
      decision: 'keep a combined line',
    },
    off: ['Bada', 'Bbo'],
    lines: [{ id: 'Both', node: 'f', bytes: 'both\n', after: 'A', before: 'C', replaces: 'B' }],
  });
  const done = inspect(repo, 'dev');
  assert.equal(done.snags.length, 0);
  assert.ok(done.files[0].bytes.includes('both\n'));
  assert.equal(done.files[0].bytes.includes('one\n'), false);
  assert.equal(done.files[0].bytes.includes('two\n'), false);
  assert.equal(done.exportable, true);
});

test('mixed line endings round-trip in assemble and export', () => {
  const repo = fileRepo([
    { id: 'A', node: 'f', bytes: 'a\r\n', after: START, before: END },
    { id: 'B', node: 'f', bytes: 'b\n', after: 'A', before: END },
    { id: 'C', node: 'f', bytes: 'c\r\n', after: 'B', before: END },
  ]);
  const body = inspect(repo, 'dev').files[0].bytes;
  assert.equal(body, 'a\r\nb\nc\r\n');
  assert.equal(exportStream(repo, 'dev').files['t.txt'], 'a\r\nb\nc\r\n');
});

test('redaction tombstones display bytes and keeps the line id and the script', () => {
  const repo = makeOdbcRepo();
  const original = repo.scripts[O.seed4].lines[0].bytes;
  redact(repo, { lineId: 'L4.0', marker: '[redacted]\n' });
  const view = assemble(repo, { stream: 'dev', path: 'src/db.c' });
  assert.ok(view.text.startsWith('[redacted]\n'));
  assert.ok(view.lines.includes('L4.0'));
  assert.equal(repo.scripts[O.seed4].lines[0].bytes, original);
  assert.equal(repo.scripts[O.seed4].lines[0].id, 'L4.0');
});

test('a locked node refuses check-in until it is unlocked', () => {
  const repo = makeOdbcRepo();
  lock(repo, 'dev', O.file);
  const refused = checkin(repo, 'dev', {
    id: 'while.locked',
    orderKey: '300',
    lines: [{ id: 'LockLine', node: O.file, bytes: 'nope\n', after: 'L4.0', before: 'L4.1' }],
  });
  assert.equal(refused.refused, true);
  assert.match(refused.message, /locked/);
  assert.equal(repo.scripts['while.locked'], undefined);
  unlock(repo, 'dev', O.file);
  const landed = checkin(repo, 'dev', {
    id: 'while.locked',
    orderKey: '300',
    lines: [{ id: 'LockLine', node: O.file, bytes: 'ok\n', after: 'L4.0', before: 'L4.1' }],
  });
  assert.equal(landed.ok, true);
});

test('the root seed cannot be pulled', () => {
  const repo = makeOdbcRepo();
  const refused = pull(repo, 'dev', O.seed1);
  assert.equal(refused.refused, true);
  assert.match(refused.message, /root seed/);
  assert.ok(movesOn(repo, 'dev').includes(O.seed1));
});

test('an empty pool exports .kawa-keep and import does not turn that into a file', () => {
  const repo = createRepo();
  checkin(repo, 'dev', {
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'docs', kind: 'pool' },
    ],
    entries: [{ id: 'Ed', pool: 'root', node: 'docs', name: 'docs' }],
  });
  const exported = exportStream(repo, 'dev');
  assert.equal(exported.ok, true);
  assert.equal(exported.files['docs/.kawa-keep'], '');
  assert.equal(isKeepPath('docs/.kawa-keep'), true);
  const imported = importTree(exported.files);
  assert.equal(Object.hasOwn(imported, 'docs/.kawa-keep'), false);
});

test('a policy change that makes names collide is tagged as exposed by that event', () => {
  const repo = makeOdbcRepo();
  setPolicy(repo, { case: 'sensitive' });
  checkin(repo, 'dev', {
    id: 'lower',
    orderKey: '50',
    nodes: [{ id: 'n:r1', kind: 'file' }],
    entries: [{ id: 'E:r1', pool: O.src, node: 'n:r1', name: 'Readme' }],
  });
  checkin(repo, 'dev', {
    id: 'upper',
    orderKey: '51',
    nodes: [{ id: 'n:r2', kind: 'file' }],
    entries: [{ id: 'E:r2', pool: O.src, node: 'n:r2', name: 'README' }],
  });
  assert.equal(inspect(repo, 'dev').snags.some((snag) => snag.kind === 7), false);
  const changed = setPolicy(repo, { case: 'insensitive' });
  const snag = inspect(repo, 'dev').snags.find((item) => item.kind === 7);
  assert.ok(snag);
  assert.equal(snag.tag11, true);
  assert.equal(snag.exposedBy, changed.event.id);
  assert.equal(snag.exposedByKind, 'policy');
});

test('a partly-on raft is a notice and does not block export by itself', () => {
  const repo = makeDemoRepo();
  defineRaft(repo, { id: 'fix', members: ['7', '10'] });
  pull(repo, 'v2', '10');
  const view = inspect(repo, 'v2');
  assert.ok(view.notices.some((notice) => notice.kind === 'raft_partial' && notice.detail === 'fix: 1 of 2 members on'));
  assert.equal(view.snags.length, 0);
  assert.equal(view.exportable, true);
});

test('forked streams share move identity and then diverge', () => {
  const repo = makeDemoRepo();
  assert.deepEqual(movesOn(repo, 'v1'), ['1', '2', '3', '4', '5']);
  assert.ok(movesOn(repo, 'v2').includes('10'));
  assert.equal(movesOn(repo, 'v1').includes('10'), false);
  const fork = forkStream(repo, 'v2', 'v3');
  assert.ok(fork);
  assert.ok(movesOn(repo, 'v3').includes('10'));
  pull(repo, 'v3', '10');
  assert.ok(movesOn(repo, 'v2').includes('10'));
});

test('a bad signature is an event snag and the script stays absent', () => {
  const repo = createRepo();
  checkin(repo, 'dev', {
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: 'f', kind: 'file' },
    ],
    entries: [{ id: 'Ef', pool: 'root', node: 'f', name: 't.txt' }],
    lines: [{ id: 'L', node: 'f', bytes: 'ok\n', after: START, before: END }],
  });
  landEvent(repo, 'dev', { kind: 'checkin', move: 'ghost', site: 'lap' });
  syncScripts(repo, [{
    id: 'ghost',
    signature: 'bad',
    orderKey: '2',
    lines: [{ id: 'G', node: 'f', bytes: 'nope\n', after: 'L', before: END }],
  }]);
  const view = inspect(repo, 'dev');
  assert.ok(view.eventSnags.some((snag) => snag.code === 'bad_signature'));
  assert.ok(view.notices.some((notice) => notice.kind === 'waiting' && notice.move === 'ghost'));
  assert.equal(view.files[0].bytes, 'ok\n');
  assert.equal(view.exportable, false);
});
