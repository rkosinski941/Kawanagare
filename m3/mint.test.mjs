/**
 * mint-v1 (G-49; weave note §7.1 T-W01..T-W12, plus M1-01..M1-14).
 * Canonical line records from a before-view and an after-view.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { carry, checkin, createRepo, exportStream, forkStream, inspect, movesOn, pull, redact, restore } from './engine.mjs';
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

test('M1-11 fuzz, chains of four mints: view bytes always equal the last after bytes; no snags with mint `saw` (D-M1-12)', () => {
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
      assert.deepEqual(out.snags, [], `row ${row} step ${step}`);
    }
  }
});

test('M1-12 saw exemption (D-M1-12, G-53): a sequential minted modify of an earlier move\'s `after` anchor is not kind 3', () => {
  const repo = seedRepo('a\nb\nc\n');
  mintIn(repo, 'dev', 'insE', '2', 'a\nb\ne\nc\n');
  const m = mintIn(repo, 'dev', 'modB', '3', 'a\nB\ne\nc\n');
  assert.deepEqual(m.saw, ['insE', 'seed']);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'a\nB\ne\nc\n');
  assert.deepEqual(view.snags, []);
  assert.equal(view.exportable, true);
});

test('M1-13 saw exemption (D-M1-12, G-54): a sequential minted delete of a line a later move anchors on is not kind 5', () => {
  const repo = seedRepo('a\nb\nc\n');
  mintIn(repo, 'dev', 'insE', '2', 'a\nb\ne\nc\n');
  mintIn(repo, 'dev', 'insF', '3', 'a\nb\ne\nf\nc\n');
  mintIn(repo, 'dev', 'delE', '4', 'a\nb\nf\nc\n');
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'a\nb\nf\nc\n');
  assert.deepEqual(view.snags, []);
  assert.equal(view.exportable, true);
});

test('M1-13b concurrent edits still snag: without the other move in `saw`, kind 3 and kind 5 fire', () => {
  const repo = seedRepo('a\nb\nc\n');
  forkStream(repo, 'dev', 'other');
  mintIn(repo, 'dev', 'insE', '2', 'a\nb\ne\nc\n');
  const view0 = inspect(repo, 'other');
  const mod = mintScript(FILE, beforeFromView(repo, view0, FILE), 'a\nB\nc\n', 'modB');
  assert.deepEqual(mod.saw, ['seed']);
  assert.equal(checkin(repo, 'other', withIntent({ id: 'modB', orderKey: '3', saw: mod.saw, lines: mod.lines, off: mod.off }, { targets: [{ node: FILE }] })).ok, true);
  assert.equal(carry(repo, 'dev', 'modB').ok, true);
  let view = inspect(repo, 'dev');
  assert.deepEqual(view.snags.map((snag) => [snag.kind, snag.spot]), [[3, 'L:seed:1']]);

  const repo2 = seedRepo('a\nb\nc\n');
  forkStream(repo2, 'dev', 'other');
  mintIn(repo2, 'dev', 'insE', '2', 'a\nb\ne\nc\n');
  mintIn(repo2, 'other', 'delB', '3', 'a\nc\n');
  assert.equal(carry(repo2, 'dev', 'delB').ok, true);
  view = inspect(repo2, 'dev');
  assert.deepEqual(view.snags.map((snag) => [snag.kind, snag.spot, snag.lines]), [[5, 'L:seed:1', ['L:insE:0']]]);
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

// ---------------------------------------------------------------- D-M1-13: kind 3 through replacement chains

/** Base "a\n" on dev, fork `other`; `steps` mints on dev; `insert` on other adds "x\n" after the base line. */
function chainRepo(steps) {
  const repo = seedRepo('a\n');
  forkStream(repo, 'dev', 'other');
  steps.forEach(([id, after], k) => mintIn(repo, 'dev', id, String(k + 2), after));
  mintIn(repo, 'other', 'insert', '90', 'a\nx\n');
  assert.equal(carry(repo, 'dev', 'insert').ok, true);
  return repo;
}

test('M1-18 terra-mint repro (G-56): an unseen insert after a line replaced twice (r1, r2) is kind 3', () => {
  const repo = chainRepo([['r1', 'A\n'], ['r2', 'AA\n']]);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'AA\nx\n');
  assert.deepEqual(view.snags.map((snag) => [snag.kind, snag.spot, snag.lines, snag.moves.slice().sort()]), [[3, 'L:seed:0', ['L:insert:0'], ['insert', 'r2']]]);
  assert.equal(view.exportable, false);
});

