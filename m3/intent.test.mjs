
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assemble,
  carry,
  checkin,
  landEvent,
  pull,
  replayRepo,
  restore,
  saveScript,
} from './engine.mjs';
import { canonJson } from './canon.mjs';
import { makeOdbcRepo, O, withIntent } from './fixture.mjs';

function snapshot(repo) {
  return JSON.stringify({
    scripts: repo.scripts,
    streams: repo.streams,
    repoEvents: repo.repoEvents,
    seq: repo.seq,
  });
}

function insertScript(id, extra = {}) {
  return withIntent({
    id,
    orderKey: id,
    author: 'ada',
    site: 'bot',
    lines: [{ id: `${id}.line`, node: O.file, bytes: `/* ${id} */\n`, after: 'L4.2' }],
    ...extra,
  });
}

function findEvent(repo, moveId) {
  return repo.streams.dev.events.filter((event) => !event.rejected && event.move === moveId);
}

test('T41b no intent block: intent_missing, no script and no event', () => {
  const repo = makeOdbcRepo();
  const before = snapshot(repo);
  const refused = checkin(repo, 'dev', {
    id: 'no.intent',
    orderKey: '900',
    lines: [{ id: 'NI', node: O.file, bytes: 'x\n', after: 'L4.2' }],
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.refused, true);
  assert.equal(refused.code, 'intent_missing');
  assert.equal(refused.field, '/intent');
  assert.equal(refused.reason, undefined);
  assert.equal(repo.scripts['no.intent'], undefined);
  assert.equal(snapshot(repo), before);
});

test('T42b each invalid shape is intent_invalid and writes nothing', () => {
  const repo = makeOdbcRepo();
  const cases = [
    [{ targets: [{ node: O.file }], purpose: 'fix', needs: [], reason: 'r', kind: 'fix' }, '/intent/kind', 'unknown_field'],
    [{ targets: [{ node: O.file }], purpose: 'fix', needs: [], reason: 'r', op: 'add' }, '/intent/op', 'unknown_field'],
    [{ targets: [{ node: O.file, path: 'src/db.c' }], purpose: 'fix', needs: [], reason: 'r' }, '/intent/targets/0/path', 'unknown_field'],
    [{ targets: [{ node: O.file, kind: 'file' }], purpose: 'fix', needs: [], reason: 'r' }, '/intent/targets/0/kind', 'unknown_field'],
    [{ targets: [], purpose: 'fix', needs: [], reason: 'r' }, '/intent/targets', 'empty'],
    [{ targets: [{ node: O.file }], purpose: 'nope', needs: [], reason: 'r' }, '/intent/purpose', 'not_in_list'],
    [{ targets: [{ node: O.file }], purpose: 'fix', needs: [], reason: '' }, '/intent/reason', 'empty'],
    [{ targets: [{ node: O.file }], purpose: 'fix', needs: [], reason: ' \u00a0\t' }, '/intent/reason', 'blank'],
    [{ targets: [{ node: O.file }], purpose: 'fix', needs: 'move.0', reason: 'r' }, '/intent/needs', 'wrong_type'],
    [{ targets: [{ node: 'n:missing' }], purpose: 'fix', needs: [], reason: 'r' }, '/intent/targets/0/node', 'unknown_node'],
  ];
  let index = 0;
  for (const [intent, field, reason] of cases) {
    index += 1;
    const before = snapshot(repo);
    const id = `bad.intent.${index}`;
    const refused = checkin(repo, 'dev', {
      id,
      orderKey: `91${index}`,
      lines: [{ id: `${id}.line`, node: O.file, bytes: 'x\n', after: 'L4.2' }],
      intent,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'intent_invalid', id);
    assert.equal(refused.field, field, id);
    assert.equal(refused.reason, reason, id);
    assert.equal(repo.scripts[id], undefined, id);
    assert.equal(snapshot(repo), before, id);
  }
});

test('T43 a valid block lands, is stored identically and survives pull, restore and carry', () => {
  const script = insertScript('intent.keep');
  const repo = makeOdbcRepo();
  const landed = checkin(repo, 'dev', script);
  assert.equal(landed.ok, true);
  assert.deepEqual(repo.scripts[script.id].intent, script.intent);
  assert.deepEqual(landed.event.intent, script.intent);
  assert.equal(canonJson(repo.scripts[script.id].intent), canonJson(landed.event.intent));

  pull(repo, 'dev', script.id);
  assert.deepEqual(repo.scripts[script.id].intent, script.intent);
  restore(repo, 'dev', script.id);
  assert.deepEqual(repo.scripts[script.id].intent, script.intent);
  const carried = carry(repo, 'release', script.id);
  assert.equal(carried.ok, true);
  assert.deepEqual(repo.scripts[script.id].intent, script.intent);

  const one = makeOdbcRepo();
  const two = makeOdbcRepo();
  checkin(one, 'dev', insertScript('intent.same'));
  checkin(two, 'dev', insertScript('intent.same'));
  const pick = (view) => ({
    files: view.files,
    snags: view.snags,
    moves: view.moves,
    ops_derived: view.ops_derived,
    intent_reports: view.intent_reports,
    intent_need_absent: view.intent_need_absent,
  });
  assert.deepEqual(
    pick(assemble(one, { stream: 'dev' })),
    pick(assemble(two, { stream: 'dev' })),
  );
});

test('T44b move_empty at check-in stores nothing', () => {
  const repo = makeOdbcRepo();
  const before = snapshot(repo);
  const refused = checkin(repo, 'dev', withIntent({
    id: 'empty.move',
    orderKey: '920',
  }));
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'move_empty');
  assert.equal(refused.field, '/');
  assert.equal(repo.scripts['empty.move'], undefined);
  assert.equal(snapshot(repo), before);
});

test('T81 targets are node identity across rename, delete, restore and pool targets', () => {
  const repo = makeOdbcRepo();
  const rename = withIntent({
    id: 'rename.odbc',
    orderKey: '930',
    entryOff: [O.eOdbc],
    entries: [{ id: 'E:renamed', pool: O.src, node: O.file, name: 'renamed.c' }],
  }, { targets: [{ node: O.file }], purpose: 'refactor', reason: 'rename the file' });
  assert.equal(checkin(repo, 'dev', rename).ok, true);
  const original = canonJson(repo.scripts[rename.id].intent);

  const remove = withIntent({
    id: 'delete.odbc',
    orderKey: '931',
    entryOff: ['E:renamed'],
  }, { targets: [{ node: O.file }], purpose: 'chore', reason: 'delete the entry' });
  assert.equal(checkin(repo, 'dev', remove).ok, true);
  pull(repo, 'dev', remove.id);
  restore(repo, 'dev', remove.id);
  assert.equal(canonJson(repo.scripts[rename.id].intent), original);

  const poolTarget = withIntent({
    id: 'target.pool',
    orderKey: '932',
    attributes: [{ id: 'pt:note', node: O.file, key: 'note', value: 'pool target' }],
  }, { targets: [{ node: O.src }], purpose: 'docs', reason: 'touch the src pool' });
  assert.equal(checkin(repo, 'dev', poolTarget).ok, true);
  assert.deepEqual(repo.scripts[poolTarget.id].intent.targets, [{ node: O.src }]);
  assert.equal(canonJson(repo.scripts[rename.id].intent), original);

  const before = snapshot(repo);
  const unknown = checkin(repo, 'dev', withIntent({
    id: 'unknown.target',
    orderKey: '933',
    lines: [{ id: 'UT', node: O.file, bytes: 'u\n', after: 'L4.2' }],
  }, { targets: [{ node: 'n:unknown' }] }));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'intent_invalid');
  assert.equal(unknown.field, '/intent/targets/0/node');
  assert.equal(unknown.reason, 'unknown_node');
  assert.equal(repo.scripts['unknown.target'], undefined);
  assert.equal(snapshot(repo), before);
});

