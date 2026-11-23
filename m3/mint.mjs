/**
 * mint-v1: the canonical way to mint line records from a before-view and an
 * after-view of one file node (gap G-49; weave note §7).
 *
 * The weave (weave.mjs) consumes line records. This file authors them. Output
 * obeys the weave invariants: records are only appended (I5), view order comes
 * from anchors and `replaces`, never from storage order (I6), and a changed line
 * is a switch-off plus a new line that `replaces` it, never an edit in place (I7).
 *
 * Pure functions. No repo access except `beforeFromView`, which only reads.
 *
 * Algorithm (D-M1-02), fixed for `derive_algo: "mint-v1"`:
 *   1. Split both sides into lines (D-M1-01).
 *   2. Keep the longest common prefix, then the longest common suffix of what is left.
 *   3. Align the middle with a longest-common-subsequence table over exact line
 *      bytes. Walk forward: equal lines are kept; otherwise switch off the before
 *      line when that keeps at least as long a common subsequence as adding the
 *      after line (deletions first); otherwise add the after line.
 *   4. Group each maximal run of offs and adds between two kept lines into a hunk.
 *      Pair the k-th add with the k-th off as a replacement (D-M1-03).
 */

import { START, END } from './weave.mjs';

export const MINT_ALGO = 'mint-v1';

/** Largest LCS table (rows x columns after trimming) mint-v1 will build (D-M1-07). */
export const MINT_MAX_CELLS = 16777216;

/**
 * Split raw bytes into lines. A line ends after each "\n" and keeps it, so
 * "\r\n" stays with its line. A lone "\r" is not a line end. A last line with
 * no "\n" is still a line. Empty input gives no lines. (D-M1-01)
 */
export function splitLines(bytes) {
  const s = String(bytes ?? '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const j = s.indexOf('\n', i);
    if (j < 0) {
      out.push(s.slice(i));
      break;
    }
    out.push(s.slice(i, j + 1));
    i = j + 1;
  }
  return out;
}

/**
 * Align two line arrays. Returns ops in walk order:
 * `{op: 'keep', i, j}`, `{op: 'off', i}`, `{op: 'add', j}` (absolute indices).
 * Throws `mint_too_large` when the trimmed table exceeds MINT_MAX_CELLS.
 */
export function alignLines(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const n = a.length - pre - suf;
  const m = b.length - pre - suf;
  if ((n + 1) * (m + 1) > MINT_MAX_CELLS) {
    const err = new Error(`mint_too_large: ${n} x ${m} lines after trimming exceeds ${MINT_MAX_CELLS} cells`);
    err.code = 'mint_too_large';
    throw err;
  }
  const A = a.slice(pre, pre + n);
  const B = b.slice(pre, pre + m);
  const w = m + 1;
  const L = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
  }
  const ops = [];
  for (let k = 0; k < pre; k++) ops.push({ op: 'keep', i: k, j: k });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      ops.push({ op: 'keep', i: pre + i, j: pre + j });
      i++;
      j++;
    } else if (i < n && (j >= m || L[(i + 1) * w + j] >= L[i * w + j + 1])) {
      ops.push({ op: 'off', i: pre + i });
      i++;
    } else {
      ops.push({ op: 'add', j: pre + j });
      j++;
    }
  }
  for (let k = 0; k < suf; k++) ops.push({ op: 'keep', i: a.length - suf + k, j: b.length - suf + k });
  return ops;
}

/** Line id for the n-th line a move mints (spec §2 form `L:<move>:<n>`; D-M1-04). */
export function mintLineId(moveId, n) {
  return `L:${moveId}:${n}`;
}

/**
 * Mint line records for one file node.
 *
 * @param {string} node file node id
 * @param {{id: string, bytes: string}[]} before visible lines of the node in view order
 *   (stored bytes, not redaction markers); see `beforeFromView`
 * @param {string} afterBytes the whole new content of the file
 * @param {string} moveId the move that will carry these records
 * @param {{firstIndex?: number}} [opts] first `n` for `L:<move>:<n>` (default 0), so one
 *   move can mint several nodes without id clashes
 * @returns {{derive_algo: string, node: string, lines: object[], off: string[], saw: string[], nextIndex: number}}
 *   `lines` in after-view order with `{id, node, bytes, after, before}` and, for a
 *   replacement, `replaces`; `off` in before-view order. Every `replaces` is also in `off`.
 *   `saw` lists the makers (`addedBy`) of the before lines, unique, UTF-16 code unit
 *   order (D-M1-06); empty when the before lines carry no `addedBy`.
 */
export function mintScript(node, before, afterBytes, moveId, opts = {}) {
  if (node == null || node === '') throw new Error('mintScript needs a node');
  if (moveId == null || moveId === '') throw new Error('mintScript needs a move id');
  if (!Array.isArray(before)) throw new Error('mintScript needs the before lines as [{id, bytes}]');
  const seen = new Set();
  for (const line of before) {
    if (!line || line.id == null || typeof line.bytes !== 'string') throw new Error('before lines need {id, bytes}');
    if (seen.has(line.id)) throw new Error(`before line ${line.id} listed twice`);
    seen.add(line.id);
  }
  const firstIndex = opts.firstIndex ?? 0;
  if (!Number.isSafeInteger(firstIndex) || firstIndex < 0) throw new Error('firstIndex must be a non-negative integer');

  const a = before.map((line) => line.bytes);
  const b = splitLines(afterBytes);
  const ops = alignLines(a, b);

  const lines = [];
  const off = [];
  let next = firstIndex;
  let prevKept = START;
  let k = 0;
  while (k < ops.length) {
    if (ops[k].op === 'keep') {
      prevKept = before[ops[k].i].id;
      k++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (k < ops.length && ops[k].op !== 'keep') {
      if (ops[k].op === 'off') dels.push(ops[k].i);
      else adds.push(ops[k].j);
      k++;
    }
    const nextKept = k < ops.length ? before[ops[k].i].id : END;
    for (const i of dels) off.push(before[i].id);
    let prev = prevKept;
    adds.forEach((j, x) => {
      const line = { id: mintLineId(moveId, next++), node, bytes: b[j], after: prev, before: nextKept };
      if (x < dels.length) line.replaces = before[dels[x]].id;
      lines.push(line);
      prev = line.id;
    });
  }
  const saw = [...new Set(before.map((line) => line.addedBy).filter((id) => id != null).map(String))].sort();
  return { derive_algo: MINT_ALGO, node, lines, off, saw, nextIndex: next };
}

/**
 * Before lines for `mintScript` from a computed view (`inspect`, `assemble` or
 * `computeView` result) and the repo's scripts: `[{id, bytes, addedBy}]` in view
 * order. Uses stored bytes, so a redaction marker is never minted as content
 * (D-M1-05). Read-only.
 */
export function beforeFromView(repo, view, node) {
  const file = (view.files || []).find((item) => item.node === node);
  if (!file) throw new Error(`node ${node} is not a visible file in this view`);
  if (!file.lineIds.length && file.bytes !== '') {
    throw new Error(`node ${node} is a whole-content file; mint-v1 mints line records only`);
  }
  const byId = new Map();
  for (const script of Object.values(repo.scripts)) {
    for (const line of script.lines || []) byId.set(line.id, { bytes: line.bytes, addedBy: script.id });
  }
  return file.lineIds.map((id) => {
    const line = byId.get(id);
    if (!line) throw new Error(`line ${id} has no stored record`);
    return { id, bytes: line.bytes, addedBy: line.addedBy };
  });
}