test('M1-19 chain of three replacements: still kind 3 at the first line of the chain', () => {
  const repo = chainRepo([['r1', 'A\n'], ['r2', 'AA\n'], ['r3', 'AAA\n']]);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'AAA\nx\n');
  assert.deepEqual(view.snags.map((snag) => [snag.kind, snag.spot]), [[3, 'L:seed:0']]);
});

test('M1-20 chain whose visible link saw the insert: no kind 3 (the visible owner decides, D-M1-13)', () => {
  const repo = seedRepo('a\n');
  forkStream(repo, 'dev', 'other');
  mintIn(repo, 'dev', 'r1', '2', 'A\n');
  mintIn(repo, 'other', 'insert', '3', 'a\nx\n');
  assert.equal(carry(repo, 'dev', 'insert').ok, true);
  assert.deepEqual(inspect(repo, 'dev').snags.map((snag) => snag.kind), [3]);
  const m = mintIn(repo, 'dev', 'r2', '4', 'AA\nx\n');
  assert.deepEqual(m.saw, ['insert', 'r1']);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'AA\nx\n');
  assert.deepEqual(view.snags, []);
});

test('M1-21 chain whose last link is switched off with no replacement: kind 5, not kind 3', () => {
  const repo = seedRepo('a\nb\n');
  forkStream(repo, 'dev', 'other');
  mintIn(repo, 'dev', 'r1', '2', 'A\nb\n');
  mintIn(repo, 'dev', 'r2', '3', 'AA\nb\n');
  mintIn(repo, 'dev', 'r3', '4', 'b\n');
  mintIn(repo, 'other', 'insert', '90', 'a\nx\nb\n');
  assert.equal(carry(repo, 'dev', 'insert').ok, true);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'x\nb\n');
  assert.deepEqual(view.snags.map((snag) => [snag.kind, snag.spot, snag.lines]), [[5, 'L:seed:0', ['L:insert:0']]]);
});

test('M1-22 chain with the first link pulled: only the dangling link (kind 4); no kind 3 on the visible base line (D-M1-15)', () => {
  const repo = chainRepo([['r1', 'A\n'], ['r2', 'AA\n']]);
  assert.equal(pull(repo, 'dev', 'r1').ok, true);
  const view = inspect(repo, 'dev');
  // D-M1-15: the walk does not climb past r1's line (maker off), so the visible seed
  // line is not "replaced" and there is no kind 3; only the dangling link (kind 4).
  assert.equal(fileOf(view).bytes, 'a\nAA\nx\n');
  assert.deepEqual(view.snags.map((snag) => [snag.kind, snag.spot]), [[4, 'L:r1:0']]);
  assert.equal(view.exportable, false);
});

// ---------------------------------------------------------------- two-author fuzz (D-M1-13)

/** Snags the spec rules (2 rules 3-6, 4.2 kinds 1, 2, 3, 5, with D-K5-01 and D-M1-12/13) predict, computed from records only. */
function predictedSnags(repo, stream) {
  const on = movesOn(repo, stream);
  const onSet = new Set(on);
  const lines = new Map();
  const offBy = new Map();
  for (const id of on) {
    const sc = repo.scripts[id];
    for (const line of sc.lines) lines.set(line.id, { ...line, addedBy: id });
    for (const off of sc.off) {
      if (!offBy.has(off)) offBy.set(off, []);
      offBy.get(off).push(id);
    }
  }
  const sawOf = (m) => repo.scripts[m].saw || [];
  const seen = (a, b) => a === b || sawOf(a).includes(b) || sawOf(b).includes(a);
  const isVisible = (id) => lines.has(id) && !(offBy.get(id) || []).length;
  const visible = [...lines.values()].filter((line) => isVisible(line.id));
  const owners = (target) => visible.filter((v) => {
    let ref = v.replaces;
    const walked = new Set();
    while (ref && !walked.has(ref)) {
      if (ref === target) return true;
      if (isVisible(ref)) return false;
      walked.add(ref);
      ref = lines.get(ref)?.replaces;
    }
    return false;
  });
  const out = new Set();
  const group = (keyOf, kind) => {
    const groups = new Map();
    for (const line of visible) {
      const key = keyOf(line);
      if (key == null) continue;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(line.addedBy);
    }
    for (const [key, moves] of groups) if (moves.size > 1) out.add(`${kind}|${key}`);
  };
  group((line) => line.replaces || null, 1);
  group((line) => (line.replaces ? null : `${line.after}|${line.before}`), 2);
  for (const x of visible) {
    if (!x.replaces && x.after !== START) {
      const own = owners(x.after);
      if (own.length && lines.get(x.after).addedBy !== x.addedBy && own.some((o) => !seen(o.addedBy, x.addedBy))) out.add(`3|${x.after}`);
    }
    for (const anchor of [x.after, x.before]) {
      if (anchor === START || anchor === END) continue;
      const target = lines.get(anchor);
      if (target.addedBy === x.addedBy || isVisible(anchor) || owners(anchor).length) continue;
      const offs = new Set();
      const todo = [anchor];
      const walked = new Set();
      while (todo.length) {
        const id = todo.shift();
        if (walked.has(id)) continue;
        walked.add(id);
        for (const m of offBy.get(id) || []) if (onSet.has(m)) offs.add(m);
        for (const l of lines.values()) if (l.replaces === id) todo.push(l.id);
      }
      if ([...offs].every((m) => sawOf(m).includes(x.addedBy))) continue;
      out.add(`5|${anchor}`);
    }
  }
  return [...out].sort();
}

