
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CanonError,
  canonBytes,
  canonJson,
  hashOf,
  parseCanon,
} from './canon.mjs';
import { CANON_REASONS, LIMITS } from './codes.mjs';

const CANON_VECTORS = [
  {
    "id": "V01",
    "title": "object key order does not matter",
    "input": "{\"b\":2,\"a\":1}",
    "expected": "{\"a\":1,\"b\":2}"
  },
  {
    "id": "V02",
    "title": "nested objects sorted, arrays keep order",
    "input": "{\"z\":{\"b\":[3,1,2],\"a\":null},\"y\":true}",
    "expected": "{\"y\":true,\"z\":{\"a\":null,\"b\":[3,1,2]}}"
  },
  {
    "id": "V03",
    "title": "empty array",
    "input": "[]",
    "expected": "[]"
  },
  {
    "id": "V04",
    "title": "empty object",
    "input": "{}",
    "expected": "{}"
  },
  {
    "id": "V05",
    "title": "empty containers nested, insignificant whitespace removed",
    "input": " [ {} , [ ] , { \"a\" : [ ] } ] ",
    "expected": "[{},[],{\"a\":[]}]"
  },
  {
    "id": "V06",
    "title": "scalars at the top level",
    "input": "false",
    "expected": "false"
  },
  {
    "id": "V07",
    "title": "null at the top level",
    "input": "null",
    "expected": "null"
  },
  {
    "id": "V08",
    "title": "quote, backslash and slash: solidus is not escaped",
    "input": "\"a\\\"b\\\\c\\/d\"",
    "expected": "\"a\\\"b\\\\c/d\""
  },
  {
    "id": "V09",
    "title": "control characters: short escapes for \\b \\t \\n \\f \\r, lowercase \\u00xx for the rest, DEL (U+007F) raw",
    "input": "\"\\u0000\\b\\t\\n\\f\\r\\u001f\\u007f\"",
    "expected": "\"\\u0000\\b\\t\\n\\f\\r\\u001f\u007f\""
  },
  {
    "id": "V10",
    "title": "hex digits in \\u escapes are written lowercase; input case does not matter",
    "input": "\"\\u001F\\u001f\"",
    "expected": "\"\\u001f\\u001f\""
  },
  {
    "id": "V11",
    "title": "non-ASCII is raw UTF-8: e-acute, euro sign, astral emoji",
    "input": "\"\\u00e9\\u20ac\\ud83d\\ude00\"",
    "expected": "\"\u00e9\u20ac\ud83d\ude00\""
  },
  {
    "id": "V12",
    "title": "U+2028 and U+2029 are raw, not escaped",
    "input": "\"\\u2028\\u2029\"",
    "expected": "\"\u2028\u2029\""
  },
  {
    "id": "V13",
    "title": "NFC string kept as written",
    "input": "\"\\u00e9\"",
    "expected": "\"\u00e9\""
  },
  {
    "id": "V14",
    "title": "NFD string kept as written (differs from V13 in bytes and hash)",
    "input": "\"e\\u0301\"",
    "expected": "\"e\u0301\""
  },
  {
    "id": "V15",
    "title": "key order is by UTF-16 code unit: U+1F600 (D83D DE00) sorts before U+FFFF; codepoint order would reverse them",
    "input": "{\"\\uffff\":2,\"\\ud83d\\ude00\":1,\"a\":3}",
    "expected": "{\"a\":3,\"\ud83d\ude00\":1,\"\uffff\":2}"
  },
  {
    "id": "V16",
    "title": "key order: empty key first, digits as text, uppercase before lowercase",
    "input": "{\"b\":1,\"B\":2,\"10\":3,\"2\":4,\"\":5}",
    "expected": "{\"\":5,\"10\":3,\"2\":4,\"B\":2,\"b\":1}"
  },
  {
    "id": "V17",
    "title": "key order is by raw code unit, not locale: z before e-acute",
    "input": "{\"\\u00e9\":1,\"z\":2}",
    "expected": "{\"z\":2,\"\u00e9\":1}"
  },
  {
    "id": "V18",
    "title": "keys are escaped like strings and sorted by their unescaped value",
    "input": "{\"\\\"\":2,\"\\n\":1}",
    "expected": "{\"\\n\":1,\"\\\"\":2}"
  },
  {
    "id": "V19",
    "title": "key order is decided after unescaping: an escaped key sorts as its character",
    "input": "{\"b\":1,\"\\u0061\":2}",
    "expected": "{\"a\":2,\"b\":1}"
  },
  {
    "id": "V20",
    "title": "integer boundaries: zero, safe maximum and minimum",
    "input": "[0,-1,9007199254740991,-9007199254740991]",
    "expected": "[0,-1,9007199254740991,-9007199254740991]"
  },
  {
    "id": "V21",
    "title": "__proto__ is an ordinary key",
    "input": "{\"constructor\":1,\"__proto__\":{\"a\":1}}",
    "expected": "{\"__proto__\":{\"a\":1},\"constructor\":1}"
  },
  {
    "id": "V22",
    "title": "the S1 fixed vector input",
    "input": "{\"a\":1,\"b\":[1,2]}",
    "expected": "{\"a\":1,\"b\":[1,2]}"
  },
  {
    "id": "V23",
    "title": "equal strings in different escape forms give identical bytes",
    "input": "[\"\\u0041\",\"A\",\"\\/\"]",
    "expected": "[\"A\",\"A\",\"/\"]"
  }
];

