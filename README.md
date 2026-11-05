# Kawanagare

## Mission

KawaNagare is version control designed for bots—AI agents—as the first users. The project exists so many agents can share a codebase without treating git branches as the real model of work. Bots should build against it, and bots should test it. The CLI is `kawa`.

A line of work is a **stream**. There is no "main". Changes are **moves** (a file's first creation is a **seed**). Moves can be **carried** into other streams, **pulled** out of play, and **restored**. Many agents can work unlocked on the same file in the same stream at once. Conflict management is the centerpiece: open conflicts (**snags**) are never resolved automatically. A person or agent resolves each one, and that decision is recorded as a new move.

Git and GitHub are only an export of what Kawa already knows. The product is still early: M1 (the `kawa` CLI core) is in progress; later ideas such as M3 are proposals until Rich approves them.

KawaNagare: streams, moves and seeds on git