function snagKeys(view) {
  return [...new Set(view.snags.map((snag) => `${snag.kind}|${snag.spot}`))].sort();
}

test('M1-23 two-author fuzz (400 seeded rows): snags equal the rule prediction; every snag spans both authors; an unseen insert next to a line the other side replaced or deleted always snags; views equal in both arrival orders', () => {
  const next = rng(0x7477_6f61);
  const stats = { rows: 0, snagRows: 0, kinds: {} };
  for (let row = 0; row < 400; row++) {
    const repo = seedRepo(randomText(next, 6));
    forkStream(repo, 'dev', 'A');
    forkStream(repo, 'dev', 'B');
    const made = { A: [], B: [] };
    for (const side of ['A', 'B']) {
      const steps = 1 + Math.floor(next() * 2);
      for (let step = 0; step < steps; step++) {
        const id = `${side}${step}`;
        const view = inspect(repo, side);
        const m = mintScript(FILE, beforeFromView(repo, view, FILE), randomText(next, 7), id);
        if (!m.lines.length && !m.off.length) continue;
        const res = checkin(repo, side, withIntent({ id, orderKey: String(10 * (side === 'A' ? 1 : 2) + step), saw: m.saw, lines: m.lines, off: m.off }, { targets: [{ node: FILE }] }));
        assert.equal(res.ok, true, `row ${row} ${id}: ${res.message}`);
        made[side].push(id);
      }
    }
    for (const id of made.B) assert.equal(carry(repo, 'A', id).ok, true, `row ${row} carry ${id} into A`);
    for (const id of made.A) assert.equal(carry(repo, 'B', id).ok, true, `row ${row} carry ${id} into B`);
    const va = inspect(repo, 'A');
    const vb = inspect(repo, 'B');
    assert.deepEqual(fileOf(vb).lineIds, fileOf(va).lineIds, `row ${row} order`);
    assert.equal(fileOf(vb).bytes, fileOf(va).bytes, `row ${row} bytes`);
    assert.deepEqual(snagKeys(vb), snagKeys(va), `row ${row} snags by arrival order`);
    const got = snagKeys(va);
    assert.deepEqual(got, predictedSnags(repo, 'A'), `row ${row} prediction`);
    for (const snag of va.snags) {
      assert.equal([1, 2, 3, 5].includes(snag.kind), true, `row ${row} kind ${snag.kind}`);
      const sides = new Set(snag.moves.map((m) => (m.startsWith('A') ? 'A' : m.startsWith('B') ? 'B' : 'seed')));
      assert.equal(sides.has('A') && sides.has('B'), true, `row ${row} snag ${snag.kind} ${snag.spot} not cross-author: ${snag.moves}`);
    }
    // Semantic floor: a B insert whose `after` is a seed line that A switched off must snag (3 or 5) at that line, and vice versa.
    const offIn = (ids) => new Set(ids.flatMap((id) => repo.scripts[id].off));
    for (const [mine, theirs] of [[made.B, made.A], [made.A, made.B]]) {
      const theirOff = offIn(theirs);
      const myOff = offIn(mine);
      for (const id of mine) {
        for (const line of repo.scripts[id].lines) {
          if (line.replaces || !line.after.startsWith('L:seed:') || !fileOf(va).lineIds.includes(line.id)) continue;
          if (theirOff.has(line.after) && !myOff.has(line.after)) {
            assert.equal(got.includes(`3|${line.after}`) || got.includes(`5|${line.after}`), true, `row ${row}: ${line.id} after ${line.after} switched off by the other side, no snag`);
          }
        }
      }
    }
    stats.rows += 1;
    if (got.length) stats.snagRows += 1;
    for (const key of got) stats.kinds[key[0]] = (stats.kinds[key[0]] || 0) + 1;
  }
  assert.equal(stats.rows, 400);
  assert.ok(stats.snagRows > 50, `fuzz too tame: ${JSON.stringify(stats)}`);
  for (const kind of ['1', '2', '3', '5']) assert.ok(stats.kinds[kind] > 0, `kind ${kind} never exercised: ${JSON.stringify(stats)}`);
  if (process.env.KAWA_FUZZ_STATS) console.log(JSON.stringify(stats));
});

