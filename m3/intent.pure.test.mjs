
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkInRefusal,
  deriveOps,
  hasRecords,
  intentError,
} from './intent.mjs';
import { RECORD_ARRAYS } from './codes.mjs';
import { normalizeScript } from './engine.mjs';
import {
  makeDemoRepo,
  makeOdbcRepo,
  O,
  script121,
  script122,
} from './fixture.mjs';

const NODES = new Set(['n:a', 'p:root']);
const ctx = { hasNode: (id) => NODES.has(id) };

const ok = {
  id: 'move.1',
  lines: [{ id: 'L1' }],
  intent: {
    targets: [{ node: 'n:a' }],
    purpose: 'fix',
    needs: ['move.0'],
    reason: 'fix the thing',
  },
};
const withI = (overrides) => ({ ...ok, intent: { ...ok.intent, ...overrides } });

function codeOf(payload) {
  const got = checkInRefusal(payload, ctx);
  return got ? [got.code, got.field, got.reason].filter((part) => part !== undefined) : null;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

test('T41a an absent or null intent is intent_missing at /intent', () => {
  assert.deepEqual(codeOf({ ...ok, intent: undefined }), ['intent_missing', '/intent']);
  assert.deepEqual(codeOf({ ...ok, intent: null }), ['intent_missing', '/intent']);
  assert.deepEqual(checkInRefusal({ id: 'move.1', intent: undefined }, ctx), {
    code: 'intent_missing',
    field: '/intent',
  });
});

test('T42a closed schema errors carry the exact field and reason', () => {
  const cases = [
    [withI({ kind: 'fix' }), ['intent_invalid', '/intent/kind', 'unknown_field']],
    [withI({ op: 'add' }), ['intent_invalid', '/intent/op', 'unknown_field']],
    [withI({ targets: [{ node: 'n:a', path: 'src/db.c' }] }), ['intent_invalid', '/intent/targets/0/path', 'unknown_field']],
    [withI({ purpose: 'x-custom' }), ['intent_invalid', '/intent/purpose', 'not_in_list']],
    [withI({ targets: [] }), ['intent_invalid', '/intent/targets', 'empty']],
    [withI({ reason: '' }), ['intent_invalid', '/intent/reason', 'empty']],
    [withI({ reason: ' \u00a0\u3000\t' }), ['intent_invalid', '/intent/reason', 'blank']],
    [withI({ needs: 'move.0' }), ['intent_invalid', '/intent/needs', 'wrong_type']],
  ];
  for (const [payload, expected] of cases) assert.deepEqual(codeOf(payload), expected);
});

test('T85 the unknown-field rule is recursive and top-level keys are checked first', () => {
  assert.deepEqual(
    codeOf(withI({ targets: [{ node: 'n:a', kind: 'file' }] })),
    ['intent_invalid', '/intent/targets/0/kind', 'unknown_field'],
  );
  assert.deepEqual(
    codeOf(withI({ targets: [{ node: 'n:a', z: 1, a: 2 }] })),
    ['intent_invalid', '/intent/targets/0/a', 'unknown_field'],
  );
  const payload = withI({ targets: [{ node: 'n:a', kind: 'file' }], op: 'add' });
  assert.deepEqual(codeOf(payload), ['intent_invalid', '/intent/op', 'unknown_field']);
});

test('T79 the 46 reference cases in validation order', () => {
  const cases = [
    ['valid', ok, null],
    ['intent absent', { ...ok, intent: undefined }, ['intent_missing', '/intent']],
    ['intent null', { ...ok, intent: null }, ['intent_missing', '/intent']],
    ['intent array', { ...ok, intent: [] }, ['intent_invalid', '/intent', 'wrong_type']],
    ['intent string', { ...ok, intent: 'x' }, ['intent_invalid', '/intent', 'wrong_type']],
    ['unknown key kind', withI({ kind: 'fix' }), ['intent_invalid', '/intent/kind', 'unknown_field']],
    ['unknown key op', withI({ op: 'add' }), ['intent_invalid', '/intent/op', 'unknown_field']],
    ['two unknown keys, UTF-16 order first', withI({ zeta: 1, alpha: 2 }), ['intent_invalid', '/intent/alpha', 'unknown_field']],
    ['unknown beats missing', { ...ok, intent: { targets: [{ node: 'n:a' }], kind: 'x' } }, ['intent_invalid', '/intent/kind', 'unknown_field']],
    ['missing key, field order', { ...ok, intent: { reason: 'r', purpose: 'fix' } }, ['intent_invalid', '/intent/targets', 'missing']],
    ['null targets', withI({ targets: null }), ['intent_invalid', '/intent/targets', 'wrong_type']],
    ['empty targets', withI({ targets: [] }), ['intent_invalid', '/intent/targets', 'empty']],
    ['65 targets', withI({ targets: Array.from({ length: 65 }, () => ({ node: 'n:a' })) }), ['intent_invalid', '/intent/targets', 'too_many']],
    ['target is string (path)', withI({ targets: ['src/db.c'] }), ['intent_invalid', '/intent/targets/0', 'wrong_type']],
    ['target extra key', withI({ targets: [{ node: 'n:a', path: 'x' }] }), ['intent_invalid', '/intent/targets/0/path', 'unknown_field']],
    ['target missing node', withI({ targets: [{}] }), ['intent_invalid', '/intent/targets/0/node', 'missing']],
    ['target node number', withI({ targets: [{ node: 5 }] }), ['intent_invalid', '/intent/targets/0/node', 'wrong_type']],
    ['target bad id', withI({ targets: [{ node: 'src/db.c' }] }), ['intent_invalid', '/intent/targets/0/node', 'bad_id']],
    ['target unknown node', withI({ targets: [{ node: 'n:a' }, { node: 'n:zzz' }] }), ['intent_invalid', '/intent/targets/1/node', 'unknown_node']],
    ['duplicate target at later index', withI({ targets: [{ node: 'n:a' }, { node: 'p:root' }, { node: 'n:a' }] }), ['intent_invalid', '/intent/targets/2/node', 'duplicate']],
    ['purpose wrong type', withI({ purpose: 3 }), ['intent_invalid', '/intent/purpose', 'wrong_type']],
    ['purpose x- value', withI({ purpose: 'x-custom' }), ['intent_invalid', '/intent/purpose', 'not_in_list']],
    ['purpose case', withI({ purpose: 'Fix' }), ['intent_invalid', '/intent/purpose', 'not_in_list']],
    ['needs not list', withI({ needs: 'move.0' }), ['intent_invalid', '/intent/needs', 'wrong_type']],
    ['needs bad id', withI({ needs: ['move.0', 'bad id'] }), ['intent_invalid', '/intent/needs/1', 'bad_id']],
    ['needs duplicate', withI({ needs: ['move.0', 'move.0'] }), ['intent_invalid', '/intent/needs/1', 'duplicate']],
    ['needs self', withI({ needs: ['move.1'] }), ['intent_invalid', '/intent/needs/0', 'self_reference']],
    ['needs null element', withI({ needs: [null] }), ['intent_invalid', '/intent/needs/0', 'wrong_type']],
    ['needs empty allowed', withI({ needs: [] }), null],
    ['needs absent id allowed (not on, script absent)', withI({ needs: ['move.never.seen'] }), null],
    ['reason number', withI({ reason: 5 }), ['intent_invalid', '/intent/reason', 'wrong_type']],
    ['reason empty', withI({ reason: '' }), ['intent_invalid', '/intent/reason', 'empty']],
    ['reason blank', withI({ reason: ' \u00a0\u3000\t' }), ['intent_invalid', '/intent/reason', 'blank']],
    ['reason newline', withI({ reason: 'a\nb' }), ['intent_invalid', '/intent/reason', 'control_char']],
    ['reason U+2028', withI({ reason: 'a\u2028b' }), ['intent_invalid', '/intent/reason', 'control_char']],
    ['reason lone surrogate', withI({ reason: 'a\ud800' }), ['intent_invalid', '/intent/reason', 'lone_surrogate']],
    ['reason 200 code points (astral) ok', withI({ reason: '\u{1F600}'.repeat(200) }), null],
    ['reason 201 code points', withI({ reason: 'a'.repeat(201) }), ['intent_invalid', '/intent/reason', 'too_long']],
    ['multi-error: targets beats purpose beats reason', withI({ targets: [], purpose: 'zz', reason: '' }), ['intent_invalid', '/intent/targets', 'empty']],
    ['multi-error: purpose beats reason', withI({ purpose: 'zz', reason: '' }), ['intent_invalid', '/intent/purpose', 'not_in_list']],
    ['intent invalid beats move_empty', { id: 'move.1', intent: { targets: [], purpose: 'fix', needs: [], reason: 'r' } }, ['intent_invalid', '/intent/targets', 'empty']],
    ['move_empty', { id: 'move.1', intent: ok.intent }, ['move_empty', '/']],
    ['order-only resolution valid (no records)', { id: 'move.1', intent: ok.intent, resolves: { decision: 'order' } }, null],
    ['create move targets its own new node (valid)', { id: 'move.2', nodes: [{ id: 'n:new', kind: 'file' }], intent: { ...ok.intent, targets: [{ node: 'n:new' }] } }, null],
    ['target a node that is neither stored nor minted here', { id: 'move.2', nodes: [{ id: 'n:new', kind: 'file' }], intent: { ...ok.intent, targets: [{ node: 'n:other' }] } }, ['intent_invalid', '/intent/targets/0/node', 'unknown_node']],
    ['records: attrOff only is a record', { id: 'move.1', intent: ok.intent, attrOff: ['a1'] }, null],
  ];
  assert.equal(cases.length, 46);
  for (const [name, payload, expected] of cases) {
    assert.deepEqual(codeOf(payload), expected, name);
  }
});

test('T78 deriveOps matches every row of the R1-R13 truth table', () => {
  const repo = makeOdbcRepo();
  const stored = repo.scripts;
  const n = (script) => normalizeScript(script);
  const ops = (script, scripts = stored) => deriveOps(n(script), scripts).ops;
  const rows = [];
  const check = (id, got, want) => {
    assert.deepEqual(got, want, id);
    rows.push(id);
  };

  check('seed.1 (root pool, pool, entry)', deriveOps(stored[O.seed1], stored).ops, ['add']);
  check('seed.4 (new file, lines, attrs)', deriveOps(stored[O.seed4], stored).ops, ['add']);
  check('move.117 (insert into existing file)', deriveOps(stored[O.m117], stored).ops, ['change']);
  check('move.118 (replace line + rename)', deriveOps(stored[O.m118], stored).ops, ['change', 'rename']);

  const s121 = n(script121());
  const s122 = n(script122());
  check('move.121 (replace line)', deriveOps(s121, stored).ops, ['change']);
  check('move.122 (resolution: new text, switches off both sides)', deriveOps(s122, { ...stored, [s121.id]: s121 }).ops, ['change']);
  check('delete (entry off only)', ops({ id: 'x1', entryOff: [O.eDb] }), ['remove']);
  check('empty pool (node + entry)', ops({
    id: 'x2',
    nodes: [{ id: 'p:new', kind: 'pool' }],
    entries: [{ id: 'E:new', pool: O.src, node: 'p:new', name: 'empty' }],
  }), ['add']);
  check('move between pools (entry off + entry in other pool, same node)', ops({
    id: 'x3',
    entryOff: [O.eOdbc],
    entries: [{ id: 'E:mv', pool: O.root, node: O.file, name: 'odbc.c' }],
  }), ['rename']);
  check('case-only rename', ops({
    id: 'x4',
    entryOff: [O.eOdbc],
    entries: [{ id: 'E:case', pool: O.src, node: O.file, name: 'ODBC.c' }],
  }), ['rename']);
  check('pool -> file at same name (off pool entry, entry for NEW file node)', ops({
    id: 'x5',
    entryOff: [O.eSrc],
    nodes: [{ id: 'n:newfile', kind: 'file' }],
    entries: [{ id: 'E:pf', pool: O.root, node: 'n:newfile', name: 'src' }],
  }), ['add', 'remove']);
  check('copy (new node + entry + lines)', ops({
    id: 'x6',
    nodes: [{ id: 'n:copy', kind: 'file' }],
    entries: [{ id: 'E:copy', pool: O.src, node: 'n:copy', name: 'copy.c' }],
    lines: [{ id: 'Lc0', node: 'n:copy', bytes: 'x\n' }],
  }), ['add']);
  check('attribute change (attr off + new attr, existing node)', ops({
    id: 'x7',
    attrOff: ['seed.4:mode'],
    attributes: [{ id: 'x7:mode', node: O.file, key: 'mode', value: '755' }],
  }), ['change']);
  check('attribute switch-off alone', ops({ id: 'x8', attrOff: ['seed.4:mode'] }), ['remove']);
  check('line switch-off with no replacement', ops({ id: 'x9', off: ['L4.2'] }), ['remove']);
  check('order-only resolution (no records)', ops({
    id: 'x10',
    resolves: {
      kind: 'same_slot', inputs: [O.m118, O.m121], contested: ['L4.1'],
      saw: ['L118.0', 'L121.0'], decision: 'order',
    },
  }), []);
  check('removal resolution (off only)', ops({
    id: 'x11',
    resolves: {
      kind: 'same_slot', inputs: [O.m118, O.m121], contested: ['L4.1'],
      saw: ['L118.0', 'L121.0'], decision: 'remove',
    },
    off: ['L118.0', 'L121.0'],
  }), ['remove']);
  check('content + rename + delete of another entry', ops({
    id: 'x12',
    off: ['L4.1'],
    lines: [{ id: 'Lx12', node: O.file, bytes: 'y\n', replaces: 'L4.1' }],
    entryOff: [O.eOdbc, O.eSrc],
    entries: [{ id: 'E:x12', pool: O.src, node: O.file, name: 'q.c' }],
  }), ['change', 'remove', 'rename']);
  check('entry off with identical re-entry (same pool, same name)', ops({
    id: 'x13',
    entryOff: [O.eOdbc],
    entries: [{ id: 'E:same', pool: O.src, node: O.file, name: 'odbc.c' }],
  }), ['change']);

  const partial = deriveOps(n({ id: 'x14', entryOff: ['E:unknown'] }), stored);
  check('unresolvable switched-off entry', partial.ops, ['remove']);
  assert.deepEqual(partial.partial, ['E:unknown']);

  const demo = makeDemoRepo().scripts;
  check('demo move 3 (insert)', deriveOps(demo['3'], demo).ops, ['change']);
  check('demo move 10 (replace)', deriveOps(demo['10'], demo).ops, ['change']);
  check('demo move 1 (seed with nodes, entry, lines)', deriveOps(demo['1'], demo).ops, ['add']);

  const shuffled = n({
    id: 'x15',
    entryOff: [O.eOdbc, O.eSrc].reverse(),
    off: ['L4.1'],
    lines: [{ id: 'Lx15', node: O.file, bytes: 'z\n', replaces: 'L4.1' }],
    entries: [{ id: 'E:x15', pool: O.src, node: O.file, name: 'q.c' }],
  });
  assert.deepEqual(deriveOps(shuffled, stored).ops, ['change', 'remove', 'rename']);
  assert.deepEqual(deriveOps(stored[O.m117], stored).ops, ['change']);
  assert.deepEqual(deriveOps(stored[O.m118], stored).ops, ['change', 'rename']);
  assert.equal(rows.length, 23);

  const lexical = [...deriveOps(stored[O.m118], stored).ops].sort();
  assert.deepEqual(deriveOps(stored[O.m118], stored).ops, lexical);
});

test('T80 hasRecords: seven arrays, order-only resolutions and redactions', () => {
  const base = { id: 'move.1', intent: ok.intent };
  for (const key of RECORD_ARRAYS) {
    assert.equal(hasRecords({ [key]: ['x'] }), true, key);
    assert.equal(codeOf({ ...base, [key]: ['x'] }), null, key);
  }
  assert.equal(hasRecords({ redactions: [{ lineId: 'L1' }] }), false);
  assert.deepEqual(codeOf({ ...base, redactions: [{ lineId: 'L1' }] }), ['move_empty', '/']);

  assert.equal(codeOf({ ...base, resolves: { decision: 'order' } }), null);
  assert.deepEqual(codeOf(base), ['move_empty', '/']);
  assert.deepEqual(codeOf({ ...base, off: [] }), ['move_empty', '/']);
});

test('T44a a move with no records and no resolves is move_empty', () => {
  assert.deepEqual(codeOf({ id: 'move.1', intent: ok.intent }), ['move_empty', '/']);
  assert.deepEqual(codeOf({ id: 'move.1', intent: ok.intent, nodes: [], entries: [], lines: [] }), ['move_empty', '/']);
});

test('purity: every function is stable and does not mutate frozen inputs', () => {
  const payload = deepFreeze({
    id: 'move.2',
    nodes: [{ id: 'n:new', kind: 'file' }],
    entryOff: [O.eDb],
    lines: [{ id: 'Lx', node: 'n:new', bytes: 'x\n' }],
    intent: {
      targets: [{ node: 'n:new' }],
      purpose: 'feature',
      needs: ['move.0'],
      reason: 'stable',
    },
  });
  const frozenCtx = Object.freeze({ hasNode: (id) => id === 'n:new' });
  const scripts = deepFreeze({
    [O.eDb]: normalizeScript({
      id: 'seed.4',
      entries: [{ id: O.eDb, pool: O.src, node: O.file, name: 'db.c' }],
    }),
  });

  assert.deepEqual(checkInRefusal(payload, frozenCtx), checkInRefusal(payload, frozenCtx));
  assert.deepEqual(intentError(payload.intent, 'move.2', frozenCtx), intentError(payload.intent, 'move.2', frozenCtx));
  assert.deepEqual(hasRecords(payload), hasRecords(payload));
  const first = deriveOps(payload, scripts);
  const second = deriveOps(payload, scripts);
  assert.deepEqual(first, second);
  assert.deepEqual(first.ops, ['add', 'remove']);
  assert.equal(Object.isFrozen(payload), true);
  assert.equal(Object.isFrozen(scripts), true);
});
