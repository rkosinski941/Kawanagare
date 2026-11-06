# M3 reference engine

A zero-dependency model of the [M3 architecture proposal](../docs/kawanagare-m3-spec-v4.md): line weave, pools, snags, rafts, and the flow log. It is not the M1 CLI. It does not use the repo-root `package.json`, `src/`, or `test/` tree.

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
- Mixed CRLF/LF bytes, redaction tombstones, locks, empty-pool `.kawa-keep`, and path checks (segment compare, so `wt2` is not inside `wt`) that do not touch the real disk.

## Layout

| File | Role |
|---|---|
| `engine.mjs` | Streams, flow log, carry / pull / restore, assemble, export gate |
| `weave.mjs` | Line records, both anchors, tombstones, `order_key` |
| `pools.mjs` | Entry records, names, orphans, cycles |
| `names.mjs` | Repo-path policy and inside-worktree checks |
| `model.mjs` | The visibility rule and resolution dormancy |
| `fixture.mjs` | The `odbc.c` example and the move-10 history |
| `demo.mjs` | The backport story |
| `matrix.test.mjs`, `m3.test.mjs` | The suite |

`package.json` in this directory only marks the folder as a private ES module so `node --test m3/` can start it. It has no dependencies.
