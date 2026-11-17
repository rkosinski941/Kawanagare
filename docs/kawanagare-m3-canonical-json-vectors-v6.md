# KawaNagare canonical JSON vectors (spec v6, section A)

draft_by: change-impact
status: draft, box-only. Companion to kawanagare-m3-spec-v6.md section A and slice S1.
source_files: evidence/canon-vectors.json (authoritative), evidence/canon-reference.mjs, evidence/canon-reference.py, evidence/canon-vectors-check.mjs
verified: JS reference and an independent Python implementation agree on every vector below (see "Verification"). The m3 engine has no canonicalizer to check against.

## Reading the tables
- `input` is raw JSON text. `<U+XXXX>` marks a character shown by code point because it is invisible or combining. Bytes are UTF-8, lowercase hex.
- `canonical` is the exact output of `canonJson(parseCanon(input))`.
- Refusals are `{code: "canon_invalid", reason, path, target}`. `path` is an RFC 6901 pointer to the containing value; `target` is `value` or `key`. Errors in text are reported first-in-text-order.
- Hashes are `"sha256:" + hex(sha256(canonical UTF-8 bytes))`.

## 1. Canonical outputs

| id | rule shown | input | canonical | canonical bytes (hex) |
|---|---|---|---|---|
| V01 | object key order does not matter | `{"b":2,"a":1}` | `{"a":1,"b":2}` | `7b2261223a312c2262223a327d` |
| V02 | nested objects sorted, arrays keep order | `{"z":{"b":[3,1,2],"a":null},"y":true}` | `{"y":true,"z":{"a":null,"b":[3,1,2]}}` | `7b2279223a747275652c227a223a7b2261223a6e756c6c2c2262223a5b332c312c325d7d7d` |
| V03 | empty array | `[]` | `[]` | `5b5d` |
| V04 | empty object | `{}` | `{}` | `7b7d` |
| V05 | empty containers nested, insignificant whitespace removed | ` [ {} , [ ] , { "a" : [ ] } ] ` | `[{},[],{"a":[]}]` | `5b7b7d2c5b5d2c7b2261223a5b5d7d5d` |
| V06 | scalars at the top level | `false` | `false` | `66616c7365` |
| V07 | null at the top level | `null` | `null` | `6e756c6c` |
| V08 | quote, backslash and slash: solidus is not escaped | `"a\"b\\c\/d"` | `"a\"b\\c/d"` | `22615c22625c5c632f6422` |
| V09 | control characters: short escapes for \b \t \n \f \r, lowercase \u00xx for the rest, DEL (U+007F) raw | `"\u0000\b\t\n\f\r\u001f\u007f"` | `"\u0000\b\t\n\f\r\u001f<U+007F>"` | `225c75303030305c625c745c6e5c665c725c75303031667f22` |
| V10 | hex digits in \u escapes are written lowercase; input case does not matter | `"\u001F\u001f"` | `"\u001f\u001f"` | `225c75303031665c753030316622` |
| V11 | non-ASCII is raw UTF-8: e-acute, euro sign, astral emoji | `"\u00e9\u20ac\ud83d\ude00"` | `"é€😀"` | `22c3a9e282acf09f988022` |
| V12 | U+2028 and U+2029 are raw, not escaped | `"\u2028\u2029"` | `"<U+2028><U+2029>"` | `22e280a8e280a922` |
| V13 | NFC string kept as written | `"\u00e9"` | `"é"` | `22c3a922` |
| V14 | NFD string kept as written (differs from V13 in bytes and hash) | `"e\u0301"` | `"e<U+0301>"` | `2265cc8122` |
| V15 | key order is by UTF-16 code unit: U+1F600 (D83D DE00) sorts before U+FFFF; codepoint order would reverse them | `{"\uffff":2,"\ud83d\ude00":1,"a":3}` | `{"a":3,"😀":1,"<U+FFFF>":2}` | `7b2261223a332c22f09f9880223a312c22efbfbf223a327d` |
| V16 | key order: empty key first, digits as text, uppercase before lowercase | `{"b":1,"B":2,"10":3,"2":4,"":5}` | `{"":5,"10":3,"2":4,"B":2,"b":1}` | `7b22223a352c223130223a332c2232223a342c2242223a322c2262223a317d` |
| V17 | key order is by raw code unit, not locale: z before e-acute | `{"\u00e9":1,"z":2}` | `{"z":2,"é":1}` | `7b227a223a322c22c3a9223a317d` |
| V18 | keys are escaped like strings and sorted by their unescaped value | `{"\"":2,"\n":1}` | `{"\n":1,"\"":2}` | `7b225c6e223a312c225c22223a327d` |
| V19 | key order is decided after unescaping: an escaped key sorts as its character | `{"b":1,"\u0061":2}` | `{"a":2,"b":1}` | `7b2261223a322c2262223a317d` |
| V20 | integer boundaries: zero, safe maximum and minimum | `[0,-1,9007199254740991,-9007199254740991]` | `[0,-1,9007199254740991,-9007199254740991]` | `5b302c2d312c393030373139393235343734303939312c2d393030373139393235343734303939315d` |
| V21 | __proto__ is an ordinary key | `{"constructor":1,"__proto__":{"a":1}}` | `{"__proto__":{"a":1},"constructor":1}` | `7b225f5f70726f746f5f5f223a7b2261223a317d2c22636f6e7374727563746f72223a317d` |
| V22 | the S1 fixed vector input | `{"a":1,"b":[1,2]}` | `{"a":1,"b":[1,2]}` | `7b2261223a312c2262223a5b312c325d7d` |
| V23 | equal strings in different escape forms give identical bytes | `["\u0041","A","\/"]` | `["A","A","/"]` | `5b2241222c2241222c222f225d` |

