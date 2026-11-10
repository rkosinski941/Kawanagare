# Retired M1 git-native CLI

This is the retired M1 git-native `kawa` CLI, kept for reference. M3 supersedes it. In M3, the weave, the pools, and the flow log are the source of truth, and git is an export only.

It was merged on 2026-11-10 and moved here from the repository root.

It is not maintained, and it is not in CI.

The current design is the reference engine in [`m3/`](../../m3/) and [`docs/kawanagare-m3-spec-v4.md`](../../docs/kawanagare-m3-spec-v4.md).

## Known unfixed issues

- A Windows repo-path mismatch.
- A check-in that is not atomic.
- A weak worktree prefix check.

## Build and test

From this directory, with Node 20 or newer:

```
npm ci
npm test
```

`npm test` compiles `src/` and runs the suite in `test/`.
