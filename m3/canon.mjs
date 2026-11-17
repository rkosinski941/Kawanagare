
import { createHash } from 'node:crypto';
import { MAX_SAFE, LIMITS } from './codes.mjs';

const MAX_DEPTH = LIMITS.canon_depth_max;

export class CanonError extends Error {
  constructor(reason, path, target) {
    const where = path === undefined ? '' : path === '' ? ' (root)' : ` at ${path}`;
    super(`canon_invalid: ${reason}${where}`);
    this.name = 'CanonError';
    this.code = 'canon_invalid';
    this.reason = reason;
    if (path !== undefined) this.path = path;
    if (target !== undefined) this.target = target;
  }
}

function pointer(parent, segment) {
  const text = String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
  return `${parent}/${text}`;
}

function hasLoneSurrogate(text) {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
      return true;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

function quoteString(text) {
  let out = '"';
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    const ch = text[i];
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (unit === 0x08) out += '\\b';
    else if (unit === 0x09) out += '\\t';
    else if (unit === 0x0a) out += '\\n';
    else if (unit === 0x0c) out += '\\f';
    else if (unit === 0x0d) out += '\\r';
    else if (unit < 0x20) out += `\\u${unit.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

function compareKeys(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function writeValue(value, path, depth) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';

  const type = typeof value;
  if (type === 'string') {
    if (hasLoneSurrogate(value)) throw new CanonError('lone_surrogate', path, 'value');
    return quoteString(value);
  }
  if (type === 'number') {
    if (Object.is(value, -0)) throw new CanonError('negative_zero', path, 'value');
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new CanonError('float', path, 'value');
    }
    if (Math.abs(value) > MAX_SAFE) throw new CanonError('integer_range', path, 'value');
    return String(value);
  }
  if (type !== 'object') throw new CanonError('unsupported_type', path, 'value');

  if (depth >= MAX_DEPTH) throw new CanonError('depth_exceeded', path, 'value');

  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i += 1) {
      if (!(i in value)) throw new CanonError('unsupported_type', pointer(path, i), 'value');
      parts.push(writeValue(value[i], pointer(path, i), depth + 1));
    }
    return `[${parts.join(',')}]`;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonError('unsupported_type', path, 'value');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CanonError('unsupported_type', path, 'value');
  }

  const keys = Object.keys(value).sort(compareKeys);
  const parts = [];
  for (const key of keys) {
    if (hasLoneSurrogate(key)) throw new CanonError('lone_surrogate', path, 'key');
    parts.push(`${quoteString(key)}:${writeValue(value[key], pointer(path, key), depth + 1)}`);
  }
  return `{${parts.join(',')}}`;
}

export function canonJson(value) {
  return writeValue(value, '', 0);
}

export function canonBytes(value) {
  return Buffer.from(canonJson(value), 'utf8');
}

export function hashOf(value) {
  const digest = createHash('sha256').update(canonBytes(value)).digest('hex');
  return `sha256:${digest}`;
}

export function parseCanon(text) {
  if (typeof text !== 'string') throw new CanonError('parse_error');
  if (text.charCodeAt(0) === 0xfeff) throw new CanonError('parse_error');

  let at = 0;

  const fail = (reason, path, target) => {
    throw new CanonError(reason, path, target);
  };
  const skipSpace = () => {
    while (at < text.length) {
      const ch = text[at];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') at += 1;
      else break;
    }
  };

  function parseString(path, target) {
    at += 1;
    let out = '';
    for (;;) {
      if (at >= text.length) return fail('parse_error', path, target);
      const ch = text[at];
      const unit = ch.charCodeAt(0);
      if (ch === '"') {
        at += 1;
        break;
      }
      if (unit < 0x20) return fail('parse_error', path, target);
      if (ch === '\\') {
        const esc = text[at + 1];
        if (esc === '"' || esc === '\\' || esc === '/') {
          out += esc;
          at += 2;
          continue;
        }
        if (esc === 'b') { out += '\b'; at += 2; continue; }
        if (esc === 'f') { out += '\f'; at += 2; continue; }
        if (esc === 'n') { out += '\n'; at += 2; continue; }
        if (esc === 'r') { out += '\r'; at += 2; continue; }
        if (esc === 't') { out += '\t'; at += 2; continue; }
        if (esc === 'u') {
          const hex = text.slice(at + 2, at + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail('parse_error', path, target);
          out += String.fromCharCode(parseInt(hex, 16));
          at += 6;
          continue;
        }
        return fail('parse_error', path, target);
      }
      out += ch;
      at += 1;
    }
    if (hasLoneSurrogate(out)) return fail('lone_surrogate', path, target);
    return out;
  }

  function parseNumber(path) {
    const rest = text.slice(at);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(rest);
    if (!match) return fail('parse_error', path);
    const token = match[0];
    at += token.length;
    if (token.includes('.') || token.includes('e') || token.includes('E')) {
      return fail('float', path, 'value');
    }
    if (token === '-0') return fail('negative_zero', path, 'value');
    const digits = token.startsWith('-') ? token.slice(1) : token;
    if (digits.length > 16 || (digits.length === 16 && digits > String(MAX_SAFE))) {
      return fail('integer_range', path, 'value');
    }
    return Number(token);
  }

  function parseArray(path, depth) {
    if (depth >= MAX_DEPTH) return fail('depth_exceeded', path, 'value');
    at += 1;
    const out = [];
    skipSpace();
    if (text[at] === ']') {
      at += 1;
      return out;
    }
    for (;;) {
      out.push(parseValue(pointer(path, out.length), depth + 1));
      skipSpace();
      if (text[at] === ',') {
        at += 1;
        continue;
      }
      if (text[at] === ']') {
        at += 1;
        return out;
      }
      return fail('parse_error', path);
    }
  }

  function parseObject(path, depth) {
    if (depth >= MAX_DEPTH) return fail('depth_exceeded', path, 'value');
    at += 1;
    const out = Object.create(null);
    skipSpace();
    if (text[at] === '}') {
      at += 1;
      return out;
    }
    for (;;) {
      skipSpace();
      if (text[at] !== '"') return fail('parse_error', path);
      const key = parseString(path, 'key');
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        return fail('duplicate_key', path, 'key');
      }
      skipSpace();
      if (text[at] !== ':') return fail('parse_error', path);
      at += 1;
      out[key] = parseValue(pointer(path, key), depth + 1);
      skipSpace();
      if (text[at] === ',') {
        at += 1;
        continue;
      }
      if (text[at] === '}') {
        at += 1;
        return out;
      }
      return fail('parse_error', path);
    }
  }

  function parseValue(path, depth) {
    skipSpace();
    const ch = text[at];
    if (ch === '{') return parseObject(path, depth);
    if (ch === '[') return parseArray(path, depth);
    if (ch === '"') return parseString(path, 'value');
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber(path);
    if (text.startsWith('true', at)) {
      at += 4;
      return true;
    }
    if (text.startsWith('false', at)) {
      at += 5;
      return false;
    }
    if (text.startsWith('null', at)) {
      at += 4;
      return null;
    }
    return fail('parse_error', path);
  }

  const value = parseValue('', 0);
  skipSpace();
  if (at !== text.length) throw new CanonError('parse_error');
  return value;
}