## 2. Refusals (input is refused; nothing is hashed)

| id | rule shown | input | reason | path | target |
|---|---|---|---|---|---|
| R01 | negative zero | `-0` | `negative_zero` | `` | value |
| R02 | negative zero in an array | `[1,-0]` | `negative_zero` | `/1` | value |
| R03 | fraction, even when integral | `{"a":1.0}` | `float` | `/a` | value |
| R04 | exponent form, even when integral | `[1e2]` | `float` | `/0` | value |
| R05 | exponent form, capital E | `[1E2]` | `float` | `/0` | value |
| R06 | ordinary float | `1.5` | `float` | `` | value |
| R07 | one above the safe maximum | `9007199254740992` | `integer_range` | `` | value |
| R08 | one below the safe minimum | `[-9007199254740992]` | `integer_range` | `/0` | value |
| R09 | twenty-digit integer | `{"n":12345678901234567890}` | `integer_range` | `/n` | value |
| R10 | lone high surrogate | `"\ud800"` | `lone_surrogate` | `` | value |
| R11 | lone low surrogate | `["\udc00"]` | `lone_surrogate` | `/0` | value |
| R12 | high surrogate followed by a plain character | `"\ud83dx"` | `lone_surrogate` | `` | value |
| R13 | surrogates in the wrong order | `"\ude00\ud83d"` | `lone_surrogate` | `` | value |
| R14 | lone surrogate in a key | `{"\ud800":1}` | `lone_surrogate` | `` | key |
| R15 | duplicate key | `{"a":1,"a":2}` | `duplicate_key` | `` | key |
| R16 | duplicate key, identical values still refused | `{"x":{"k":1,"k":1}}` | `duplicate_key` | `/x` | key |
| R17 | duplicate key after unescaping | `{"a":1,"\u0061":2}` | `duplicate_key` | `` | key |
| R18 | trailing comma in an object | `{"a":1,}` | `parse_error` | n/a | n/a |
| R19 | trailing comma in an array | `[1,]` | `parse_error` | n/a | n/a |
| R20 | empty input | `` | `parse_error` | n/a | n/a |
| R21 | NaN is not JSON | `NaN` | `parse_error` | n/a | n/a |
| R22 | single-quoted string | `{'a':1}` | `parse_error` | n/a | n/a |
| R23 | text after the value | `[1] x` | `parse_error` | n/a | n/a |
| R24 | byte order mark in front | `<U+FEFF>[1]` | `parse_error` | n/a | n/a |
| R25 | raw newline inside a string | `"a<U+000A>b"` | `parse_error` | n/a | n/a |
| R26 | unknown escape | `"\x41"` | `parse_error` | n/a | n/a |
| R27 | leading zero | `[01]` | `parse_error` | n/a | n/a |
| R28 | first error in text order wins | `[1.5,-0]` | `float` | `/0` | value |

Generated depth vectors: 64 nested arrays (`[` x64, `]` x64) are accepted; 65 are refused `depth_exceeded`.