// ---------------------------------------------------------------- DeepSeek review of PR #16 (pins and fixes)

function handIn(repo, stream, script) {
  const res = checkin(repo, stream, withIntent(script, { targets: [{ node: FILE }] }));
  assert.equal(res.ok, true, res.message);
}

test('M1-24 mint takes strings only (D-M1-14): Buffer, Uint8Array, number throw; a "\\r" after the last "\\n" is its own line', () => {
  const enc = new TextEncoder();
  assert.throws(() => mintScript('n', [], enc.encode('a\r\nb\n'), 'm'), TypeError);
  assert.throws(() => mintScript('n', [], Buffer.from([0x61, 0xff, 0x0a]), 'm'), TypeError);
  assert.throws(() => mintScript('n', [], 42, 'm'), TypeError);
  assert.throws(() => mintScript('n', [], undefined, 'm'), TypeError);
  assert.throws(() => splitLines(null), TypeError);
  assert.deepEqual(splitLines('a\n\r'), ['a\n', '\r']);
  // CRLF and LF lines differ; mint never normalizes.
  const before = [{ id: 'S', bytes: 'a\r\n' }];
  assert.deepEqual(mintScript('n', before, 'a\n', 'm').off, ['S']);
});

test('M1-25 adjacent replacements by two authors (X -> X2, Y -> Y2) are not a snag (spec 4.2 "not snags": separate slots)', () => {
  const repo = seedRepo('X\nY\n');
  forkStream(repo, 'dev', 'B');
  const a = mintIn(repo, 'dev', 'A', '2', 'X\nY2\n');
  assert.equal(a.lines[0].after, 'L:seed:0');
  mintIn(repo, 'B', 'B', '3', 'X2\nY\n');
  assert.equal(carry(repo, 'dev', 'B').ok, true);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'X2\nY2\n');
  assert.deepEqual(view.snags, []);
});

test('M1-26 same-move neighbour (spec 4.2 kind 3 bullet 3): replacing X does not snag X\'s original next line', () => {
  const repo = seedRepo('X\nI\n');
  handIn(repo, 'dev', { id: 'B', orderKey: '2', off: ['L:seed:0'], lines: [{ id: 'R', node: FILE, bytes: 'R\n', after: START, before: 'L:seed:1', replaces: 'L:seed:0' }] });
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'R\nI\n');
  assert.deepEqual(view.snags, []);
});

test('M1-27 an intermediate replacer in the insert\'s saw does not mask the final one (D-M1-13)', () => {
  const repo = seedRepo('X\n');
  forkStream(repo, 'dev', 'A');
  mintIn(repo, 'dev', 'B1', '2', 'R1\n');
  handIn(repo, 'A', { id: 'A', orderKey: '3', saw: ['B1'], lines: [{ id: 'I', node: FILE, bytes: 'i\n', after: 'L:seed:0', before: END }] });
  mintIn(repo, 'dev', 'B2', '4', 'R2\n');
  assert.equal(carry(repo, 'dev', 'A').ok, true);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'R2\ni\n');
  assert.deepEqual(view.snags.map((snag) => [snag.kind, snag.spot, snag.moves.slice().sort()]), [[3, 'L:seed:0', ['A', 'B2']]]);
});

test('M1-28 residual G-61 (pending Rich, also on main): delete vs modify of one line by two authors is not a snag; the modify wins', () => {
  const repo = seedRepo('X\nY\n');
  forkStream(repo, 'dev', 'B');
  mintIn(repo, 'dev', 'A', '2', 'X2\nY\n');
  mintIn(repo, 'B', 'B', '3', 'Y\n');
  assert.equal(carry(repo, 'dev', 'B').ok, true);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'X2\nY\n');
  assert.deepEqual(view.snags, []);
});

