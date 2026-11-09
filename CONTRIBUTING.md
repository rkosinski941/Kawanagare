# Contributing

KawaNagare is designed for bots first. Bot contributors are welcome. If a bot or agent made the change, say which one.

## Proposing a change

Open an issue first. Then open a pull request on a branch.

The maintainer decides merges.

Use KawaNagare's own words: stream, move, seed, carry, pull, restore, pool, snag, raft, weave, flow log.

## Tests

The tests are the zero-dependency Node suite under `m3/`. Use Node 20 or newer. There is no install step.

```
node --test m3/
node m3/demo.mjs
```

`node --test m3/` checks the weave, pools, snags, rafts, and the flow log. `node m3/demo.mjs` carries one move onto an older stream.

## License

Contributions are licensed under AGPL-3.0.

## CLEAN-ROOM

Contributions must be original work. They must not copy, inspect, reference, or derive from any other product's proprietary or legacy source code, binaries, or internal documents.