const REFUSE_VECTORS = [
  {
    "id": "R01",
    "title": "negative zero",
    "input": "-0",
    "reason": "negative_zero",
    "path": "",
    "target": "value"
  },
  {
    "id": "R02",
    "title": "negative zero in an array",
    "input": "[1,-0]",
    "reason": "negative_zero",
    "path": "/1",
    "target": "value"
  },
  {
    "id": "R03",
    "title": "fraction, even when integral",
    "input": "{\"a\":1.0}",
    "reason": "float",
    "path": "/a",
    "target": "value"
  },
  {
    "id": "R04",
    "title": "exponent form, even when integral",
    "input": "[1e2]",
    "reason": "float",
    "path": "/0",
    "target": "value"
  },
  {
    "id": "R05",
    "title": "exponent form, capital E",
    "input": "[1E2]",
    "reason": "float",
    "path": "/0",
    "target": "value"
  },
  {
    "id": "R06",
    "title": "ordinary float",
    "input": "1.5",
    "reason": "float",
    "path": "",
    "target": "value"
  },
  {
    "id": "R07",
    "title": "one above the safe maximum",
    "input": "9007199254740992",
    "reason": "integer_range",
    "path": "",
    "target": "value"
  },
  {
    "id": "R08",
    "title": "one below the safe minimum",
    "input": "[-9007199254740992]",
    "reason": "integer_range",
    "path": "/0",
    "target": "value"
  },
  {
    "id": "R09",
    "title": "twenty-digit integer",
    "input": "{\"n\":12345678901234567890}",
    "reason": "integer_range",
    "path": "/n",
    "target": "value"
  },
  {
    "id": "R10",
    "title": "lone high surrogate",
    "input": "\"\\ud800\"",
    "reason": "lone_surrogate",
    "path": "",
    "target": "value"
  },
  {
    "id": "R11",
    "title": "lone low surrogate",
    "input": "[\"\\udc00\"]",
    "reason": "lone_surrogate",
    "path": "/0",
    "target": "value"
  },
  {
    "id": "R12",
    "title": "high surrogate followed by a plain character",
    "input": "\"\\ud83dx\"",
    "reason": "lone_surrogate",
    "path": "",
    "target": "value"
  },
  {
    "id": "R13",
    "title": "surrogates in the wrong order",
    "input": "\"\\ude00\\ud83d\"",
    "reason": "lone_surrogate",
    "path": "",
    "target": "value"
  },
  {
    "id": "R14",
    "title": "lone surrogate in a key",
    "input": "{\"\\ud800\":1}",
    "reason": "lone_surrogate",
    "path": "",
    "target": "key"
  },
  {
    "id": "R15",
    "title": "duplicate key",
    "input": "{\"a\":1,\"a\":2}",
    "reason": "duplicate_key",
    "path": "",
    "target": "key"
  },
  {
    "id": "R16",
    "title": "duplicate key, identical values still refused",
    "input": "{\"x\":{\"k\":1,\"k\":1}}",
    "reason": "duplicate_key",
    "path": "/x",
    "target": "key"
  },
  {
    "id": "R17",
    "title": "duplicate key after unescaping",
    "input": "{\"a\":1,\"\\u0061\":2}",
    "reason": "duplicate_key",
    "path": "",
    "target": "key"
  },
  {
    "id": "R18",
    "title": "trailing comma in an object",
    "input": "{\"a\":1,}",
    "reason": "parse_error"
  },
  {
    "id": "R19",
    "title": "trailing comma in an array",
    "input": "[1,]",
    "reason": "parse_error"
  },
  {
    "id": "R20",
    "title": "empty input",
    "input": "",
    "reason": "parse_error"
  },
  {
    "id": "R21",
    "title": "NaN is not JSON",
    "input": "NaN",
    "reason": "parse_error"
  },
  {
    "id": "R22",
    "title": "single-quoted string",
    "input": "{'a':1}",
    "reason": "parse_error"
  },
  {
    "id": "R23",
    "title": "text after the value",
    "input": "[1] x",
    "reason": "parse_error"
  },
  {
    "id": "R24",
    "title": "byte order mark in front",
    "input": "\ufeff[1]",
    "reason": "parse_error"
  },
  {
    "id": "R25",
    "title": "raw newline inside a string",
    "input": "\"a\nb\"",
    "reason": "parse_error"
  },
  {
    "id": "R26",
    "title": "unknown escape",
    "input": "\"\\x41\"",
    "reason": "parse_error"
  },
  {
    "id": "R27",
    "title": "leading zero",
    "input": "[01]",
    "reason": "parse_error"
  },
  {
    "id": "R28",
    "title": "first error in text order wins",
    "input": "[1.5,-0]",
    "reason": "float",
    "path": "/0",
    "target": "value"
  }
];