test('M1-29 residual G-62 (pending Rich): saw is per move; a line hidden from the deleting author and re-exposed by a pull is not kind 5', () => {
  const repo = seedRepo('X\nY\n');
  forkStream(repo, 'dev', 'B');
  handIn(repo, 'dev', { id: 'A', orderKey: '2', saw: ['seed'], lines: [
    { id: 'I1', node: FILE, bytes: 'i1\n', after: START, before: 'L:seed:0' },
    { id: 'I2', node: FILE, bytes: 'i2\n', after: 'L:seed:0', before: 'L:seed:1' },
  ] });
  mintIn(repo, 'dev', 'C', '3', 'i1\nX\nY\n');
  assert.equal(carry(repo, 'B', 'A').ok, true);
  assert.equal(carry(repo, 'B', 'C').ok, true);
  const m = mintIn(repo, 'B', 'Bdel', '4', 'i1\nY\n');
  assert.deepEqual(m.saw, ['A', 'seed']);
  assert.equal(carry(repo, 'dev', 'Bdel').ok, true);
  assert.equal(pull(repo, 'dev', 'C').ok, true);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'i1\ni2\nY\n');
  assert.deepEqual(view.snags, []);
});

test('M1-30 kind 5 counts the move that emptied the slot (D-M1-16): B1 saw the insert and replaced X; B2 did not and deleted R', () => {
  const repo = seedRepo('P\nX\n');
  forkStream(repo, 'dev', 'B');
  mintIn(repo, 'dev', 'A', '2', 'P\ni\nX\n');
  assert.equal(carry(repo, 'B', 'A').ok, true);
  const b1 = mintIn(repo, 'B', 'B1', '3', 'P\ni\nR\n');
  assert.deepEqual(b1.saw, ['A', 'seed']);
  forkStream(repo, 'B', 'B2s');
  assert.equal(pull(repo, 'B2s', 'A').ok, true);
  const b2 = mintIn(repo, 'B2s', 'B2', '4', 'P\n');
  assert.deepEqual(b2.saw, ['B1', 'seed']);
  assert.equal(carry(repo, 'dev', 'B1').ok, true);
  assert.equal(carry(repo, 'dev', 'B2').ok, true);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'P\ni\n');
  assert.deepEqual(view.snags.map((snag) => [snag.kind, snag.spot, snag.lines, snag.moves.slice().sort()]), [[5, 'L:seed:1', ['L:A:0'], ['A', 'B1', 'B2']]]);
  // Control: when B2 also saw A, the chain delete was made with the insert in view.
  const ok = seedRepo('P\nX\n');
  mintIn(ok, 'dev', 'A', '2', 'P\ni\nX\n');
  mintIn(ok, 'dev', 'B1', '3', 'P\ni\nR\n');
  mintIn(ok, 'dev', 'B2', '4', 'P\ni\n');
  assert.deepEqual(inspect(ok, 'dev').snags, []);
});

const MINT_V1_VECTOR_HASH = 'sha256:cb1d7a82d0a9cfd559f382a479c64855743b0d0175e89be7ecd6a3df9ac4771c';

// ---------------------------------------------------------------- Opus review of PR #16 (Q2d test gaps)

function snagRows(view) {
  return view.snags.map((snag) => [snag.kind, snag.spot, snag.lines, snag.moves.slice().sort()]);
}

test('M1-31 kind 1 through a chain: B and C both replace R1, so both hold X\'s slot (Q2d gap 1)', () => {
  // A replaces X → R1. B replaces R1 → R2. C, forked before B, replaces R1 → R3.
  // R1 is off. R2 and R3 are the two visible owners of X's slot. That is kind 1.
  const repo = seedRepo('P\nX\n');
  mintIn(repo, 'dev', 'A', '2', 'P\nR1\n');
  forkStream(repo, 'dev', 'C');
  const b = mintIn(repo, 'dev', 'B', '3', 'P\nR2\n');
  const c = mintIn(repo, 'C', 'C', '4', 'P\nR3\n');
  assert.equal(b.lines[0].replaces, 'L:A:0');
  assert.equal(c.lines[0].replaces, 'L:A:0');
  assert.equal(b.saw.includes('C'), false);
  assert.equal(c.saw.includes('B'), false);
  assert.equal(carry(repo, 'dev', 'C').ok, true);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'P\nR2\nR3\n');
  assert.deepEqual(fileOf(view).lineIds, ['L:seed:0', 'L:B:0', 'L:C:0']);
  assert.equal(fileOf(view).lineIds.includes('L:A:0'), false);
  assert.equal(fileOf(view).lineIds.includes('L:seed:1'), false);
  assert.deepEqual(snagRows(view), [[1, 'L:A:0', ['L:B:0', 'L:C:0'], ['B', 'C']]]);
});

