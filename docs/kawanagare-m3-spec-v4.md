# KawaNagare M3 Architecture & Conflict Proposal v4

**Status:** active proposal / reference model under test. This is not an approved build plan for the M1 CLI. Nothing in M1 switches over to this model until Rich approves it.

**What this document is.** The architecture for streams, moves, the line weave, pools, and conflict management. Bots are the primary users. The runnable model is [`m3/`](../m3/): `node --test m3/` and `node m3/demo.mjs`, with Node 20+ and no install step.

**What this supersedes.** [`kawanagare-spec-v7.md`](kawanagare-spec-v7.md) treats git as the store: a move is replayed into a new commit, GitHub is the source of truth, and `main` is the branch people merge to (v7 §2 and §9). v4 drops that assumption. Signed move scripts and the flow log are the source of truth. Git trees and commits are only an export. [`kawanagare-spec-v7.md`](kawanagare-spec-v7.md) and [`kawanagare-brief-v7.md`](kawanagare-brief-v7.md) stay in `docs/` as the frozen M1 record. M1 keeps following v7 until Rich says otherwise.

**Who it is for.** KawaNagare is designed for **bots (AI agents)** first. Bot teams work concurrently in open water on shared files, and bots test the model. A human release-backport workflow is the same machinery — carry a move into an older stream — so it comes for free. There is no separate "first user" track.

**Inputs folded into v4.** M3 ideas v3; the 40-row snag matrix (T01–T40); the line-weave prototype (`assemble`, transitive `with-needs`, `pull` / `restore`, and the four findings below). v3's open question about the first user is closed by the paragraph above.

---

## 0. Kawa words

| Term | Meaning |
|---|---|
| **stream** | A named list of moves that are on. There is no "main" stream. |
| **move** | One signed, immutable change. It mints line records and entry records and switches older ones off. |
| **seed** | The move that first creates a file or pool. The root seed cannot be pulled. |
| **carry** | Put a move's id into another stream. Records are not copied. The same Move-Id is the same change everywhere. |
| **pull** | Take a move out of play in one stream. The script stays. |
| **restore** | Put a pulled move back on. |
| **pool** | A directory node. Its contents are entry records. |
| **entry record** | "Node X is here under name N", minted by one move. |
| **line record** | One line of a file, raw bytes plus its line ending, minted by one move, never edited. |
| **snag** | An open conflict. It is computed from the stream. Nobody resolves it automatically. |
| **resolution move** | An ordinary move a person or bot checks in to record how a snag was decided. |
| **raft** | A named list of moves that carry together, as one flow-log event. |
| **flow log** | The ordered list of stream events. |
| **open water / locked** | Open water (the default): concurrent edits land and snags show. Locked: an optional signed lock refuses other moves at check-in. |
| **notice** | Something the viewer shows that is not a snag. Notices do not block export, except a waiting move, which does. |
| **assemble** | A read-only preview: build a file or a pool view from a chosen move list, and report the snags, without writing a stream or the flow log. |
| **site** | One place of work. Ids are site-scoped (`rich@desk`). |
| **twins** | A label on a kind 1 or kind 2 snag whose sides are byte-identical. Not a separate snag. |
| **order key** | A signed value on a move used only to display contested lines in a fixed order. |

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

1. **The script is written first.** It is immutable and named by its id, so writing it twice is harmless.
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
4. If the `after` or `before` line was replaced, the anchor resolves to the visible replacement (or replacements) in that slot. The insert stays in the same gap. Replacing the right-hand line does not throw the insert out of the gap, and it does not by itself raise a snag.
5. If the anchor line was switched off and nothing replaces it, the line remains in the order graph as a **tombstone**: neighbors keep their places, the tombstone is omitted from the visible text, and the anchor is snag kind 5.
6. If two moves put lines in the **same gap** (the same `after` and `before` on the same node), that is snag kind 2. Kawa still shows them, in `order_key` order, then by position in the script, then by line id. That order is display only. It is not a decision, and it does not follow who checked in first (T03).
7. A **redaction** is a tombstone event on a line. The line id stays. The script keeps the original bytes (signatures cover them). Assemble and export show the redaction marker instead. A leaked secret still needs rotating.

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

**When Kawa refuses instead of snagging:** a move that conflicts with itself or breaks repo policy (§3, §3.1); a move on a locked node (§4.6); a carry whose needs are not met (§4.9). Check-in, pull, and restore are never refused for causing snags. They land, and the snags show.

### 4.2 Kinds of snag

