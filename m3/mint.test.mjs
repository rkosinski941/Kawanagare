/**
 * mint-v1 (G-49; weave note §7.1 T-W01..T-W12, plus M1-01..M1-14).
 * Canonical line records from a before-view and an after-view.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { carry, checkin, createRepo, exportStream, forkStream, inspect, pull, redact, restore } from './engine.mjs';
import { START, END } from './weave.mjs';
import { withIntent } from './fixture.mjs';
import { hashOf } from './canon.mjs';
import { MINT_ALGO, MINT_MAX_CELLS, alignLines, beforeFromView, mintLineId, mintScript, splitLines } from './mint.mjs';

const FILE = 'f';
const PATH = 't.txt';

/** Seed a repo with one file whose lines are minted by mint-v1 from an empty file. */
function seedRepo(bytes, stream = 'dev') {
  const repo = createRepo();
  const m = mintScript(FILE, [], bytes, 'seed');
  const seeded = checkin(repo, stream, withIntent({
    id: 'seed',
    orderKey: '1',
    nodes: [
      { id: 'root', kind: 'pool', root: true },
      { id: FILE, kind: 'file' },
    ],
    entries: [{ id: 'Ef', pool: 'root', node: FILE, name: PATH }],
    lines: m.lines,
  }));
  assert.equal(seeded.ok, true, seeded.message);
  return repo;
}

function fileOf(view) {
  return view.files.find((file) => file.path === PATH);
}

function text(repo, stream = 'dev') {
  return fileOf(inspect(repo, stream)).bytes;
}

function ids(repo, stream = 'dev') {
  return fileOf(inspect(repo, stream)).lineIds;
}

/** Mint `after` against the current view of `stream` and check the move in there. */
function mintIn(repo, stream, moveId, orderKey, after) {
  const view = inspect(repo, stream);
  const m = mintScript(FILE, beforeFromView(repo, view, FILE), after, moveId);
  const script = withIntent({ id: moveId, orderKey, saw: m.saw, lines: m.lines, off: m.off }, { targets: [{ node: FILE }] });
  const res = checkin(repo, stream, script);
  assert.equal(res.ok, true, res.message);
  return m;
}

function lineRecord(repo, id) {
  for (const script of Object.values(repo.scripts)) {
    const line = script.lines.find((item) => item.id === id);
    if (line) return line;
  }
  return null;
}