test('M1-32 a pulled middle link ends the chain: C uses B\'s anchors, not A\'s (D-M1-15, Q2d gap 2)', () => {
  // Seed L X R. A replaces X in place (between L and R).
  // B replaces A's line but stores anchors after R. C replaces B's line and stores anchors before L.
  // While B is on, the walk reaches X, so C sits between L and R.
  // After B is pulled, the walk stops at B and C sits after R. A's line is visible again. Kind 4 on B's line.
  const repo = seedRepo('L\nX\nR\n');
  mintIn(repo, 'dev', 'A', '2', 'L\nA\nR\n');
  handIn(repo, 'dev', {
    id: 'B', orderKey: '3', saw: ['A', 'seed'], off: ['L:A:0'],
    lines: [{ id: 'Lb', node: FILE, bytes: 'B\n', after: 'L:seed:2', before: END, replaces: 'L:A:0' }],
  });
  handIn(repo, 'dev', {
    id: 'C', orderKey: '4', saw: ['A', 'B', 'seed'], off: ['Lb'],
    lines: [{ id: 'Lc', node: FILE, bytes: 'C\n', after: START, before: 'L:seed:0', replaces: 'Lb' }],
  });
  const live = inspect(repo, 'dev');
  assert.equal(fileOf(live).bytes, 'L\nC\nR\n');
  assert.deepEqual(fileOf(live).lineIds, ['L:seed:0', 'Lc', 'L:seed:2']);
  assert.deepEqual(live.snags, []);
  assert.equal(pull(repo, 'dev', 'B').ok, true);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'L\nA\nR\nC\n');
  assert.deepEqual(fileOf(view).lineIds, ['L:seed:0', 'L:A:0', 'L:seed:2', 'Lc']);
  assert.deepEqual(snagRows(view), [[4, 'Lb', ['Lc'], ['B', 'C']]]);
});

test('M1-33 a pulled mid-chain maker puts the tombstone at that link\'s anchors, not the original line (Q2d gap 3)', () => {
  // P Q X S. A replaces X (between Q and S). B replaces A's line but stores anchors between P and Q.
  // C replaces B. Del switches C off with no successor: C is the tombstone.
  // While B is on, the tombstone holds X's slot and the view is P Q S.
  // After B is pulled, the tomb walk stops at B. A's line returns in X's slot.
  // An insert anchored on the tombstone, before Q, lands between P and Q — B's gap, not X's.
  const repo = seedRepo('P\nQ\nX\nS\n');
  mintIn(repo, 'dev', 'A', '2', 'P\nQ\nA\nS\n');
  handIn(repo, 'dev', {
    id: 'B', orderKey: '3', saw: ['A', 'seed'], off: ['L:A:0'],
    lines: [{ id: 'Rb', node: FILE, bytes: 'B\n', after: 'L:seed:0', before: 'L:seed:1', replaces: 'L:A:0' }],
  });
  handIn(repo, 'dev', {
    id: 'C', orderKey: '4', saw: ['A', 'B', 'seed'], off: ['Rb'],
    lines: [{ id: 'Rc', node: FILE, bytes: 'C\n', after: START, before: END, replaces: 'Rb' }],
  });
  handIn(repo, 'dev', { id: 'Del', orderKey: '5', saw: ['A', 'B', 'C', 'seed'], off: ['Rc'] });
  const held = inspect(repo, 'dev');
  assert.equal(fileOf(held).bytes, 'P\nQ\nS\n');
  assert.deepEqual(fileOf(held).lineIds, ['L:seed:0', 'L:seed:1', 'L:seed:3']);
  assert.deepEqual(held.snags, []);
  assert.equal(pull(repo, 'dev', 'B').ok, true);
  handIn(repo, 'dev', {
    id: 'M', orderKey: '6', saw: ['A', 'C', 'Del', 'seed'],
    lines: [{ id: 'Im', node: FILE, bytes: 'M\n', after: 'Rc', before: 'L:seed:1' }],
  });
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'P\nM\nQ\nA\nS\n');
  assert.deepEqual(fileOf(view).lineIds, ['L:seed:0', 'Im', 'L:seed:1', 'L:A:0', 'L:seed:3']);
  assert.deepEqual(snagRows(view), [
    [5, 'Rc', ['Im'], ['Del', 'M']],
    [4, 'Rb', ['Rb'], ['B', 'C']],
  ]);
});