| # | Snag | When it happens |
|---|---|---|
| 1 | **Same line replaced twice** | Two or more on-moves each put a replacement in the same line's slot. |
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

**Kind 3, precisely.** This is the ambiguous case, not every neighbor of a replaced line.

- Kind 3 fires when an in-play insert uses a replaced line as its **`after`** anchor (the left edge it attached to), and `saw` does not include the replacing move. Assemble still places the insert after the replacement, and reports the snag, so the caller sees both the text and the break (T04).
- An insert that only names the replaced line as its **`before`** anchor is not kind 3. The left edge is intact. The gap rule keeps the insert beside that slot. In the worked example, the extra include sits before `int open();` and stays clean when that line is replaced.
- A line minted by the **same move** as the anchor (the original next line of that move) is not kind 3. Ordering slides it to follow the replacement.
- If `saw` includes the replacing move, the author did see the replacement, and kind 3 does not fire.

**Kind 4 is the missing need.** The maker move of a required anchor or switch-off is not in play. That is what a carry refuses (§4.9). A pull or restore that exposes it lands, and the snag is tagged with that event (T26).

**Kind 5 is a deleted anchor.** The maker is on, the line is off, and there is no replacement. The tombstone keeps the order. The snag says the anchor is gone (T07).

**One problem, one snag.** Kawa reports one snag per contested spot (one line slot, one gap, one lost anchor, one pool name, one node, one attribute key), listing every move involved. Three replacements of one line are one kind 1 snag with three sides.

**Not snags:** two moves switching off the same line with no replacement; edits to neighboring but separate gaps; a later move that replaces a line an earlier on-move added (a normal follow-on edit, not two replacements of the same slot).

### 4.3 How an open snag is shown

Both moves stay **on**. The snag is computed, not stored, so it cannot go stale. A stream with a snag still builds. Assemble returns that best-effort text **and** the structured snags. Callers need both: the preview of move 10 on an older stream shows `runSafe()` and, beside it, the missing need.

Each snag carries its kind, path when it has one, the moves involved, each side's bytes, the event that exposed it when kind 11 applies, and any dormant resolution text offered as a choice. Each move is **off**, **on and clean**, or **on with a snag**. Notices are listed separately.

### 4.4 The resolution move

A person or bot clears a snag by checking in a resolution move. It is an ordinary signed move plus a section that says what was decided. Kawa never writes this section itself.

```yaml
move: move.rich@desk.122
resolves:
  kind: same_slot
  identical: false
  inputs: [move.rich@desk.118, move.joy@lap.121]   # all must be on
  absent: []                                        # all must be off
  contested: ["L:seed.rich@desk.4:1"]
  saw: ["L:move.rich@desk.118:0", "L:move.joy@lap.121:0"]
  decision: "new text combining both"
records:
  off: ["L:move.rich@desk.118:0", "L:move.joy@lap.121:0"]
  lines:
  - {id: "L:move.rich@desk.122:0", bytes: "int open(int flags, int mode);\n", replaces: "L:seed.rich@desk.4:1"}
```

**When it counts.** A resolution is active only while every `inputs` move is on, every `absent` move is off, and the visible records in the contested spot, ignoring this resolution's own lines and switch-offs, are exactly the ones it `saw`. Otherwise it is **dormant**: its lines and switch-offs stop counting, and the viewer says why (`move.122 dormant: input move.joy@lap.121 is off`). When the conditions hold again it wakes. A dormant resolution is never deleted.

If a new move lands in the spot of an active resolution (T29), the resolution goes dormant and a fresh snag lists every side, including the dormant resolution's text as a choice, so nobody has to retype it.

### 4.5 Twins

- **The same move carried twice cannot duplicate.** A carry adds the id. If it is already on, no event is written, and the reply is `already on in dev; nothing to do` (T10).
- **Two separate moves that make the same change** are one snag of kind 1 or kind 2, labelled **twin** when the sides are byte-identical (T02, T08). The label is not a second snag.
- **Choices:** keep one side's lines, or the other's, or write new text. The viewer says the bytes match, so the choice is whose move carries the line and its history. The resolution records `identical: true`. Kawa does not pick.
- A single common line (a blank line, or a lone `}`) does not get the twin label. It is a plain kind 2 snag (T09).
- A twin that arrives later by carry or raft carry gets the same check, tagged with that event (T11, T32).

### 4.6 Locked mode

A stream, or one node, can be **locked** by a flow-log event. While the lock is held, other moves that touch that node are refused at check-in. Locks are off by default. Pull the lock with an unlock event. Carry is not a check-in; the lock does not block it.

