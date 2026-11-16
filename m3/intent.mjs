
import {
  CODE,
  ID_RE,
  INTENT_KEYS,
  LIMITS,
  OPS,
  PURPOSES,
  RECORD_ARRAYS,
} from './codes.mjs';
import { indexScripts } from './model.mjs';

const WHITE_SPACE = /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const compareKeys = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const refusal = (field, reason) => ({ field, reason });

function statementError(value, field) {
  if (typeof value !== 'string') return refusal(field, 'wrong_type');
  if (LONE.test(value)) return refusal(field, 'lone_surrogate');
  if (value.length === 0) return refusal(field, 'empty');
  if (WHITE_SPACE.test(value)) return refusal(field, 'blank');
  if (CONTROL.test(value)) return refusal(field, 'control_char');
  if ([...value].length > LIMITS.statement_max) return refusal(field, 'too_long');
  return null;
}

function listOfIds(value, field, options) {
  const { min, ctx, self, node } = options;
  if (!Array.isArray(value)) return refusal(field, 'wrong_type');
  if (value.length < min) return refusal(field, 'empty');
  if (value.length > LIMITS.list_max) return refusal(field, 'too_many');

  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    let id = value[i];
    const elementField = `${field}/${i}`;
    const idField = node ? `${elementField}/node` : elementField;

    if (node) {
      if (!isObject(id)) return refusal(elementField, 'wrong_type');
      const keys = Object.keys(id).sort(compareKeys);
      for (const key of keys) {
        if (key !== 'node') return refusal(`${elementField}/${key}`, 'unknown_field');
      }
      if (!Object.prototype.hasOwnProperty.call(id, 'node')) {
        return refusal(idField, 'missing');
      }
      id = id.node;
    }

    if (typeof id !== 'string') return refusal(idField, 'wrong_type');
    if (LONE.test(id)) return refusal(idField, 'lone_surrogate');
    if (!ID_RE.test(id)) return refusal(idField, 'bad_id');
    if (node && ctx && typeof ctx.hasNode === 'function' && !ctx.hasNode(id)) {
      return refusal(idField, 'unknown_node');
    }
    if (!node && id === self) return refusal(idField, 'self_reference');
    if (seen.has(id)) return refusal(idField, 'duplicate');
    seen.add(id);
  }
  return null;
}

export function intentError(intent, selfId, ctx) {
  if (!isObject(intent)) return refusal('/intent', 'wrong_type');

  const supplied = Object.keys(intent).sort(compareKeys);
  for (const key of supplied) {
    if (!INTENT_KEYS.includes(key)) return refusal(`/intent/${key}`, 'unknown_field');
  }
  for (const key of INTENT_KEYS) {
    if (!(key in intent)) return refusal(`/intent/${key}`, 'missing');
  }

  let error = listOfIds(intent.targets, '/intent/targets', { min: 1, ctx, node: true });
  if (error) return error;

  const purpose = intent.purpose;
  if (typeof purpose !== 'string') return refusal('/intent/purpose', 'wrong_type');
  if (!PURPOSES.includes(purpose)) return refusal('/intent/purpose', 'not_in_list');

  error = listOfIds(intent.needs, '/intent/needs', { min: 0, ctx, self: selfId });
  if (error) return error;

  return statementError(intent.reason, '/intent/reason');
}

export function hasRecords(script) {
  if (!script || typeof script !== 'object') return false;
  return RECORD_ARRAYS.some((key) => Array.isArray(script[key]) && script[key].length > 0);
}

export function checkInRefusal(payload, ctx) {
  const intent = payload ? payload.intent : undefined;
  if (intent === undefined || intent === null) {
    return { code: CODE.intent_missing, field: '/intent' };
  }

  const own = new Set(((payload && payload.nodes) || []).map((node) => node.id));
  const selfId = payload && payload.id != null ? String(payload.id) : undefined;
  const error = intentError(intent, selfId, {
    hasNode: (id) => own.has(id) || (ctx && typeof ctx.hasNode === 'function' && ctx.hasNode(id)),
  });
  if (error) return { code: CODE.intent_invalid, ...error };

  if (!hasRecords(payload) && !(payload && payload.resolves)) {
    return { code: CODE.move_empty, field: '/' };
  }
  return null;
}

function asScript(script) {
  return {
    nodes: [],
    entries: [],
    entryOff: [],
    lines: [],
    off: [],
    attributes: [],
    attrOff: [],
    ...script,
  };
}

export function deriveOps(script, scripts) {
  const move = asScript(script);
  const store = { ...(scripts || {}) };
  store[move.id] = move;
  const idx = indexScripts(store);

  const found = new Set();
  const partial = [];
  const newNodeIds = new Set(move.nodes.map((node) => node.id));

  const slotOf = (lineId) => {
    const seen = new Set();
    let current = lineId;
    while (idx.lines[current] && idx.lines[current].replaces && !seen.has(current)) {
      seen.add(current);
      current = idx.lines[current].replaces;
    }
    return current;
  };

  if (move.nodes.length > 0) found.add('add');

  const switchedEntries = move.entryOff.map((id) => {
    const entry = idx.entries[id];
    if (!entry) partial.push(id);
    return { id, entry };
  });
  const paired = new Set();
  for (const entry of move.entries) {
    const match = switchedEntries.find(
      (candidate) => candidate.entry && candidate.entry.node === entry.node && !paired.has(candidate.id),
    );
    if (!match) {
      found.add('add');
      continue;
    }
    paired.add(match.id);
    if (match.entry.pool === entry.pool && match.entry.name === entry.name) found.add('change');
    else found.add('rename');
  }
  for (const candidate of switchedEntries) {
    if (!paired.has(candidate.id)) found.add('remove');
  }

  for (const line of move.lines) {
    if (line.replaces) found.add('change');
    else if (!newNodeIds.has(line.node)) found.add('change');
  }

  const replacedSlots = new Set();
  for (const line of move.lines) {
    if (line.replaces) replacedSlots.add(slotOf(line.replaces));
  }
  for (const id of move.off) {
    const line = idx.lines[id];
    if (!line) partial.push(id);
    const replaced = line && replacedSlots.has(slotOf(id));
    const direct = move.lines.some((candidate) => candidate.replaces === id);
    if (!replaced && !direct) found.add('remove');
  }

  const newAttributeKeys = new Set();
  for (const attr of move.attributes) {
    newAttributeKeys.add(`${attr.node}\u0000${attr.key}`);
    if (!newNodeIds.has(attr.node)) found.add('change');
  }
  for (const id of move.attrOff) {
    const attr = idx.attrs[id];
    if (!attr) partial.push(id);
    if (!(attr && newAttributeKeys.has(`${attr.node}\u0000${attr.key}`))) found.add('remove');
  }

  return {
    ops: OPS.filter((op) => found.has(op)),
    partial: partial.sort(),
  };
}
