# M3 reference engine

A zero-dependency model of the [M3 spec v6 draft](../docs/kawanagare-m3-spec-v6.md): line weave, pools, snags, rafts, and the flow log. It is not the retired M1 CLI in [`legacy/m1/`](../legacy/m1/). It does not use that directory's `package.json`, `src/`, or `test/`.

Bots are the users this model is built for. `assemble` is how you simulate a carry, a pull, or a restore before you commit to it.

## Run

Node 20 or newer. No install.

```
node --test m3/
node m3/demo.mjs
```

`node m3/demo.mjs` backports move 10 from stream `v2` onto the older stream `v1`. The Move-Id stays `10`. The needs group is `10 → 7 → 6`. The demo exits non-zero if that story breaks.

## What the tests cover

- Matrix rows **T01–T40** (`matrix.test.mjs`), all 11 snag kinds. Kind 6 is a twin label on kind 1 or 2. Kind 11 is a tag (`tag11`, `exposedBy`) on the underlying snag.
- Read-only `assemble`: the repo snapshot is unchanged, and the result has both text and snags.
- The move-10 backport: refusal without `withNeeds`, one event for the transitive group, then `pull` and `restore`.
- Anchor ordering: an insert stays in its gap when the right-hand line is replaced; the same gap is ordered by `order_key`, not by who landed first.
- Two bots in open water on one file, then a resolution move for the overlapping edit. Nothing is auto-resolved.
- Needs (S3, `needs.test.mjs`): `deriveNeeds` edges `{move_id, via_node_id, reason_code}` with `derive_algo: "needs-v1"`; carry codes `needs_derived_missing`, `parent_pool_missing` (options `[add_parent, refuse]`), `waiver_invalid`, notice `needs_authored_unproven`; single-edge waiver events; `carryPreview`.
- Raft carry (G-41, `raft.test.mjs`): same refusal codes, order and waiver rule as a single-move carry; problem objects carry `needs_report`, `notices` and, for `parent_pool_missing`, `parent_move_id` and `child_node_id`; a landed raft reports the waived-edge `needs_derived_missing` notice.
- Kind 5 same-move exemption (`kind5.test.mjs`): a pure mid-file delete of B in A,B,C views `a\nc\n` and exports; a later insert anchored on B is still kind 5 (T07).
- mint-v1 (`mint.test.mjs`, G-49): `mintScript` turns a before-view and after bytes into line records and switch-offs. Deletions-first LCS after prefix/suffix trim; modify = `off` + a line that `replaces`; ids `L:<move>:<n>`; a fixed output hash (T-W09); seeded fuzz that every minted view reads back byte for byte. Replacement chains keep the first line's slot (D-M1-08). Sequential edits do not snag: a replacing or switching-off move whose `saw` lists the other move is exempt from kind 3 / kind 5; concurrent edits still snag (D-M1-12), including through replacement chains (D-M1-13). Kind 1 follows replacement chains (D-M1-18), and delete vs modify of one line by two moves that did not see each other is kind 1 (D-M1-17, G-61). A seeded two-author fuzz checks every snag against the rules and both arrival orders.
- Mixed CRLF/LF bytes, redaction tombstones, locks, empty-pool `.kawa-keep`, and path checks (segment compare, so `wt2` is not inside `wt`) that do not touch the real disk.

## Layout

| File | Role |
|---|---|
| `engine.mjs` | Streams, flow log, carry / pull / restore, assemble, export gate |
| `weave.mjs` | Line records, both anchors, tombstones, `order_key` |
| `mint.mjs` | mint-v1: line records and switch-offs from a before-view and after bytes |
| `pools.mjs` | Entry records, names, orphans, cycles |
| `names.mjs` | Repo-path policy and inside-worktree checks |
| `model.mjs` | The visibility rule and resolution dormancy |
| `needs.mjs` | Derived needs (`needs-v1`), needs reports, waiver schema |
| `codes.mjs` | Codes, closed lists, limits (one constants file) |
| `fixture.mjs` | The `odbc.c` example and the move-10 history |
| `demo.mjs` | The backport story |
| `*.test.mjs` | The suite; `index.mjs` imports every file (gate T86) |

`package.json` in this directory only marks the folder as a private ES module so `node --test m3/` can start it. It has no dependencies.
