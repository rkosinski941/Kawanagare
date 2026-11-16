
export const CODE = Object.freeze({
  canon_invalid: 'canon_invalid',
  intent_missing: 'intent_missing',
  intent_invalid: 'intent_invalid',
  move_empty: 'move_empty',
  intent_need_absent: 'intent_need_absent',
});

export const NOTICE = Object.freeze({
  intent_need_absent: 'intent_need_absent',
  ops_derived_partial: 'ops_derived_partial',
});

export const CANON_REASONS = Object.freeze([
  'float',
  'integer_range',
  'negative_zero',
  'lone_surrogate',
  'duplicate_key',
  'unsupported_type',
  'depth_exceeded',
  'parse_error',
]);

export const INTENT_REASONS = Object.freeze([
  'missing',
  'wrong_type',
  'unknown_field',
  'empty',
  'blank',
  'control_char',
  'lone_surrogate',
  'too_long',
  'too_many',
  'bad_id',
  'unknown_node',
  'duplicate',
  'self_reference',
  'not_in_list',
]);

export const PURPOSES = Object.freeze([
  'feature',
  'fix',
  'refactor',
  'docs',
  'test',
  'perf',
  'chore',
  'security',
]);

export const OPS = Object.freeze(['add', 'change', 'remove', 'rename']);

export const RECORD_ARRAYS = Object.freeze([
  'nodes',
  'entries',
  'entryOff',
  'lines',
  'off',
  'attributes',
  'attrOff',
]);

export const LIMITS = Object.freeze({
  statement_max: 200,
  list_max: 64,
  id_max: 200,
  canon_depth_max: 64,
});

export const MAX_SAFE = 9007199254740991;

export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._@:+-]{0,199}$/;

export const TARGET_KEYS = Object.freeze(['node']);
export const INTENT_KEYS = Object.freeze(['targets', 'purpose', 'needs', 'reason']);
