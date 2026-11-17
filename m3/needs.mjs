/**
 * S3: derived needs, needs reports, and needs waivers (spec v6 4.9, 12).
 *
 * Pure functions over the script store. Nothing here appends a flow-log event.
 *
 * derive_algo "needs-v1": one edge {move_id, via_node_id, reason_code} per distinct
 * (maker move, node, reason) of the three items in spec 4.9:
 *   anchor        a new line's `after` or `before` line, made by another move
 *   replaces      a new line's `replaces` line, made by another move
 *   switch_off    an `off` line or an `attrOff` attribute, made by another move
 *   parent_pool   a new entry's parent pool node, minted by another move
 *   entry_visible an `entryOff` entry made by another move, or a new entry for a
 *                 node minted by another move (D-S3-03)
 *   resolution_input  each id in `resolves.inputs` (via_node_id is null, D-S3-04)
 * The move set of these edges equals weave.directNeedIds (checked in needs.test.mjs).
 */

import { ID_RE, NEEDS_ALGO, NEED_REASONS, WAIVER_KEYS } from './codes.mjs';
import { indexScripts } from './model.mjs';
import { statementError } from './intent.mjs';

const START = 'START';
const END = 'END';
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** UTF-16 code unit order, locale-free (same rule as canonJson key order). */
export function cmpCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Edge order: move_id, then reason_code in spec 12 order, then via_node_id (null first). */
export function cmpEdge(a, b) {
  return (
    cmpCodeUnit(a.move_id, b.move_id) ||
    NEED_REASONS.indexOf(a.reason_code) - NEED_REASONS.indexOf(b.reason_code) ||
    cmpCodeUnit(a.via_node_id ?? '', b.via_node_id ?? '')
  );
}

/** Derived edges of one script against an index of the script store. Sorted, unique. */
export function deriveEdges(idx, script) {
  const edges = new Map();
  const add = (moveId, via, code) => {
    if (!moveId || moveId === script.id) return;
    const edge = { move_id: moveId, via_node_id: via ?? null, reason_code: code };
    const key = `${edge.move_id}\u0000${edge.via_node_id ?? ''}\u0000${code}`;
    if (!edges.has(key)) edges.set(key, edge);
  };
  const lineEdge = (lineId, code) => {
    if (!lineId || lineId === START || lineId === END) return;
    const line = idx.lines[lineId];
    if (line) add(line.addedBy, line.node, code);
  };
  for (const line of script.lines || []) {
    lineEdge(line.after, 'anchor');
    lineEdge(line.before, 'anchor');
    lineEdge(line.replaces, 'replaces');
  }
  for (const lineId of script.off || []) lineEdge(lineId, 'switch_off');
  for (const entry of script.entries || []) {
    const pool = idx.nodes[entry.pool];
    if (pool) add(pool.addedBy, entry.pool, 'parent_pool');
    const node = idx.nodes[entry.node];
    if (node) add(node.addedBy, entry.node, 'entry_visible');
  }
  for (const entryId of script.entryOff || []) {
    const entry = idx.entries[entryId];
    if (entry) add(entry.addedBy, entry.node, 'entry_visible');
  }
  for (const attrId of script.attrOff || []) {
    const attr = idx.attrs[attrId];
    if (attr) add(attr.addedBy, attr.node, 'switch_off');
  }
  if (script.resolves) {
    for (const input of script.resolves.inputs || []) add(input, null, 'resolution_input');
  }
  return [...edges.values()].sort(cmpEdge);
}

/** Distinct need move ids of a script, code-unit sorted. */
export function derivedIds(idx, script) {
  return [...new Set(deriveEdges(idx, script).map((edge) => edge.move_id))].sort(cmpCodeUnit);
}

/** Authored needs: `intent.needs` strings in authored order, first occurrence kept (D-S3-05). */
export function authoredNeeds(script) {
  const intent = script?.intent;
  if (!isObject(intent) || !Array.isArray(intent.needs)) return [];
  const out = [];
  for (const id of intent.needs) if (typeof id === 'string' && !out.includes(id)) out.push(id);
  return out;
}

/**
 * Needs report for one move. Every field is always present; canonJson-safe.
 * needs_derived_only / needs_authored_only are set differences on move ids (D-S3-01).
 */
export function needsReportFor(idx, script, moveId = script?.id) {
  if (!script) {
    return {
      derive_algo: NEEDS_ALGO,
      move_id: moveId,
      script_present: false,
      needs_authored: [],
      needs_derived: [],
      needs_derived_only: [],
      needs_authored_only: [],
    };
  }
  const derived = deriveEdges(idx, script);
  const derivedLookup = new Set(derived.map((edge) => edge.move_id));
  const authored = authoredNeeds(script);
  const authoredLookup = new Set(authored);
  return {
    derive_algo: NEEDS_ALGO,
    move_id: moveId,
    script_present: true,
    needs_authored: authored,
    needs_derived: derived,
    needs_derived_only: [...derivedLookup].filter((id) => !authoredLookup.has(id)).sort(cmpCodeUnit),
    needs_authored_only: authored.filter((id) => !derivedLookup.has(id)),
  };
}

/** deriveNeeds(repo, moveId): the derived edges of a stored move (spec 4.9). */
export function deriveNeeds(repo, moveId) {
  const script = repo.scripts[moveId];
  const usable = script && script.signature !== 'bad';
  const idx = indexScripts(repo.scripts);
  return {
    derive_algo: NEEDS_ALGO,
    move_id: moveId,
    script_present: !!usable,
    needs_derived: usable ? deriveEdges(idx, script) : [],
  };
}

/** Full needs report of a stored move (assemble and carry preview shape). */
export function needsReport(repo, moveId, idx = indexScripts(repo.scripts)) {
  const script = repo.scripts[moveId];
  return needsReportFor(idx, script && script.signature !== 'bad' ? script : null, moveId);
}

function idError(value, field) {
  if (typeof value !== 'string') return { field, reason: 'wrong_type' };
  if (LONE.test(value)) return { field, reason: 'lone_surrogate' };
  if (!ID_RE.test(value)) return { field, reason: 'bad_id' };
  return null;
}

/**
 * Waiver validation (closed schema, spec 4.9). Order: payload is an object; unknown keys in
 * code-unit order; required keys move_id, need_move_id, reason; values in that order;
 * need_move_id equal to move_id is self_reference; then the recorded signer (D-S3-07).
 * Reasons come from the intent_invalid.reason list. Returns {field, reason} or null.
 */
export function waiverError(waiver, signer) {
  if (!isObject(waiver)) return { field: '/', reason: 'wrong_type' };
  for (const key of Object.keys(waiver).sort(cmpCodeUnit)) {
    if (!WAIVER_KEYS.includes(key)) return { field: `/${key}`, reason: 'unknown_field' };
  }
  for (const key of WAIVER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(waiver, key)) return { field: `/${key}`, reason: 'missing' };
  }
  const moveErr = idError(waiver.move_id, '/move_id');
  if (moveErr) return moveErr;
  const needErr = idError(waiver.need_move_id, '/need_move_id');
  if (needErr) return needErr;
  if (waiver.need_move_id === waiver.move_id) return { field: '/need_move_id', reason: 'self_reference' };
  const reasonErr = statementError(waiver.reason, '/reason');
  if (reasonErr) return reasonErr;
  if (signer === undefined || signer === null) return { field: '/signer', reason: 'missing' };
  return idError(signer, '/signer');
}