test('M1-34 kind 5 saw exemption checks every emptier of a three-link chain (D-M1-16, Q2d gap 4)', () => {
  // X → R1 (B1) → R2 (B2) → deleted (B3). A inserted before X.
  // The exemption needs B1, B2, and B3 all to list A. One miss is kind 5.
  const deep = seedRepo('P\nX\n');
  forkStream(deep, 'dev', 'B');
  mintIn(deep, 'dev', 'A', '2', 'P\ni\nX\n');
  assert.equal(carry(deep, 'B', 'A').ok, true);
  const b1 = mintIn(deep, 'B', 'B1', '3', 'P\ni\nR1\n');
  const b2 = mintIn(deep, 'B', 'B2', '4', 'P\ni\nR2\n');
  assert.deepEqual(b1.saw, ['A', 'seed']);
  assert.deepEqual(b2.saw, ['A', 'B1', 'seed']);
  forkStream(deep, 'B', 'B3s');
  assert.equal(pull(deep, 'B3s', 'A').ok, true);
  const b3 = mintIn(deep, 'B3s', 'B3', '5', 'P\n');
  assert.equal(b3.saw.includes('A'), false);
  assert.equal(carry(deep, 'dev', 'B1').ok, true);
  assert.equal(carry(deep, 'dev', 'B2').ok, true);
  assert.equal(carry(deep, 'dev', 'B3').ok, true);
  const deepView = inspect(deep, 'dev');
  assert.equal(fileOf(deepView).bytes, 'P\ni\n');
  assert.deepEqual(snagRows(deepView), [[5, 'L:seed:1', ['L:A:0'], ['A', 'B1', 'B2', 'B3']]]);

  // The middle emptier missed A; the last one saw A. Still kind 5.
  const mid = seedRepo('P\nX\n');
  forkStream(mid, 'dev', 'Bs');
  mintIn(mid, 'dev', 'A', '2', 'P\ni\nX\n');
  assert.equal(carry(mid, 'Bs', 'A').ok, true);
  mintIn(mid, 'Bs', 'B1', '3', 'P\ni\nR1\n');
  forkStream(mid, 'Bs', 'B2s');
  assert.equal(pull(mid, 'B2s', 'A').ok, true);
  const mb2 = mintIn(mid, 'B2s', 'B2', '4', 'P\nR2\n');
  assert.equal(mb2.saw.includes('A'), false);
  assert.equal(carry(mid, 'dev', 'B1').ok, true);
  assert.equal(carry(mid, 'dev', 'B2').ok, true);
  const mb3 = mintIn(mid, 'dev', 'B3', '5', 'P\ni\n');
  assert.equal(mb3.saw.includes('A'), true);
  const midView = inspect(mid, 'dev');
  assert.equal(fileOf(midView).bytes, 'P\ni\n');
  assert.deepEqual(snagRows(midView), [[5, 'L:seed:1', ['L:A:0'], ['A', 'B1', 'B2', 'B3']]]);

  // Control: every emptier saw A.
  const ok = seedRepo('P\nX\n');
  mintIn(ok, 'dev', 'A', '2', 'P\ni\nX\n');
  mintIn(ok, 'dev', 'B1', '3', 'P\ni\nR1\n');
  mintIn(ok, 'dev', 'B2', '4', 'P\ni\nR2\n');
  mintIn(ok, 'dev', 'B3', '5', 'P\ni\n');
  assert.equal(text(ok), 'P\ni\n');
  assert.deepEqual(inspect(ok, 'dev').snags, []);
});

