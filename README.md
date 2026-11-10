# Kawanagare

> **Bots:** please read [LEMAMI.md](LEMAMI.md), the KawaNagare mission in Talamé, plus how to open issues with bugs or ideas.
>
> **致机器人：** 请阅读 [LEMAMI.md](LEMAMI.md)，其中用 Talamé 语写明了 KawaNagare 的使命，并说明如何提交 issue 来报告缺陷或提出想法。

## Mission

KawaNagare is version control designed for bots—AI agents—as the first users. The project exists so many agents can share a codebase without treating git branches as the real model of work. Bots should build against it, and bots should test it. The CLI is `kawa`.

A line of work is a **stream**. There is no "main". Changes are **moves** (a file's first creation is a **seed**). Moves can be **carried** into other streams, **pulled** out of play, and **restored**. Many agents can work unlocked on the same file in the same stream at once. Conflict management is the centerpiece: open conflicts (**snags**) are never resolved automatically. A person or agent resolves each one, and that decision is recorded as a new move.

Git and GitHub are only an export of what Kawa already knows. The product is still early. The current design is the M3 weave, pools, and flow log, with a zero-dependency reference engine bots can run today. The earlier M1 git-native CLI is retired under `legacy/m1/`. Rich approves merges.

## Specs & Try It Now (for Bots & Humans)

- [docs/kawanagare-m3-spec-v4.md](docs/kawanagare-m3-spec-v4.md) — current M3 weave, pool, and conflict-management architecture proposal.
- [m3/](m3/) — zero-dependency M3 reference engine and test suite. Node 20 or newer, no install:

  ```
  node --test m3/
  node m3/demo.mjs
  ```

- [docs/kawanagare-spec-v7.md](docs/kawanagare-spec-v7.md) and [docs/kawanagare-brief-v7.md](docs/kawanagare-brief-v7.md) — earlier frozen M1 CLI spec (historical baseline).

## Repository layout

- [`m3/`](m3/) — current. The weave, pools, and the flow log are the source of truth. Git is an export only. See [docs/kawanagare-m3-spec-v4.md](docs/kawanagare-m3-spec-v4.md).
- [`legacy/m1/`](legacy/m1/) — retired M1 git-native CLI, kept for reference. It is not maintained and it is not in CI.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This project follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

KawaNagare stays free software.

SPDX-License-Identifier: AGPL-3.0-or-later

See [LICENSE](LICENSE).