### 4.7 Rafts, and transitive needs

A raft is a **signed flow-log event that names a list of moves**, for example `open-sig = [118, 121, 122]`. It is a label, not a container. A move may sit in more than one raft. Scripts are never copied.

- **Carrying a raft is one flow-log event, all or nothing** (T30). Every member's needs are checked against the target plus the other members first. If any need falls outside that set, the whole carry is refused and the stream is unchanged. There is no partly carried raft.
- **Members already on** are skipped and named. That is not a failure.
- **A member with a twin already in the target** still carries. The twin snag then shows, tagged by the carry (T32). Kawa does not drop the member.
- **Pulling one member is allowed** (T33). The raft then shows a **partly on** notice (`open-sig: 2 of 3 members on`). That notice does not block export. Pulling the whole raft is one event too.
- **`--with-needs` is transitive.** Move 10 needs 7, and 7 needs 6, so the group is `10 → 7 → 6`. A carry computes the whole closure, deps first, and names it (`needs:10 = [6, 7, 10]`). It does **not** add those moves unless the caller passes `with-needs`. One event then carries the group. Silent extra moves are a bug. The reference engine returns the group on both the refusal and the successful carry.

### 4.8 What blocks export

**Every snag blocks export, including event snags. A waiting move blocks export. Other notices do not.**

| Blocks export | Does not block |
|---|---|
| Snag kinds 1–5 and 7–10, twins included, whether or not tagged 11; event snags | Dormant resolution |
| A **waiting** move (its event is in the log, its script is not here) | Unattached script |
| | Raft partly on |
| | A redundant carry reply |

There is no such thing as a non-blocking snag.

### 4.9 Carry needs: refuse, do not snag

A carry is one deliberate edit of a stream's list, so Kawa checks it first. **If a need is unmet, the carry is refused.** The reply names the missing moves, the proposed transitive group, and any pool precondition that still fails.

A move's needs are:

1. The "carry needs" column in §3 (parent pool reachable, old entry visible, both pools reachable, the deleted entry visible).
2. The **maker move** of every line it anchors on, replaces, or switches off. This is kind 4 if the move were allowed to land with that maker off.
3. For a resolution, its `inputs`.

**The anchor line does not have to be the visible text.** v3 said a carry needs every anchored line "visible". That sentence is easy to over-read.

- Maker not in play: missing need, kind 4, carry refused (or pulled into the needs group).
- Anchor line replaced or switched off by another move that **is** in play: not a missing need. The weave orders through the replacement or the tombstone. If the case is ambiguous, the specific snag (kind 3 or kind 5) shows after the carry. The carry itself is not refused for that.

Pool preconditions are stricter than line anchors, and they match the §3 table. A file whose parent pool is not reachable is refused, not turned into an orphan (T34). `--with-needs` can propose the move that creates the pool. It cannot turn a switch-off back on; if the old entry is hidden by some other on-move, the carry stays refused.

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

`assemble` builds a file or a pool view from any chosen move list and returns the bytes and the snags. It does not append a flow-log event, does not turn a move on, and does not take one off.

```
kawa assemble <path> --moves <list>
kawa assemble <path> --stream <stream> --with <moves> --without <moves>
```

Bots use it to simulate a decision before committing:

- **Before a carry:** assemble the target stream's moves plus the candidate. If the preview's snags are missing needs, read the proposed group and assemble again with that group. Carry only after the preview is the tree you want.
- **Before a pull:** assemble the stream `--without` that move. The snags are what the pull would expose.
- **Before a restore:** assemble the stream `--with` that move. Restore will land even when needs are missing; assemble shows the snag first.

The reference engine's `assemble` is that operation. A snapshot of the repo before and after is identical.

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
- **Stream events need an order.** Pull, restore, carry, raft, lock, policy, and checkpoint are flow-log events. Each names its `parent_event`. One sequencer gives a single order. The log can travel over git; git does not own it.
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

[`m3/`](../m3/) is the reference model for this document. It is not the M1 CLI and it does not share paths with that work (`package.json`, `src/`, `test/` at the repo root).

```
node --test m3/
node m3/demo.mjs
```

Node 20 or newer. No `npm install`. The tests name the matrix rows T01–T40 and add assemble, the move-10 backport, anchor ordering, open-water bots, mixed line endings, and Windows-shaped path checks. Those path checks compare segments in memory, so they pass on Linux and on Windows without creating reserved filenames on disk.

The engine records resolution moves only when the caller supplies one. It does not auto-resolve.

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