test('M1-35 beforeFromView of a truly empty file returns []; a whole-content file still throws (Q2d gap 5)', () => {
  const repo = seedRepo('a\n');
  mintIn(repo, 'dev', 'wipe', '2', '');
  const view = inspect(repo, 'dev');
  const file = fileOf(view);
  assert.equal(file.bytes, '');
  assert.deepEqual(file.lineIds, []);
  assert.deepEqual(beforeFromView(repo, view, FILE), []);

  const bin = createRepo();
  assert.equal(checkin(bin, 'dev', withIntent({
    id: 'seed',
    orderKey: '1',
    nodes: [{ id: 'root', kind: 'pool', root: true }, { id: 'bin', kind: 'file' }],
    entries: [{ id: 'Eb', pool: 'root', node: 'bin', name: 'blob.bin' }],
    attributes: [{ id: 'seed:content', node: 'bin', key: 'content', value: 'abc' }],
  })).ok, true);
  const whole = inspect(bin, 'dev').files[0];
  assert.equal(whole.bytes, 'abc');
  assert.deepEqual(whole.lineIds, []);
  assert.throws(() => beforeFromView(bin, inspect(bin, 'dev'), 'bin'), /whole-content file/);
});

// Exposes bug at f9f581f. Run unskipped, the assertion below failed verbatim:
// AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
// + actual - expected
//
// + []
// - [
// -   [
// -     1,
// -     'L:seed:0',
// -     [
// -       'L:A:0'
// -     ],
// -     [
// -       'A',
// -       'B'
// -     ]
// -   ]
// - ]
// The lines above it passed: bytes were 'X2\nY\n' (the modify stays visible) and B's saw does not include A.
test('M1-36 G-61: an unseen delete and modify of one line is kind 1; the replacement stays visible (Q2d gap 6)', { skip: 'Exposes bug at f9f581f: snagRows(view) was [] instead of [[1, L:seed:0, [L:A:0], [A, B]]]' }, () => {
  const repo = seedRepo('X\nY\n');
  forkStream(repo, 'dev', 'B');
  mintIn(repo, 'dev', 'A', '2', 'X2\nY\n');
  const deleted = mintIn(repo, 'B', 'B', '3', 'Y\n');
  assert.deepEqual(deleted.off, ['L:seed:0']);
  assert.deepEqual(deleted.lines, []);
  assert.equal(deleted.saw.includes('A'), false);
  assert.equal(carry(repo, 'dev', 'B').ok, true);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'X2\nY\n');
  assert.deepEqual(snagRows(view), [[1, 'L:seed:0', ['L:A:0'], ['A', 'B']]]);
});

test('M1-36 control: a delete that saw the modify removes the replacement and is not a snag (Q2d gap 6)', () => {
  const ok = seedRepo('X\nY\n');
  mintIn(ok, 'dev', 'A', '2', 'X2\nY\n');
  const b = mintIn(ok, 'dev', 'B', '3', 'Y\n');
  assert.deepEqual(b.saw, ['A', 'seed']);
  assert.deepEqual(b.off, ['L:A:0']);
  assert.equal(text(ok), 'Y\n');
  assert.deepEqual(inspect(ok, 'dev').snags, []);
});

test('M1-37 two inserts after one chain-replaced anchor: the seen one is exempt, the unseen one is kind 3 (Q2d gap 7)', () => {
  // B1 replaces X → R1, B2 replaces R1 → R2. S was in the view when B2 minted, so B2 saw S.
  // U also anchors after X, and neither saw the other. Kind 3 lists U only.
  const repo = seedRepo('X\nY\nZ\n');
  forkStream(repo, 'dev', 'seen');
  forkStream(repo, 'dev', 'unseen');
  mintIn(repo, 'dev', 'B1', '2', 'R1\nY\nZ\n');
  const s = mintIn(repo, 'seen', 'S', '3', 'X\nS\nY\nZ\n');
  assert.equal(s.lines[0].after, 'L:seed:0');
  assert.equal(carry(repo, 'dev', 'S').ok, true);
  const b2 = mintIn(repo, 'dev', 'B2', '4', 'R2\nS\nY\nZ\n');
  assert.equal(b2.lines[0].replaces, 'L:B1:0');
  assert.equal(b2.saw.includes('S'), true);
  assert.deepEqual(inspect(repo, 'dev').snags, []);
  handIn(repo, 'unseen', {
    id: 'U', orderKey: '5', saw: ['seed'],
    lines: [{ id: 'Iu', node: FILE, bytes: 'U\n', after: 'L:seed:0', before: 'L:seed:2' }],
  });
  assert.equal(carry(repo, 'dev', 'U').ok, true);
  const view = inspect(repo, 'dev');
  assert.equal(fileOf(view).bytes, 'R2\nS\nY\nU\nZ\n');
  assert.equal(fileOf(view).lineIds.includes('L:S:0'), true);
  assert.deepEqual(snagRows(view), [[3, 'L:seed:0', ['Iu'], ['B2', 'U']]]);
});