const HASHES = {
  "H01": "sha256:8baa73198470c7bb4c3ce142a8fd651affc0310d878bb9bd159e37a573fb4874",
  "H02": "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  "H03": "sha256:74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
  "H04": "sha256:f2886017e9c7abacf804b54d64787dce2b611c9544ba21f3affdd126a6e50086",
  "H05": "sha256:3d68ce21f2899a475713cdbe7562ba9bdb6b1dfde8af1f221bdff4a0935b53b2",
  "H06": "sha256:92a98ee3f7f8f30bd80c9d464a68ad47d46e0da2bc7da9c2b5a391e15fd1b4ff"
};

const HASH_INPUTS = {
  H01: '{"a":1,"b":[1,2]}',
  H02: '{}',
  H03: 'null',
  H04: '"\\u00e9"',
  H05: '"e\\u0301"',
  H06: '{"\\uffff":2,"\\ud83d\\ude00":1,"a":3}',
};

function prefix(value) {
  let out = '';
  for (let i = 0; i < value; i += 1) out += '[';
  for (let i = 0; i < value; i += 1) out += ']';
  return out;
}

function nested(value) {
  let out = [];
  for (let i = 1; i < value; i += 1) out = [out];
  return out;
}

test('A-S1-1 object key order does not change canonJson or hashOf', () => {
  const one = { b: 2, a: 1, inner: { z: 1, y: 2 } };
  const two = { inner: { y: 2, z: 1 }, a: 1, b: 2 };
  assert.equal(canonJson(one), canonJson(two));
  assert.equal(hashOf(one), hashOf(two));
  assert.equal(canonJson(one), '{"a":1,"b":2,"inner":{"y":2,"z":1}}');
});

test('A-S1-2 a float or undefined throws canon_invalid', () => {
  for (const value of [1.5, NaN, Infinity, undefined]) {
    assert.throws(
      () => canonJson(value),
      (error) => {
        assert.equal(error.code, 'canon_invalid');
        assert.ok(CANON_REASONS.includes(error.reason));
        return true;
      },
    );
  }
  assert.throws(() => canonJson(-0), { code: 'canon_invalid', reason: 'negative_zero' });
  assert.throws(() => canonJson(2 ** 53), { code: 'canon_invalid', reason: 'integer_range' });
  assert.throws(() => canonJson('a\ud800'), { code: 'canon_invalid', reason: 'lone_surrogate' });
  assert.throws(() => canonJson(10n), { code: 'canon_invalid', reason: 'unsupported_type' });
});

test('A-S1-3 the fixed vector hash is a literal', () => {
  assert.equal(
    hashOf({ a: 1, b: [1, 2] }),
    'sha256:8baa73198470c7bb4c3ce142a8fd651affc0310d878bb9bd159e37a573fb4874',
  );
});

test('A-S1-4 NFC and NFD strings hash differently and are never normalised', () => {
  const nfc = '\u00e9';
  const nfd = 'e\u0301';
  assert.notEqual(nfc.length, nfd.length);
  assert.equal(canonJson(nfc), '"é"');
  assert.equal(canonJson(nfd), '"e\u0301"');
  assert.notEqual(hashOf(nfc), hashOf(nfd));
  assert.equal(hashOf(nfc), HASHES.H04);
  assert.equal(hashOf(nfd), HASHES.H05);
});

test('T77 all canonical outputs V01-V23', () => {
  assert.equal(CANON_VECTORS.length, 23);
  for (const vector of CANON_VECTORS) {
    const value = parseCanon(vector.input);
    assert.equal(canonJson(value), vector.expected, vector.id);
    const bytes = canonBytes(value).toString('hex');
    assert.equal(bytes, Buffer.from(vector.expected, 'utf8').toString('hex'), vector.id);
    assert.equal(canonJson(parseCanon(canonJson(value))), vector.expected, `${vector.id} reparse`);
  }
});