### 2.1 Refusals that exist only for in-memory values (not reachable from JSON text)

| id | value | reason | path |
|---|---|---|---|
| A01 | `undefined` | `unsupported_type` | `` (root) |
| A02 | `{a: undefined}` | `unsupported_type` | `/a` |
| A03 | `NaN` | `float` | root |
| A04 | `[Infinity]` | `float` | `/0` |
| A05 | `-0` (numeric negative zero) | `negative_zero` | root |
| A06 | `1.5` | `float` | root |
| A07 | `2**53` | `integer_range` | root |
| A08 | `10n` (BigInt) | `unsupported_type` | root |
| A09 | `new Date(0)` | `unsupported_type` | root |
| A10 | `new Map()` | `unsupported_type` | root |
| A11 | a function | `unsupported_type` | root |
| A12 | a Symbol | `unsupported_type` | root |
| A13 | sparse array `[ , 1]` | `unsupported_type` | `/0` |
| A14 | string ending in a lone low surrogate | `lone_surrogate` | root |
| A15 | object with a Symbol key | `unsupported_type` | root |
| A16 | class instance (prototype not Object.prototype or null) | `unsupported_type` | root |
| A17 | object whose key is a lone surrogate | `lone_surrogate` (target key) | root |

JS `JSON.stringify` differs from this contract and MUST NOT be used as the canonicalizer: `JSON.stringify(-0)` gives `"0"`; `{a: undefined}` gives `{}`; a lone surrogate gives the escape `"\\ud800"`; `1e21` gives `1e+21`. The check script asserts each of these.

## 3. Hash vectors

| id | rule shown | input | canonical | hash |
|---|---|---|---|---|
| H01 | S1 fixed vector A-S1-3 | `{"a":1,"b":[1,2]}` | `{"a":1,"b":[1,2]}` | `sha256:8baa73198470c7bb4c3ce142a8fd651affc0310d878bb9bd159e37a573fb4874` |
| H02 | empty object | `{}` | `{}` | `sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a` |
| H03 | null | `null` | `null` | `sha256:74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b` |
| H04 | NFC vs NFD differ (V13) | `"\u00e9"` | `"é"` | `sha256:f2886017e9c7abacf804b54d64787dce2b611c9544ba21f3affdd126a6e50086` |
| H05 | NFC vs NFD differ (V14) | `"e\u0301"` | `"e<U+0301>"` | `sha256:3d68ce21f2899a475713cdbe7562ba9bdb6b1dfde8af1f221bdff4a0935b53b2` |
| H06 | key-order vector V15 | `{"\uffff":2,"\ud83d\ude00":1,"a":3}` | `{"a":3,"😀":1,"<U+FFFF>":2}` | `sha256:92a98ee3f7f8f30bd80c9d464a68ad47d46e0da2bc7da9c2b5a391e15fd1b4ff` |

- **A-S1-3 fixed vector:** `hashOf({a:1,b:[1,2]}) == "sha256:8baa73198470c7bb4c3ce142a8fd651affc0310d878bb9bd159e37a573fb4874"`. Independently confirmed with `printf '%s' '{"a":1,"b":[1,2]}' | sha256sum`.
- **A-S1-4:** H04 and H05 differ. Strings are never normalised.
- **Sort-order discriminator (V15, H06):** a codepoint sort (Python default, Go `sort.Strings` on runes) puts U+FFFF before U+1F600; the UTF-16 sort contract puts U+1F600 first. A mutated reference using codepoint order fails V15 and H06 (checked).

## 4. Verification
- `node evidence/canon-vectors-check.mjs` runs all sections against the JS reference, then runs `evidence/canon-reference.py` and compares all hashes. Result at the time of writing: JS and Python both report 0 failures (23 canonical, 28 refusals, 6 hashes; 17 in-memory refusals JS only).
- The three sha256 values for H01, H02 and H03 were also computed with `sha256sum` on the hand-typed canonical text.
- **Engine check:** `m3/` at the read-only source has no canonicalizer or `hashOf` (grep found none; it uses `JSON.stringify` only inside a test helper). So there is nothing to mismatch. S1 creates `m3/canon.mjs`; S1 passes when it matches this file. The engine's own default `Array.sort()` on ids is UTF-16 code unit order, consistent with the key order chosen here.