test('T82 script and flow log carry byte-identical intent through replay and a crash', () => {
  const repo = makeOdbcRepo();
  const script = insertScript('intent.replay');
  const landed = checkin(repo, 'dev', script);
  assert.equal(landed.ok, true);
  assert.equal(
    canonJson(repo.scripts[script.id].intent),
    canonJson(findEvent(repo, script.id)[0].intent),
  );
  const replayed = replayRepo(JSON.parse(JSON.stringify({
    scripts: repo.scripts,
    streams: repo.streams,
    repoEvents: repo.repoEvents,
    seq: repo.seq,
  })));
  assert.equal(
    canonJson(replayed.scripts[script.id].intent),
    canonJson(findEvent(replayed, script.id)[0].intent),
  );
  assert.equal(findEvent(replayed, script.id).length, 1);

  const crash = insertScript('intent.crash');
  saveScript(repo, crash);
  const crashed = replayRepo(JSON.parse(JSON.stringify({
    scripts: repo.scripts,
    streams: repo.streams,
    repoEvents: repo.repoEvents,
    seq: repo.seq,
  })));
  assert.deepEqual(crashed.scripts[crash.id].intent, crash.intent);
  assert.equal(findEvent(crashed, crash.id).length, 0);

  const resumed = landEvent(crashed, 'dev', {
    kind: 'checkin',
    move: crash.id,
    site: 'desk',
    intent: crashed.scripts[crash.id].intent,
  });
  assert.equal(resumed.ok, true);
  assert.equal(findEvent(crashed, crash.id).length, 1);
  assert.equal(
    canonJson(crashed.scripts[crash.id].intent),
    canonJson(findEvent(crashed, crash.id)[0].intent),
  );
  const again = replayRepo(JSON.parse(JSON.stringify({
    scripts: crashed.scripts,
    streams: crashed.streams,
    repoEvents: crashed.repoEvents,
    seq: crashed.seq,
  })));
  assert.equal(findEvent(again, crash.id).length, 1);
  assert.deepEqual(again.scripts[crash.id].intent, crash.intent);
});