/** Deterministic PRNG (mulberry32) so the fuzz rows are the same on every host. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomText(next, maxLines) {
  const alphabet = ['a\n', 'b\n', 'c\n', 'd\n', 'a\r\n', 'e'];
  const count = Math.floor(next() * (maxLines + 1));
  let out = '';
  for (let i = 0; i < count; i++) {
    let line = alphabet[Math.floor(next() * alphabet.length)];
    if (line === 'e' && i < count - 1) line = 'e\n';
    out += line;
  }
  return out;
}

// ---------------------------------------------------------------- T-W rows (weave note §7.1)

test('T-W01 I5: after a mint deletes B, record B is still stored with its bytes and is inactive', () => {
  const repo = seedRepo('a\nb\nc\n');
  const m = mintIn(repo, 'dev', 'delB', '2', 'a\nc\n');
  assert.deepEqual(m.off, [mintLineId('seed', 1)]);
  assert.deepEqual(m.lines, []);
  const b = lineRecord(repo, mintLineId('seed', 1));
  assert.equal(b.bytes, 'b\n');
  assert.equal(repo.scripts.seed.lines.length, 3);
  assert.equal(ids(repo).includes(b.id), false);
  assert.equal(text(repo), 'a\nc\n');
});

test('T-W02 I6: a new record is appended in its own script; view order places it mid-file', () => {
  const repo = seedRepo('a\nb\nc\n');
  const seedOrder = repo.scripts.seed.lines.map((line) => line.id);
  mintIn(repo, 'dev', 'insX', '2', 'a\nx\nb\nc\n');
  assert.deepEqual(repo.scripts.seed.lines.map((line) => line.id), seedOrder);
  assert.deepEqual(repo.scripts.insX.lines.map((line) => line.id), ['L:insX:0']);
  assert.deepEqual(ids(repo), ['L:seed:0', 'L:insX:0', 'L:seed:1', 'L:seed:2']);
  assert.equal(text(repo), 'a\nx\nb\nc\n');
});

test('T-W03 I7: modify is off:[old] plus a new line that replaces it; old bytes unchanged; no snag on the successor', () => {
  const repo = seedRepo('a\nb\nc\n');
  const m = mintIn(repo, 'dev', 'modB', '2', 'a\nB\nc\n');
  assert.deepEqual(m.off, ['L:seed:1']);
  assert.deepEqual(m.lines, [{ id: 'L:modB:0', node: FILE, bytes: 'B\n', after: 'L:seed:0', before: 'L:seed:2', replaces: 'L:seed:1' }]);
  assert.equal(lineRecord(repo, 'L:seed:1').bytes, 'b\n');
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'a\nB\nc\n');
  assert.deepEqual(view.snags, []);
  assert.equal(view.exportable, true);
});

test('T-W04 I7 negative: `replaces` without `off` is not a modify (old line stays active); mint never emits it', () => {
  const repo = seedRepo('a\nb\nc\n');
  const res = checkin(repo, 'dev', withIntent({
    id: 'repOnly',
    orderKey: '2',
    lines: [{ id: 'R', node: FILE, bytes: 'B\n', after: 'L:seed:0', before: 'L:seed:2', replaces: 'L:seed:1' }],
  }));
  assert.equal(res.ok, true, res.message);
  assert.equal(ids(repo).includes('L:seed:1'), true);
  const m = mintScript(FILE, [{ id: 'x', bytes: 'b\n' }, { id: 'y', bytes: 'c\n' }], 'B\nC\nD\n', 'm');
  for (const line of m.lines) if (line.replaces) assert.equal(m.off.includes(line.replaces), true);
});

test('T-W05 I3: carrying the minted move keeps its Move-Id and line ids; the source stream is unchanged', () => {
  const repo = seedRepo('a\nb\nc\n');
  forkStream(repo, 'dev', 'rel');
  mintIn(repo, 'dev', 'modB', '2', 'a\nB\nc\n');
  const devBefore = ids(repo, 'dev');
  const scriptCount = Object.keys(repo.scripts).length;
  const res = carry(repo, 'rel', 'modB');
  assert.equal(res.ok, true, res.message);
  assert.deepEqual(ids(repo, 'rel'), devBefore);
  assert.equal(text(repo, 'rel'), 'a\nB\nc\n');
  assert.deepEqual(ids(repo, 'dev'), devBefore);
  assert.equal(Object.keys(repo.scripts).length, scriptCount);
  assert.equal(repo.scripts.modB.lines[0].id, 'L:modB:0');
});

test('T-W06 I4: two streams over one weave show different activations of the same line; neither is a base', () => {
  const repo = seedRepo('a\nb\nc\n');
  forkStream(repo, 'dev', 'rel');
  mintIn(repo, 'dev', 'delB', '2', 'a\nc\n');
  mintIn(repo, 'rel', 'delC', '3', 'a\nb\n');
  assert.equal(ids(repo, 'dev').includes('L:seed:1'), false);
  assert.equal(ids(repo, 'rel').includes('L:seed:1'), true);
  assert.equal(ids(repo, 'dev').includes('L:seed:2'), true);
  assert.equal(ids(repo, 'rel').includes('L:seed:2'), false);
  assert.equal(text(repo, 'dev'), 'a\nc\n');
  assert.equal(text(repo, 'rel'), 'a\nb\n');
});

test('T-W07 I8: pull then restore of a minted move gives the same line ids and bytes; script count unchanged', () => {
  const repo = seedRepo('a\nb\nc\n');
  mintIn(repo, 'dev', 'modB', '2', 'a\nB\nc\nd\n');
  const idsOn = ids(repo);
  const count = Object.keys(repo.scripts).length;
  assert.equal(pull(repo, 'dev', 'modB').ok, true);
  assert.equal(text(repo), 'a\nb\nc\n');
  assert.equal(restore(repo, 'dev', 'modB').ok, true);
  assert.deepEqual(ids(repo), idsOn);
  assert.equal(text(repo), 'a\nB\nc\nd\n');
  assert.equal(Object.keys(repo.scripts).length, count);
});

test('T-W08 I1: one in-play set reached by different carry/pull/restore orders gives equal line ids and bytes', () => {
  const repo = seedRepo('a\nb\nc\nd\n');
  forkStream(repo, 'dev', 'x');
  forkStream(repo, 'dev', 'y');
  mintIn(repo, 'x', 'modA', '2', 'A\nb\nc\nd\n');
  mintIn(repo, 'y', 'delC', '3', 'a\nb\nd\n');
  assert.equal(carry(repo, 'x', 'delC').ok, true);
  assert.equal(carry(repo, 'y', 'modA').ok, true);
  assert.equal(pull(repo, 'y', 'modA').ok, true);
  assert.equal(pull(repo, 'y', 'delC').ok, true);
  assert.equal(restore(repo, 'y', 'delC').ok, true);
  assert.equal(restore(repo, 'y', 'modA').ok, true);
  assert.deepEqual(ids(repo, 'x'), ids(repo, 'y'));
  assert.equal(text(repo, 'x'), 'A\nb\nd\n');
  assert.equal(text(repo, 'y'), text(repo, 'x'));
  assert.deepEqual(inspect(repo, 'x').snags, []);
});

test('T-W09 G-49 tie-break: equal-cost alignment is deletions-first; output hash is a fixed vector', () => {
  // [a, b] -> [b, a]: two alignments keep one line. Deletions first keeps b.
  assert.deepEqual(alignLines(['a\n', 'b\n'], ['b\n', 'a\n']), [
    { op: 'off', i: 0 },
    { op: 'keep', i: 1, j: 0 },
    { op: 'add', j: 1 },
  ]);
  // HTI shape: a kept line next to a pure deletion run stays attached to the kept side.
  assert.deepEqual(alignLines(['x\n', 'y\n', '}\n', '}\n'], ['x\n', '}\n']), [
    { op: 'keep', i: 0, j: 0 },
    { op: 'off', i: 1 },
    { op: 'off', i: 2 },
    { op: 'keep', i: 3, j: 1 },
  ]);
  const before = splitLines('p\nq\nr\nq\np\ns\n').map((bytes, i) => ({ id: `S:${i}`, bytes }));
  const m = mintScript('n:f', before, 'q\np\nr\np\nq\nt\n', 'move.vec@box.1');
  assert.deepEqual(m.off, ['S:0', 'S:3', 'S:5']);
  assert.deepEqual(m.lines.map((line) => [line.id, line.bytes, line.after, line.before, line.replaces ?? null]), [
    ['L:move.vec@box.1:0', 'p\n', 'S:1', 'S:2', null],
    ['L:move.vec@box.1:1', 'q\n', 'S:4', END, 'S:5'],
    ['L:move.vec@box.1:2', 't\n', 'L:move.vec@box.1:1', END, null],
  ]);
  assert.equal(hashOf(m), MINT_V1_VECTOR_HASH);
  assert.deepEqual(mintScript('n:f', before, 'q\np\nr\np\nq\nt\n', 'move.vec@box.1'), m);
});

test('T-W10 G-49 residual / Q-W3: a minted mid-file delete exports (D-K5-01); T07 shape still flags', () => {
  const repo = seedRepo('a\nb\nc\n');
  mintIn(repo, 'dev', 'delB', '2', 'a\nc\n');
  let view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'a\nc\n');
  assert.deepEqual(view.snags, []);
  assert.equal(exportStream(repo, 'dev').ok, true);
  const late = checkin(repo, 'dev', withIntent({
    id: 'insD',
    orderKey: '3',
    lines: [{ id: 'D', node: FILE, bytes: 'd\n', after: 'L:seed:1', before: 'L:seed:2' }],
  }));
  assert.equal(late.ok, true, late.message);
  view = inspect(repo, 'dev');
  const lost = view.snags.filter((snag) => snag.kind === 5);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].spot, 'L:seed:1');
  assert.deepEqual(lost[0].lines, ['D']);
  assert.equal(view.exportable, false);
});

test('T-W11 a no-op mint (after bytes = before bytes) emits no lines and no offs', () => {
  const before = splitLines('a\nb\r\nc').map((bytes, i) => ({ id: `S:${i}`, bytes }));
  const m = mintScript('n:f', before, 'a\nb\r\nc', 'm');
  assert.deepEqual(m.lines, []);
  assert.deepEqual(m.off, []);
  assert.equal(m.nextIndex, 0);
  assert.deepEqual(mintScript('n:f', [], '', 'm').lines, []);
});

test('T-W12 mixed CRLF/LF bytes round-trip through mint and view', () => {
  const seedBytes = 'a\r\nb\nc\r\nlast';
  const repo = seedRepo(seedBytes);
  assert.equal(text(repo), seedBytes);
  const after = 'a\r\nb\r\nc\r\nlast\nnew\r\nend';
  const m = mintIn(repo, 'dev', 'eol', '2', after);
  assert.deepEqual(m.off, ['L:seed:1', 'L:seed:3']);
  assert.equal(text(repo), after);
  assert.deepEqual(inspect(repo, 'dev').snags, []);
});

// ---------------------------------------------------------------- M1 rows (this slice)

test('M1-01 splitLines: "\\n" ends a line and stays on it; lone "\\r" does not split; last line may lack "\\n"', () => {
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('a'), ['a']);
  assert.deepEqual(splitLines('a\n'), ['a\n']);
  assert.deepEqual(splitLines('a\r\nb'), ['a\r\n', 'b']);
  assert.deepEqual(splitLines('a\rb\n'), ['a\rb\n']);
  assert.deepEqual(splitLines('\n\n'), ['\n', '\n']);
  assert.deepEqual(splitLines('é\n😀'), ['é\n', '😀']);
  assert.equal(splitLines('x\r\ny\nz').join(''), 'x\r\ny\nz');
});

test('M1-02 alignment order is fixed: prefix keep, then suffix keep, then the deletions-first walk', () => {
  // Suffix trim keeps the last x, so the earlier lines are switched off.
  assert.deepEqual(alignLines(['a\n', 'x\n', 'x\n'], ['x\n']), [
    { op: 'off', i: 0 },
    { op: 'off', i: 1 },
    { op: 'keep', i: 2, j: 0 },
  ]);
  // Prefix trim keeps the first x.
  assert.deepEqual(alignLines(['x\n', 'x\n', 'a\n'], ['x\n']), [
    { op: 'keep', i: 0, j: 0 },
    { op: 'off', i: 1 },
    { op: 'off', i: 2 },
  ]);
  // Bytes compare exactly: CRLF and LF lines differ; a missing final "\n" differs.
  assert.deepEqual(alignLines(['a\r\n', 'b'], ['a\n', 'b\n']).map((op) => op.op), ['off', 'off', 'add', 'add']);
});

test('M1-03 hunk pairing: k-th add replaces k-th off; extra adds are plain inserts; extra offs are pure switch-offs', () => {
  const before = splitLines('a\nb\nc\nd\n').map((bytes, i) => ({ id: `S:${i}`, bytes }));
  const grow = mintScript('n', before, 'a\nB\nC\nX\nd\n', 'm');
  assert.deepEqual(grow.off, ['S:1', 'S:2']);
  assert.deepEqual(grow.lines.map((line) => [line.id, line.after, line.before, line.replaces ?? null]), [
    ['L:m:0', 'S:0', 'S:3', 'S:1'],
    ['L:m:1', 'L:m:0', 'S:3', 'S:2'],
    ['L:m:2', 'L:m:1', 'S:3', null],
  ]);
  const shrink = mintScript('n', before, 'a\nB\nd\n', 'm');
  assert.deepEqual(shrink.off, ['S:1', 'S:2']);
  assert.deepEqual(shrink.lines.map((line) => [line.id, line.replaces]), [['L:m:0', 'S:1']]);
  // No minted line anchors on a line that the same mint switches off.
  for (const m of [grow, shrink]) {
    for (const line of m.lines) {
      assert.equal(m.off.includes(line.after), false);
      assert.equal(m.off.includes(line.before), false);
    }
  }
});

test('M1-04 line ids are L:<move>:<n>; firstIndex/nextIndex let one move mint several nodes without clashes', () => {
  const a = mintScript('n:1', [], 'x\ny\n', 'move.joy@lap.7');
  assert.deepEqual(a.lines.map((line) => line.id), ['L:move.joy@lap.7:0', 'L:move.joy@lap.7:1']);
  assert.equal(a.nextIndex, 2);
  const b = mintScript('n:2', [], 'z\n', 'move.joy@lap.7', { firstIndex: a.nextIndex });
  assert.deepEqual(b.lines.map((line) => line.id), ['L:move.joy@lap.7:2']);
  assert.deepEqual(a.lines.map((line) => [line.after, line.before]), [[START, END], ['L:move.joy@lap.7:0', END]]);
  assert.throws(() => mintScript('n', [], 'x\n', 'm', { firstIndex: -1 }));
  assert.throws(() => mintScript('n', [{ id: 'S', bytes: 'a\n' }, { id: 'S', bytes: 'b\n' }], '', 'm'), /listed twice/);
  assert.throws(() => mintScript('', [], '', 'm'));
  assert.throws(() => mintScript('n', [], '', ''));
});

test('M1-05 pure and deterministic: equal inputs give deep-equal output; inputs are not mutated', () => {
  const before = Object.freeze(splitLines('a\nb\nc\n').map((bytes, i) => Object.freeze({ id: `S:${i}`, bytes, addedBy: 'seed' })));
  const one = mintScript('n', before, 'a\nB\nc\nd\n', 'm');
  const two = mintScript('n', before, 'a\nB\nc\nd\n', 'm');
  assert.deepEqual(one, two);
  assert.equal(one.derive_algo, MINT_ALGO);
  assert.equal(hashOf(one), hashOf(two));
});

test('M1-06 beforeFromView uses stored bytes, so a redaction marker is never minted as content', () => {
  const repo = seedRepo('a\nsecret\nc\n');
  redact(repo, { lineId: 'L:seed:1', marker: '[redacted]\n' });
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'a\n[redacted]\nc\n');
  const before = beforeFromView(repo, view, FILE);
  assert.deepEqual(before.map((line) => line.bytes), ['a\n', 'secret\n', 'c\n']);
  assert.deepEqual(before.map((line) => line.addedBy), ['seed', 'seed', 'seed']);
  const m = mintScript(FILE, before, 'a\nc\n', 'drop');
  assert.deepEqual(m.off, ['L:seed:1']);
  assert.throws(() => beforeFromView(repo, view, 'nope'), /not a visible file/);
});

test('M1-07 empty before (new file node) mints one START..END chain; empty after switches every line off', () => {
  const fresh = mintScript('n', [], 'a\nb\n', 'm');
  assert.deepEqual(fresh.off, []);
  assert.deepEqual(fresh.lines.map((line) => [line.after, line.before, line.replaces ?? null]), [[START, END, null], ['L:m:0', END, null]]);
  const repo = seedRepo('a\nb\nc\n');
  const m = mintIn(repo, 'dev', 'empty', '2', '');
  assert.deepEqual(m.off, ['L:seed:0', 'L:seed:1', 'L:seed:2']);
  assert.deepEqual(m.lines, []);
  assert.equal(text(repo), '');
  assert.deepEqual(inspect(repo, 'dev').snags, []);
});

test('M1-08 size limit: a trimmed table over MINT_MAX_CELLS throws mint_too_large; trimming keeps large files cheap', () => {
  const side = Math.ceil(Math.sqrt(MINT_MAX_CELLS));
  const before = Array.from({ length: side }, (_, i) => ({ id: `S:${i}`, bytes: `b${i}\n` }));
  const after = Array.from({ length: side }, (_, i) => `a${i}\n`).join('');
  assert.throws(() => mintScript('n', before, after, 'm'), (err) => err.code === 'mint_too_large');
  const big = Array.from({ length: 50000 }, (_, i) => ({ id: `S:${i}`, bytes: `l${i}\n` }));
  const edited = big.map((line, i) => (i === 25000 ? 'changed\n' : line.bytes)).join('');
  const m = mintScript('n', big, edited, 'm');
  assert.deepEqual(m.off, ['S:25000']);
  assert.equal(m.lines[0].replaces, 'S:25000');
});

test('M1-09 saw lists the makers of the before lines, unique and sorted; empty without addedBy', () => {
  const repo = seedRepo('a\nb\n');
  mintIn(repo, 'dev', 'move.b', '2', 'a\nx\nb\n');
  const view = inspect(repo, 'dev');
  const m = mintScript(FILE, beforeFromView(repo, view, FILE), 'a\nx\n', 'move.c');
  assert.deepEqual(m.saw, ['move.b', 'seed']);
  assert.deepEqual(mintScript('n', [{ id: 'S', bytes: 'a\n' }], 'b\n', 'm').saw, []);
});

test('M1-10 fuzz, one move on a seed: view bytes equal the after bytes and there are no snags (300 seeded rows)', () => {
  const next = rng(0x6b617761);
  for (let row = 0; row < 300; row++) {
    const start = randomText(next, 8);
    const after = randomText(next, 8);
    const repo = seedRepo(start);
    const view = inspect(repo, 'dev');
    const m = mintScript(FILE, beforeFromView(repo, view, FILE), after, 'm1');
    for (const line of m.lines) if (line.replaces) assert.equal(m.off.includes(line.replaces), true);
    if (!m.lines.length && !m.off.length) {
      assert.equal(start, after, `row ${row}`);
      continue;
    }
    const res = checkin(repo, 'dev', withIntent({ id: 'm1', orderKey: '2', lines: m.lines, off: m.off }, { targets: [{ node: FILE }] }));
    assert.equal(res.ok, true, `row ${row}: ${res.message}`);
    const out = inspect(repo, 'dev');
    assert.equal(fileOf(out).bytes, after, `row ${row}: ${JSON.stringify(start)} -> ${JSON.stringify(after)}`);
    assert.deepEqual(out.snags, [], `row ${row}`);
  }
});

test('M1-11 fuzz, chains of four mints: view bytes always equal the last after bytes; any snag is kind 3 or 5 (G-53, G-54)', () => {
  const next = rng(0x6d696e74);
  for (let row = 0; row < 150; row++) {
    const repo = seedRepo(randomText(next, 6));
    for (let step = 1; step <= 4; step++) {
      const after = randomText(next, 7);
      const view = inspect(repo, 'dev');
      const id = `m${step}`;
      const m = mintScript(FILE, beforeFromView(repo, view, FILE), after, id);
      if (!m.lines.length && !m.off.length) continue;
      const res = checkin(repo, 'dev', withIntent({ id, orderKey: String(step + 1), saw: m.saw, lines: m.lines, off: m.off }, { targets: [{ node: FILE }] }));
      assert.equal(res.ok, true, `row ${row} step ${step}: ${res.message}`);
      const out = inspect(repo, 'dev');
      assert.equal(fileOf(out).bytes, after, `row ${row} step ${step}`);
      for (const snag of out.snags) assert.equal([3, 5].includes(snag.kind), true, `row ${row} step ${step} kind ${snag.kind}`);
    }
  }
});

test('M1-12 residual G-53 (pending Rich): a sequential minted modify of the `after` anchor of an earlier move\'s line raises kind 3', () => {
  const repo = seedRepo('a\nb\nc\n');
  mintIn(repo, 'dev', 'insE', '2', 'a\nb\ne\nc\n');
  const m = mintIn(repo, 'dev', 'modB', '3', 'a\nB\ne\nc\n');
  assert.deepEqual(m.saw, ['insE', 'seed']);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'a\nB\ne\nc\n');
  assert.deepEqual(view.snags.map((snag) => [snag.kind, snag.spot, snag.lines]), [[3, 'L:seed:1', ['L:insE:0']]]);
  assert.equal(view.exportable, false);
});

test('M1-13 residual G-54 (pending Rich): a sequential minted delete of a line that a later move\'s line anchors on raises kind 5', () => {
  const repo = seedRepo('a\nb\nc\n');
  mintIn(repo, 'dev', 'insE', '2', 'a\nb\ne\nc\n');
  mintIn(repo, 'dev', 'insF', '3', 'a\nb\ne\nf\nc\n');
  mintIn(repo, 'dev', 'delE', '4', 'a\nb\nf\nc\n');
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'a\nb\nf\nc\n');
  assert.deepEqual(view.snags.map((snag) => [snag.kind, snag.spot, snag.lines]), [[5, 'L:insE:0', ['L:insF:0']]]);
  assert.equal(view.exportable, false);
});

test('M1-14 one move, two nodes: chained ids, both files change, carry is one move', () => {
  const repo = createRepo();
  const f1 = mintScript('f1', [], 'one\n', 'seed');
  const f2 = mintScript('f2', [], 'two\n', 'seed', { firstIndex: f1.nextIndex });
  assert.equal(checkin(repo, 'dev', withIntent({
    id: 'seed',
    orderKey: '1',
    nodes: [{ id: 'root', kind: 'pool', root: true }, { id: 'f1', kind: 'file' }, { id: 'f2', kind: 'file' }],
    entries: [{ id: 'E1', pool: 'root', node: 'f1', name: 'a.txt' }, { id: 'E2', pool: 'root', node: 'f2', name: 'b.txt' }],
    lines: [...f1.lines, ...f2.lines],
  })).ok, true);
  forkStream(repo, 'dev', 'rel');
  const view = inspect(repo, 'dev');
  const m1 = mintScript('f1', beforeFromView(repo, view, 'f1'), 'ONE\n', 'both');
  const m2 = mintScript('f2', beforeFromView(repo, view, 'f2'), 'two\nmore\n', 'both', { firstIndex: m1.nextIndex });
  assert.deepEqual([...m1.lines, ...m2.lines].map((line) => line.id), ['L:both:0', 'L:both:1']);
  const res = checkin(repo, 'dev', withIntent({ id: 'both', orderKey: '2', lines: [...m1.lines, ...m2.lines], off: [...m1.off, ...m2.off] }, { targets: [{ node: 'f1' }, { node: 'f2' }] }));
  assert.equal(res.ok, true, res.message);
  assert.equal(carry(repo, 'rel', 'both').ok, true);
  const rel = inspect(repo, 'rel');
  assert.deepEqual(rel.files.map((file) => [file.path, file.bytes]), [['a.txt', 'ONE\n'], ['b.txt', 'two\nmore\n']]);
  assert.deepEqual(rel.snags, []);
});

test('M1-15 replacement chain (D-M1-08): replacing a visible replacement keeps the original slot', () => {
  const repo = seedRepo('a\nb\n');
  mintIn(repo, 'dev', 'both', '2', 'a2\nb2\n');
  const m = mintIn(repo, 'dev', 'again', '3', 'a3\nb2\n');
  assert.equal(m.lines[0].replaces, 'L:both:0');
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'a3\nb2\n');
  assert.deepEqual(view.snags, []);
});

test('M1-16 switched-off replacement keeps its slot as the tombstone (D-M1-08)', () => {
  const repo = seedRepo('a\nb\n');
  mintIn(repo, 'dev', 'modA', '2', 'x\nb\n');
  mintIn(repo, 'dev', 'insY', '3', 'y\nx\nb\n');
  const m = mintIn(repo, 'dev', 'last', '4', 'z\nb\n');
  assert.deepEqual(m.off, ['L:insY:0', 'L:modA:0']);
  assert.equal(m.lines[0].replaces, 'L:insY:0');
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'z\nb\n');
  assert.deepEqual(view.snags, []);
});

test('M1-17 a chain of replacements is placed by the first line of the chain (D-M1-08)', () => {
  const repo = seedRepo('q\n');
  mintIn(repo, 'dev', 'm2', '2', 'p\nq\n');
  const m3 = mintIn(repo, 'dev', 'm3', '3', 'P\nQ\n');
  assert.deepEqual(m3.lines.map((line) => [line.replaces, line.after, line.before]), [['L:m2:0', START, END], ['L:seed:0', 'L:m3:0', END]]);
  const m4 = mintIn(repo, 'dev', 'm4', '4', 'P2\nQ\n');
  assert.equal(m4.lines[0].replaces, 'L:m3:0');
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'P2\nQ\n');
  assert.deepEqual(view.snags, []);
});

const MINT_V1_VECTOR_HASH = 'sha256:cb1d7a82d0a9cfd559f382a479c64855743b0d0175e89be7ecd6a3df9ac4771c';