test('T77 all refusals R01-R28 in text order', () => {
  assert.equal(REFUSE_VECTORS.length, 28);
  for (const vector of REFUSE_VECTORS) {
    assert.throws(
      () => parseCanon(vector.input),
      (error) => {
        assert.ok(error instanceof CanonError, vector.id);
        assert.equal(error.code, 'canon_invalid', vector.id);
        assert.equal(error.reason, vector.reason, vector.id);
        if (vector.path !== undefined) assert.equal(error.path, vector.path, vector.id);
        if (vector.target !== undefined) assert.equal(error.target, vector.target, vector.id);
        return true;
      },
      vector.id,
    );
  }
});

test('T77 in-memory refusals A01-A17', () => {
  const sparse = [];
  sparse.length = 2;
  sparse[1] = 1;
  class Sample {}
  const symbolKeyed = {};
  symbolKeyed[Symbol('k')] = 1;
  const cases = [
    { id: 'A01', value: undefined, reason: 'unsupported_type', path: '' },
    { id: 'A02', value: { a: undefined }, reason: 'unsupported_type', path: '/a' },
    { id: 'A03', value: NaN, reason: 'float', path: '' },
    { id: 'A04', value: [Infinity], reason: 'float', path: '/0' },
    { id: 'A05', value: -0, reason: 'negative_zero', path: '' },
    { id: 'A06', value: 1.5, reason: 'float', path: '' },
    { id: 'A07', value: 2 ** 53, reason: 'integer_range', path: '' },
    { id: 'A08', value: 10n, reason: 'unsupported_type', path: '' },
    { id: 'A09', value: new Date(0), reason: 'unsupported_type', path: '' },
    { id: 'A10', value: new Map(), reason: 'unsupported_type', path: '' },
    { id: 'A11', value: () => 1, reason: 'unsupported_type', path: '' },
    { id: 'A12', value: Symbol('x'), reason: 'unsupported_type', path: '' },
    { id: 'A13', value: sparse, reason: 'unsupported_type', path: '/0' },
    { id: 'A14', value: 'a\udc00', reason: 'lone_surrogate', path: '' },
    { id: 'A15', value: symbolKeyed, reason: 'unsupported_type', path: '' },
    { id: 'A16', value: new Sample(), reason: 'unsupported_type', path: '' },
    { id: 'A17', value: { '\ud800': 1 }, reason: 'lone_surrogate', path: '', target: 'key' },
  ];
  assert.equal(cases.length, 17);
  for (const item of cases) {
    assert.throws(
      () => canonJson(item.value),
      (error) => {
        assert.equal(error.reason, item.reason, item.id);
        assert.equal(error.path, item.path, item.id);
        if (item.target) assert.equal(error.target, item.target, item.id);
        return true;
      },
      item.id,
    );
  }
});

test('T77 every hash vector H01-H06', () => {
  for (const [id, text] of Object.entries(HASH_INPUTS)) {
    assert.equal(hashOf(parseCanon(text)), HASHES[id], id);
  }
  assert.equal(HASHES.H01.startsWith('sha256:'), true);
  assert.equal(new Set(Object.values(HASHES)).size, 6);
});

test('T77 V15 and H06 fix UTF-16 key order', () => {
  const v15 = CANON_VECTORS.find((vector) => vector.id === 'V15');
  assert.equal(
    canonJson(parseCanon(v15.input)),
    '{"a":3,"😀":1,"\uffff":2}',
  );
  assert.equal(hashOf(parseCanon(HASH_INPUTS.H06)), HASHES.H06);
  const keyOrder = Object.keys(parseCanon(v15.input)).sort();
  assert.equal(keyOrder.join('|'), 'a|😀|\uffff');
});

test('T77 depth 64 is accepted and 65 is refused', () => {
  assert.equal(LIMITS.canon_depth_max, 64);
  assert.equal(parseCanon(prefix(64)).length > 0, true);
  assert.doesNotThrow(() => canonJson(nested(64)));
  assert.throws(() => parseCanon(prefix(65)), { code: 'canon_invalid', reason: 'depth_exceeded' });
  assert.throws(() => canonJson(nested(65)), { code: 'canon_invalid', reason: 'depth_exceeded' });
});

test('parseCanon keeps objects prototype-free and refuses duplicate keys before values', () => {
  const value = parseCanon('{"__proto__":{"a":1}}');
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(canonJson(value), '{"__proto__":{"a":1}}');
  assert.throws(() => parseCanon('{"a":1,"\\u0061":2}'), {
    code: 'canon_invalid',
    reason: 'duplicate_key',
    path: '',
    target: 'key',
  });
});