test('T83 a refused intent, even with a bad signature, leaves store and log unchanged', () => {
  const repo = makeOdbcRepo();
  const before = snapshot(repo);
  const refused = checkin(repo, 'dev', {
    id: 'bad.signature',
    orderKey: '940',
    signature: 'bad',
    lines: [{ id: 'BS', node: O.file, bytes: 'x\n', after: 'L4.2' }],
    intent: {
      targets: [{ node: O.file }],
      purpose: 'fix',
      needs: [],
      reason: 'r',
      kind: 'fix',
    },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'intent_invalid');
  assert.equal(refused.field, '/intent/kind');
  assert.equal(repo.scripts['bad.signature'], undefined);
  assert.equal(snapshot(repo), before);
});

test('T84 a stored pre-intent script loads; assemble reports missing and unknown fields', () => {
  const repo = makeOdbcRepo();
  const preIntent = {
    id: 'pre.intent',
    orderKey: '950',
    author: 'ada',
    site: 'bot',
    lines: [{ id: 'PI', node: O.file, bytes: '/* pre */\n', after: 'L4.2' }],
  };
  saveScript(repo, preIntent);
  landEvent(repo, 'dev', { kind: 'checkin', move: preIntent.id, site: 'bot' });

  const kindBlock = {
    id: 'kind.intent',
    orderKey: '951',
    author: 'ada',
    site: 'bot',
    lines: [{ id: 'KI', node: O.file, bytes: '/* kind */\n', after: 'L4.2' }],
    intent: {
      targets: [{ node: O.file }],
      purpose: 'fix',
      needs: [],
      reason: 'r',
      kind: 'fix',
    },
  };
  saveScript(repo, kindBlock);
  landEvent(repo, 'dev', { kind: 'checkin', move: kindBlock.id, site: 'bot' });

  const view = assemble(repo, { stream: 'dev' });
  assert.deepEqual(
    view.intent_reports.find((report) => report.move === preIntent.id),
    { move: preIntent.id, code: 'intent_missing', field: '/intent' },
  );
  assert.deepEqual(
    view.intent_reports.find((report) => report.move === kindBlock.id),
    { move: kindBlock.id, code: 'intent_invalid', field: '/intent/kind', reason: 'unknown_field' },
  );

  const refused = checkin(repo, 'dev', { ...kindBlock, id: 'kind.checkin' });
  assert.equal(refused.code, 'intent_invalid');
  assert.equal(refused.field, '/intent/kind');
});

test('T44 assemble reports ops_derived and intent_need_absent for the odbc fixture', () => {
  const repo = makeOdbcRepo();
  const view = assemble(repo, { stream: 'dev' });
  assert.deepEqual(view.ops_derived[O.m117], ['change']);
  assert.deepEqual(view.ops_derived[O.m118], ['change', 'rename']);
  assert.deepEqual(view.ops_derived[O.seed4], ['add']);

  assert.equal(checkin(repo, 'dev', withIntent({
    id: 'delete.db',
    orderKey: '960',
    entryOff: [O.eDb],
  })).ok, true);
  const needy = insertScript('needy', { needs: ['move.absent'] });
  needy.intent = { ...needy.intent, needs: ['move.absent'] };
  assert.equal(checkin(repo, 'dev', needy).ok, true);

  const after = assemble(repo, { stream: 'dev' });
  assert.deepEqual(after.ops_derived['delete.db'], ['remove']);
  assert.deepEqual(after.ops_derived.needy, ['change']);
  assert.deepEqual(
    after.intent_need_absent.find((entry) => entry.move === 'needy'),
    {
      move: 'needy',
      need: 'move.absent',
      code: 'intent_need_absent',
      provenance: 'authored_only',
    },
  );
});
