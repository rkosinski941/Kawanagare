# KawaNagare M3 Architecture & Conflict Proposal v6

**Status:** DRAFT v6, box-only, not posted, not reviewed (review_by: 10thman-delegator, pending). v6 folds the triage of the Codex review of v5 (triage-codex.md) and adds the named stream base `tome` as an M4-deferred section (§13). Active proposal / reference model under test. This is not an approved build plan for the M1 CLI. Nothing in M1 switches over to this model until Rich approves it.

**Base of v6.** v5, which was v4 as on `main` (includes merged kanosei PR #11) plus the *proposed* intent-block text of open PR #12. The sections "Intent block (required)" and "Kanosei intent" exist only if PR #12 merges; v5 and v6 amend them (changelogs Q1, Q3 and v6-02 to v6-13). Provisional names and enum values are listed in §12 and need Rich (needs-rich.md NR-2). Parked items are in §11.

**What this document is.** The architecture for streams, moves, the line weave, pools, and conflict management. Bots are the primary users. The runnable model is [`m3/`](../m3/): `node --test m3/` and `node m3/demo.mjs`, with Node 20+ and no install step.

**What this supersedes.** [`kawanagare-spec-v7.md`](kawanagare-spec-v7.md) treats git as the store: a move is replayed into a new commit, GitHub is the source of truth, and `main` is the branch people merge to (v7 §2 and §9). v4 drops that assumption. Signed move scripts and the flow log are the source of truth. Git trees and commits are only an export. [`kawanagare-spec-v7.md`](kawanagare-spec-v7.md) and [`kawanagare-brief-v7.md`](kawanagare-brief-v7.md) stay in `docs/` as the frozen M1 record. M1 keeps following v7 until Rich says otherwise.

**Who it is for.** KawaNagare is designed for **bots (AI agents)** first. Bot teams work concurrently in open water on shared files, and bots test the model. A human release-backport workflow is the same machinery — carry a move into an older stream — so it comes for free. There is no separate "first user" track.

**Inputs folded into v5.** DeepSeek answers of 2026-11-15 to the open-question bundle (Q1-Q12, Q-VCS1-17); verdicts and reasons are in decisions.md. DeepSeek worked from v7 (M1) and not from v4, so answers that rely on v7-only constructs are not folded in. **Inputs folded into v4.** M3 ideas v3; the 40-row snag matrix (T01–T40); the line-weave prototype (`assemble`, transitive `with-needs`, `pull` / `restore`, and the four findings below). v3's open question about the first user is closed by the paragraph above.

---

## Changelog v5 -> v6 (keyed by Codex review point; reasons in triage-codex.md)

Verdicts, reasons and rejections: triage-codex.md. Needs-Rich items NR-1 to NR-12 stay open; Codex opinions on them are recorded in needs-rich.md as `codex_view` only. Everything not listed is unchanged from v5.

**Slice scope marker.** Only the sections tagged **[S1-S2]** are normative for slices S1 and S2: §A (canonical form), "Intent block (required)", §1.1 step 1, §4.1 `move_empty`, §12 rows for intent. Every other section is a provisional contract for later slices and does not block building S1 or S2. §13 (tome) is M4-deferred and blocks nothing.

| id | change | section |
|---|---|---|
| v6-01 | Canonical JSON made exact: string escaping, key sort by UTF-16 code unit (RFC 8785 order), safe-integer range, `-0`, lone surrogates, duplicate keys, depth limit, error shape. Strict parser `parseCanon`. Vectors in canonical-json-vectors.md. | §A |
| v6-02 | Intent targets are tagged node ids `{node}`, never paths. Path to node resolution is tooling, outside the signed block. | Intent block |
| v6-03 | `ops_derived` is a set computed by a fixed truth table over the seven record arrays; sorted in §12 order, which equals lexical order. Cross-pool move is `rename`. | Intent block |
| v6-04 | Exact intent validation: id grammar, statement rules and limits, list bounds, duplicates, closed schema (recursive), fixed check order and error object. | Intent block |
| v6-05 | `needs`: authored needs are never carry preconditions. Record time requires grammar only; assemble reports. | Intent block, §4.9 |
| v6-06 | `move_empty` defined by the seven record arrays plus `resolves`. Order-only resolution is valid. A removal resolution needs at least one switch-off. | §4.1, §4.4 |
| v6-07 | Kanosei overview no longer says the other members are pulled. A pick never pulls (matches pick consequences and NR-10 lean). NR-10 stays open. | §0, Kanosei |
| v6-08 | A raft outside a kanosei carries no authored intent; it is derived. "Remains open" text removed. | Kanosei intent, §4.7 |
| v6-09 | Raft carry checks derived needs only; authored-only needs are a notice, as for a single carry. | §4.7 |
| v6-10 | Equal-view promise narrowed: exposure annotations (`tag11`, `exposedBy`, `exposedByKind`) are outside it. | §4.11 |
| v6-11 | `in_play` is the one canonical machine field; "on" and "off" are display words only. | §0, §4.11 |
| v6-12 | "One short statement" replaced by one shared rule: 1 to 200 code points, one line, not blank. | Intent block, Kanosei intent |
| v6-13 | Closed schema everywhere in M3: unknown field refused (`unknown_field`). No extension fields; a change is a spec revision. Pre-intent scripts load and assemble reports `intent_missing`. | Intent block |
| v6-14 | New rows T77 to T85 (S1 vectors, S2 pure and integration) and T61b (S5, see v6-17). T43 split: S2 keeps pull, restore and single carry; raft carry moves to T43r in S8. | §10.1, slices.md |
| v6-15 | New section §13: `tome`, the named immutable stream base. M4-deferred, pending Rich (Q-T1 to Q-T10). It is a proposed replacement for the named frozen view (NR-6, Q12); that replacement is pending Rich. | §13, §6, §11 |
| v6-16 | §6 no longer lists an undefined flow-log event token beside pull, carry and raft. | §6 |
| v6-17 | Snag report order is fixed (`moves`, `sides[]`, `lines`), found as an engine gap by the sample dry run. | §4.3 |
| v6-18 | assemble and inspect output fields are named `ops_derived` and `intent_reports` (snake_case). | Intent block, §4.11 |
| v6-19 | Test gate is explicit: `node --test m3/*.test.mjs`, and `m3/index.mjs` must import every `*.test.mjs`, enforced by `gate.test.mjs`. | §9, §10.2 |

---

## Changelog v4 -> v5 (keyed by DeepSeek question id)

Verdicts are in decisions.md. Each line names the section and what changed. Everything not listed is unchanged from v4 (+ PR #12 text).

| qid | change | section |
|---|---|---|
| Q1 | PR #12 `kind` enum removed. Authored `purpose` (closed) added. `op` is derived (`ops_derived`), not authored. `labels[]` not in M3. | Intent block (required) |
| Q2, ask_2a-g | Raft gains required `bind` and `bind_reason`, optional `tags`/`summary`, derived raft intent with `derive_algo` and hash, tag/summary change events. Authored raft-level intent refused. | §4.7 Raft record, Derived raft intent |
| ask_2d | Notice `needs_closure_large` from derived closure count; threshold is a repo_policy value (default 6). | §4.7, §3.1 |
| ask_2f | `bind_reason` is `{code, member_refs, text?}`. Refusal `raft_bind_reason_missing`. | §4.7 Raft record |
| Q3 | Kanosei `accept` becomes a list of `{kind, ref}` with a closed kind list. `intent_hash` is output only. | Kanosei intent |
| Q4 | A move pulls whole; a path or pool of a move cannot be pulled (`move_partial_pull`). | §4.2, §4.7 |
| Q5 | Sequencer guarantees stated for the flow log. No cross-site sequencer in M3. | §6 |
| Q6 | Kanosei events: open, join, pick, abandon. Status open/picked/abandoned. Closed kanosei refuse join. Members may be moves and rafts (DeepSeek's no-mixing rule rejected). Pulled-rival need is kind 4 with a label. | Kanosei (proposed) |
| Q7 | Not changed; needs Rich. v5 adds canonical field `in_play` in §4.11 output and keeps `pool`. | §0, §12 |
| Q8 | Intent codes fire as specified; implementation order recorded in slices.md. | §9 |
| Q9, ask_9a-c | Needs split into `needs_authored[]` and `needs_derived[]`; codes `needs_derived_missing`, `needs_authored_unproven`; single-edge waiver. | §4.9 |
| Q10, ask_10a-b | `parent_pool_missing` closed code and options. No reparent. (Behavior was already v4 T34.) | §4.9 |
| Q11 | `raft_incomplete` when carrying with a named source stream. Skip event not specified; new raft is the provisional continuation. | §4.7 raft_incomplete |
| Q-VCS1 | Every snag has a stream-independent `snag_id`; a resolution names it. | §4.3, §4.4, §A |
| Q-VCS2 | Snag payload gains `base` and flat `sides[]`. No term cancellation. | §4.3 |
| Q-VCS3 | Assembled view identity is commutative in the on-set (`view_hash`). DeepSeek's "No" rejected. | §4.11, §A |
| Q-VCS4 | Resolution `decision: order` with `ordered_sides`. | §4.4 |
| Q-VCS5 | `assemble --at <event>` is read-only. Rewind event parked. | §4.11, §11 |
| Q-VCS7 | One-snag-per-spot bound stated; scale test T65. | §4.3 |
| Q-VCS8 | `move_empty` refusal; no empty naming move. | §4.1 |
| Q-VCS9 | `decision: identical` closed; twin resolution travels with a raft (already v4 behavior). | §4.4, §4.5 |
| Q-VCS10 | Move-Id exists only for a checked-in signed move. | §1.1 |
| Q-VCS11 | Export refuses `preview_mismatch` when an approved preview id is given. | §4.8 |
| Q-VCS17, ask_vcs17a-c | Kanosei coexistence, derived links, pick consequences. Names provisional. | Kanosei (derived links) |
| Q-VCS6, 12-16, Q12 | Parked, not in M3 text. | §11 |

---

## 0. Kawa words

| Term | Meaning |
|---|---|
| **stream** | A named list of moves that are on. There is no "main" stream. |
| **move** | One signed, immutable change. It mints line records and entry records and switches older ones off. |
| **intent block** | Required signed block on every move (`targets`, `purpose`, `needs`, `reason`), and on a kanosei (`goal`, `targets`, `accept`). Written when the move is recorded or the kanosei opens. Kept in the flow log. Never consumed or deleted. |
| **seed** | The move that first creates a file or pool. The root seed cannot be pulled. |
| **carry** | Put a move's id into another stream. Records are not copied. The same Move-Id is the same change everywhere. |
| **pull** | Take a move out of play in one stream. The script stays. |
| **restore** | Put a pulled move back on. |
| **pool** | A directory node. Its contents are entry records. |
| **entry record** | "Node X is here under name N", minted by one move. |
| **line record** | One line of a file, raw bytes plus its line ending, minted by one move, never edited. |
| **snag** | An open conflict. It is computed from the stream. Nobody resolves it automatically. |
| **resolution move** | An ordinary move a person or bot checks in to record how a snag was decided. |
| **raft** | A named list of moves that carry together, as one flow-log event. Carries a required `bind` and `bind_reason`; its intent is derived, never authored (§4.7). |
| **kanosei** | (proposed) A named set of rival moves or rafts, each an alternative implementation of the same idea. Carries its own intent block. A reviewer assembles each member and carries one. A pick never pulls the others; pulling a rival is a separate reviewer event (NR-10 open). |
| **flow log** | The ordered list of stream events. |
| **in_play** | Machine field, `true` or `false`: the move is on in the stream. Canonical. The words "on" and "off" are display aliases for `in_play: true` and `in_play: false` and never appear as field names. |
| **tome** | (proposed, M4-deferred) A named, immutable freeze of a stream's on-set, used as a stream-open base. §13. |
| **open water / locked** | Open water (the default): concurrent edits land and snags show. Locked: an optional signed lock refuses other moves at check-in. |
| **notice** | Something the viewer shows that is not a snag. Notices do not block export, except a waiting move, which does. |
| **assemble** | A read-only preview: build a file or a pool view from a chosen move list, and report the snags and intent-block reports, without writing a stream or the flow log. |
| **site** | One place of work. Ids are site-scoped (`rich@desk`). |
| **twins** | A label on a kind 1 or kind 2 snag whose sides are byte-identical. Not a separate snag. |
| **order key** | A signed value on a move used only to display contested lines in a fixed order. |
| **snag id** | `snag_id`: a stream-independent hash of a snag's kind, contested spot and sorted participating moves (§4.3). |
| **view hash** | `view_hash`: hash of the sorted on-set plus policy. Equal on-sets give equal views (§4.11). |

**Provisional names (v5, unchanged in v6).** The names `coexistence`, `kanosei_link`, `pick`, and every closed list and new code in §12, are provisional until Rich answers needs-rich.md NR-1 and NR-2. The Japanese terms `heizon`, `en`, `kime` are not Kawa words in v5.

Idea Bin flagged three of these words (pull, raft, pool). v4 does not rename them. The flags are questions at the end.

## 1. The model in one page

A file is built from moves that say which lines are on and off. Its seed is the first lines. Each later move adds new line records and switches old ones off. A stream is a list of move ids. Carrying a change edits that list. It does not copy lines. A pool does the same for a directory.

| Layer | Role | If lost |
|---|---|---|
| Signed move scripts (line records, entry records, switch-offs, anchors, attributes) | Truth for content | Lost history; back these up |
| Signed flow-log events | Truth for which moves are on in each stream | Lost recipe; back these up |
| Weave and pool layouts | Built from the two rows above | Rebuild |
| Git trees and commits | An export | Nothing |

**One visibility rule.** A record (line, entry, or attribute) is visible in a stream when the move that minted it is on and no on-move switches it off. A resolution move's lines and switch-offs count only while that resolution is active (§4.4).

**Git is only an export.** Each clean stream can export as branch `kawa/<stream>`. The git default branch is a pointer the repo owner picks; changing it changes nothing in Kawa. A stream with any open snag, or a waiting move, does not export (§4.8). A plain git commit made outside Kawa is imported once, on one site, as a new signed move.

### 1.1 What is saved, and in what order

1. **The script is written first.** It is immutable and named by its id, so writing it twice is harmless. A check-in refused for `intent_missing`, `intent_invalid` or `move_empty` writes no script and no flow-log event, and the refusal order is fixed (Intent block (required), "Record-time refusal order"). **A Move-Id exists only for a signed, checked-in move.** No pre-check-in draft identifier is a Move-Id and none is reused as one (Q-VCS10; draft handling is parked, §11).
2. **The flow-log event is the commit point.** A move is on in a stream only when its event is in the log. The event is appended in one step.
3. **Replay after a crash:**
   - *Script with no event:* stored and off. The viewer shows an **unattached** notice. Nothing turns on by itself (T38).
   - *Event whose script is missing:* the move is **waiting**. The viewer names the site it is waiting on. Export holds. This is a notice, not a snag (T06). If the script arrives and fails its signature, the event is an event snag and the script is treated as absent.
   - *Half-built layout:* thrown away and rebuilt from scripts and events (T39).
4. Every flow-log write needs a kill test (stop between steps 1 and 2, and mid-step 2) before anything ships.

## 2. Files: line records

Every file is a **node** with a stable id that never depends on its path. Ids are site-scoped. Parts of an id are joined with `:`.

Each new line stores **both anchors**: `after` (the line the author saw just before it, or `START`) and `before` (the line just after it, or `END`). A replacement says which line it `replaces` and takes that line's slot. Each line stores its **raw bytes, line ending included**, so mixed endings come back exactly (CRLF, LF, or a mix in one file).

```yaml
# node n:seed.rich@desk.4:0   (shown at src/odbc.c; the path lives in the pools)
lines:
- {id: "L:seed.rich@desk.4:0", bytes: "#include <sql.h>\n", after: START, before: END}
- {id: "L:seed.rich@desk.4:1", bytes: "int open();\n",       after: "L:seed.rich@desk.4:0", before: END}
- {id: "L:seed.rich@desk.4:2", bytes: "int close();\n",      after: "L:seed.rich@desk.4:1", before: END}
```

**How lines line up.** Both anchors are required so an insert stays inside its gap when one boundary line is replaced.

1. Lines in one move's script keep the order they were written.
2. A new line sits strictly between its resolved `after` and its resolved `before`.
3. A replacement occupies the slot of the line it replaces. Its place comes from that line's anchors, not from a second copy of the text.
   Chain (D-M1-08): when the replaced line is itself a replacement, the slot is that of the first line in the chain; a switched-off replacement with no visible successor holds the slot as the tombstone. A line whose maker is off (pulled, or a dormant resolution) ends every walk along a `replaces` chain (D-M1-15): slot ordering, tombstones, anchor resolution, and the kind 1, kind 3 and kind 5 chain checks. The walk stops at that line, uses its anchors as the slot's position, and does not climb past it.
   Delete vs modify (D-M1-17, G-61): when one on-move's visible replacement holds a line's slot (directly or through the chain) and another on-move switches that line off with no replacement of its own, and neither move's `saw` lists the other, that is snag kind 1 (§4.2). The replacement stays visible. If either move's `saw` lists the other, the edit was sequential and it is not a snag.
4. If the `after` or `before` line was replaced, the anchor resolves to the visible replacement (or replacements) in that slot. The insert stays in the same gap. Replacing the right-hand line does not throw the insert out of the gap, and it does not by itself raise a snag.
5. If the anchor line was switched off and nothing replaces it, the line remains in the order graph as a **tombstone**: neighbors keep their places, the tombstone is omitted from the visible text, and the anchor is snag kind 5.
   Exception (D-K5-01): a line minted by the **same move** as its switched-off `after` or `before` anchor (that anchor's original neighbor) is not kind 5. A pure mid-file delete of B in seed lines A,B,C views `a\nc\n` and exports. A line from a later move that anchors on the switched-off line is still kind 5 (T07). A lost `replaces` anchor is never exempt.
   Exception (saw): when every on-move that switches off the anchor or any replacement of it reached through the `replaces` chain (D-M1-16) lists the anchored line's move in `saw`, the delete was made with that line in view, and it is not kind 5. An anchor whose slot is held by a visible replacement through a chain (rule 3) is replaced, not lost.
6. If two moves put lines in the **same gap** (the same `after` and `before` on the same node), that is snag kind 2. Kawa still shows them, in `order_key` order, then by position in the script, then by line id. That order is display only. It is not a decision, and it does not follow who checked in first (T03).
7. A **redaction** is a tombstone event on a line. The line id stays. The script keeps the original bytes (signatures cover them). Assemble and export show the redaction marker instead. A leaked secret still needs rotating.

**Minting lines (mint-v1, G-49).** A tool that turns a before-view and after bytes of one file node into line records uses `derive_algo: mint-v1`. Split after each `\n` (the `\n` stays on the line; a lone `\r` does not split; a last line without `\n` is a line). Keep the common prefix, then the common suffix. Align the rest by longest common subsequence (LCS) over exact line bytes. Walk both sides from their first remaining line to the end: when the before line and the after line are equal, keep both; otherwise, when switching off the before line leaves an LCS of the remaining lines at least as long as adding the after line does, switch off first (deletions first); otherwise add the after line. In each run between two kept lines, the k-th new line `replaces` the k-th switched-off line; extra new lines are plain inserts and extra switch-offs stand alone. A new line's `after` is the line before it in the after-view (`START` at the top) and its `before` is the next kept line (`END` at the bottom). Line ids are `L:<move>:<n>`. Both sides are strings in the stored line-byte encoding; mint never normalizes line endings (D-M1-14). Reference: `m3/mint.mjs`.

**`saw` (G-60).** `saw` is a list of move ids on the script. A move minted with mint-v1 lists the makers of its before-view lines (D-M1-06); a move that mints several nodes lists the union, unique and sorted. A move written another way (by hand or by another tool) supplies `saw` itself: the moves whose lines were visible to its author when the move was made. A missing `saw` is an empty list: the move saw nothing, and no saw exemption applies on its side. The engine does not check `saw` against history; it uses it as written. `saw` only feeds the saw exemptions of kind 1 (delete vs modify), kind 3 and kind 5.

`eol` and `encoding` are display hints. Export writes the stored bytes and turns git newline conversion off. A line that is not valid UTF-8 is still a line.

Attributes (`kind`, `mode`, symlink target, whole-content bytes) use the same visibility rule. Two visible values for one attribute key is snag kind 10. A later move that switches the old value off is clean. A binary file stores whole-content records instead of lines. Nothing is dropped.

## 3. Directories: pools

A **pool** is a directory node. Its contents are entry records. Each entry lives only in its parent pool's list.

```yaml
# pool p:seed.rich@desk.1:0   (the stream root)
entries:
- {id: "E:seed.rich@desk.1:0", node: "p:seed.rich@desk.1:1", name: src, by: seed.rich@desk.1}
```

A path is a view: start at the root, follow visible entries. Paths inside Kawa always use `/`, on every operating system. **Reachability is a second check.** After the walk from the root, Kawa visits pools that have visible entries but cannot be reached. Anything found there is an orphan snag (kind 8). The viewer offers two choices: restore the pool, or move the file elsewhere.

Rules:

- **One visible entry per node.** No hard links. A copy is a new node.
- **Names are one path segment.** No empty names, `.`, `..`, or slashes.
- **Case and Unicode follow one signed repo policy**, applied the same on every site. `Readme` and `README` both visible is a snag on every machine, not only on Windows (T14).
- **The root seed cannot be pulled.** Pulling it would orphan everything.
- A move that conflicts with itself (a cycle, two names for one node, two values for one attribute, a duplicate name, a forbidden name) is refused at check-in (T19). Snags are only between moves.

| Operation | What the move writes | After a pull | Carry needs |
|---|---|---|---|
| Create file or pool | New node + entry in parent | Entry hidden; node kept | Parent pool reachable in the target |
| Rename | Off old entry + new entry, same node, same pool | Old name back | Old entry visible |
| Move between pools | Off entry in A + new entry in B | Back in A | Both pools reachable |
| Delete | Off the entry only (contents untouched) | Back, with its current contents | The entry visible |
| Empty pool | Pool node + entry, no children | Kept | As create |
| Case-only rename | Off `Readme` + new `README` in one move | As rename | As rename |
| Pool → file at the same name | Off the pool's entry + entry for a **new** file node | Pool and contents back | Pool entry visible |
| File → pool at the same name | Off the file's entry + entry for a new pool | File back | File entry visible |

A node never changes between pool and file. That always mints a new node.

**Empty pools in git.** Git cannot store an empty directory. Export writes a reserved placeholder, `.kawa-keep`. Import recognizes it and does not turn it into a real file.

**Restoring a deleted node** shows its lines as they are now, including edits carried in while it was deleted (T35). That is intended.

### 3.1 Paths, case, and Windows

Node ids never depend on paths, so a worktree path cannot change what a stream contains. The worktree, where real files meet Kawa, still has rules:

- **Inside checks** compare canonical path segments, never a text prefix. `wt2` is not inside `wt`. `.` and `..` are resolved. Short 8.3 names are mapped to long names before the compare. Case is folded only where the local filesystem folds it (Windows, and usually macOS), drive letter included.
- **The repo policy** is one signed flow-log event. The reference default is:

```yaml
event: policy.rich@desk.1
kind: repo_policy
names:
  case: insensitive
  unicode: nfc          # compared after NFC; stored bytes stay as written
  forbidden: windows    # CON, NUL, trailing dot or space, <>:"|?* and so on
  max_path: 259
```

- A name that breaks the policy is refused at check-in. A later policy event that makes existing names collide exposes those collisions as snags, tagged with the policy event.
- A move that would make any exported path longer than `max_path` is refused at check-in, with the path named (T40). The same check runs when a rename lengthens paths under a pool.
- Lines keep raw bytes. Export does not convert newlines.

## 4. Conflict management

Conflict management is the centerpiece. Kawa never resolves a conflict by itself. It finds snags, shows them, and records a person's or a bot's decision as a resolution move.

### 4.1 Open water by default

Many bots, and any people with them, may change the same file in the same stream at once. Each move is checked in against the lines its author saw (`saw` lists those moves when it matters). If the stream has moved on, the move still lands, and any snag it causes is shown.

Two bots inserting into different gaps of the same file do not snag. Two bots replacing the same line do. Both moves stay on until someone checks in a resolution. Kawa does not pick a side.

**When Kawa refuses instead of snagging:** a move that conflicts with itself or breaks repo policy (§3, §3.1); a move on a locked node (§4.6); a carry whose needs are not met (§4.9); a move recorded with a missing or schema-invalid intent block (`intent_missing`, `intent_invalid`; Intent block (required)); a move with no records and no `resolves` section (`move_empty`; "records" is defined in Intent block (required)); a resolution whose `snag_id` or `decision` does not match (`resolution_invalid`; §4.4); adding a kanosei member whose `kanosei` field does not name that kanosei (`kanosei_mismatch`; Kanosei intent). Check-in, pull, and restore are never refused for causing snags. They land, and the snags show.

### 4.2 Kinds of snag

| # | Snag | When it happens |
|---|---|---|
| 1 | **Same line replaced twice** | Two or more on-moves each put a replacement in the same line's slot; or one on-move puts a replacement in the slot and another switches the line off with no replacement, neither listing the other in `saw` (delete vs modify, D-M1-17). |
| 2 | **Same-gap inserts** | Two or more on-moves add lines in the same gap (same node, same `after`, same `before`). |
| 3 | **Insert beside a replaced line** | An insert's `after` anchor is a line that another on-move replaces, and the inserting move did not see that replacement. See below. |
| 4 | **Missing need** | An on-move anchors on, replaces, or switches off a line whose maker is off. If the maker's script has not arrived, the move is **waiting** (a notice), not this snag. |
| 5 | **Anchor lost** | An on-move anchors on a line that another on-move switches off, and nothing replaces that line. |
| 6 | **Twin** | Not a separate snag. A label on a kind 1 or kind 2 snag whose sides are byte-identical (§4.5). |
| 7 | **Name collision** | Two visible entries with one comparable name in a pool, or one node under two visible names. |
| 8 | **Orphan** | A visible entry whose pool cannot be reached from the root. |
| 9 | **Cycle** | Two or more on-moves together put a pool inside itself. |
| 10 | **Attribute** | Two visible values for one attribute key. |
| 11 | **Exposed by an event** | A tag on one of the above when a pull, restore, carry, raft pull, or policy event is what made the snag appear. One problem stays one snag. |
| E | **Event snag** | Two sites' flow-log events fork from one parent and the later one's meaning changed (§6), or an event's script fails its signature. |

**Kind 1, precisely.**

- Through a chain (§2 rule 3, D-M1-18): a visible replacement holds every slot up its `replaces` chain. Two visible replacements from different on-moves that reach one slot through different links are kind 1 at that slot. Replacements that reach a slot through a shared link meet at that link first; kind 1 is reported there, once. The chain walk is the §2 rule 3 walk and ends where §2 rule 3 ends it.
- Delete vs modify (D-M1-17, G-61): a line is switched off by an on-move that has no line replacing it (the deleter), and a visible replacement from another on-move holds the line's slot, directly or through a chain. Kind 1 fires at that line when neither the deleter's `saw` lists the owner's move nor the owner's move's `saw` lists the deleter. The replacement stays visible. Arrival order does not matter.
- Through a chain, the visible owner decides (same rule as kind 3, D-M1-13): an intermediate link whose maker did not see the deleter does not raise kind 1 when the visible owner's move saw it.
- A move whose `resolves.inputs` lists the deleter or the owner's move, while that resolution is active, counts as having seen it for this check (§4.4). A resolution that keeps the replacement, or one that switches it off, ends the snag.
- Settled deleter (D-M1-21): while a resolution is active (§4.4), a deleter listed in its `resolves.inputs` is not a deleter at any slot listed in its `resolves.contested`. A later edit of the line the resolution kept (for example a mint-v1 edit, whose `saw` cannot list a pure deleter, G-63) does not raise kind 1 against that deleter again. A deleter the resolution does not list is not settled. When the resolution goes dormant, its deleters count again.
- A deleter is a side with `lines: []` and `bytes: ""`. A snag with a deleter side is never twin. When the same slot also has two replacements, it is still one kind 1 snag listing every side.
- Not kind 1: replacing a line and then deleting the replacement in a later move that saw it (the slot is empty; kind 5 rules apply to anchors). A deletion with no visible replacement in the slot.
- Known limit (G-63): mint-v1 `saw` lists the makers of visible lines (§2 minting). A move that only switched lines off has no visible line, so a later minted edit of the surviving replacement does not list it. Before a resolution, the snag stays until a resolution, a `saw` that names the deleter, or a switch-off of the replacement. After an active resolution lists the deleter, the deleter is settled (D-M1-21) and a later edit does not bring the snag back.

**Kind 3, precisely.** This is the ambiguous case, not every neighbor of a replaced line.

- Kind 3 fires when an in-play insert uses a replaced line as its **`after`** anchor (the left edge it attached to), and `saw` does not include the replacing move. Assemble still places the insert after the replacement, and reports the snag, so the caller sees both the text and the break (T04).
- An insert that only names the replaced line as its **`before`** anchor is not kind 3. The left edge is intact. The gap rule keeps the insert beside that slot. In the worked example, the extra include sits before `int open();` and stays clean when that line is replaced.
- A line minted by the **same move** as the anchor (the original next line of that move) is not kind 3. Ordering slides it to follow the replacement.
- If `saw` includes the replacing move, the author did see the replacement, and kind 3 does not fire.
- If the replacing move's `saw` includes the inserting move, the replacement was made with the insert in view, and kind 3 does not fire.
- Through a chain (§2 rule 3, D-M1-13): the slot owners of the `after` anchor (visible lines that hold the anchor's slot, reached directly or by walking the `replaces` chain through switched-off links) are the replacing lines. The `saw` checks above apply to each slot owner.

**Kind 4 is the missing need.** The maker move of a required anchor or switch-off is not in play. That is what a carry refuses (§4.9). A pull or restore that exposes it lands, and the snag is tagged with that event (T26).

**Kind 4 label `kanosei_link_orphaned`.** A kind 4 snag whose missing maker is a pulled, unpicked member of a kanosei carries this label (Kanosei, derived links). It is a label like twin, not a twelfth kind. It is tagged 11 by the pull that exposed it.

**A move is pulled whole.** Pull takes a move id. A path, file or pool of a move is not a pull target; a request naming one is refused `move_partial_pull` and no event is written (Q4). To take part of a move, check in new moves that carry the part and pull the original.

**Kind 5 is a deleted anchor.** The maker is on, the line is off, and there is no replacement. The tombstone keeps the order. The snag says the anchor is gone (T07).

**One problem, one snag.** Kawa reports one snag per contested spot (one line slot, one gap, one lost anchor, one pool name, one node, one attribute key), listing every move involved. Three replacements of one line are one kind 1 snag with three sides.

**Not snags:** two moves switching off the same line with no replacement; edits to neighboring but separate gaps; a later move that replaces a line an earlier on-move added (a normal follow-on edit, not two replacements of the same slot).

### 4.3 How an open snag is shown

Both moves stay **on**. The snag is computed, not stored, so it cannot go stale. A stream with a snag still builds. Assemble returns that best-effort text **and** the structured snags. Callers need both: the preview of move 10 on an older stream shows `runSafe()` and, beside it, the missing need.

Each snag carries its `snag_id`, kind, path when it has one, the moves involved as a flat `sides[]` (every move once, never nested), a `base` (the replaced line, the gap, or the contested node), each side's bytes, the event that exposed it when kind 11 applies, and any dormant resolution text offered as a choice. Each move is **off**, **on and clean**, or **on with a snag**. Notices are listed separately.

**Order inside a snag report (v6).** `moves` is sorted by move id (UTF-16 code unit order). `sides[]` is ordered by the move's `order_key` (the §2 comparison), then by move id. `lines`, where a snag lists line ids, follows the `sides[]` order, then script order. None of these depends on the order in which moves arrived or events were applied, so the equal-view promise (§4.11) holds for snags with three or more sides. The reference engine at v5 sorts `moves` and `sides` but not `lines` (found by the sample run, sample-run/dry-run-results.md); S5 T61 adds a three-side case.

**`snag_id`** (Q-VCS1). `snag_id = hashOf({derive_algo: "snag-v1", kind, contested, moves: sorted participating move ids})` using the canonical form in §A. Two streams with the same kind, the same contested identity and the same participating moves report the same `snag_id`. It names a snag; it does not resolve it. Kind 11 tags and exposure events are not part of it.

**Report size** (Q-VCS7). One snag per contested spot bounds a report to the number of spots, not the number of pairs of moves. Event snags are grouped by site (§6). v5 adds no caps; test T65 checks that many sites merging the same moves in different orders give the same `snag_id` set.

### 4.4 The resolution move

A person or bot clears a snag by checking in a resolution move. It is an ordinary signed move plus a section that says what was decided. Kawa never writes this section itself.

```yaml
move: move.rich@desk.122
resolves:
  kind: same_slot
  snag_id: "sha256:..."                             # recomputed at check-in; mismatch is resolution_invalid
  identical: false
  inputs: [move.rich@desk.118, move.joy@lap.121]   # all must be on
  absent: []                                        # all must be off
  contested: ["L:seed.rich@desk.4:1"]
  saw: ["L:move.rich@desk.118:0", "L:move.joy@lap.121:0"]
  decision: new_text
  note: "new text combining both"                   # optional, one line, never parsed
records:
  off: ["L:move.rich@desk.118:0", "L:move.joy@lap.121:0"]
  lines:
  - {id: "L:move.rich@desk.122:0", bytes: "int open(int flags, int mode);\n", replaces: "L:seed.rich@desk.4:1"}
```

**Decision values (closed, provisional, §12).** `new_text`, `keep_one`, `identical`, `order`, `remove`. `snag_id` MUST equal the id Kawa computes from `kind`, `contested` and the sorted `inputs`; otherwise check-in refuses `resolution_invalid` and stores nothing. `note` is optional and never parsed.

**Order-only resolution (kind 2).** `decision: order` with `ordered_sides: [move ids]`, a permutation of the snag's sides, and no new bytes. While the activity rule below holds, the stored order replaces `order_key` display order and export uses it. It is a recorded decision, not a display hint. It goes dormant when a third side lands or `saw` stops matching; Kawa never reorders by itself.

**Empty-record resolutions (v6).** A move with a `resolves` section is never `move_empty`, even when all seven record arrays are empty. An order-only resolution is therefore valid with no records: the flow-log record event is non-empty because it carries the `resolves` section and the intent block. `ops_derived` of such a move is `[]`. A resolution with `decision: remove` MUST switch off at least one record (`off`, `entryOff` or `attrOff` non-empty); otherwise `resolution_invalid`. Decision-specific record shapes for `new_text`, `keep_one` and `identical` are fixed in S4, not in S1 or S2.

**When it counts.** A resolution is active only while every `inputs` move is on, every `absent` move is off, and the visible records in the contested spot, ignoring this resolution's own lines and switch-offs, are exactly the ones it `saw`. Otherwise it is **dormant**: its lines and switch-offs stop counting, and the viewer says why (`move.122 dormant: input move.joy@lap.121 is off`). When the conditions hold again it wakes. A dormant resolution is never deleted.

- Spot (D-M1-20): the visible records in the contested spot are each contested line that is visible, plus each visible replacement whose `replaces` chain reaches a contested line. The chain walk is the kind 1 walk (§2 rule 3, §4.2 "Kind 1, precisely"): it climbs through lines that are not visible and stops at a visible line or at a line whose maker is off (D-M1-15). A resolution whose `saw` is exactly the `lines` of a kind 1 snag at that spot matches it, including a snag reached through a chain.
- One active set (D-M1-19): activity is computed once for the whole on-set as one fixed point. Order the on resolutions by `order_key` (the §2 comparison), then by move id (UTF-16 code unit order). Start from the empty set. Add the first resolution in that order that holds given the set chosen so far and whose addition keeps every already-chosen resolution holding; then start the walk again from the first resolution. Stop when a full walk adds nothing. Each chosen resolution holds given the others. A resolution left out either does not hold, or would stop an earlier-chosen one from holding; it is dormant with reason `spot changed`. Two resolutions of one spot that saw the same records therefore give one active resolution (the first in that order) and one dormant one, never zero active and never both. Arrival order does not matter.

If a new move lands in the spot of an active resolution (T29), the resolution goes dormant and a fresh snag lists every side, including the dormant resolution's text as a choice, so nobody has to retype it.

### 4.5 Twins

- **The same move carried twice cannot duplicate.** A carry adds the id. If it is already on, no event is written, and the reply is `already on in dev; nothing to do` (T10).
- **Two separate moves that make the same change** are one snag of kind 1 or kind 2, labelled **twin** when the sides are byte-identical (T02, T08). The label is not a second snag.
- **Choices:** keep one side's lines, or the other's, or write new text. The viewer says the bytes match, so the choice is whose move carries the line and its history. The resolution records `identical: true` and `decision: identical` (or `keep_one` when one side's lines are kept). Kawa does not pick. The twin resolution is one signed move; it travels with a raft carry (T30, T32), is active only while both sides are on and `saw` matches, and a third side makes it dormant and raises a fresh snag (Q-VCS9).
- A single common line (a blank line, or a lone `}`) does not get the twin label. It is a plain kind 2 snag (T09).
- A twin that arrives later by carry or raft carry gets the same check, tagged with that event (T11, T32).

### 4.6 Locked mode

A stream, or one node, can be **locked** by a flow-log event. While the lock is held, other moves that touch that node are refused at check-in. Locks are off by default. Pull the lock with an unlock event. Carry is not a check-in; the lock does not block it.

### 4.7 Rafts, and transitive needs

A raft is a **signed flow-log event that names a list of moves**, for example `open-sig = [118, 121, 122]`, plus a required `bind` and `bind_reason` (Raft record). It is a label, not a container. A move may sit in more than one raft. Scripts are never copied.

- **Carrying a raft is one flow-log event, all or nothing** (T30). Every member's **derived** needs (§4.9 `needs_derived[]`, including pool preconditions and resolution inputs) are checked against the target plus the other members first. If any derived need falls outside that set, the whole carry is refused `needs_derived_missing` and the stream is unchanged. There is no partly carried raft. Authored-only needs follow the single-carry rule: notice `needs_authored_unproven`, no refusal. A raft carry applies the same derived/authored distinction as one move's carry, once per member.
- **Members already on** are skipped and named. That is not a failure.
- **A member with a twin already in the target** still carries. The twin snag then shows, tagged by the carry (T32). Kawa does not drop the member.
- **Pulling one member is allowed** (T33). The raft then shows a **partly on** notice (`open-sig: 2 of 3 members on`). That notice does not block export. Pulling the whole raft is one event too.
- **`--with-needs` is transitive.** Move 10 needs 7, and 7 needs 6, so the group is `10 → 7 → 6`. A carry computes the whole closure, deps first, and names it (`needs:10 = [6, 7, 10]`). It does **not** add those moves unless the caller passes `with-needs`. One event then carries the group. Silent extra moves are a bug. The reference engine returns the group on both the refusal and the successful carry.

#### Raft record

The raft-define event is signed and carries:

```yaml
raft: open-sig
members: [move.rich@desk.118, move.joy@lap.121, move.rich@desk.122]
bind: atomic                      # required, closed list, fixed at creation
bind_reason:                      # required
  code: needs_edge                # closed list
  member_refs: [move.rich@desk.118, move.rich@desk.122]   # one or more, each a member
  text: "122 resolves 118 and 121"   # optional, <= 200 chars, never parsed
tags: [fix]                       # optional, <= 8
summary: "open() flags and mode"  # optional, one line, never parsed
derive_algo: raft-v1
derived_hash: "sha256:..."
```

- `bind` is one value from the closed list in §12. Missing: `raft_bind_missing`. Not in the list, including `other`: `raft_bind_invalid`. `bind` never changes; a different bind is a different raft.
- `bind_reason` missing, or missing `code` or `member_refs`: `raft_bind_reason_missing`. `text` over 200 characters, `member_refs` that are not a subset of `members`, or an unknown `code`: `intent_invalid` naming `bind_reason`.
- A raft-define event that carries an authored intent block is refused `intent_invalid`. Raft intent is derived, always; there is no case in which a raft outside a kanosei carries authored intent. The raft event never touches the intent blocks of its member moves; those stay on their own record events.
- `tags` have no effect on carry, pull, snag or export. Core tag values are closed (§12); an unknown core tag is a notice; an unknown `x-` tag is ignored; a tag that contradicts the derived intent is a notice. Tags and `summary` change only by signed, append-only flow-log events, also after a carry. A fork of two such events follows §6. Clearing tags leaves `bind` and `bind_reason` untouched.
- `bind` is routing and identity; `tags` are discovery; the two vocabularies are not merged.
- A raft-define event that is refused writes nothing.

#### Derived raft intent

`kawa raft view --json` returns one deterministic object per raft:

```yaml
id: open-sig
bind: atomic
tags: [fix]
summary: "open() flags and mode"
derived:
  targets: [sorted union of member targets]
  needs: [sorted union of member authored needs, minus members]
  ops: [sorted union of members' ops_derived]
  purposes: [sorted union of members' purpose]
  member_count: 3
  needs_closure_count: 3        # distinct moves in the transitive derived-needs closure, members included
  derive_algo: raft-v1
  hash: "sha256:..."
```

- `derived` is computed by assemble and the view. It is never authored.
- `hash = hashOf(derived without hash)`. At raft creation the event stores `derive_algo` and `derived_hash`. A recompute with the same `derive_algo` that differs from the stored hash is `raft_intent_drift`: a refusal on carry and assemble, nothing appended. A different `derive_algo` is a notice, and the view is recomputed.
- Notice `needs_closure_large` when `needs_closure_count` is at least the repo_policy value `needs_closure_notice` (default 6). It is never a refusal and an author `risk:` tag neither creates nor suppresses it.

#### raft_incomplete

A raft carry may name a source stream (`carry raft R --from S`). If any member of R is not on in S, the carry is refused `raft_incomplete {raft_id, missing_members[], stream, cause}` with `cause` in `member_pulled`, `member_never_on`. Nothing is appended and no remaining member is carried. The carry proceeds once the member is restored. Without `--from` the v4 rule applies: the raft carries by its member list, all or nothing.

Provisional continuation (needs Rich, NR-5): to carry only the remaining members, define a **new raft** naming them, with its own `bind` and `bind_reason`. v5 does not define a skip event.

### Kanosei (proposed)

A kanosei is a named set of rival moves or rafts. Each member is an alternative implementation of the same idea. Rich suggested the word.

- Members are shown side by side as alternatives, not as a snag.
- A reviewer (bot or person) runs assemble on each member against the target stream.
- The pick is a carry recorded as one signed flow-log event. The event names the kanosei and the chosen member.
- A pick does not pull the other members. A reviewer may pull a rival with a separate pull event; a pulled rival is pulled, not deleted, and can be restored (NR-10 open: whether a pick should pull rivals).
- Nothing is picked automatically.
- Another bot may add a member while the kanosei is open.

Intent for a kanosei, its members, and its pick is specified in Kanosei intent.

**Lifecycle (Q6).** Four signed flow-log events: `kanosei.open` (carries the kanosei intent block), `kanosei.join` (adds one member, a move or a raft, with member intent), `kanosei.pick`, `kanosei.abandon` (`{kanosei, reason}`, carries nothing). Status is derived from the events: `open`, `picked`, `abandoned`.

- Join is allowed only while `open`. After `pick` or `abandon` the kanosei is closed: a join, or any change to it, is refused and nothing is appended. A closed kanosei is never mutated.
- Reopening is a new kanosei id with its own intent block (provisional; question to Rich, NR-9).
- Members may be moves and rafts in one kanosei. (DeepSeek's no-mixing rule is not adopted: PR #11 defines the members as rival moves or rafts, and a pick names exactly one member either way.)
- Two sites joining different members against one `parent_event` follow §6; no pick follows from it.

**Coexistence (provisional name).** `coexistence` is a derived state: two or more members of one open kanosei are on in separate streams. It is shown in the kanosei view and is never a snag.

**Derived links (provisional name `kanosei_link`).** A link is a derived relation: a move that is a member of kanosei B has a derived need (§4.9) on a move that is a member of kanosei A. Links are recomputed from needs on demand. They are never authored and never stored as truth (ask_vcs17a). assemble of a candidate pick lists, for each link, what the pick would leave unpicked, without writing anything.

**Pick consequences.** A pick is a carry of the chosen member. Unmet needs refuse it before anything lands: `pick_needs_unmet`, wrapping the §4.9 refusal and its needs group. A valid pick does not remove other members. When a reviewer later pulls a rival, any on-move that needs it gets a kind 4 snag, tagged 11 by the pull, with label `kanosei_link_orphaned`. Kawa never re-points a need to another member and never removes a member silently.

**Open questions (for Rich).** Whether picking auto-pulls the others (NR-10). v5 and v6 rule: it does not; the reviewer pulls rivals with separate events. Option B of NR-10 would change that rule. Whether a kanosei can be re-opened after a pick (v5 text: no, new id; NR-9). Names for coexistence, links and pick (NR-1).

### Intent block (required) [S1-S2]

Every move MUST carry an intent block.

- The intent block MUST be written when the move is recorded (check-in).
- The intent block MUST be signed with the move. The move signature covers the block.
- The flow log MUST keep the intent block permanently. The record event MUST store the same signed block, byte-identical after canonicalization (§A).
- The intent block MUST NOT be consumed.
- The intent block MUST NOT be deleted.
- pull, restore, carry, and a raft event MUST NOT drop the intent block.

A missing or schema-invalid intent block MUST be refused at record time. The move MUST NOT be stored. The flow log MUST NOT be appended. Refusal, not a snag. Snags are reserved for conflicts.

**Record-time refusal order.** Exactly one refusal is returned per attempt: the first row that matches. No later row is evaluated.

| # | Check | Code |
|---|---|---|
| 1 | Move id already recorded (existing v4 refusal) | unchanged |
| 2 | `intent` key missing, or its value is `null` | `intent_missing` |
| 3 | Intent block fails the schema below | `intent_invalid` |
| 4 | No records and no `resolves` section | `move_empty` |
| 5 | Move conflicts with itself, locked node, `max_path` (existing v4 refusals, in their existing order) | unchanged |

**Refusal shape.** `{ok: false, refused: true, code, field, reason, message}`. `field` is an RFC 6901 pointer into the check-in payload (for example `/intent/targets/0/node`); it is `/intent` for `intent_missing` and `/` for `move_empty`. `reason` is one value of `intent_invalid.reason` in §12 and is absent for the other codes. Exactly one `field` is reported (the first failure, see "Validation order").

**Records.** The *records* of a move are the seven arrays of its script: `nodes`, `entries`, `entryOff`, `lines`, `off`, `attributes`, `attrOff`. A move has records when at least one of the seven is non-empty. A redaction is a repo event (§2), not a move record; there is no redaction-only move. A move with a `resolves` section is never `move_empty` (§4.4).

**Schema (closed).** The intent block is a JSON object with exactly the keys `targets`, `purpose`, `needs`, `reason`. Every key is required. An unknown key at any depth is refused `intent_invalid` with reason `unknown_field`; this includes the v4-draft field `kind` and any authored `op`. There are no extension fields in M3: every signed M3 payload is a closed schema, and a change to a schema is a spec revision. `needs` MAY be an empty list; no other field may be empty.

| Field | Rule |
|---|---|
| `targets` | Array of 1 to `list_max` (64) target elements. Each element is an object with exactly one key `node`, whose value is a node id (grammar in §12). Duplicate node ids are refused (`duplicate`, field is the later index). |
| `purpose` | String, exactly one value of the closed list in §12 (provisional: `feature`, `fix`, `refactor`, `docs`, `test`, `perf`, `chore`, `security`). Case-sensitive. An `x-` value is `not_in_list`. |
| `needs` | Array of 0 to `list_max` (64) move ids (grammar in §12), kept in authored order. Duplicates are refused (`duplicate`). The move's own id is refused (`self_reference`). |
| `reason` | A statement string (Statement rule). |

**Statement rule** (`reason`, kanosei `goal`, member `approach`, pick `reason`; there is no "short"). Checks in this order: type is string (`wrong_type`); no lone surrogate (`lone_surrogate`); not empty (`empty`); not blank, meaning at least one code point is not Unicode White_Space (`blank`); no C0 control code point U+0000 to U+001F, no U+007F, no U+0085, U+2028 or U+2029 (`control_char`; this makes a statement one line); at most `statement_max` (200) Unicode code points (`too_long`). No normalization is applied and none is checked; length counts code points, not UTF-16 units.

**Targets.** A target is identity, not a path. `{node}` names a node id; the node kind (file or pool) comes from the script store, not from the id. A rename, a move between pools, or a delete and restore changes the path of a node and never changes the target. The node MUST exist in the local script store (minted by a stored move) or be minted by this move; it need not be reachable, on in any stream, or visible. Otherwise `unknown_node`. Paths never appear in the signed block. A tool that accepts a path from a caller resolves it to a node id before check-in, against the view of the target stream plus this move for a created or renamed node, and against the view before the move for a removed node. That resolution is tooling and is outside S2. Reason for choosing node ids: §2, §3 and §4.9 already make a node id the identity and a path a view; a path in a signed block would hash differently after a rename, and two implementers could record different things for one change. Open question: NR-13.

**Needs.** At record time `needs` is checked for grammar, duplicates and self-reference only. Record time MUST NOT require each id to be on in the target stream and MUST NOT require the script to exist. Authored needs are intent data. They are never carry preconditions (§4.9): assemble reports them (below) and a carry gives the notice `needs_authored_unproven` when the edge is authored-only.

**Validation order.** The first failure wins. Within `intent`: (1) value is an object, else `wrong_type` at `/intent`; (2) unknown keys, checked in UTF-16 code unit order of the key, `unknown_field` at `/intent/<key>`; (3) required keys in the order `targets`, `purpose`, `needs`, `reason`, `missing` at `/intent/<key>`; (4) values in that same field order. For one field: type (`wrong_type`; `null` is `wrong_type`), then bounds (`empty` for an empty `targets`, `too_many`), then each element by ascending index (element type, unknown key inside an element, id grammar `bad_id`, existence `unknown_node` or `self_reference`), then duplicates (reported at the later occurrence). A value that the canonicalizer would refuse (§A, for example a number where a string is required) is `wrong_type`; a string with a lone surrogate is `lone_surrogate`.

| Case | Code | `field` example |
|---|---|---|
| Intent block absent or `null` | `intent_missing` | `/intent` |
| Intent block fails the schema | `intent_invalid` | `/intent/targets/1/node` |

**Backward compatibility.** The M3 reference engine has no signed repositories outside its fixtures. A stored script that has no intent block (written before S2) loads. check-in of the same shape is refused `intent_missing`, and assemble reports `intent_missing` for such a move in a preview. There is no migration step. A stored block with the v4-draft field `kind` loads and assemble reports `intent_invalid` (`unknown_field`, `/intent/kind`).

**Derived operations (`ops_derived`).** The operation of a move is derived, never authored. It is a *set* drawn from the closed list `add`, `change`, `remove`, `rename`. It is output sorted in §12 order, which is identical to lexical order. Each record row below is evaluated independently and the results are unioned. The move's own script and the stored scripts (for the entries, lines and attributes it switches off) are the only inputs.

| Row | Records in this move | Op |
|---|---|---|
| R1 | A new node in `nodes` | `add` |
| R2 | A new entry for node N, with an `entryOff` entry of the same node N in this move, in a different pool or with a different name (byte comparison; case-only change counts) | `rename` |
| R3 | A new entry for node N, with an `entryOff` entry of the same node N, same pool, same name | `change` |
| R4 | A new entry for node N with no `entryOff` entry of node N in this move | `add` |
| R5 | An `entryOff` entry with no new entry for the same node in this move | `remove` |
| R6 | A new line with `replaces`, or a new line without `replaces` for a node that this move did not mint | `change` |
| R7 | A new line without `replaces` for a node minted by this move | none (covered by R1) |
| R8 | An `off` line that is replaced by a new line of this move. A line is replaced when a new line has `replaces` equal to it or equal to any line in its `replaces` chain (same slot). | none (covered by R6) |
| R9 | An `off` line not replaced by any new line of this move | `remove` |
| R10 | A new attribute for a node that this move did not mint | `change` |
| R11 | An `attrOff` attribute, with a new attribute for the same node and key in this move | none (covered by R10) |
| R12 | An `attrOff` attribute with no new attribute for the same node and key | `remove` |
| R13 | A `resolves` section | none; ops come from the records only |

Consequences: create file or pool = `[add]`; copy = `[add]` (a copy is a new node, §3); delete = `[remove]`; rename, case-only rename and move between pools = `[rename]`; replace a line = `[change]`; pool to file at one name = `[add, remove]`; attribute or mode edit = `[change]`; content plus rename = `[change, rename]`; an order-only resolution = `[]`. Redaction is not an op. A move with at least one record has a non-empty set. `rename` also covers a move between pools: the closed list has no fifth op, and adding one (for example `relocate`) is an NR-2 question. An off id that cannot be resolved in the local script store counts as `remove` and assemble adds the notice `ops_derived_partial` listing those ids. The fixtures give move 117 = `[change]` and move 118 = `[change, rename]`. A reference classifier checked 23 rows against the fixtures (evidence/ops-derived-reference.mjs).

```yaml
intent:
  targets: [{node: "n:seed.rich@desk.4:0"}, {node: "p:seed.rich@desk.1:1"}]
  purpose: feature
  needs: [move.rich@desk.117]
  reason: "replace the open() line in src/db.c"
```

**assemble (§4.11).** assemble MUST validate the intent block of every move in the preview, with the same checks and order as check-in rows 2 and 3. assemble MUST report each move id listed in `needs` and absent from the plan, in `needs` order, with code `intent_need_absent` and a `provenance` field: `derived` when the same edge is a derived need (§4.9), `authored_only` otherwise. That report MUST NOT be a snag. It also reports `ops_derived` per move. **Output fields (v6).** `assemble` and `inspect` return two top-level fields, both snake_case like the record fields: `ops_derived`, an object mapping each move id that has a script to its sorted op list, and `intent_reports`, an array of report entries in plan order, each `{code, move, ...}` (`field` and `reason` for `intent_missing` and `intent_invalid`; `need` and `provenance` for `intent_need_absent`; `ids` for the notice `ops_derived_partial`). Both fields are always present, empty when there is nothing to report. They are not in `snags`, `notices` or `blockers`. Three independent S1-S2 builds chose `ops`, `opsDerived` and `ops_derived`, so the names are fixed here (build-findings.md G-04).

**Determinism.** Processing of intent blocks MUST be deterministic. Identical moves and identical intent blocks MUST yield identical assemble output.

**Rationale.** KawaNagare is optimized for bots. Intent is machine-checked data, not a changelog. See https://github.com/rkosinski941/Kawanagare/issues/8.

**Open questions.**

- ~~Whether the `kind` enum ... stays the closed set.~~ v5 replaces `kind` with `purpose` (authored, closed) and derived ops. Timing relative to PR #12 and the values are for Rich (NR-3, NR-2).
- ~~Whether a raft carries its own intent block.~~ Closed in v5 and v6: a raft derives its intent (§4.7). Kanosei intent is resolved below.
- Targets are node ids, not paths (v6 choice; NR-13). PR #12's example shows paths; reshaping it falls under NR-3.


#### Kanosei intent

A kanosei MUST carry its own intent block. The block states the shared idea. It MUST be written when the kanosei opens. It MUST be signed with the kanosei. The flow log MUST keep it permanently. It MUST NOT be consumed. It MUST NOT be deleted.

**Kanosei schema.** Every field is required. An unknown field MUST be refused as `intent_invalid`.

| Field | Rule |
|---|---|
| `goal` | One statement of the shared idea: a statement string (Intent block, "Statement rule"). |
| `targets` | Shared scope. Same rule as a move `targets` (Intent block, "Targets"): one or more `{node}` entries. |
| `accept` | Machine-checkable success criteria. MUST be a list of one or more `{kind, ref}` entries. `kind` is one of the closed list in §12 (provisional: `test`, `assemble_clean`, `needs_met`). `test` names an external test id whose result the caller supplies; Kawa never runs tests. `assemble_clean` means assemble of the member on the target stream has no snags; `needs_met` means the member has no missing derived need. |

A kanosei that opens with no intent block MUST be refused as `intent_missing`. A schema-invalid block MUST be refused as `intent_invalid`, and the refusal MUST name the field. The kanosei MUST NOT be stored. The flow log MUST NOT be appended. Refusal, not a snag.

**Member intent.** Every member move or member raft MUST keep its normal intent block, plus `kanosei` and `approach`. Both added fields are required. Members MAY differ in `targets`. Members MAY differ in `needs`.

| Field | Rule |
|---|---|
| `targets`, `purpose`, `needs`, `reason` | Same rules as a move intent block. |
| `kanosei` | MUST name the kanosei id. |
| `approach` | One statement of how this member differs: a statement string (Intent block, "Statement rule"). |

A move that is not a kanosei member MUST NOT carry `kanosei` or `approach`. Either field on a non-member MUST be refused as `intent_invalid`.

Adding a member to an open kanosei MUST check the member intent before the flow log is appended:

| Case | Refusal code |
|---|---|
| Member intent block absent | `intent_missing` |
| Member intent block fails this schema | `intent_invalid` |
| `kanosei` does not name the open kanosei | `kanosei_mismatch` |

On any of those refusals the kanosei MUST stay unchanged. The flow log MUST NOT be appended. `kanosei_mismatch` is a refusal, not a snag. Snags are reserved for conflicts.

A member raft MUST carry this member intent block, stored on the `kanosei.join` event. That is the only authored intent a raft ever has. It does not change the rule for a raft outside a kanosei: such a raft carries no authored intent and derives it (§4.7). The raft-define event never carries intent, member or otherwise.

**assemble (§4.11).** assemble MUST validate each member independently against the kanosei `accept` list. assemble MUST report per member, code `kanosei_accept`, one member per check. Members MUST NOT be combined in that check. The report MUST NOT be a snag. Identical kanosei intent, identical member intents, and the same stream MUST yield identical per-member reports.

**`intent_hash`.** assemble output includes `intent_hash = hashOf(kanosei intent)` as identity. It is not a drift check; the signature covers the block (a changed block fails its signature). `kanosei_mismatch` means only that a member names a different kanosei.

**Pick.** The pick is one signed flow-log event. The event MUST name the kanosei and the chosen member. The event MUST carry an intent block. The pick signature covers that block. The flow log MUST keep the pick intent permanently.

| Field | Rule |
|---|---|
| `member` | MUST name the chosen member. MUST equal the member named on the pick event. |
| `reason` | One statement: a statement string (Intent block, "Statement rule"). |

A pick with no intent block MUST be refused as `intent_missing`. A schema-invalid pick intent MUST be refused as `intent_invalid`. The pick MUST NOT be appended.

A rival that a reviewer pulls is pulled, not deleted. pull MUST keep each rival's intent block in the flow log permanently. Those blocks MUST NOT be consumed. Those blocks MUST NOT be deleted. They remain the record of the rejected alternatives. restore MUST NOT rewrite them.

```yaml
kanosei: open-choice
intent:
  goal: "one open() line in src/db.c"
  targets: [{node: "n:seed.rich@desk.4:0"}, {node: "p:seed.rich@desk.1:1"}]
  accept:
    - {kind: test, ref: "t.open.flags"}
    - {kind: test, ref: "t.open.mode"}
members:
  - move: move.rich@desk.118
    intent:
      targets: [{node: "n:seed.rich@desk.4:0"}, {node: "p:seed.rich@desk.1:1"}]
      purpose: feature
      needs: [move.rich@desk.117]
      reason: "replace open() and the pool entry name"
      kanosei: open-choice
      approach: "flags argument and a pool entry rename"
  - raft: open-mode
    intent:
      targets: [{node: "n:seed.rich@desk.4:0"}]
      purpose: feature
      needs: []
      reason: "replace open() with a mode argument"
      kanosei: open-choice
      approach: "mode argument, carried as a raft"
pick:
  kanosei: open-choice
  member: move.rich@desk.118
  intent:
    member: move.rich@desk.118
    reason: "t.open.flags holds for this member"
```

Example per-member report. The `ok` values show the report shape:

```yaml
code: kanosei_accept
kanosei: open-choice
members:
  - member: move.rich@desk.118
    accept:
      - {id: t.open.flags, ok: true}
      - {id: t.open.mode, ok: false}
  - member: open-mode
    accept:
      - {id: t.open.flags, ok: false}
      - {id: t.open.mode, ok: true}
```

**Resolved.** A kanosei carries its own intent block, as specified in this subsection. A raft derives its intent (§4.7); a member raft additionally has the authored member intent on its join event.

### 4.8 What blocks export

**Every snag blocks export, including event snags. A waiting move blocks export. Other notices do not.**

| Blocks export | Does not block |
|---|---|
| Snag kinds 1–5 and 7–10, twins included, whether or not tagged 11; event snags | Dormant resolution |
| A **waiting** move (its event is in the log, its script is not here) | Unattached script |
| | Raft partly on |
| | A redundant carry reply |

There is no such thing as a non-blocking snag.

**Preview mismatch** (Q-VCS11). If land or export is given an approved preview id (the `view_hash` of an assemble result), and the stream's tree is not the one that preview built, export is refused `preview_mismatch {expected_tree, actual_tree, preview_id}`. Nothing is written. A snag or waiting move still blocks first. A shelf is not an object: an unconfirmed shelf is an assemble preview, identified by its hash.

### 4.9 Carry needs: refuse, do not snag

**Derived and authored needs** (Q9). A move has two need sets. `needs_derived[]` is computed by `derive_algo: needs-v1` from the three items below; each edge is `{move_id, via_node_id, reason_code}` with `reason_code` from the closed list in §12. `needs_authored[]` is `intent.needs`. assemble and a carry preview report both, plus `needs_derived_only[]` and `needs_authored_only[]`. Nothing is applied without `--with-needs`; nothing is added silently.

- `needs_derived_only[]` not empty, no `--with-needs`, no waiver: carry is **refused** `needs_derived_missing {move_ids[]}`, with the transitive group named.
- `needs_authored_only[]` not empty and no derived-only need: the carry may land, with notice `needs_authored_unproven`. Not a refusal. **Authored needs are never carry preconditions.** If an authored need is also a derived edge, it is a derived need and the derived rule applies. An authored need that is not a derived edge never refuses a carry, alone or inside a raft.
- **Waiver.** A signed event naming exactly one edge `{move_id, need_move_id, reason}` lets that carry land without that need. It never suppresses the derived-missing notice. A malformed waiver is `waiver_invalid`. Who may sign is open (NR-11).

A carry is one deliberate edit of a stream's list, so Kawa checks it first. **If a need is unmet, the carry is refused.** The reply names the missing moves, the proposed transitive group, and any pool precondition that still fails.

A move's needs are:

1. The "carry needs" column in §3 (parent pool reachable, old entry visible, both pools reachable, the deleted entry visible).
2. The **maker move** of every line it anchors on, replaces, or switches off. This is kind 4 if the move were allowed to land with that maker off.
3. For a resolution, its `inputs`.

**The anchor line does not have to be the visible text.** v3 said a carry needs every anchored line "visible". That sentence is easy to over-read.

- Maker not in play: missing need, kind 4, carry refused (or pulled into the needs group).
- Anchor line replaced or switched off by another move that **is** in play: not a missing need. The weave orders through the replacement or the tombstone. If the case is ambiguous, the specific snag (kind 3 or kind 5) shows after the carry. The carry itself is not refused for that.

Pool preconditions are stricter than line anchors, and they match the §3 table. A file whose parent pool is not reachable is refused, not turned into an orphan (T34): `parent_pool_missing {node_id, parent_move_id, options: [add_parent, refuse]}`, before anything lands. Identity is `node_id`; a path is display only. `--with-needs` means choosing `add_parent` up front: one event carries the parent-creating move and the child. There is no reparent option in M3 (ask_10b). `--with-needs` can propose the move that creates the pool. It cannot turn a switch-off back on; if the old entry is hidden by some other on-move, the carry stays refused.

This is different from pull and restore. Those change what is already in a stream. Refusing a pull would trap a bad move. They land, and snags show, tagged with the event (T26, T27).

| Action | Needs unmet | Result |
|---|---|---|
| Check-in in open water | Stream moved on | Lands; snags shown |
| Carry, needs group, or raft carry | Missing maker, unreachable parent, missing resolution input | **Refused**, with the group named (T31, T34) |
| Pull or restore | Something now depends on a missing line | Lands; snag tagged with the event (T26, T27) |

Carrying a resolution without its inputs is refused: `inputs … are not in this stream; carry them as a raft or leave the resolution behind` (T31).

### 4.10 Removal resolutions after a restore

A removal resolution ("B without A") lists A under `absent`. While A is off and the spot matches `saw`, the resolution is active. When A is restored, the resolution goes dormant, and whatever snag A and B cause together shows again, tagged by the restore, with the dormant resolution named (T28). Pull A again and the resolution wakes. Nothing is deleted.

### 4.11 Read-only assemble

`assemble` builds a file or a pool view from any chosen move list and returns the bytes, the snags, and the intent-block reports. It does not append a flow-log event, does not turn a move on, and does not take one off.

```
kawa assemble <path> --moves <list>
kawa assemble <path> --stream <stream> --with <moves> --without <moves>
```

Bots use it to simulate a decision before committing:

- **Before a carry:** assemble the target stream's moves plus the candidate. If the preview's snags are missing needs, read the proposed group and assemble again with that group. Carry only after the preview is the tree you want.
- **Before a pull:** assemble the stream `--without` that move. The snags are what the pull would expose.
- **Before a restore:** assemble the stream `--with` that move. Restore will land even when needs are missing; assemble shows the snag first.
- **Intent block:** assemble MUST validate the intent block of every move in the preview. It MUST report `intent_missing` or `intent_invalid` when the block is missing or schema-invalid. It MUST report `intent_need_absent` for each move id listed in `needs` and absent from the plan. These reports are not snags and are returned in `intent_reports`; the per-move ops are returned in `ops_derived`. Identical moves and identical intent blocks MUST yield identical assemble output. See Intent block (required).
- **Kanosei intent:** assemble MUST validate each kanosei member independently against that kanosei's `accept` list and MUST report per member (`kanosei_accept`). Members MUST NOT be combined in that check. The report is not a snag. See Kanosei intent.

assemble also reads history: `kawa assemble <path> --stream <stream> --at <event>` builds the view of the stream as it was after flow-log event `<event>`. It is read-only and writes no event (Q-VCS5). A recorded rewind event is parked (§11).

**View identity** (Q-VCS3). The result carries `view_hash = hashOf({on_set: sorted on-move ids, policy_hash})`. Visibility is a function of the on-set (§1), and gap order follows `order_key`, not check-in order (§2), so two streams with the same on-set give the same **view**, whatever sequence of carry, pull and restore events produced them. The **view** is: `files`, `snags` (identity, kind, `snag_id`, `sides[]`, `base`), `notices` that are functions of the on-set, `blockers`, `directories`, and `exportable`. The **exposure annotations** `tag11`, `exposedBy` and `exposedByKind` depend on event history. They are not part of `view_hash`, not part of the view, and outside the equal-view promise; they are compared only between streams with the same event history. The reference engine was checked on 720 orderings with an active resolution and on two different event histories reaching one on-set (T61).

**Machine fields.** Per move, `in_play: true|false` is the one canonical field for on/off. "on" and "off" are display words only (an alias table is in §0), and `on_set` in `view_hash` is the sorted list of ids of moves with `in_play: true`. Need edges are `needs` (forward) and `needed_by` (reverse); the word `linked` is not a machine field.

The reference engine's `assemble` is that operation for bytes and snags. A snapshot of the repo before and after is identical. Intent-block reports, including per-member kanosei `accept` reports, are not emitted by the reference engine yet.

## 5. Worked example

Ids are shortened: `seed.4` is `seed.rich@desk.4`, `L4.0` is `L:seed.rich@desk.4:0`.

**1. Seeds.** `seed.1` makes the root pool and pool `src`. `seed.4` makes `src/odbc.c`:

- L4.0 `#include <sql.h>`
- L4.1 `int open();`
- L4.2 `int close();`

**2. move.117** adds L117.0 `#include <sqlext.h>` with after L4.0 and before L4.1.

**3. move.118** replaces L4.1 with L118.0 `int open(int flags);` and renames the entry from `odbc.c` to `db.c` on the same node.

**4. Stream `dev` = [seed.1, seed.4, 117, 118].** From `START`: L4.0, then L117.0 in the gap before L4.1, then L118.0 in L4.1's slot, then L4.2. The file is `src/db.c`. No snags. L4.2 was minted with L4.1, so it follows the replacement without a kind 3 snag. L117.0 only uses L4.1 as its `before` anchor, so it stays in the gap, also without a snag.

**5. Pull 118.** The rename and L118.0 go dormant. The file is `src/odbc.c` = L4.0, L117.0, L4.1, L4.2. **Restore 118** brings step 4 back. Nothing is replayed or deleted (T25).

**6. Open water.** Joy, who saw the seed and not move 118, checks in **move.joy@lap.121**, also replacing L4.1 with `int open(int mode);`. Both stay on. One kind 1 snag. `dev` does not export (T01). If her bytes match 118's exactly, it is the same one snag, labelled twin (T02).

**7. Resolution.** move.122 switches off L118.0 and L121.0 and replaces L4.1 with `int open(int flags, int mode);`. Inputs [118, 121] are on and `saw` matches, so it is active. The file is `src/db.c` = L4.0, L117.0, L122.0, L4.2. No snags.

**8. Pull 121.** move.122 goes dormant. L118.0 shows again. No snag. The notice is `move.122 dormant: input move.joy@lap.121 is off` (T23). Restore 121 and 122 wakes (T24).

**9. Carry 117 to `release` = [seed.1, seed.4].** Its anchors' makers are on, so the carry is clean. Carrying 122 alone is refused: inputs 118 and 121 are not in that stream (T31).

**10. Raft.** `open-sig` = [118, 121, 122]. Carrying the raft into `release` (which already has 117) is one event. `release` matches step 7. Pulling 121 alone leaves `open-sig: 2 of 3 members on`, puts 122 to sleep, and does not block export (T33).

### 5.1 Worked backport: move 10 into an older stream

This is the case a git cherry-pick makes painful, and the case bot teams hit when a fix lands on a newer stream.

Stream `v1` holds moves 1..5: a small `main` function, a replaced `return`, and two notes. Stream `v2` is a fork of `v1`. Moves 6..10 land only there.

- Move 6 adds a helper note.
- Move 7 adds `init();` and `run();`, anchored on move 6.
- Move 10 replaces `run();` with `runSafe();`. It needs move 7. Move 7 needs move 6. The closure is **10 → 7 → 6**.

**Cherry-pick**, for contrast: git copies the patch onto the older branch and mints a new commit with a new SHA. The fix's identity splits. If the context has drifted, the copy fails or applies in the wrong place, and the two histories no longer name the same change.

**Kawa:**

1. `assemble` of `v1` plus move 10 does not touch either stream. The preview text contains `runSafe()` (best effort) and a kind 4 snag whose need is move 7.
2. `carry` of move 10 into `v1` is refused. `v1` is still moves 1..5. The reply names the group `[6, 7, 10]`.
3. `carry --with-needs` writes **one** flow-log event that adds 6, then 7, then 10. Move 10's id is unchanged. `v1` and `v2` both contain that same id. The file has `init();` and `runSafe();`, and no snag.
4. `pull` of move 10 on `v2` brings `run();` back. `restore` puts `runSafe();` back. Same id both times.

`node m3/demo.mjs` runs this story.

## 6. Sites and the flow log

- **Move scripts union.** They are immutable. Sites collect them. A script that fails its signature is absent. If an event already names it, that is an event snag, and export holds.
- **Stream events need an order.** Pull, restore, carry, raft, lock, and policy are flow-log events. (v5 also listed an undefined event token here; v6 removes it. The named stream base is the proposed `tome`, §13, M4-deferred.) Each names its `parent_event`. One sequencer gives a single order. The log can travel over git; git does not own it.
- **Sequencer guarantees** (Q5). For one stream: events are append-only; each event names its `parent_event`; event ids are applied at most once; the fold is deterministic; order follows the log, never wall clocks. A shared cross-site sequencer is not part of M3 (§11).
- **Forks.** If two sites issue events against the same parent, the later one is stale (T36). Kawa re-issues it only when the meaning is unchanged (the same kind and the same moves). Otherwise it is an event snag and the stale event does not change the stream.
- A union of scripts never brings a pull back to life (T37). Only the flow log decides which moves are on.
- **Redaction** uses a tombstone event (§2).
- **Compaction** may store a ready-built tree and must not throw scripts away.

Offline bots can produce a drizzle of event snags. The viewer should group them by site and show which ones one decision would clear.

## 7. What developers complain about, and how Kawa answers

From public posts in Oct–Nov 2026. These are complaints, not claims Kawa has already proved.

| Complaint | Kawa's answer (proposed) |
|---|---|
| Tools show what a change touched, not what depends on it | Anchors name the lines a later move stands on. Before a pull or carry, assemble lists the moves that would snag (kinds 3, 4, 5, 8). This is textual dependency. A call into a changed function still needs a later verify gate. |
| Diffs lack whitespace and moved-code filters | Whitespace-only moves can sit in their own raft and be pulled from a view. A move across the file is still a switch-off plus an insert. "Moved" is display only. |
| Scope creep buries the real change | Split the work into rafts and carry each one. |
| Too many diffs to read | Review a stream as rafts and snags. This helps only when authors name rafts well. |
| A small config diff with a huge blast radius | Pulling a raft returns the earlier tree, with no revert commit. Kawa cannot predict runtime impact. |

## 8. Use cases

Worth running, and covered by `m3/`:

- Preview a carry with `assemble` before writing the flow log.
- Backport one fix onto an older stream, whole group or refused, never half (§5.1).
- Pull a bad move and restore it.
- Several bots in open water on one file: non-overlapping inserts stay clean; an overlapping replacement stays a snag until a resolution move.
- A customer-variant stream that carries its own raft.

Edge cases the matrix now specifies: raft all-or-nothing (T30); missing parent on carry is a refusal (T34); pulling a delete restores current contents (T35); a re-imported identical change is a twin (T11).

Still open for the viewer, not for the model: long chains of dormant resolutions are hard to read (question 4). Large binaries times many moves grow storage, and compaction cannot drop scripts.

## 9. The reference engine

[`m3/`](../m3/) is the reference model for this document. It is not the retired M1 CLI in [`legacy/m1/`](../legacy/m1/), and it does not share paths with that work (`legacy/m1/package.json`, `legacy/m1/src/`, `legacy/m1/test/`).

```
node --test m3/*.test.mjs
node m3/demo.mjs
```

**Test gate (v6).** The gate is `node --test m3/*.test.mjs` (explicit file list through the shell glob). `node --test m3/` also works but, on Node 24, runs only what `m3/index.mjs` imports; so `index.mjs` MUST import every `*.test.mjs` in `m3/`, and `m3/gate.test.mjs` fails when one is missing (§10.2). Without that rule a new test file is skipped silently: two of three S1-S2 builds reported 57/57 on Linux and skipped their own 28 and 37 new tests.

Node 20 or newer. No `npm install`. The tests name the matrix rows T01–T40 and add assemble, the move-10 backport, anchor ordering, open-water bots, mixed line endings, and Windows-shaped path checks. Those path checks compare segments in memory, so they pass on Linux and on Windows without creating reserved filenames on disk.

The engine records resolution moves only when the caller supplies one. It does not auto-resolve.

**v6 build order** (Q8; guidance, not a runtime rule): canonical form (S1), then S2a pure checks (intent validation, `ops_derived`, `move_empty` predicate) and S2b check-in integration (`intent_missing`, `intent_invalid`, `move_empty`, persistence, replay), then needs codes, then snag ids and resolution forms, view identity, kanosei (`kanosei_mismatch`), raft bind, and last the raft derived checks (`raft_intent_drift`, `raft_incomplete`), which need the raft schema first. See slices.md S1-S9.

A production store still has to add real signatures, a crash-safe append, and the git export command. The reference engine keeps the decisions those pieces must not get wrong: script first, event is the commit point, snags are computed, needs are transitive and named, export stops on snags and on waiting moves.

## 10. Where each matrix row is specified

| Rows | Section |
|---|---|
| T01, T03, T04, T05, T07 | 4.2, and 2 for ordering |
| T02 | 4.2, 4.5 — one snag, labelled twin |
| T06 | 1.1, 4.2, 4.8 — waiting notice, names the site, holds export |
| T08, T09 | 4.5 |
| T10 | 4.5 — no event; "already on, nothing to do" |
| T11 | 4.5, kind 11 tag |
| T12–T15 | 3, 3.1, 4.2 |
| T16 | 3.1 — NFC compare; a later policy event tags the snag |
| T17, T18 | 3, 4.2 |
| T19 | 3, 4.1 — refused at check-in |
| T20–T22 | 2, 4.2 |
| T23, T24, T25 | 4.4, 5 |
| T26, T27 | 4.9 — land, tagged with the event |
| T28 | 4.4, 4.10 |
| T29 | 4.4 — fresh snag; dormant text offered as a choice |
| T30 | 4.7, 5 step 10 — one event, all or nothing |
| T31 | 4.9 — refused |
| T32 | 4.7 — carries whole; twin tagged by the carry |
| T33 | 4.7 — single member may be pulled; partly-on notice |
| T34 | 4.9 — refused, not an orphan |
| T35 | 3 — current contents come back |
| T36, T37 | 6 |
| T38 | 1.1 |
| T39 | 1, 1.1 |
| T40 | 3.1 |

### 10.1 New matrix rows in v5 and v6 (proposed)

Each row has a runnable test in slices.md. `A-` ids refer to the delegator matrix.

| Row | Behavior | Section | Slice |
|---|---|---|---|
| T41 | No intent block: `intent_missing`, nothing stored (a: pure validator returns the code; b: check-in stores no script and appends no event) | Intent block | S2a, S2b |
| T42 | Unknown field, `kind`, `op`, unknown `purpose`, empty targets: `intent_invalid` names the field (a pure, b check-in) | Intent block | S2a, S2b |
| T43 | Intent block kept through pull, restore and single carry; identical inputs give identical output (v6: raft carry removed, see T43r) | Intent block | S2b |
| T43r | Intent block of every member kept and deep-equal after a raft carry; the raft-define event carries no authored intent (moved from T43) | Intent block, 4.7 | S8 |
| T44 | Move with no records and no `resolves`: `move_empty` (a pure, b check-in) | 4.1 | S2a, S2b |
| T77 | Canonical JSON vectors V01 to V23, R01 to R28, A01 to A17, H01 to H06 (canonical-json-vectors.md); `parseCanon` strict parser | §A | S1 |
| T78 | `ops_derived` truth table: all rows of the table in Intent block, exact arrays | Intent block | S2a |
| T79 | Intent validation: fixed error order, error object, reasons, limits | Intent block | S2a |
| T80 | `move_empty` boundary: order-only resolution valid; removal resolution needs a switch-off; records defined by the seven arrays | 4.1, 4.4 | S2a |
| T81 | Target identity: a targeted file renamed, deleted then restored, and a pool target all keep the same `{node}`; unknown node refused | Intent block | S2b |
| T82 | Signed script intent and flow-log record event intent are byte-identical after canonicalization and after replay; replay after a crash neither loses nor duplicates it | Intent block, 1.1 | S2b |
| T83 | A refused intent (including a bad signature) leaves script store and flow log unchanged | Intent block | S2b |
| T84 | Pre-intent script loads; assemble reports `intent_missing`; check-in of the same shape is refused | Intent block | S2b |
| T85 | Closed schema is recursive: unknown field inside a target element is refused | Intent block | S2a |
| T45 | Derived-only need: `needs_derived_missing`; `--with-needs` carries the named group | 4.9 | S3 |
| T46 | Authored-only need: notice `needs_authored_unproven` | 4.9 | S3 |
| T47 | Single-edge waiver; notice stays; wrong or malformed waiver refused | 4.9 | S3 |
| T48 | `parent_pool_missing` with options `[add_parent, refuse]`; no reparent | 4.9 | S3 |
| T49 | `raft_bind_missing`, `raft_bind_invalid` (incl. `other`), bind immutable | 4.7 | S7 |
| T50 | `raft_bind_reason_missing`; `bind_reason` field errors are `intent_invalid` | 4.7 | S7 |
| T51 | Derived raft intent deterministic; `raft_intent_drift` on stored-hash mismatch | 4.7 | S8 |
| T52 | Tag/summary change events leave carry, pull, snag, export unchanged | 4.7 | S7 |
| T53 | `raft_incomplete` with `--from`; carries after restore | 4.7 | S8 |
| T54 | Kanosei open, join, pick, abandon; closed refuses join; `kanosei_mismatch` | Kanosei | S6 |
| T55 | Moves and rafts mixed in one kanosei | Kanosei | S6 |
| T56 | `pick_needs_unmet`; `kanosei_link_orphaned` after a rival is pulled | Kanosei | S6 |
| T57 | `kanosei_accept` per member with `{kind, ref}` predicates | Kanosei intent | S6 |
| T58 | `snag_id` equal across streams; dormant resolution is not authoritative | 4.3, 4.4 | S4 |
| T59 | Wrong `snag_id` on a resolution: `resolution_invalid` | 4.4 | S4 |
| T60 | Order-only resolution for kind 2 | 4.4 | S4 |
| T61 | Equal on-sets give equal `view_hash` and views under any event order | 4.11 | S5 |
| T61b | Three-side snag in 10 seeded arrival orders: equal `view_hash` and equal order of `moves`, `sides[]`, `lines` (v6; found by the sample run; the v5 engine fails it on `lines`) | 4.3, 4.11 | S5 |
| T62 | `assemble --at` is read-only | 4.11 | S5 |
| T63 | `preview_mismatch` on export | 4.8 | S5 |
| T64 | Twin `identical` resolution travels with a raft | 4.5 | S4 |
| T65 | Many sites, shuffled delivery: same `snag_id` set | 4.3 | S9 |
| T66 | Partial pull refused `move_partial_pull` | 4.2 | S9 |
| T67 | Parked features absent from the M3 engine | 11 | S9 |

### 10.2 Test gate (v6)

| Row | Check | Slice |
|---|---|---|
| T86 | `gate.test.mjs` lists `m3/*.test.mjs` and fails if any file is not imported by `m3/index.mjs`, or if `index.mjs` imports a missing file. It is the only test that reads the disk (`node:fs`). | S1 (first slice that adds a test file; later slices keep it green) |

A slice is done when `node --test m3/*.test.mjs` is green and `node --test m3/` reports the same test count.

## 11. Parked (not in M3)

These answers were accepted as design or recorded as constraints, but are not part of the M3 text. Placement is a milestone choice for Rich (needs-rich.md NR-4); labels after M3 are provisional because v4 does not define later milestones. Each line gives the constraint to keep when it is taken up.

| Item | qid | Recommended placement | Constraint to keep |
|---|---|---|---|
| Cross-site shared sequencer | Q5 | M5 | Total order per stream, append-only, causal `parent_event`, at-most-once event ids, deterministic fold. Git does not own the log. |
| Site-local permanent exclusion list | Q-VCS13 | M5 | Exact ids plus reason in local config; no auto-propagation; auto-receive off. |
| Recorded rewind event | Q-VCS5 | M4 | Signed `{stream, to_event, target_set_hash, reason}`; append-only; no deletion; no auto-rebase of later events; conflicting rewinds are an event snag. Read-only `assemble --at` is already in M3. |
| Closed query language | Q-VCS6 | M4 | AND-only selector over move id, stream, raft, event, since; canonical JSON; refusals `query_unsupported`, `query_ambiguous`; never writes the flow log. |
| Draft ids before check-in | Q-VCS10 | M4 | A draft id is never a Move-Id and is never reused as one; a split mints new canonical ids. |
| Divergent supersede | Q-VCS14 | M4, only if a supersede link is added | Divergent supersedes are a snag until a pick or resolution move; dependents are not re-pointed silently. |
| Structure-aware matching | Q-VCS15 | M4 or later | Detection only; versioned analyzer; advisory; never an auto-assembled result. |
| Foundation plus rafts storage, quality tags | Q-VCS16 | M4 | No privileged stream; replacing a foundation is a signed event with needs checks. |
| Named frozen stream view | Q12 | M4 (disputed; NR-6) | Read-only; carry source only; never a target; never inherits. v6 §13 proposes that a `tome` replaces this view; that replacement is pending Rich (Q-T8). |
| Non-file records | Q-VCS12 | not planned (NR-8) | Independent fields are no conflict; overlapping fields stay a snag; never last-timestamp-wins. |
| `move split` | Q4 | not planned | A part of a move is carried by new moves; the original is pulled. |
| Reparent resolution | ask_10b | not planned | Needs its own move type and dependency checks. |
| Signed skip event for a raft | Q11 | NR-5 | Would let one raft id mean two member sets. |

## 12. Provisional names and closed lists

Everything in this section is provisional until Rich answers needs-rich.md NR-1 and NR-2. Engines keep them in one constants file so a rename is one edit.

| List | Values |
|---|---|
| `intent.purpose` | feature, fix, refactor, docs, test, perf, chore, security |
| `ops_derived` (derived, not authored) | add, change, remove, rename |
| raft `bind` | atomic, feature, migration, revert_set, dep_bump |
| `bind_reason.code` | needs_edge, shared_target, contract, build_unit, migration_step, revert_pair |
| raft tag core values | feature, fix, refactor, migration, spec, experiment (`x-` values ignored) |
| kanosei `accept.kind` | test, assemble_clean, needs_met |
| resolution `decision` | new_text, keep_one, identical, order, remove |
| derived-need `reason_code` | anchor, replaces, switch_off, parent_pool, entry_visible, resolution_input |
| kanosei terms | coexistence, kanosei_link, pick (not heizon, en, kime) |
| `intent_invalid.reason` | missing, wrong_type, unknown_field, empty, blank, control_char, lone_surrogate, too_long, too_many, bad_id, unknown_node, duplicate, self_reference, not_in_list |
| `canon_invalid.reason` | float, integer_range, negative_zero, lone_surrogate, duplicate_key, unsupported_type, depth_exceeded, parse_error |
| shared limits (constants file) | `statement_max` 200 code points; `list_max` 64 entries; `id_max` 200 characters; `canon_depth_max` 64 nested containers |
| id grammar | `^[A-Za-z0-9][A-Za-z0-9._@:+-]{0,199}$` (move ids, node ids) |
| tome (M4-deferred, proposed) | `tome`; refusals `tome_name_conflict`, `tome_target_refused`, `tome_set_mismatch` (§13) |

New codes: refusals `canon_invalid` (library error, not a check-in refusal), `intent_missing`, `intent_invalid`, `move_empty`, `resolution_invalid`, `needs_derived_missing`, `parent_pool_missing`, `waiver_invalid`, `raft_bind_missing`, `raft_bind_invalid`, `raft_bind_reason_missing`, `raft_intent_drift`, `raft_incomplete`, `move_partial_pull`, `kanosei_mismatch`, `pick_needs_unmet`, `preview_mismatch`. Notices and labels: `needs_authored_unproven`, `needs_closure_large`, `intent_need_absent`, `kanosei_accept`, `kanosei_link_orphaned`.

## A. Canonical form and hashing [S1]

All v6 hashes use one canonical form so every site and every language gets the same bytes. Byte-level vectors: canonical-json-vectors.md. Two independent reference implementations (JavaScript and Python) are in `evidence/` and agree on every vector.

**Input.** A value is one of: `null`, `true`, `false`, an integer, a string, an array of values, an object whose keys are strings and whose values are values. Nothing else. A float, `NaN`, an infinity, `undefined`, a BigInt, a function, a symbol, a Date, a Map, a class instance, a sparse array, and an object with a symbol key are refused. Refusal is recursive: the first failure in traversal order is reported. Traversal is document order for text (`parseCanon`), and for an in-memory value ascending index for arrays and UTF-16 key order for objects.

**Rules.**

1. **Whitespace.** None between tokens.
2. **Strings.** UTF-8. Escape `"` as `\"`, `\` as `\\`, U+0008 `\b`, U+0009 `\t`, U+000A `\n`, U+000C `\f`, U+000D `\r`, every other U+0000 to U+001F as `\u00xx` with lowercase hex. Nothing else is escaped: `/`, U+007F, U+2028, U+2029 and all non-ASCII characters are written raw. The input form of an escape never matters (`"\u0041"` and `"A"` give the same bytes). No Unicode normalization is applied; NFC and NFD strings hash differently.
3. **Lone surrogates.** A string or key that contains an unpaired UTF-16 surrogate is refused `lone_surrogate` (it has no UTF-8 encoding). Valid pairs are one code point.
4. **Integers.** Decimal digits, no `+`, no leading zeros, no fraction, no exponent. The range is -(2^53 - 1) to 2^53 - 1 (-9007199254740991 to 9007199254740991). A larger magnitude is refused `integer_range`. Carry a larger number as a string. In text, any token with a fraction or exponent is refused `float` even when its value is integral (`1.0`, `1e2`). `-0` is refused `negative_zero` (in text and as a numeric negative zero; do not map it to `0`). JavaScript `JSON.stringify` MUST NOT be used as the canonicalizer: it maps `-0` to `0`, drops `undefined` members, and escapes lone surrogates.
5. **Key order.** Object keys are sorted by **UTF-16 code unit**, comparing the unescaped keys, ascending, with no locale. Chosen over code point order for three reasons: v5 already said it; it is the order of RFC 8785 and of native JavaScript string comparison and of the engine's default `Array.sort()`; and the two orders differ only for keys that mix an astral character with U+E000 to U+FFFF, so the choice costs other languages one line (Python: `key.encode('utf-16-be')`; Go and Rust: compare `encode_utf16()` sequences). Vector V15 separates the two orders.
6. **Duplicate keys.** An object with two equal keys is refused `duplicate_key`, after unescaping (`{"a":1,"\u0061":2}` is a duplicate), even when the values are equal. This is enforced by `parseCanon` on text. An in-memory object cannot hold duplicate keys. `JSON.parse` keeps the last value silently and MUST NOT be used on signed input.
7. **Keys are strings.** JSON has no other key type; an API that receives non-string keys must stringify nothing and refuse (`unsupported_type`).
8. **Arrays** keep their stated order. Lists that stand for sets (move ids in `snag_id`, `on_set`) are sorted by the caller before hashing and are marked "sorted" where used.
9. **Depth.** At most `canon_depth_max` (64) nested containers; a 65th is refused `depth_exceeded`.
10. **Text input.** `parseCanon(text)` accepts RFC 8259 JSON text with the above limits. A BOM, a trailing comma, a raw control character in a string, an unknown escape, a leading zero and trailing text are `parse_error`. Bytes are decoded as UTF-8 first; invalid UTF-8 is `parse_error` (no text vector covers this).

**Error object.** `canon_invalid {reason, path, target}`: `reason` from §12 `canon_invalid.reason`; `path` an RFC 6901 pointer to the containing value (`""` for the root); `target` is `value` or `key`. `parse_error` has no path guarantee. A text with two problems reports the first in text order (`[1.5,-0]` is `float` at `/0`).

**Hash.** `canonJson(value)` is the string of rules 1 to 9. `canonBytes` is its UTF-8 encoding. `hashOf(value) = "sha256:" + lowercase hex(sha256(canonBytes))`. `hashOf({a:1,b:[1,2]}) = "sha256:8baa73198470c7bb4c3ce142a8fd651affc0310d878bb9bd159e37a573fb4874"`.

The reference engine needs only `node:crypto` for the hash. At the time of v6 the engine in `m3/` has no canonicalizer; S1 adds it (`m3/canon.mjs`) and passes when it matches canonical-json-vectors.md.

## 13. Tome: a named immutable stream base (M4-DEFERRED, pending Rich)

**Status: M4-deferred. Not part of M3. Nothing in S1 to S9 builds it.** Full design note: design-note-checkpoint.md in this folder (copied from v5's folder; filename kept for traceability, the note itself uses the Kawa word). Open items: needs-rich.md Q-T1 to Q-T10. Proposed tests T68 to T76 are listed as M4 in test-matrix-notes-v6.md only; they are not in §10.1 or slices.md.

**Rich's inputs (settled).** A tome is immutable. It freezes a move list. It is the common parent for stream forks. It helps conflict checks between sibling streams. Rich also said: "for Kawanagare do what makes sense." The rest below is a bot proposal and not a Rich decision.

**Proposed word.** `tome` (留め, "hold, fastening"; machine and CLI token `tome`). Alternates `iwa`, `seki`. Not Rich-approved (Q-T1). It does not reuse `anchor` (line records, §2) or `base` (snag field, §4.3), and a raft is not a tome (a raft is a carry group).

**Record.** One signed flow-log event; it mints no move and changes no stream.

```yaml
derive_algo: tome-v1
id: hashOf({derive_algo: "tome-v1", stream, name, moves: sorted})   # §A
name: non-empty string                 # the label
stream: source stream
moves: sorted list                     # MUST equal the stream's on-set after the creating event (else tome_set_mismatch)
signer: key                            # not in id
created_at: informational              # not in id, never used for event order (§6)
# derived, stored on the event: creating_event, view_hash = hashOf({on_set: moves, policy_hash})
```

**Invariants (proposed).** I1 immutable; I2 a changed set is a new tome under a new name; I3 same `stream`, `name` and sorted `moves` recompute the same `id` (idempotent); I4 `(stream, name)` unique, else `tome_name_conflict`; I5 `created_at` and `signer` are not identity; I6 a tome is not a stream: carry, pull, restore, raft carry, lock and policy refuse it as a target (`tome_target_refused`), and the source stream may still pull a move that is in the tome; I7 creation with `moves` different from the on-set is refused `tome_set_mismatch`, nothing stored.

**Stream open.** `open_stream --from <tome_id> --name <new_stream>`: the new stream starts with exactly `tome.moves` and records `base_tome`. No seed move is written. Many streams may open from one tome, now or later. The tome inherits no later event. This is not a §6 event fork (T36).

**Conflict role.** When sibling streams A and B share `base_tome` T, the sibling check reports delta snags only: snags with at least one participating move not in `T.moves`. A snag whose moves are all in `T.moves` belongs to the shared base and is not re-listed. This is a report filter and changes no derivation. `snag_id` and `view_hash` are unchanged by a tome (the tome id is an input to neither), so T58 and T61 still hold. A carry of A into B previews B's on-set plus A's delta with `--with-needs` still required. No auto-resolve, no auto-rebase, no reparent. Without a shared `base_tome` the filter does not apply.

**Relation to NR-6 and Q12 (pending Rich).** v5 §11 parks a named frozen stream view `{stream, event, label}` (read-only, carry source only, never a target, never inherits; M4, disputed). The note proposes that a tome **replaces** that view and adds two roles it lacks (stream-open base, sibling-delta filter). It keeps three Q12 constraints (read-only, never a carry, pull or restore target, no inheritance), refines "carry source only" (moves in the frozen set are carried from streams that have them; the tome is not a source object), and changes identity on purpose (set plus name, not event). **Whether the tome replaces the view is pending Rich (NR-6 and Q-T8). Until he answers, the Q12 text in §11 stands as parked and this section is a proposal.** `assemble --at <creating_event>` (M3, T62) is the check a tome stands on: it MUST give `on_set == tome.moves` and the stored `view_hash`, writing nothing.

**Placement.** Recommended M4 (Q-T9): M3 already has `assemble --at`, `view_hash` and `snag_id`; a new event kind, a stream-open operation and a report filter widen the engine, and v5's lean for NR-6 was M4. If Rich answers M3, T67 and A-Q12-1 negatives are replaced by T68 to T76 and the S3-and-later hold still applies.


## Changes from v4 (this version)

See the changelog at the top, keyed by DeepSeek question id. Details and reasons: decisions.md. Items for Rich: needs-rich.md. Implementation slices: slices.md.

## Changes from v3

- Bots are the primary users. The "first user" question is closed and removed.
- `assemble` is a first-class read-only operation (§4.11), with text and snags together.
- Worked backport of move 10 (§5.1), contrasted with cherry-pick, including transitive needs.
- `--with-needs` is the transitive closure, shown as a named group, never applied silently (§4.7).
- §4.9 no longer reads "the anchor line must be visible". Missing need means the maker is off (kind 4). A replaced or tombstoned anchor is ordered, or raises kind 3 or kind 5 when that rule says so.
- Ordering requires `after` and `before`, plus `order_key` for the same gap (§2).
- Kind 3 is specified against the worked example so a right-edge replacement and a same-move successor stay clean.
- Kind 6 stays a label. Kind 11 stays a tag. The reference engine and the matrix tests live in `m3/`.

## Questions for Rich

1. **Pull vs lift.** Git users may read "pull" as download, the opposite of this meaning. v4 keeps pull / restore. Keep them, or switch the off-switch to "lift"?
2. **Raft vs flotilla.** "Raft" also names a consensus algorithm. Keep raft, or rename (flotilla has been suggested)?
3. **Pool vs basin.** "Pool" also means a storage pool and a thread pool. Keep pool, or switch to basin?
4. **Resolution chains.** When one resolution settles a snag and a later one settles a snag that involves the first, should the viewer show the whole chain or only the latest decision?
5. **Partial raft carry.** v4 carries a raft all or nothing and refuses when a need is missing, offering the needs group instead. Should a later revision allow carrying part of a raft?
6. **Who signs repo policy.** v4 uses one signed policy event (default: case-insensitive, NFC, Windows forbidden names, `max_path` 259). Who, besides the repo owner, may append a new policy event?
7. **Kanosei.** A proposed word for a named set of rival moves or rafts, each an alternative implementation of the same idea (see Kanosei (proposed), after §4.7). Does picking one member auto-pull the others, or does the reviewer decide? Current lean: the reviewer decides. Can a kanosei be re-opened after a pick? See https://github.com/rkosinski941/Kawanagare/issues/10 and #8 (https://github.com/rkosinski941/Kawanagare/issues/8).
8. **Intent block.** (v5: `kind` replaced by `purpose`; see NR-2, NR-3.) Every move MUST carry an intent block (Intent block (required)). A kanosei MUST carry its own intent block (Kanosei intent). The `kind` enum is replaced by `purpose` (NR-3, NR-2). A raft derives its intent (closed in v5 and v6). Targets are node ids (NR-13). See https://github.com/rkosinski941/Kawanagare/issues/8.
9. **Kanosei names.** coexistence / link / pick, or the Japanese terms heizon / en / kime? (NR-1)
10. **Closed lists.** Adopt the provisional lists and codes in §12? (NR-2)
11. **Milestone placement** of the parked items in §11. (NR-4)
12. **Raft after a pulled member.** Signed skip under the same raft id, or a new raft? (NR-5)
13. **Named frozen view.** M3, M4 or drop? (NR-6)
14. **Human words vs machine tokens.** (NR-7)
15. **Non-file records.** In scope at all? (NR-8)
16. **Kanosei reopen and auto-pull after pick.** (NR-9, NR-10)
17. **Who signs** needs waivers and policy events. (NR-11)
18. **Raft bind.** Confirm required `bind` and structured `bind_reason`; is `text` required? (NR-12)
19. **Intent targets.** Node ids only (v6), or also paths? (NR-13)
20. **Named stream base.** Adopt `tome` (§13) as M4 and let it replace the named frozen view? (Q-T1 to Q-T10; NR-6)
