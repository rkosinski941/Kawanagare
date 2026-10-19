# KawaNagare: streams, moves and seeds on git
Build spec v7 (frozen for M1), for Enjoy and the 10th-man team. Unsettled points are listed in §10d with the milestone that must settle them; nothing else is open.

The name comes from 川の流れ (kawa no nagare), "the river's current."
The product is **KawaNagare**. Each line of work inside it is still a **stream**, and the CLI command is `kawa`.

> **Inspiration.** The model is inspired by a stream-based configuration management tool Rich used years ago (TRUEchange), where there was no mainline, only streams, and every change was a first-class object that could be carried between streams or removed. There, changes were called moves and file creations seeds. This spec uses its own terms throughout: **moves** and **seeds**. It is a clean-room design from remembered behavior only.

## 1. Goal, and what's in and out of v1
**Goal in plain words:** let people and agents work in *streams*, *seeds* and *moves* rather than mainline and branches.
- A **seed** creates one or more files.
- A **move** is one change after that, across any number of files. A move may also add files; whichever object (seed or move) first creates a file is its **creator** for dependency purposes (§5).
- A **stream** is a recipe: a base (reached through a checkpoint), plus an ordered list of in-play moves and any later seeds. The base holds seeds and, after the first checkpoint on top of root, **base moves**: moves frozen into that checkpoint's `contains` list. Base moves behave like any other move for attribution and dependencies; they just aren't in the stream's own list.

The tool builds a stream's files by replaying that list. Merging, carrying (cherry-picking) and *backing out* a move all become **events**; the fold derives the new recipe from them, and a rebuild follows, so they work in either direction. Nothing ever edits recipe YAML directly.

**In v1**
- **v1 means M1–M5 (§9).** M1–M4 are single-site: one repo copy, one human owner (Rich) and any number of agents, which appear through the `Agent-Id` trailer. M5 adds distributed mode (§7a): several sites, the site registry and delegate approvers. Both use the same event log, fold and signing code from M1 onward.
- A local CLI (`kawa`) plus a local web UI served on 127.0.0.1.
- Stream create and fork, checkpoints, seed and move create, check-in, list and show, merge, carry, back out and restore, materialize, diff two moves, and per-line impact.
- The agent HTTP API: heat, move, compose, gate, plus the stream endpoints.
- Conflict, dependency and "lines removed by other in-play moves" reporting.

**Out of v1:** hosted servers (distributed mode in §7a uses GitHub only, from M5, including its PR flow), multi-user auth, phases (a `phase` field is reserved, see §3), exclusive file locks on checkout (v1 has only the repo write lock in §5, advisory claims and private work areas; none of them stops a second agent from editing the same file), per-line views of binary files (files matching `binary_globs` can be added by seeds and replaced whole by moves, but get no weave), merging across repos, and Windows-specific installers beyond `npm i -g`.

## 2. Mapping the concepts to git
**Why a commit is almost a move.** A git commit is already close to a move: one change across many files, with its own message and author. The difference is that it's bound to its parent. Its SHA covers its parent's SHA, so it means "this exact tree, after that exact history" and can't move without becoming a different commit. This layer makes the change free-floating:
- It gets a stable id that lives in the commit message (`Move-Id: move.000123`).
- Replaying it onto any stream produces a new commit with a new SHA but the same id.

The id, not the SHA, is the object's identity.

| Concept | In git under this tool |
|---|---|
| Seed (add set) | Exactly one commit with a `Seed-Id: seed.000004` trailer. It only *adds* files (one or many). Its metadata lives in `.kawa/objects/seed.000004.json`. |
| Move (move.000117) | Exactly one commit with a `Move-Id: move.000117` trailer. It can modify, add or delete lines in many files. Its metadata lives in `.kawa/objects/move.000117.json`. |
| Ref id (bug or ticket) | One or more `Ref-Id:` trailers, stored as `ref_ids: []` in the object JSON |
| Change group | Optional `group:` on a move. Carry, merge and back-out accept `--group NAME`. |
| Backing out a move | A recorded event: the stream entry is marked backed out with `backed_out_by`, and a backout or restore event is logged. Nothing is dropped silently. |
| `<Base>` of a stream | The seeds (plus any moves) already contained in the stream's base checkpoint. In the per-line view, lines from base seeds are shown as `<Base>`, and clicking expands them to the actual seed id. |
| Checkpoint (v9.3.0.1) | An annotated git tag `cp/<stream>/<n>`, plus a record in the stream file, including the frozen list of object ids it contains |
| Stream | A YAML recipe at `.kawa/streams/<name>.yaml`, **derived** by folding the stream's events (§7a): base checkpoint plus an ordered list of in-play and backed-out object ids (seeds and moves). Only the fold writes it. The shared copy on `kawa-meta` is written only by the integrator's fold (in single-site mode the local fold is the integrator); every other site keeps its own folded copy in `.git/kawa/cache/` and never commits it. It holds no per-machine build state. |
| `.latest` head | A generated branch `streams/<name>`, the materialized result. Never edit it by hand. |
| Fork a stream at a checkpoint | A new recipe whose base is that checkpoint and whose list starts empty. The checkpoint's `contains` is cumulative from root (§3), so a fork inherits the full history. |
| Merge A → B | Append every object in play in A that is **not already in B's effective set** (B's base `contains` plus B's own list), in A's order. An object B lists as backed out is skipped and reported as `skipped_backed_out`, so a deliberate back-out is never resurrected; `--include-backed-out` restores it explicitly with a restore event. An object B lists only as `pending_conflict` was never applied, so merge retries it. Resolution bindings for pairs that end up in play together in B travel with the merge. |
| Carry | Append the selected moves or seeds (bringing in required seeds is offered automatically, see §5) |
| Back out (take out of play) | A `backout` event sets `in_play: false`, then re-materialize |
| Either-direction merge | Comes free: streams are lists, not ancestry, so B → A is the same operation |

**Where shared metadata lives: a `.kawa/` directory, committed on a dedicated orphan branch `kawa-meta`.** I chose this over git notes because:
- Notes are hard to see, edit, review and push (they need explicit refspecs), and agents and Rich can both read plain files.
- Keeping the recipes on their own branch stops them churning every materialized branch, and the metadata history becomes ordinary git history ("who removed move.000118?").

The tool works out of a separate worktree at `.git/kawa-meta-wt`.

**Local state stays out of the committed tree.** Everything per-machine lives under `.git/kawa/`, which git never commits: `local.yaml` (site id, hooks, integrator flag, pinned trust anchors), `session.token`, `idem/`, `cache/` (weave, deps, prefix shas, local folded recipes, materialized state), `wt/` (work areas), `conflicts/` and `lock`. The `kawa-meta` tree holds only shared, schema-validated data, and `kawa doctor` fails if any local-state path appears in it.

**One object, one commit: check-in squashes.** A person or agent can make as many git commits as they like while working on a move. On `kawa checkin`, the tool:
1. Squashes those commits into a single commit whose diff runs from the check-out point to the work tip.
2. Puts the description and trailers in the message.
3. Records that commit's SHA as the object's *canonical commit*.
4. Creates a ref `refs/kawa/objects/move.000117` so the commit stays reachable even after the working branch is deleted. This is the **only** ref namespace for objects: seeds and moves both live under `refs/kawa/objects/<id>`, locally and on GitHub.

Replays make new commits with the same `Move-Id`, and the canonical commit never changes.

**Superseding instead of mutating.** An object file and its canonical commit are immutable. Anything that would change them makes a **new object** that supersedes the old one through a signed `supersede` event `{old, new[], reason: split|rebase|resign}`:
- `kawa move split` makes two new objects and supersedes the original.
- Rebasing an already checked-in move onto a new stream head (`kawa move rebase`) makes a new object. (`kawa checkin --rebase` is a different thing: it finishes a check-in that hit a stale base, before anything is canonical.)
- Re-signing a quarantined move (§7a) makes a new object with the same content under a valid key.
- An id collision found at fold (§7a, offline minting) is repaired by a supersede with reason `id_collision`.

The fold replaces the old id with the new ids at the old position, in dependency order (a split-off seed goes before the move that edits its files), and the old object and ref stay for history. Rules that keep chains well-formed:
- Each new object records `derived_from: <old id>`.
- **Dependents must be re-pointed explicitly.** If the old object has in-play dependents, the `supersede` event must name, for each dependent, which new id(s) it now depends on; a split with dependents and no re-pointing is refused. Re-sign and rebase map one-to-one, so this is automatic for them.
- After substitution the fold checks that the in-play order is still a topological order of stored dependencies and that the chain has no cycle; otherwise the `supersede` event is rejected.
- The event carries a `line_map` from old weave line ids to new ones (identity for re-sign, computed by diff for rebase and split), so claims and handovers follow the change (§7a). Before check-in nothing is canonical yet, so a stale-base replay at check-in is not a supersede.

**Seed or move at check-in.** If the work only adds new files, it's checked in as a seed. If it modifies or deletes existing files, it's a move. If it does both, the tool asks whether to split it into a seed (the new files) and a move that depends on it, or to keep it as one move. Agents can choose with `--split` or `--no-split`; the default for `--json` callers is `--no-split`. Keeping it as one move is allowed, since a move may add files. **How a split check-in is stored:** the id reserved at checkout goes to the move. A second id (a seed id from the same agent@site counter) is minted at check-in. kawa makes two canonical commits: the seed (new files only) on the checkout point, then the move on top of the seed, each with its own trailers, object file and `refs/kawa/objects/<id>`, and the move gets `depends_on: [<seed id>]`. One `add` event appends both, seed first. The work branch is deleted after check-in as usual.

### Storage engine boundary
Git is the v1 storage engine, but nothing above the storage layer may call git directly. All git use goes through one `StorageEngine` interface covering commits, tags, file contents at a revision, replay, and refs. The CLI, the attribution engine, the UI, and the API only see seeds, moves, streams, and checkpoints. That way a native engine closer to how the old tool stored seeds and moves can replace git later without touching the UI or the API.

## 3. Data model and file formats
```
.kawa/                         # on kawa-meta (shared, data only)
  settings.yaml
  streams/apr_util_vendor_v9.3.0.yaml   # derived by the fold; written only by the integrator (§7a)
  objects/seed.000001.json     # one file per seed
  objects/move.000117.json     # one file per move
  events/<stream>/<event-id>.json
  claims/<claim-id>.json
  counters/<agent>@<site>     # counters/local in single-site mode
  resolutions/<id>.json        # resolution data objects, see §5
  checkpoints/<stream>/<n>.json  # cumulative contains + tree, chunked if large
  stamps/<sha>.json            # long In-Play lists for provenance stamps
  adopted/<commit-sha>         # adopt marker, see §9
  snapshots/<stream>/<n>.json  # compaction, see §7a
.git/kawa/                     # local only, never committed
  local.yaml  session.token  idem/  cache/  wt/  conflicts/  lock
```
`settings.yaml` is **non-executable data**: the schema has no field that names a command, path to run or hook, and unknown fields are rejected. It changes only through a signed `settings` event (with a version number) folded like any other, so concurrent changes are ordered, and its folded value is part of `recipe_hash` (a change to `binary_globs` rebuilds).
```yaml
version: 3
heat: { window_days: 14 }
binary_globs: ["*.png", "*.exe", "*.doc", "*.pdf"]   # no weave or per-line view
max_stream_objects: 500
```
`local.yaml` (per machine, user-only permissions, see §7):
```yaml
site_id: desk                 # required in distributed mode; unique per repo copy (§7a)
site_instance: 9f3c2a7e       # random, made at init; detects a copied site
hooks: { post_materialize: "npm test" }   # the ONLY place a hook is configured
integrator: false
trust: { pinned_allowed_signers: null }   # optional local pin (§7a)
```
In single-site mode ids are `move.000120` and `seed.000005`, and the next numbers come from `counters/local` under the repo lock. Turning on distributed mode doesn't rename anything: bare ids stay valid forever, and new objects get `agent@site` ids from then on.
Stream file:
```yaml
name: apr_util_vendor_v9.3.0
forked_from: { stream: apr_util_vendor_v9.1.0, checkpoint: cp/apr_util_vendor_v9.1.0/3 }
base: cp/apr_util_vendor_v9.1.0/3     # contents frozen in that checkpoint's record
description: Vendor drop 9.3
phase: null                           # reserved for v2 (development/staging/production ladder); ignored in v1
objects:                              # order = replay order, after the base
  - { id: move.000117, in_play: true }
  - { id: seed.000004, in_play: true }  # later file additions are listed here too
  - { id: move.000118, in_play: false, backed_out_by: rich, event: rich@desk.000007 }
resolutions:                          # bound to a conflicting pair, applied during replay (§5)
  - { id: res.enjoy@desk.000003, conflict_of: [move.000117, move.000119], bind_event: enjoy@desk.000031 }
checkpoints:
  - { n: 1, tag: cp/apr_util_vendor_v9.3.0/1, record: checkpoints/apr_util_vendor_v9.3.0/1.json }
# the record: { contains: [cumulative, ordered, from root], contains_hash, resolutions: [...], tree: <tree sha>, sha_hint: 4f1c..., tree_index: [{at: 50, tree, commit}, ...], git: {version, merge_backend}, trust_pin: <main commit of .kawa-trust> }
folded_through: rich@desk.000007     # last event applied; events themselves live in events/<stream>/
# a backout event: { id: rich@desk.000007, kind: backout, objects: [move.000118], by: rich, site: desk, parent_event: ..., reason: "broke ODBC build" }
# a restore event: { kind: restore, objects: [...], undoes: rich@desk.000007 }
# per-machine build state ({branch, sha, recipe_hash}) lives in .git/kawa/cache/materialized/<stream>.json, never here
```
The root checkpoint `cp/root/0` contains only seeds; later checkpoints contain seeds and base moves. **`contains` is always cumulative**: the full ordered list of objects in play from `cp/root/0` up to that checkpoint, including what came through every fork, plus the resolution bindings in effect. A checkpoint's identity is `{contains_hash, tree}`; `sha_hint` is only a rebuild shortcut (§5). `tree_index` records the tree **and the deterministic replay commit** after every 50th object, so a base back-out restarts from a real commit near the object instead of at root and the following replay commits stay deterministic.

**Checkpoint transition.** `kawa checkpoint S` writes one `checkpoint` event. When the fold applies it, atomically: the new record's `contains` = the old base's `contains` followed by S's in-play objects in order (backed-out ones are omitted; `from_base` back-outs are removed from `contains`), its bindings are the resolution bindings now in effect, the new checkpoint becomes S's `base`, and S's own `objects` list and `resolutions` list are emptied. Backed-out entries and their events stay in the event history, so a later restore of one of them appends it after the new base. Materialize after a checkpoint therefore replays nothing new.

**Canonical bytes for every hash.** `contains_hash`, `recipe_hash`, prefix keys, the `Kawa-In-Play` hash, chunk hashes and `request_key` records are sha256 over **RFC 8785 (JCS) canonical JSON**, UTF-8, no trailing newline. A chunked list hashes as the JCS array of its chunk hashes in order. YAML files are views; hashes never cover YAML bytes. Lists over 1,000 entries are chunked into `.<k>.json` side files, each hashed into the record, so no meta file passes the size cap. `kawa init` turns an existing repo into a seed (`seed.000001`, all files tracked at HEAD) unless `--adopt-history` is given (see §8).

Object file. Both kinds use the same shape, with `kind` telling them apart:
```json
{ "id": "move.000117", "kind": "move", "ref_ids": ["CR8638"], "group": "odbc-fixes",
  "agent_or_session": "enjoy", "author": "Rich Kosinski",
  "description": "Fix FILE_OPEN_ERROR handling",
  "checkout_description": "Investigating ODBC open failures",
  "checkin_description": "Handle SQL_ERROR from SQLDriverConnect",
  "base_sha": "4f1c...", "commit": "a1b2...",   // base_sha: the commit (not tree) it was checked out from
  "request_key": "site:desk/k-7f3a...",  // idempotency key of the request that created it (§7); null for adopt
  "paths": ["dbd/apr_dbd_odbc.c", "include/apr_dbd.h"],
  "created_at": "2026-10-18T18:02:11-04:00",
  "renames": [{ "from": "dbd/odbc.c", "to": "dbd/apr_dbd_odbc.c" }],
  "depends_on": ["seed.000002"],      // accepted AT check-in (--depends-on, or detected hard links confirmed); later ones are dep-accept events (§5)
  "demands": [],                      // must travel together
  "resolves": null,                   // set on resolution moves: { removal_of | conflict_of: [ids] }
  "supersedes": null,                 // set when this object replaces another (§2)
  "derived_from": null,               // lineage for supersedes
  "file_ids": { "dbd/apr_dbd_odbc.c": "seed.000001:dbd/odbc.c" },  // file identity per touched path (§5)
  "legacy_alias": null,               // e.g. "legacy-1a2b3c4" for adopted history; lookup only, never an id
  "adopted_from": null }              // source commit sha when made by adopt
```
`paths`, `renames`, `file_ids`, `depends_on` and `demands` over 1,000 entries are chunked into side files hashed into the core, so a vendor drop with thousands of files still fits the schema caps. For a seed, `kind` is `"seed"`, `paths` lists the files it creates, and `base_sha` is the tree it was added on. Note that it's `commit` (one SHA), not `commits`.

Commit trailers on the canonical commit and on every replayed copy:
```
Move-Id: move.000117        # or  Seed-Id: seed.000004  (exactly one of the two)
Agent-Id: enjoy
Ref-Id: CR8638              # repeatable
```
**Naming change:** the MVP's `Change-Set-Id` trailer is now `Move-Id`, and it means "this one commit", not a group of commits. BRANCHING.md needs the same rename (§9). For legacy commits that carry `Change-Set-Id`, `adopt` squashes each group into one move.

**Hunks** come from the MVP. A move's ordered hunks are its single commit's diff against its parent (for an adopted merge commit, its **first parent**), across all files: `{path, old_start, old_len, new_start, new_len, lines[]}`. A seed's hunks are all additions.

## 4. CLI
Built with Node and `commander`. Every command takes `--json` for agents.
```
kawa init [--adopt-history] [--remote <url> --site <site_id>]   # kawa-meta, .kawa/, .git/kawa/, seed.000001 + cp/root/0
kawa stream create main --base cp/root/0
kawa stream fork v9.3.0 --from v9.1.0 [--checkpoint 3]   # default = new checkpoint of current state
kawa stream list | show <name>
kawa checkpoint <stream> [-m "beta drop"]   # materialize, then tag cp/<stream>/<n+1>
kawa checkout --stream v9.3.0 -m "checkout desc" [--ref CR8638] [--agent enjoy]
                                               # reserves an id, creates work branch <agent>/<full id>/work, e.g. enjoy/move.enjoy@desk.000120/work
kawa checkin [-m "checkin desc"] [--split|--no-split] [--paths <files...>] [--depends-on <ids>] [--rebase] [--keep]
                                               # prints the new id (also in --json and the open-moves view)
kawa move rebase <id> --onto <stream>       # rewrite an already checked-in move: makes a new object (supersede)
                                               # squash work commits -> ONE commit, seed or move; adds it to the stream
kawa add <files...> --stream v9.3.0 -m "desc"   # shortcut: check in new files directly as a seed
kawa adopt <commit...> | --scan <rev-range> # register existing commits; each commit becomes one object; skips adopted ones
kawa move list [--stream S] [--kind seed|move] [--backed-out] [--limbo] [--signed-as me] [--agent X]
kawa move show move.000117 [--patch]        # works for seeds too
kawa carry <ids...> --from v9.1.0 --to v9.3.0 [--group G] [--dry-run] [--with-deps] [--keep-pending] [--keep]
kawa merge v9.1.0 v9.3.0 [--group G] [--dry-run] [--include-backed-out] [--keep]   # objects A has that B never listed
kawa backout v9.3.0 <ids...> [--group G] [--yes] [--force] [--dry-run] [--keep]    # seeds or moves
kawa approve <request-id>                   # signs an approval event with Rich's or a delegate approver's key
kawa restore v9.3.0 <ids...> [--keep]       # put backed-out objects back at their original position
kawa purge <id> --reason "leaked secret"    # always a request (exit 8); runs only after Rich's kawa approve
kawa resolve <stream> --start | --finish    # make a resolution bound to the conflicting pair
kawa deps --accept <id> --on <id>           # records a dep-accept event
kawa materialize v9.3.0                     # rebuild streams/v9.3.0
kawa move diff move.000117 move.000118     # overlapping files and regions, side-by-side hunks
kawa impact <path> --stream v9.3.0          # per-line owner table (seed or move)
kawa deps move.000119 --stream v9.3.0 [--deep]     # what it needs and what needs it
kawa heat [--stream S]
kawa claim [--paths ...] | claim list | renew <claim> | release <claim> | handover <claim> --to <agent>
kawa site list | push <site> | fetch <site>   # move objects and events between sites (via GitHub or a bundle file)
kawa push                                   # push kawa-meta and refs/kawa/objects/* to the remote
kawa doctor                                 # verify the fold, refs, signatures and that no local state is committed
kawa cache rebuild                          # rebuild the weave and dependency caches
kawa queue | kawa bundle <stream> <ids...>  # integrator queue, optional bundled PR
kawa move split <id> --paths <files...>
kawa cancel <move-id> | kawa checkout --list-stale | kawa checkout --resume <move-id>   # cancel frees the work area and claim; ids are never reused
kawa checkin --rebase                          # only before check-in completes: after a stale-base conflict (exit 6)
kawa verify <branch>                           # recheck the provenance stamp
kawa serve [--port 7420]                    # web UI and API
```
**Workflow for an agent writing a change:**
1. `kawa checkout` creates the work branch `<agent>/<full id>/work` (e.g. `enjoy/move.enjoy@desk.000120/work`), which matches BRANCHING.md's `<agent>/<topic>` and can't collide across sites. kawa refuses to create a work branch whose name already exists locally or on the remote, and never reuses one.
2. The agent commits as often as it likes, with no trailers needed.
3. `kawa checkin` squashes the work into one commit carrying `Move-Id: move.000120` and appends it to the stream.
4. If the stream is shared, the move then reaches `main` as its own PR (§7a).

**Note:** `kawa checkout` and `kawa checkin` open and close a kawa *work area*. They are not `git checkout`, and they never switch the branch in your own working directory.

Exit codes (the same with or without `--json`): 0 ok, 2 conflict, 3 dependency refusal, 4 bad input, 5 hook failed, 6 stale base, 7 lock timeout, 8 needs approval, 9 push retries exhausted. `--force` and `--yes` never complete a back-out past a dependent on their own: they turn a refusal (exit 3) into an approval request (exit 8).

## 5. Conflict, dependency and impact rules
**Materialize algorithm.** Run in a temporary worktree through `StorageEngine.replay`:
1. Check out the base checkpoint's replay commit (`sha_hint`, verified against the record's `tree`; if it's missing or differs, replay the base from the nearest `tree_index` commit).
2. For each in-play object in order, run `git cherry-pick --no-commit` on its single canonical commit (with rename detection, `--find-renames=50%`).
3. **If it conflicts and a resolution is bound to that pair** (the object and an earlier in-play object named in a resolution's `conflict_of`), check, per conflicted path, that the three input blobs (merge base, ours, theirs) have exactly the hashes the resolution recorded. Only if all match, write the recorded result blob for that path, and continue. If any input differs (for example the pair was carried into a stream with other edits in between), the binding is treated as unbound and the replay stops with a conflict. A resolution never touches a path that didn't conflict.
4. **If the pick is empty** (the change is already present), record `Kawa-Empty: true` and make an empty commit with the original trailers (`--allow-empty`), so there is still exactly one commit per object, and report it as `already_applied` in the result.
5. Commit with the original message and trailers (same `Move-Id` or `Seed-Id`, new SHA), plus `Kawa-Resolved-By: <resolution id>` when step 3 applied.

The result is exactly one commit per object, so `git log streams/<name>` reads like a move list. The final sha goes on `streams/<name>`. A rebuild is skipped when `recipe_hash` hasn't changed. It is the sha256 of: the base checkpoint's `contains_hash` and tree, the `from_base` back-outs, the ordered in-play ids with their canonical commit shas, and every active resolution binding (resolution id and result blob hashes). Binding, unbinding or replacing a resolution therefore always rebuilds.

**Deterministic replay.** Replay commits pin author and author date from the canonical commit, committer `kawa <kawa@invalid>` with the committer date set to the author date, and a normalized message (trailers in a fixed order, LF endings). Replay commits and stream heads are **never signed**. Each site runs the pinned git version and merge backend (`ort`), with replace refs, filters and hooks disabled, `core.autocrlf=false` and the attribute policy from §8. Under those conditions sites should get the same commits, but that is **not** a promise: cherry-pick results can differ across git versions and platforms. Identity is `{contains_hash, tree}`, never a commit sha. The record stores the git version used, and `kawa verify` compares trees as well as stamps, so a difference is caught and reported, never trusted.

**When a replay collides.** If a cherry-pick conflicts, stop.
- Leave the stream's branch unchanged.
- Write `.git/kawa/conflicts/<stream>.json` with `{object_id, paths, hunks of ours/theirs}`.
- Exit with code 2.

The recipe change that triggered the build (carry, merge or back-out) is rolled back unless `--keep-pending`, in which case the object is added as `in_play: false, pending_conflict: true`.

A seed collides if one of its files already exists in the target. That is reported as `path_exists` and never merged silently.

**v1 has no auto-resolve, and resolutions are part of replay.** `kawa resolve <stream> --start` opens a work area stopped at the conflict between `a` (earlier) and `b`. Whoever is doing the carry or merge (usually the bot that hit the conflict) fixes the conflicted paths; no approval is needed unless the resolution backs something out. `kawa resolve --finish` records a **resolution**, which is a data object, not a move commit, because the conflict state has no stable parent:
- `resolutions/<res-id>.json` (id `res.<agent>@<site>.<n>`), signed like an object core: either `{conflict_of: [a, b], paths: [...]}` or `{removal_of: [x], dependent: B, paths: [...]}`, where each path entry is `{path, file_id, base_blob, ours_blob, theirs_blob, result_blob, regions_fingerprint}`. `regions_fingerprint` is the sha256 of the conflicted line ranges and is checked along with the blobs. The result blobs are kept reachable by a parentless commit at `refs/kawa/objects/<res-id>`.
- A `resolution-bind` event registers it under `resolutions:` for that pair, and materialize applies it inside b's replay step (step 3 above). If a or b is out of play, the binding is **inactive**: it is skipped silently, and b replays on its own (if that conflicts, it's a new conflict). If both are in play but the input blobs don't match, it doesn't apply and the conflict is reported again. When a strict match fails, `kawa resolve --start` pre-fills from the old resolution and shows the diff, but a fresh result is required.
- **Attribution:** the resolution is **in play by binding**: whenever its binding applies, the lines in its result that came from neither side are owned by the resolution id in the weave and the Line Owners view, and every other line keeps its owner. So weave == materialized holds with resolutions applied.
- Carrying or merging both a and b into another stream copies the binding event with them; it applies there only if the input blobs match.
- A forced back-out that breaks a later move B is fixed the same way, with `{removal_of: [x]}`, applied in B's replay step while x is out of play. If x is later restored, that resolution stops applying and is flagged for review. `--dry-run` on carry and merge runs the full replay in a throwaway worktree and reports conflicts without changing anything.

**Concurrency.**
- **Worktrees:** `kawa checkout` gives each agent its own work area (a worktree) at `.git/kawa/wt/<move-id>`. Agents never share a working directory.
- **The repo lock (`.git/kawa/lock`):** this is a short **write lock** for kawa's own metadata and materialize steps, not a checkout lock on files. It is **released before the post-materialize hook runs**: the hook runs on the finished, not-yet-committed result, then kawa re-takes the lock to commit or roll back (failing with exit 6 if the stream moved meanwhile). Inside a hook, `KAWA_HOOK=1` is set; read-only kawa commands work, and write commands are refused; writers queue in FIFO order with `--wait <s>` (default 60), and exit 7 if the wait runs out. The lock records `{pid, host, agent, started}`, and a lock older than 10 minutes whose pid is dead is broken and logged.
- **Abandoned or crashed work areas:** `kawa cancel <move-id>` releases the claim, marks the reserved id consumed (ids are never reused), and moves the work branch to `refs/kawa/cancelled/<id>` for 30 days before deleting it with the work area, so a cancel can be undone with `kawa checkout --resume <id>` in that time. `kawa checkout --list-stale` shows work areas idle for more than 24h. A work area whose claim has expired and whose agent hasn't renewed it is **orphaned**: it stays on disk untouched, its unsquashed commits are kept on the work branch, and it shows in the limbo view until its agent resumes it (`kawa checkout --resume <move-id>`) or anyone cancels it after 7 days. A crash mid-checkin leaves nothing half-written, because the squash and the stream append are one locked step that either lands or rolls back.
- **Partial check-in and splitting:** `kawa checkin --paths <files...>` checks in only those files as the move and keeps the rest in a new checkout. `kawa move split <move-id> --paths <files...>` turns one checked-in move into two **new** objects and supersedes the original (§2), the second depending on the first if they touch the same lines, inserted at the original's position in dependency order. A check-in that splits into a seed plus a move inserts the seed first.
- **Stale base:** if the stream head moved since checkout, checkin replays the squashed work onto the new head before anything is canonical. If that conflicts, it exits 6 with a conflicts file, and the agent runs `kawa checkin --rebase` after fixing. Rebasing an already checked-in move is a different command, `kawa move rebase`, and makes a new object that supersedes it.

**Provenance stamp.** Every materialized head commit carries trailers `Kawa-Recipe: <recipe_hash>`, `Kawa-Base: <checkpoint>@<sha>` and `Kawa-In-Play: <ids, or a hash plus the stamps/<sha>.json path on kawa-meta for long lists>`. `kawa verify <branch>` recomputes them.

**Performance.** Incremental replay finds the longest unchanged prefix and only replays from the first change. The prefix key for position i is the JCS hash of the base identity, the `from_base` back-outs, the ids and canonical shas of objects 1..i, and every resolution binding whose pair lies within 1..i; changing an earlier binding therefore invalidates every later prefix. Streams over 500 objects (`max_stream_objects`) warn and suggest a checkpoint so the base absorbs the prefix. The limit is configurable.

**Line attribution: a per-file weave cache.** This is our own design choice. It's inspired by how the old tool appeared to behave, but the sample database didn't confirm it.
- **What's stored:** for each text file, the tool keeps `.git/kawa/cache/weave/<file-id>.json`, an ordered list of every line version ever seen across all objects: `{line_id, text, added_by, removed_by: [ids]}`. `added_by` is the seed or move id.
- **Weave line ids:** `line_id` is `<added_by>:<file_id>:<k>`, where k is the line's 0-based position among the lines that object added to that file, in the object's own diff. It never changes, so duplicate lines with the same text still have distinct ids, and it is unique across files. Claims, handovers and `line_map` always use the full id. Order in the list is weave order (a line sits after the line it was inserted after).
- **File identity:** `file-id` is the id of the object that created the file plus its path at creation, recorded per path in each object's `file_ids`. Renames keep the file-id. A delete and later re-create starts a new file-id. Case-only renames are tracked as renames (and are allowed by the path checks in §7).
- **Supersedes:** a supersede's `line_map` (§2) moves weave lines to the new object's ids, so the weave, claims and Line Owners keep pointing at the same lines.
- **How it's built:** when an object is checked in, carried or adopted, its single commit's diff (`git diff --unified=0 --find-renames=50%`, the same rename detection used to fill the object's `renames` and `file_ids` at check-in) is woven in once. A rename keeps the file's id and line ids, so attribution survives it.
- **Which bytes:** line ids describe LF-normalized text (see §8 line-ending policy). Files git treats as binary, or that match `binary_globs`, have no weave. It doesn't use `git blame`, because blame follows ancestry, not recipes.
- **How it's read:** a file's view for any set of in-play objects is a filter: show a line if its `added_by` is in-play and none of its `removed_by` is in play. Attribution, "lines removed by other in-play moves", compose previews and back-out previews are all filters, with no replay.
- **It's only a cache:** it isn't committed. `kawa cache rebuild` rebuilds it from canonical commits **plus** the folded `supersede` events (their `line_map`s) and resolution bindings, so line ids come out identical to the original. **Git replay still builds the real files** in `streams/<name>`. A test asserts that the weave view and the materialized file match.
- **When it can't be used:** files matching `binary_globs` get no weave. A move's `renames` move the weave to the new path, so attribution follows renames.

**"Lines removed by other in-play moves: N".** For move X in stream S, this is the count of lines that X added which a *later* in-play move in S then deleted or rewrote. It shows in the move panel. The reverse count, lines X removed that came from others (seeds or moves), also shows. Seeds get the same count ("lines of this seed removed by in-play moves").

**Accepting a dependency after check-in.** `kawa deps --accept B --on A` writes a signed `dep-accept` event `{object: B, on: A}`; it never edits B's object file. B's `stored` dependencies are its check-in `depends_on` plus every folded `dep-accept` (and `dep-reject`) event.

**Dependency detection** (B needs A). B depends on A, both in play in S (or its base) with A earlier. Each dependency is recorded as `{on, basis, confidence}`, where `confidence` is `hard`, `likely` or `candidate`:

| Basis | How it's found | Confidence |
|---|---|---|
| `creation` | B edits a file, or adds under a directory, that object A (seed or move) created | hard |
| `replay` | replaying S without A makes B's cherry-pick conflict (`deps --deep`, and always on back-out) | hard |
| `stored` | A is in B's accepted `depends_on` or `demands` (accepted on check-in, or later by a `dep-accept` event, so it survives cache loss) | hard |
| `symbol-precise` | Joern-backed analysis (reachability): B references a symbol that A introduced | hard |
| `symbol-candidate` | regex symbol extraction finds the same | likely |
| `textual` | a hunk of B is within 3 lines of lines owned by A, but doesn't overlap them | candidate |

Detected results are cached per recipe_hash.

**Backing out.** `kawa backout S X [Y ...]` (seeds or moves):
1. Compute the in-play dependents in S of everything being backed out, with their confidence levels. Dependents that are themselves in the back-out list don't count.
2. **Hard** dependents: refuse with exit 3, list them, and suggest `kawa backout S X Y Z` or `--force`.
3. **Likely** dependents: refuse with exit 3 unless `--yes`, listing them.
4. **Candidate** dependents: warn and continue. They never need approval.
5. **Approval:** a back-out that goes ahead past a hard or likely dependent (`--force` or `--yes`), or that backs out moves from more than one **site**, needs approval. (Agents on one site share a key, so ownership rules count sites, not `Agent-Id` labels; per-agent ownership is shown but never enforced.) It returns exit 8 with `error: "needs_approval"` and a `request_id`. Approval is **authenticated with an approver key, not a site key**. Each request has an immutable **scope**: the JCS hash of `{action, stream, base contains_hash, object ids with canonical shas}`. `kawa approve <request-id>` shows that scope in plain words and writes an `approve` event `{request_id, scope_hash, role}`; if the stream's state no longer matches the scope when the approval is applied, it's rejected and a new request is needed. The event is signed by Rich's approver key, or by a delegate approver's key. Rich's approver key is hardware-backed and kept off any site's `ssh-agent`. That stops casual misuse, but it is **not** a boundary against code running as Rich's own Windows user; see §10d. A flag alone approves nothing. Delegates (listed with role `approver` and an expiry in the registry on `main`, from M5) are narrowly scoped:
- they may approve routine forced back-outs only: not `purge`, not trust or registry changes, not base-object back-outs, and never a request that touches moves from their own site;
- their expiry is checked against fold time, and revoking a delegate takes effect at the next fold;
- a back-out that hits moves from more than one site needs Rich or two delegates.
Until M5, only Rich's approver key exists. The dry run lists every affected move grouped by owning bot, so each bot whose work is hit is named.
6. With no dependents, or once approved, mark the objects backed out and re-materialize. After a forced back-out, the collision rules apply.
7. **Build/test hook (optional):** set only in `.git/kawa/local.yaml: hooks.post_materialize` (or, for the integrator, in its reviewed workflow file, §7a), never from `kawa-meta`. It runs in the materialize worktree after **every** change to what's in play: check-in, carry, merge, back-out, restore, resolution bind and plain materialize. If it fails, the recipe change is rolled back (exit 5, `hook_failed`) unless `--keep`. This is how a back-out or restore that breaks a call in another file gets caught.

Every back-out and restore appends a backout or restore event (see §3). Each backed-out object gets `backed_out_by` in the stream file, and the UI shows a per-stream back-out history.

Backing out a seed that every later move touches therefore lists every one of them. That's intended, because removing a file's creation means removing its history in this stream.

An object that lives in the stream's base (a base seed or base move) can't be removed from the base itself, because checkpoints are frozen. `kawa backout` adds it to the stream as an explicit `{id, in_play: false, from_base: true}` entry. Materialize then can't start from the base checkpoint's tree. Instead it starts from the nearest `tree_index` entry **before** the backed-out object (or `cp/root/0`) and replays the rest of the base checkpoint's **cumulative** `contains` list (§3), in order, minus that object and any other `from_base` back-outs, with the resolution bindings recorded in the checkpoint, then the stream's own list. Nothing added between the root and the base is dropped. Bindings whose input blobs no longer match are reported as conflicts, never silently applied.

`kawa restore` (a restore event) puts X back at its original position, not at the end, and re-materializes. Carrying or merging a move whose dependencies, including its creating seeds, are missing from the target warns and offers `--with-deps`, which brings them along in dependency order.

**Heat**, as in the MVP: per file region, count author flips (consecutive moves from different `Agent-Id`s touching the region) plus collisions between agents in the same region within `window_days`.

## 6. UI requirements
The UI is a local web app (`kawa serve`), read-mostly, with actions behind confirm dialogs.

**Open moves (Rich's view).** The first page of the UI needs no CLI: every open move with its owner, agent@site, description, pending approvals, and the limbo list (orphaned work areas and moves checked in but never carried or PR'd). M4 builds it from local data. M5 adds PR links, claims (holder and expiry) and the integrator queue to the same page.

**Stream View (graph)**
- Each stream is a vertical column with its name as a header across the top. Checkpoints stack upward (for example `cp/v1/1` up to `cp/v1/6`), with the `.latest` head at the top. Lane color shows the stream's kind (for example vendor, beta or release).
- Moves checked in since the last checkpoint sit as a stack of chips on the stream, between the last checkpoint and `.latest`, so pending work is visible at a glance.
- Selecting a chip or a checkpoint fills a table under the graph listing the moves, with Id and Description columns.
- A mini-map overview sits in the lower-right corner of the graph. It shows the whole stream graph in miniature with a rectangle for the current viewport, and you drag or click the rectangle to scroll and jump around big graphs.
- The view has zoom in/out, a filter that narrows streams by name prefix, and a "type a version name" box that jumps to that stream (Tab cycles through matches).
- Fork edges run from a checkpoint to the start of the child lane.
- Objects are chips in each lane in replay order. Seeds are square chips and moves are round chips. Backed-out chips are grey and struck through, and conflict-pending chips are red.
- Hovering a move chip lists the files it touches, since one move spans many files.
- Dragging a chip, or a multi-selection, onto another lane opens a carry dry-run preview: conflicts, missing dependencies (including seeds), files touched. Confirming draws an arrow from source to target that stays for the session.
- Right-click a lane and choose "Merge into…" to merge.
- Each move chip links to its PR, its agent@site and its plain-English description. A **Limbo** filter shows moves checked in but never carried or PR'd.
- A side panel shows metadata: id, kind, Ref-Ids, group, author/agent, description, checkout and checkin descriptions, date, files, and canonical commit.

**Line Owners view (per file)**
- Left panel: the stream picker, then the file tree of the materialized stream.
- Centre: the file with a gutter showing the owner of each line: `<Base>` (an object in the base checkpoint, seed or move; hover shows its id, e.g. `seed.000001` or `move.000004`), a later seed or move id, or a resolution id. Each object gets a color, and the heat tint shows as a background.
- Right panel: lists of In play and Backed-out objects for this file, with the file's creating object (seed or move) first and then the others. Right-click an object for:
  - **Back out** or **Restore** (both run the back-out checks)
  - **Move report**: metadata, all files it touches with hunks, "Lines removed by other in-play moves: N", and its dependents and dependencies
  - **Diff two moves**: pick a second one
- **Compare mode**: side by side, *Current* (moves in play) against *What-if*, a hypothetical set the user toggles without saving that is computed with the compose API. Compare mode only **toggles** objects in or out of play (including base objects); it can't reorder objects or edit resolutions, so every what-if maps to backout and restore events.
  - Lines that differ are annotated, e.g. `[ move.000009 now in play: removes this line ]` or `[ move.000004 backed out: line back from Base ]`.
  - Making the creating seed backed out shows `[ seed.000003 backed out: file absent in this what-if ]`.
  - An "Apply snapshot" button never writes the recipe. It turns the what-if into the equivalent `backout`, `restore` and `carry` events (with the usual dependency checks and approvals), which the fold then applies.

## 7. Agent API (localhost JSON, default port 7420)
**Required before agents use the API.** These are blockers, not polish. No agent gets the API until all of them pass tests:
- **Auth:** a per-session token, created by `kawa serve` in `.git/kawa/session.token`, and required as `Authorization: Bearer` on every request. File permissions are user-only: `0600` on Linux and macOS; on Windows, `icacls` removes inherited ACEs and grants Full Control to the current user SID only (plus SYSTEM), and the server refuses to start if the ACL check fails. The server binds to 127.0.0.1 only. The one canonical origin is `http://127.0.0.1:<port>`: a request whose `Host` is `localhost:<port>` gets a redirect there, any other `Host` is rejected, and so is any `Origin` other than the canonical one (this defeats DNS rebinding).
- **UI token bootstrap:** `kawa serve` prints and opens a one-time URL `http://127.0.0.1:<port>/#boot=<nonce>`. The fragment never reaches logs. The page posts the nonce once to `POST /session`, which returns the session token; the page keeps it in `sessionStorage` for that tab only and sends it as `Authorization: Bearer`, so a reload keeps working. A tab that has a token can ask `POST /session/nonce` for a fresh one-time nonce to open a second tab; with no token at all, `kawa serve --open` prints a new nonce without a restart. `POST /session` is the **only** endpoint exempt from the Bearer and `Idempotency-Key` rules: the nonce is single-use, expires after 60s, is checked in constant time, and three failed tries end the bootstrap. Agents read the token file directly.
- **Input validation:** ids must match `^(move|seed|res)\.([a-z0-9-]{1,32}@[a-z0-9-]{1,32}\.)?\d{6}(-[a-z2-7]{6})?$` (the agent@site part is used in distributed mode, §7a), stream names `^[A-Za-z0-9._-]{1,100}$` (no `..`, no leading `-`), and paths must be relative, normalized and inside the repo with no `..` segment. git is always called with an argument array (never a shell). Revisions follow `--end-of-options`, and `--` comes only before paths, never before revisions.
- **Filesystem checks:** these apply to every path kawa **writes** and every path in a new check-in. For `init --adopt-history` and `adopt`, historical paths that fail them (for example a colon in a filename) are adopted as-is but flagged, and kawa refuses to materialize them on Windows rather than failing the whole adopt; the repo's own location may be under a junction. Before writing a path, kawa rejects symlinks and Windows junctions or reparse points anywhere on the path, alternate data streams (`:` in a path segment), reserved device names (`CON`, `NUL`, ...), trailing dots or spaces, and two **coexisting** paths that differ only in case (checked on every platform, since Windows and macOS fold case). A case-only rename, where the old spelling is removed in the same object, is allowed. Every rename's `from` and `to` go through the same checks.
- **Untrusted text:** commit messages, trailers, descriptions and file contents are data. They are escaped in the UI, never interpreted as commands, and trailers are parsed with a strict `Key: value` grammar.
- **Idempotency:** every POST requires an `Idempotency-Key` header, bound to the endpoint and the sha256 of the request body; the same key with a different endpoint or body is rejected (`idempotency_mismatch`, exit 4). **Correctness doesn't depend on the local cache:** the key is written into the resulting event or object as `request_key` (`site:<site>/<key>`; a schema field on every event and object), and the fold applies at most one event per `{site, request_key}` forever (a retried check-in returns the same id), so a retry after days offline is still deduplicated. The 24h results cache in `.git/kawa/idem/` only lets a retry return the first result quickly.

**Contracts.** Every request and response payload, plus the conflicts files, the stamp file and every kawa-meta file, has a versioned JSON Schema in `schemas/v1/*.json` (`$id` includes the version, and each schema carries `x-schema-version`). Schemas set `additionalProperties: false`, so unknown fields are rejected, and cap file size (64 KB per meta file by default) and the length of every array (`maxItems`). Lists that can legitimately be large (`paths`, `renames`, checkpoint `contains`) are chunked into hashed side files instead (§3), so the caps never block a large vendor drop. Responses carry `schema: "kawa/<name>/v1"`. Contract tests validate every endpoint's fixtures against the schemas, and a breaking change requires `v2`.

MVP endpoints. **Rename:** `GET /changeset/:id` is now `GET /move/:id`, and it serves both kinds of object.
- `GET /heat?stream=S&path=P` returns `[{path, start, end, score, agents[], flips, collisions}]`
- `GET /move/:id` (also `GET /seed/:id`) returns the object JSON plus `hunks[]` across all its files (paginated: `?page=&per_page=`, at most 200 files' hunks per page), the `streams[]` it appears in (with in-play flags), `dependents[]` and `dependencies[]`
- `POST /compose` with `{stream?, base, objects:[{id, in_play: true|false, from_base?: true}], paths?:[...]}` (a bare id string still means `in_play: true`), so a what-if can back out a base object returns `{ok, conflicts[], files:{path:{lines:[{text, owner}]}}}`. This is a virtual replay that writes nothing.
- `POST /gate` with `{agent, stream, paths:[{path,start,end}]}` returns `{advice:"ok"|"caution"|"collision", next_step?:"wait"|"ask_owner"|"stack", reasons[], hot_regions[], owners[], claims:[{holder, intent, expires}]}`. It is advisory only and never blocks. Checkout and checkin call it automatically.

Stream and object endpoints:
- `GET /streams` and `GET /streams/:name`
- `POST /streams` with `{name, base | fork_from:{stream, checkpoint?}}`
- `POST /streams/:name/checkpoint`
- `POST /streams/:name/carry` with `{from, objects[], dry_run, with_deps}`
- `POST /streams/:name/merge` with `{from, dry_run}`
- `POST /streams/:name/backout` with `{objects[], force, yes, dry_run}` (returns `needs_approval` with a `request_id` when §5 requires it), `POST /approve` with `{request_id}` (signed by the caller's approver key), and `POST /streams/:name/restore` with `{objects[]}`
- `POST /purge` with `{id, reason}` always returns `needs_approval` (exit 8) with a `request_id`; the purge runs only after an approval by Rich's key
- `POST /streams/:name/materialize`
- `GET /streams/:name/impact?path=P`
- `GET /objects?stream=&kind=&agent=`
- `POST /checkout` with `{stream, agent, description, ref_ids?, group?}`, which returns `{id, work_branch}`
- `POST /checkin` with `{id, description?, split?}`, which returns the object
- `POST /adopt` with `{commits[] | scan}` (already-adopted commits are skipped and listed)
- `POST /deps/accept` with `{object, on}`
- `POST /resolve` with `{stream, start | finish}`
- `GET /diff?a=move.000001&b=move.000002`

Writes take the repo write lock (`.git/kawa/lock`). Errors are returned as `{error, code, message, next_step?}` using the CLI's exit codes. `message` is plain text a bot can relay to Rich as is, e.g. "move.enjoy@desk.000120 can't be backed out yet: move.oss@box.000044 builds on it. Approve to back out both."

Views for agents and for Rich:
- `GET /view` (and the "Open moves" page in the UI, no CLI needed) lists open moves with owner, agent@site, PR link, plain-English description and state.
- `GET /limbo` lists moves that were checked in but never carried or turned into a PR, with their age.
- `GET /queue` shows the integrator queue (§7a).

## 7a. Distributed mode (GitHub as the hub)
Most of the GitHub mess so far came from agents on several machines (the shared box, cloud agents, and Enjoy on Rich's PC) stacking PRs that fought over one file, such as the five HoldTheIsle (then BattleForBritain) PRs on `engine.js`. Distributed mode coordinates them **with no server**. GitHub is the hub, and **GitHub is the source of truth** (§9).

**Shared state is the `kawa-meta` branch on GitHub.** It holds move metadata, events and claims. Every participant fetches it, makes its change, commits and pushes. If the push is rejected, it fetches, rebases its meta commit, re-validates, **re-signs the rebased commit** with its site key (events inside are signed individually, so their signatures survive), and retries (up to 5 times with jittered backoff, then exit 9). `kawa-meta` is protected on GitHub against force-push and deletion, and requires linear history and signed commits.

**Files are laid out so concurrent edits never conflict textually:**
- one file per move or seed: `objects/<id>.json`, written once and immutable. Later facts about a move (its PR link, a review flag, an accepted dependency) are not appended to the file; each is its own signed event, and changes to the object itself are supersedes (§2)
- stream changes as events, one file each: `events/<stream>/<event-id>.json` (`add`, `backout`, `restore`, `carry`, `merge`, `checkpoint`, `snapshot`, `supersede`, `resolution-bind`, `dep-accept`, `dep-reject`, `approve`, `purge`, `pr-link`, `claim-renew`, `claim-release`, `claim-handover`, `pr-open`, `backout-request`, `settings`)
- claims, one immutable file each: `claims/<claim-id>.json`

**Event ids and "already applied".** An event id is `<agent>@<site>.<n>` from that agent@site's counter, so it is unique without a clock. The fold applies each event id **at most once**: an event whose id was already applied, or whose content hash differs from an applied event with the same id, is ignored and reported. Events that update a fact (`pr-link`, `claim-renew`) name the event they replace in `replaces`; a re-landed old event that names a stale `replaces` is ignored, so a stale PR link can't come back. A fact's current value is the last event in its `replaces` chain; a fork in the chain (two events replacing the same one) is resolved by landed order and reported.

**Event order.** Events are ordered by the commit order in which they landed on `kawa-meta` (first-parent history), with ties inside one commit broken by event id order. Each event also carries `parent_event`: the **event id** of the latest event in that stream the writer had folded, plus `basis`, the hash of the in-play set it was made against. Machine clocks and ULIDs are never used for order. An event that names a parent older than the last fold or checkpoint of its stream is rejected, so a late or backdated event can't silently reorder a stream behind a checkpoint.

**Offline events are rebased, not lost.** Before pushing, `kawa push` and `kawa site push` re-fold the site's not-yet-landed events against the fetched state. An event is re-issued automatically only if its exact meaning is unchanged: the same canonical object ids and shas, dependencies, resolution bindings, base `contains_hash` and target effective set it was made against. Then it is re-issued as a new event with a new id, a fresh `parent_event` and `rebased_from: <old id>`; the old one is never pushed. If any of those changed, kawa shows the old and new meaning and the author must confirm or redo it. Approvals, purges, trust and registry changes are never rebased; a changed scope needs a new request. Nothing is silently dropped.

**How ordering is enforced.** Two layers, since there's no server:
- **Branch protection** on `kawa-meta`: no force-push or deletion, linear history, signed commits. A landed commit can't be reordered or removed.
- **Integrator validation:** an Actions workflow runs on every push to `kawa-meta` and folds it. It writes a signed `fold` record (`folded_through`, plus a `rejected` list of event ids with reasons: stale parent, bad signature, duplicate id, schema failure). It also writes a **heartbeat** fold record every 15 minutes even when nothing landed, so "unconfirmed" is short. The integrator signs with its own site key (site `ci`, role `integrator` in the registry, same registration and rotation rules); the key is an Actions secret available only to the signing step, never to the build hook. Every site runs the same deterministic validation, so even before the integrator's record lands, all sites ignore the same events; the record makes it auditable.

**The recipe (`streams/<name>.yaml`) is derived** by folding a stream's events in that order. No one hand-edits it. To keep it from bringing textual conflicts back, **only the integrator writes it**; everyone else treats it as a local, uncommitted view in `.git/kawa/cache/`, rebuilt from events, and `kawa doctor` verifies it. Every recipe change in every milestone (CLI commands, the UI's Apply snapshot, the API) is made by writing events, never by editing the recipe. This is the single code path in local mode too, where the local fold plays the integrator. Two agents adding moves at the same time both survive, in landed order.

**Compaction and snapshots (scale).** At each checkpoint, and every 1,000 events per stream, the integrator writes a signed `snapshot` event with the folded recipe and its event high-water mark. A fold starts from the latest valid snapshot instead of from the first event. Events older than two snapshots move to an archive branch `kawa-meta-archive` (kept, never deleted, and fetched by every site along with `kawa-meta`), and expired claims and their events are archived the same way. Each snapshot is self-contained for folding, and `kawa-meta` keeps a compact `index/` of every archived event id and `{site, request_key}`, so duplicate and idempotency checks never need the archive. The weave cache is rebuilt per checkpoint so it covers only objects since the base, plus a frozen per-checkpoint weave. Checkpoint records and their `tree_index` keep base back-outs and forks cheap at this scale (§3, §5). Gate reads only live claims and the current weave.

### Sites
Each repo copy is a **site** with its own `site_id` in `.git/kawa/local.yaml` (e.g. `desk` for Rich's PC, `box`, `vm-3`), like an offline GitHub. A site is a repo copy, not a machine: one machine can hold two sites (two clones), and each needs its own id.
- **Site registry:** `.kawa-trust/sites.yaml` on protected `main` lists each site: `{site_id, site_instance, public_key, transport: github | bundle, remote?, roles: [contributor | approver | integrator], approver_expires?}`. A site that re-inits gets a new `site_instance` through the same reviewed registry PR. Rich's key signs it, and changes go through a reviewed PR like the allowed-signers list (below). `kawa site list` reads it.
- **Moving work:** `kawa site push <site>` and `kawa site fetch <site>` move objects and events with git transport of `kawa-meta` and `refs/kawa/objects/*`, with GitHub as the usual go-between, or a bundle file for fully offline copies. Sites are how Enjoy on Rich's PC, the box and remote bots share work without anyone hosting a server.
- **Same-site clones:** copying a repo copies its `local.yaml`. `kawa init --remote` always makes a fresh `site_id` and `site_instance`, and a push from a `site_id` whose `site_instance` differs from the one registered for it is refused (`site_cloned`) until the copy re-inits as a new site.

**Move ids: per-agent@site counters,** `move.<agent>@<site>.<n>` and `seed.<agent>@<site>.<n>`, e.g. `move.enjoy@desk.000123`. Each agent@site keeps its own counter in `counters/<agent>@<site>`, and only that agent at that site ever writes it, so no two machines can collide and no clock is needed. A new id must be higher than the highest id that agent@site has already used in `kawa-meta` (checked on fetch and at push), so a site restored from backup can't reuse an id.
- **Online minting (default):** an id is minted only after a fresh fetch, and the counter bump is pushed before the object is signed. If that push loses a race, the id is re-minted before anything is signed, so no signed object ever carries a rejected id.
- **Offline minting:** a site that can't fetch mints `move.<agent>@<site>.<n>-<r>`, where `<r>` is 6 random base32 characters (30 bits), and `<n>` comes from a per-site offline batch range reserved in `kawa-meta` (and copied to `local.yaml`) the last time it was online, so another copy of that site can't use the same range. High-water checks compare the numeric `<n>` only. If a duplicate still happens, **first landed wins**: the push of the second `objects/<id>.json` fails as a file conflict, the pushing site keeps its object under a local staging name, mints a fresh id, and lands it as a supersede with reason `id_collision` that names the staging id (§2). The fold never sees two objects with one id. The ids stay short, readable and say who made the move and where, which matters in chat handoffs and the Line Owners view. A single-machine repo can keep using the bare `move.000123` form. The validation pattern becomes `^(move|seed|res)\.([a-z0-9-]{1,32}@[a-z0-9-]{1,32}\.)?\d{6}(-[a-z2-7]{6})?$`, and agent slugs must be unique per repo. Legacy aliases (`legacy-<sha7>`) are never ids; they're looked up through the `legacy_alias` field.

### Signed moves and identity
All pushes go through Rich's GitHub account, so GitHub's author field means nothing here. **`Agent-Id` is attribution, not authentication**: a well-formed forged trailer or event passes schema validation. Only a signature makes it authentication, and a signature only proves which **site** made a move.
- **Per-agent identity on one site is only a label.** All the bots on the shared box share one site key, so on the box `Agent-Id` says which bot claims a move but can't prove it. Real separation exists only between sites: the box, each cloud agent VM, and Rich's PC.
- **Signing:** each site has one SSH signing key, and git signs every canonical move commit and every `kawa-meta` commit with it (`gpg.format=ssh`). Only an object's **immutable core** is signed (the object file as written at check-in plus its canonical commit). Appended facts such as a PR link are separate events, each signed by the site that adds it. A move or event whose signature doesn't match its claimed site is flagged as a forgery and is never materialized.
- **Key storage:** the shared box keeps its single site key in `ssh-agent`, never in the repo or `/workspace`. Rich's PC uses the Windows `ssh-agent` or a hardware key. Cloud agent VMs each hold their own site key the same way.
- **Trust anchor:** an allowed-signers list (`.kawa-trust/allowed_signers`) kept outside `kawa-meta`, on protected `main` where Rich reviews every change, or pinned in each participant's local config. Rich's key signs the list. It is **never trusted from `kawa-meta` alone**, because anyone pushing as Rich could add a key there.
- **Registration:** a new site (or a bot on its own site) opens a PR adding its public key to the allowed-signers list, and Rich approves it.
- **Rotation:** a "new key" note must be co-signed by the old site key and Rich's anchor key, and it lands on `main`. A rotation signed only by the old key is rejected, since that key may be the compromised one.
- **Which key list governs a move:** the allowed-signers list and site registry record a validity interval per key (`valid_from_fold`, `valid_until_fold`), and every fold record pins the `main` commit of `.kawa-trust/` it used (`trust_pin`). A move or event verifies against the keys valid at the fold that **first** included it. So rotated keys still verify their old moves, and a revoked key verifies only what was folded before its `valid_until_fold`.
- **Revocation:** comes only from the anchor (a signed change to the list on `main`). It sets `valid_until_fold` on the key: anything first folded after that point fails, never judged by the move's own timestamp, which an attacker controls. After a revocation, moves already in a merged checkpoint stand but are flagged for review. Unmerged moves are quarantined until re-signed by a valid site key. Re-signing makes a new object with the same content that supersedes the quarantined one (§2); the old object and its ref stay as history.
- **Forgery check:** `kawa move list --signed-as me` lists every move signed with the asking site's key, so it can spot one it didn't make. On the shared box this covers the whole site, not one bot.

### Claims
Before editing, an agent pushes an immutable `claims/<id>.json` with `{agent, site, stream, anchors, intent, ttl}`. Anchors are full weave line ids (`<object>:<file_id>:<k>`, §5) or symbols, not raw line ranges, so a claim doesn't go stale when lines shift. When a claimed move is superseded (rebase, split, re-sign), gate follows the supersede's `line_map`, so the claim keeps covering the same lines.
- **Expiry uses the integrator's clock, never a writer's.** A claim's start is the time in the integrator's signed `fold` record for the fold that first included it, and it expires at start + `ttl`. Commit timestamps aren't used, since the writer sets them. **Before any fold record includes it, the claim fails closed:** gate treats it as live (so others get `caution` or `collision`) and shows it as `unconfirmed`. A later fold record can only shorten the window, never extend it, and there is **no local timer**: an unconfirmed claim stays live until a fold record includes it (heartbeats every 15 minutes keep that short). Gate advice is then the same on every site that has fetched the same records. If the integrator is down, unconfirmed claims stay live; Rich's view flags "integrator silent" after an hour, and `kawa claim release` still works.
- Claims last 4h by default (maximum 24h). `kawa claim` creates one, and checkin or cancel releases it automatically.
- **Renew, release and handover are new events, never rewrites:** `claim-renew` (a new `ttl` from its own fold time), `claim-release`, and `claim-handover {claim, to}`. Two renews that race both land and the later fold wins; a renew of an already-expired or released claim is rejected, so a retry can't resurrect it.
- **`kawa claim handover <claim> --to <agent>`** passes a claim on explicitly, so two bots don't keep taking the same job and cancelling each other.
- **When a claim expires mid-work:** the work area survives untouched. The holder's next kawa command warns it, and gate starts answering `ok` to others for those lines. If the holder doesn't renew within 24h, the work area becomes orphaned and appears in limbo (§5).
- Expired claims are ignored and archived at the next snapshot.
- Every claim shows its **holder, intent and expiry** in gate replies, `kawa claim list` and Rich's view, so a caution always says who to ask and until when.
- **No blocking in v1.** Overlapping claims return `caution` or `collision`, never a refusal.

### Gate
Gate is cheap and automatic: `kawa checkout` runs it on the stream, and `kawa checkin` runs it again on the touched paths, using the cached weave, heat and claims with no replay. Agents only call it directly to ask before they start. A `collision` reply carries `next_step`:
- `wait` (the claim expires soon; the expiry is given)
- `ask_owner` (names the holder and its contact agent)
- `stack` (build on top of the holder's move, with a `depends_on` link)

**Dependencies that travel.** Only `stored` dependencies are part of a move's shared metadata. Detected dependencies are recomputed by the integrator, which stamps the `analyzer_version` it used.

**Moves travel as refs.** Each checked-in object's canonical commit is pushed to `refs/kawa/objects/<id>` (the same single namespace as §2, for seeds, moves and resolutions), so any machine can fetch and replay any move. Checkpoint tags travel too: the remote refspecs are `refs/kawa/objects/*:refs/kawa/objects/*` and `refs/tags/cp/*:refs/tags/cp/*`, with **no `+`**. These refs aren't branches, so they don't appear in GitHub's branch or PR lists.

**Ref safety is detection plus recovery, not prevention.** No `+` only stops a well-behaved client from rewriting a ref; GitHub's protection rules don't cover arbitrary `refs/kawa/*`, so a bad push can still move or delete one. What makes that harmless: the object file stores the canonical sha, every reader rejects a ref whose sha doesn't match and fetches the right commit by sha instead, and the integrator keeps every canonical commit reachable from an append-only, branch-protected `kawa-objects` branch (one merge commit per object). A moved or deleted ref is restored from there by `kawa doctor --repair`.

**Back-out keeps the ref; purge is separate.** Backing out never deletes `refs/kawa/objects/<id>`, because restore, checkpoints and base replays need it on every fresh clone. For a leaked secret there's `kawa purge <id> --reason ...`, which **only Rich's approver key** can approve (no delegate). It writes a `purge` event, marks the object `purged`, marks every checkpoint whose `contains` includes it `invalid: purged`, reports which streams can no longer be rebuilt, and deletes its ref on GitHub and on every site that fetches afterwards. `kawa-objects` is append-only and protected, so kawa can't remove the commit from it; kawa prints the manual steps for Rich (lift protection, rewrite that branch without the object, restore protection). Affected streams must re-cut a checkpoint without it or move to a new base; a superseding replacement repairs the stream going forward, not the old checkpoint. **Purge is not erasure:** the content stays in materialized `streams/*` commits, checkpoint tags, PR branches and diffs, packfiles, forks, GitHub's caches and any offline clone or bundle. Rotate the secret; that is the only real fix.

### PRs: one move = one PR by default
**What a PR contains.** Streams stay local, so a PR is never "the stream." kawa builds the PR branch `<agent>/<full id>/pr` (separate from the work branch, which is gone after check-in) by starting from the current `origin/main` and replaying just that move (or the chain, in order) onto it, with a dry run first. If the move doesn't apply cleanly to `main`, that's an ordinary conflict (exit 2) and needs a resolution before the PR opens. GitHub's own `main` is mirrored as a stream named `main`, refreshed on every fetch. **Merge method:** a single-move PR is squash-merged and its squash commit is adopted as that move (§9). A chain PR, stacked PR or bundle is merged with a **merge commit or rebase merge, never squash**, so each move keeps its own commit and `Move-Id` trailer and each is adopted as its own move; kawa's `pr-open` event records the expected ids, and adoption checks them all. After the mergethe adopted moves land in the `main` stream, and the checkpoint tag goes on that stream and is pushed with the `cp/*` refspec.

Each move reaches `main` as **its own PR** by default, so Rich can review, test (for example, whether a human can still win HoldTheIsle) and merge or reject each fix on its own. The PR body links the move id, its agent@site, its Ref-Ids, a plain-English description and the provenance stamp, and the PR link is recorded as a signed `pr-link` event on the move, not by editing its object file.
- **Dependent moves:** a move with an unmerged hard or stored dependency can't pass CI alone. By default kawa opens **one PR per dependency chain** of up to 6 moves (the chain's moves in dependency order, one commit and title per move, each listed with owner and dry-run result). A longer chain opens **stacked PRs** instead (`--stacked` forces that for short ones too), each based on the previous move's branch. Chain membership is recorded in a `pr-open` event when the PR opens, never recomputed silently. After each bottom-up merge, kawa rebases the rest of the stack onto the new `main`, re-runs the dry run and hook, and refreshes the PRs. Rejecting one move in a chain PR backs it out (with the usual checks) and refreshes the PR. A chain that would be longer than 12 moves is refused with advice to split the work. Independent moves still get one PR each.
- **Bundling is optional** (`kawa bundle <stream> <ids...>`). A bundled PR lists each move with its owner and dry-run result, and Rich can still reject single moves: the integrator backs them out and refreshes the PR.
- **The integrator is optional.** Without one, the move's author (or its cloud agent) opens its own PR. When used, the integrator is a **GitHub Actions job**: a clean runner, no secrets available to the build hook, public logs, and one concurrency group per stream. It materializes, runs the hook, opens the PR, and after the squash merge adopts the result and tags the checkpoint. Its hook command lives in its workflow file on protected `main` (reviewed by Rich like any code), never in `kawa-meta`; the clean runner has no `local.yaml`. A PR opened with `GITHUB_TOKEN` won't trigger other workflows, so CI on it needs a GitHub App or a PAT.
- **The queue is visible to every bot:** `kawa queue` and `GET /queue` show what the integrator is about to bundle or open, with owners and dry-run results.
- 10thman delegator is the **coordinator**, not the integrator.

**Handoffs** happen by move id over whatever channel the bots already use (bot messaging, an issue comment, a task note), e.g. "carry move.enjoy@desk.000120 to stream release-1". The receiver runs `kawa carry` and pushes `kawa-meta`. Messages are requests, not authority: the receiver validates them like any other input.

### Who runs it
- **Cloud agents on remote VMs** install `kawa`, clone with `kawa init --remote` (their VM is its own site), and call checkout, gate and checkin themselves before opening their PR. Bots that only dispatch cloud agents, like BattleBot, pass the move id in the task.
- **While a move waits for review**, its author is free: the move is checked in, its claim is released, and the author can start the next checkout, stacking on its own pending move if it needs to. The open-moves view shows the wait.
- **Local agents (Enjoy, OpenCode and similar)** don't speak bot-to-bot. They work through local staging on Rich's PC, and Rich or a reviewer bot syncs that site.

### Local staging for Enjoy
Enjoy agents can work fully offline against a local stream and sync when Rich chooses:
- Each agent gets its own work area (`kawa checkout`), and moves check in to a local stream such as `enjoy-staging`.
- Rich, or a reviewer bot, reviews locally: Line Owners view, compose, and backing out anything bad.
- Enjoy integrates its own staging: `kawa site push` sends the moves, and each opens its own PR (or an optional bundle).

**First test:** the existing three-hourly HoldTheIsle `for-enjoy` workflow. Each labeled issue becomes one move in `enjoy-staging` and one PR, without a stack.

**Later, not in v1:** a small hosted coordination service with a live dashboard, faster locks than git push races, and webhooks. The file formats above are its API, so adding it later doesn't change them.

**Security.** Everything read from `kawa-meta` (objects, events, claims, counters) and every handoff message is untrusted input:
- Validate it against the `schemas/v1` schemas and the id, path and stream patterns before use, and reject or quarantine invalid files with a warning.
- Never execute anything from metadata. The hook command comes only from `.git/kawa/local.yaml`, and `settings.yaml` on `kawa-meta` has no executable fields at all (§3).
- An event whose site isn't in the allowed-signers list on `main` or local config, or whose signature fails, is ignored.
- Treat kawa-meta pushes like code: the integrator re-checks every move and signature it materializes.

## 8. Stack, layout and test plan
**Stack:** Node 20+ and TypeScript. All git use goes through the `StorageEngine` (git CLI through `execa`, no libgit2). It uses `commander` for the CLI, `fastify` for the API and static UI, `yaml`, and `diff`. The UI is Vite, React and plain CSS, with the graph drawn in SVG by hand or with `elkjs` for layout. Tests use `vitest`. It must run on Windows with Git for Windows, so paths go through `path`, there's no bash in runtime code, and there's an explicit **line-ending policy**: `kawa init` checks for (or offers to add) a `.gitattributes` with `* text=auto eol=lf` plus `-text` for binary globs; if it adds one to an existing repo, it runs `git add --renormalize .` and commits that as a separate plain commit **before** making `seed.000001`, so the seed captures LF content and the working tree is clean, and temp worktrees run with `core.autocrlf=false` and `core.eol=lf`. `core.autocrlf=false` alone only turns conversion off; the attributes are what normalize. Line ids and the weave describe the LF-normalized blob bytes.

Layout:
```
streams/
  src/storage/{engine.ts,git-engine.ts}
  src/core/{recipe.ts,objects.ts,checkin.ts,materialize.ts,attribution.ts,deps.ts,heat.ts}
  src/cli/index.ts   src/api/server.ts   schemas/v1/*.json   test/contract/
  web/ (vite app)
  test/fixtures/make-demo-repo.ts   test/*.test.ts
  BRANCHING.md  README.md
```
**Demo repo script** (`make-demo-repo.ts`, deterministic dates and authors):
- `seed.000001` (agent `rich`) creates `app.c` (10 lines) and `app.h`. It forms the base of checkpoint `cp/root/0`.
- Stream `v1` comes from root, and stream `v2` forks from `v1` at checkpoint `cp/v1/1`, which is cut after move.000001 is checked in to v1 (so `cp/v1/1` contains seed.000001 and move.000001).
- The objects:
  - move.000001 (agent `enjoy`, **made as 3 work commits**) adds a function at lines 3–5 of `app.c` plus a prototype in `app.h`, so one move touches two files
  - move.000002 (agent `oss`) edits line 8 of `app.c`
  - move.000003 (agent `enjoy`) modifies move.000001's line 4, so it depends on move.000001
  - seed.000002 (agent `reach`) creates `util.c`
  - move.000004 (agent `reach`) edits `util.c`, so it depends on seed.000002
  - move.000005 (agent `oss`) changes the same line 8 differently, colliding with move.000002

**Tests (each one checks the resulting file contents and owners):**
1. Check-in squashes move.000001's three work commits into **one** commit carrying `Move-Id: move.000001`, which touches both files.
2. Materializing v1 [move.000001, move.000002, move.000003] gives one commit per object with the expected files. The test compares **trees**, not SHAs: the result's tree matches the expected tree, each replay commit carries the right id, and running it twice is a no-op (same tree, no new replay).
3. Impact on `app.c`: base lines show `<Base>` (seed.000001), and other lines show the correct moves. move.000001 shows "Lines removed by other in-play moves: 1".
4. Backing out move.000002 from v1 rebuilds without the line-8 edit.
5. Backing out move.000001 is refused (exit 3) because of move.000003. Backing out both succeeds, and restoring brings both back in their original positions, in both files.
6. Carrying move.000004 into v1 without seed.000002 warns about the missing seed. With `--with-deps` it brings seed.000002 first.
7. Backing out seed.000002 is refused because of move.000004 (a creation dependency). With both backed out, `util.c` disappears from the materialized stream.
8. Back-carry: carrying move.000003 from v1 to v2, then a new v2 move back to v1, works in both directions.
9. Merging v1 → v2 adds only the missing objects.
10. Carrying move.000005 into a stream that has move.000002 gives a conflict (exit 2), leaves the recipe unchanged, and dry-run reports the same. A seed whose file already exists reports `path_exists`.
11. Compose with no writes: the git refs are byte-identical before and after. Compose with `{id: seed.000001, in_play: false, from_base: true}` renders `app.c` and `app.h` as absent and reports `missing_file` conflicts for move.000001, move.000002 and move.000003, which edit them.
12. With move.000002 (agent `oss`) in play and a live claim by `oss` on line 8, gate for agent `enjoy` on line 8 returns "collision" naming `oss`, with `next_step`.
13. The weave view equals the materialized file for every stream after tests 1–10, and `cache rebuild` gives an identical weave. Backing out and restoring move.000002 logs a backout and then a restore event with `backed_out_by` set and then cleared.
14. `adopt --scan` turns each plain commit into one move. A legacy `Change-Set-Id` group becomes one squashed move. Running the same scan again adopts nothing.
15. Resolution in replay (own fixture: stream v3 with move.000002 then move.000005, kept with `--keep-pending`): a resolution bound with `resolution-bind` changes `recipe_hash`, so materialize rebuilds and succeeds with move.000005's commit carrying `Kawa-Resolved-By`; the resolved line is owned by the resolution in Line Owners, and weave == materialized. Backing out move.000002 makes the binding skip. Carrying the pair into a stream with an extra edit to `app.c` between them leaves the binding unbound (input blobs differ) and reports the conflict.
16. Merge doesn't resurrect: back out move.000002 in v2, then merge v1 → v2; move.000002 stays backed out and is reported as `skipped_backed_out`.
17. Carrying move.000002 into a stream that already has the same change gives an empty pick, one empty commit with `Kawa-Empty: true`, and `already_applied`.
18. A reused `Idempotency-Key` with a different body returns `idempotency_mismatch`.
19. Backing out a base move (`from_base: true`) in v2 keeps every other object of `cp/v1/1`.
20. `move split` makes two new ids at the old position in dependency order, a `supersede` event, and is refused if move.000001's dependent move.000003 isn't re-pointed; with re-pointing, move.000003 follows. (M1 asserts only the split, the supersede event and the re-pointing.)
20b. (M5) After the split in test 20, a claim on a split line still matches via `line_map`.
21. A case-only rename `app.h → App.h` (made with `git mv` so the index records it on case-insensitive filesystems) checks in, the object's `renames` and `file_ids` show it as a rename on Linux, macOS and Windows runners, and attribution is kept; adding `App.h` next to an existing `app.h` is rejected.
22. A hook that calls `kawa impact` runs without deadlocking; a hook that calls `kawa carry` is refused.
23. On a Windows runner with CRLF working files, test 13 still holds, both on the fresh demo and on an existing CRLF repo after `kawa init` renormalizes it.
24a. Checkpoint transition: `kawa checkpoint v1` empties v1's own list, the new record's `contains` is cumulative, and materialize afterwards replays nothing.
24b. Base back-out from `tree_index`: on a generated fixture of 60+ objects, backing out the base object at index 60 restarts from the `tree_index` commit at 50 and gives the same tree as a full replay without it.
25. A split check-in (`--split`) of work that adds `new.c` and edits `app.c` makes a seed then a move, two refs, and `depends_on` from move to seed.
26. Backing out move.000002 with test 15's binding in place makes the binding inactive and move.000005 replays alone without a reported conflict.
27. A purge returns exit 8; after an approval with Rich's key, it marks `cp/*` records containing the object `invalid: purged`.
28. An approval whose scope no longer matches the stream is rejected.
29. A chain PR of two moves merged by merge commit adopts two moves with their original ids.
30. Two concurrent checkouts on v1 get separate worktrees and work branches; both check in, and both moves land in v1 in order.
31. Stale base: after another move lands on v1 that conflicts with a pending checkout, `kawa checkin` exits 6 with a conflicts file; after fixing, `kawa checkin --rebase` completes it.
32. `kawa cancel` on a checkout, then `kawa checkout --resume` within 30 days, restores the work area and work branch, and the id is not reissued to anyone else.
33. Killing `kawa checkin` at each step (after squash, after object write, before the event) leaves nothing half-written: either the move and its event exist, or neither does, and a re-run with the same `Idempotency-Key` returns one move.
34. Incremental replay after adding one object to v1 gives the same tree as a full replay from the base.
35. (Windows runner) A file whose full path is over 260 characters checks in, materializes and diffs correctly.

Smoke test on real data: `init --adopt-history` against HoldTheIsle. The first commit, or each commit that only adds files, becomes a seed, and every later commit becomes one move with a normal id and `legacy_alias: "legacy-<sha7>"`, which the CLI and `/move/:id` accept as a lookup. Then run impact on one file and `deps` across its stacked PRs.

## 9. Milestones for Enjoy, and how the team helps
- **M1, CLI core:** StorageEngine (git), the object model (seeds and moves), **the event log and local fold** (single site, local fold as integrator), event ids and `counters/local`, site-key signing of objects and events on the one local site, supersede events, init, checkout and checkin with squash and split, add, adopt, stream create/fork/checkpoint with cumulative `contains`, list/show, materialize with deterministic replay, carry, merge, back-out/restore (without dependency checks), dry-run, conflict reports, worktrees, the lock queue, cancel, the stale-base checkin, the provenance stamp and incremental replay. Tests 1, 2, 4, 8, 9, 10, 14, 16, 17, 20, 24a, 25 and 30–35. *Owners:* Code quality scanner (tests and coverage, Windows CI matrix), 10thman-OSS (licenses, pins, dogfood scan).
- **M2, attribution and dependencies:** the weave cache (with line ids, file ids, renames and binary globs), resolutions bound into replay, stored `depends_on`, change groups, impact, lines-removed counts, `move diff`, deps with basis and confidence, confidence-based back-out rules, Rich's approver key and signed approvals, `dep-accept` events, the post-materialize hook with lock release, base-object removal with `tree_index`, and `--with-deps`. Tests 3, 5, 6, 7, 13, 15, 19, 21, 22, 23, 24b, 26, 27 and 28. *Owners:* reachability (dependency review), Code quality scanner (the weave == materialized property test).
- **M3, agent API:** the "Required before agents use the API" gate, JSON Schemas and contract tests, all endpoints including `/move/:id`, `/checkout` and `/checkin`, plus heat and gate. Tests 11, 12 and 18, plus the HoldTheIsle smoke test. *Owners:* WSRA Scanner (security pass), WSRAKB scraper (schemas, contract tests, the stamp), reachability (symbol dependencies next).
- **M4, web UI:** built only on the tested M3 API. Stream View with seed and move chips and drag-to-carry, the Line Owners view with compare mode, and the open-moves page from local data (M5 adds its distributed panels).
- **M5, distributed mode (§7a):** the shared fold on `kawa-meta` in landed commit order (reusing M1's local fold), offline event rebasing, heartbeat fold records, the `kawa-objects` branch and `doctor --repair`, chunked side files, PR building from `origin/main` and the `main` stream, chain caps and stack refresh, sites and `agent@site` ids and counters, signed moves and meta commits with one key per site, the Rich-signed allowed-signers list on `main` or local config, registration by PR, anchor co-signed rotation and revocation, claims with holder, expiry, renew and handover, line-id or symbol anchoring, gate integration, `refs/kawa/objects/*` push and fetch with sha checks, event ids applied at most once, fold records and integrator validation, snapshots and the archive branch, the site registry and `site_cloned` check, online and offline id minting, signed approvals and delegate approvers, `kawa purge`, one PR per dependency chain or stacked PRs, the push-retry loop, one-move-one-PR and optional bundles, the GitHub Actions integrator, resync from GitHub, `kawa push`, the Rich view and limbo view, and validation of fetched metadata. Tests: two clones pushing at the same time (both events survive and ids never collide), a backdated event is rejected, a moved or deleted move ref is detected and restored from `kawa-objects`, an offline event against a stale checkpoint is rebased or reported (never silently lost), a duplicate offline id is rejected at fold, an unsigned or wrongly signed move is flagged, an id at or below a site's highest used id is rejected, an oversized or unknown-field meta file is rejected, claim overlap gives a caution, expired claims are ignored, a re-landed old event is ignored, a renew of an expired claim is rejected, a cloned site's push is refused, an unsigned approval approves nothing, and a malicious or invalid meta file is rejected. The race tests run against a real GitHub test repo, not only bare remotes. Tests 20b and 29. Pilot: the HoldTheIsle `for-enjoy` batch, one PR per move. *Owners:* 10thman delegator (coordination and pilot), WSRA Scanner (security review of meta input and signing; its pass is part of M3 and is extended here), WSRAKB scraper (owner of the M5 meta-file schemas: `x-schema-version`, unknown-field rejection, size and array caps), Code quality scanner (multi-clone race tests on Windows and Linux against the GitHub test repo), reachability (dependencies across moves from different machines).

**Milestone order note:** the event log, fold and signing are built in M1 for one local site, and approvals in M2, so M5 adds distribution (more sites, the shared branch, the registry, delegates) without rewriting any write path.

Each milestone is one PR or a short stack (at most two deep) under BRANCHING.md:
- no direct pushes to `main` after the first import, and branches named `<agent>/<topic>`
- the consuming pillar reviews, then the delegator merges
- no secrets or bulky outputs

**BRANCHING.md needs one edit:** its `Change-Set-Id` trailer becomes `Move-Id` (one per squash commit), next to `Agent-Id`. A squash-merged single-move PR is then exactly one move. Chain and bundle PRs are merged without squash (§7a), so each move keeps its own commit.

Help from the 10th-man team:
- **WSRA Scanner:** the M3 security pass, then a "hosts added by this move" hook on `/move/:id`.
- **WSRAKB scraper:** the API schemas and contract tests, the M5 meta-file schemas, plus help with the materialize stamp.
- **Code quality scanner:** a test and coverage review each milestone, the weave == materialized property test, and a Windows CI matrix (CRLF, case-only renames, long paths). Also taskbench integration: one task = one `kawa checkout` worktree, `kawa checkin --json --no-split` when done, with exit 8 mapped to needs-approval, exit 2 to "fix the conflict" (the agent's own job), and exit 3 to blocked.
- **reachability:** the dependency-detection review, then Joern-backed symbol dependencies after M3.
- **10thman-OSS:** a license and pin review each milestone, plus an SBOM, vuln and license dogfood scan on every milestone PR.
- **10thman delegator:** coordinates (not the integrator, since it can't push), merges, and applies the trailer rename in BRANCHING.md.
- **Change impact (me):** impact notes, the demo repo, and first agent user of the API.

**Where 10th-man would use it.**
- A release stream per vuln-DB snapshot.
- Backing out a bad analyzer fix and running compose to see which verdicts change.
- Line owners to trace a bad agent move.
- Finding which move added an outbound URL, with a gate on new external hosts.

**Rule: GitHub is the source of truth.** Streams next to GitHub PRs can disagree, and this rule settles it:
- KawaNagare reads `main`, but never pushes to it.
- `streams/*` branches stay local.
- When Rich merges, closes or renames something by hand in GitHub (as with BattleForBritain → HoldTheIsle), kawa resyncs on the next fetch (within 15 minutes when the integrator runs, from its heartbeat): a merged PR's squash commit is adopted as one move (`kawa adopt --scan origin/main`). Adoption is idempotent and follows **first parents**: a merge commit on `main` is adopted per first-parent diff, or, for a kawa chain or bundle PR, as the separate moves its `pr-open` event lists. It matches the `Move-Id` trailer if GitHub kept it, otherwise the PR number from the `pr-link` event, and writes an adopt marker `adopted/<commit-sha>` naming the move, so a later scan skips it and dependents keep pointing at the same id; a closed PR writes a `backout-request` event citing the PR, which goes through the normal §5 checks (dependents, approval, hook): if they pass, the move is backed out; if not, the refusal shows in Rich's view and nothing changes, and a repo rename only updates the remote. Kawa never "fixes" GitHub to match itself.
- A stream change reaches GitHub only as an ordinary PR from a `<agent>/<topic>` branch.

## 10. Questions for Rich (the build uses these defaults)
1. Did a seed have to be pure additions, or could it hold a file's first version plus an edit to an existing file? *Default:* check-in offers to split; moves may add files.
2. Is replay order by the order it was added or by date? *Default:* landed order.
3. When backing out a seed or move that others depend on, should it be refused or just warned about? *Default:* hard and likely dependents refuse, and going past them needs a signed approval (§5).
4. Should the repo itself be `rkosinski941/kawanagare`, or live inside the viewer project? *Default:* its own repo; needed before M1 starts.

*Settled by the sample findings:* phases were a development → staging → production ladder with phase locking. We reserve `phase:` for v2 and drop the earlier question.
*Resolved:* materialized `streams/*` branches stay local by default (see §9's caution).
*Resolved in v6:*
- **Old Q1, editing a checkpointed move:** objects are immutable; an edit is a new object that supersedes the old one (§2).
- **Old Q6, merge scope:** merge adds what A has that B's effective set lacks, with no merge high-water mark (§2).

*Resolved in round 2:*
- **Q7, integrator:** the GitHub Actions integrator job (§7a) for shared repos. Enjoy integrates its own staging. 10thman delegator is the coordinator, not the integrator.
- **Q8, blocking claims:** no blocking in v1 (unanimous).
- **Q9, claim expiry:** 4h default (measured from when the claim landed) plus `kawa claim renew` (unanimous).
- **Q10, existing PRs:** the open GitHub PRs are finished the old way before distributed mode starts (unanimous).
- reachability's repo stays local-only, so M5 doesn't apply there.

## 10a. DeepSeek round 1: answers and what changed
DeepSeek reviewed v4. Each answer is summarized, followed by what v5 does about it.

**From Change impact (me):**
1. **Is a weave over git viable?** *DeepSeek:* only as a derived cache with stable line identity and file lifecycle; costs O(history) per file. *v5:* weave line ids and file ids (§5), and per-checkpoint weaves with compaction (§7a). Git replay stays the source of the real files.
2. **Serverless claims conflict-free?** *DeepSeek:* no; renew, release and handover rewrite one file and race. *v5:* claim files are immutable; renew, release and handover are new events, and a renew of an expired claim is rejected (§7a).
3. **agent@site ids safe?** *DeepSeek:* the high-water check covers restores, not clones or offline copies. *v5:* fresh `site_id` and `site_instance` on every init, `site_cloned` refusal, online minting before signing, and a random suffix for offline ids (§7a).
4. **Where it breaks at scale?** *DeepSeek:* event history and the weave first, then replay length and the PR queue. *v5:* signed snapshots, archive branch, per-checkpoint weaves (§7a); the 500-object checkpoint warning stays.
5. **One move = one PR?** *DeepSeek:* right for independent fixes, wrong for dependent chains. *v5:* one PR per dependency chain by default, or `--stacked` (§7a).

**From the 10th-man team:**
1. **Fold determinism.** *DeepSeek:* only on a frozen branch; rebase breaks signatures; stale parents can land. *v5:* events signed individually, rebased meta commits re-signed, branch protection plus integrator validation with a signed `fold` record and identical validation on every site (§7a).
2. **Smallest real authentication.** *DeepSeek:* per-site keys, signed meta commits, anchor-signed registry; a compromised site still signs valid forgeries. *v5:* kept as designed, and the brief now says plainly that a key proves the site, not the bot. Approvals now need a signed key (§5).
3. **Moved or deleted refs.** *DeepSeek:* can't change a stream alone, but can break restore and checkpoint replay. *v5:* back-out keeps the ref; only an approved `kawa purge` deletes it, with an explicit warning (§7a).
4. **Crafted meta input.** *DeepSeek:* fetched hook config, traversal, junctions, UNC and ADS, git option parsing, and `--` before revisions. *v5:* hooks only in `.git/kawa/local.yaml`, `settings.yaml` is data only, `--end-of-options` before revisions, filesystem checks (§3, §7).
5. **Weave == materialized.** *DeepSeek:* no; resolution is the clearest break, plus renames, CRLF, case-only renames and duplicate lines. *v5:* resolutions applied inside replay (§5), line ids for duplicates, file ids for renames and re-creates; CRLF and case-only renames stay in the Windows CI matrix and the property test (§9).
6. **Squash-merge then adopt.** *DeepSeek:* only if GitHub keeps the trailer and adopt is idempotent. *v5:* adopt markers, match by `Move-Id` or PR number from `pr-link` (§9).
7. **Appended signed facts.** *DeepSeek:* forgery fails, but replay of an old signed event is possible. *v5:* event ids applied at most once, plus `replaces` chains (§7a).
8. **Restored or cloned site.** *DeepSeek:* a clone with the same `site_id` still acts as the same site. *v5:* `site_instance` and `site_cloned` (§7a).
9. **Clock skew and claims.** *DeepSeek:* landed commit time is still the writer's clock. *v5:* expiry from the integrator's fold time; `unconfirmed` until then (§7a).

The v4 blocking contradictions (resolution after the conflict, fetched config, immutability vs split/rebase/re-sign, two ref namespaces, back-out deleting refs, base back-out, merge resurrection, missing dep-accept event, recipe writers, unenforced ordering, undefined line ids, dependent PRs, site registry) and the unclear items (approval auth, empty picks, hook coverage, compose, local state, UI token, Windows ACLs, git arguments, path checks, idempotency binding, base moves, locking wording, event ids, test numbering, test 12, legacy alias, adopt marker, missing commands, title) are each addressed in the section named above or in §1–§9.

## 10b. DeepSeek round 2: answers and what changed
DeepSeek reviewed v5. Its answers to the round-2 questions, and what v6 does:
1. **Resolution in replay.** *DeepSeek:* pair binding plus whole-file contents isn't enough; a carried resolution can overwrite other lines. Bind to the input blob hashes. *v6:* resolutions are data objects recording base, ours, theirs and result blobs per conflicted path; they apply only on an exact input match, never to a path that didn't conflict, travel with the pair, and are part of `recipe_hash` (§5).
2. **Fold record down.** *DeepSeek:* first-fetch fallback is site-dependent and extendable; fail closed and add heartbeats. *v6:* unconfirmed claims fail closed (treated as live), capped at 24h, fold records only shorten, 15-minute heartbeats (§7a).
3. **Supersede chains.** *DeepSeek:* split with dependents is ambiguous, order can break, re-sign changes every line id. *v6:* `derived_from`, explicit re-pointing of dependents or the split is refused, a topological check at fold, and `line_map` for claims and the weave (§2, §5, §7a).
4. **Base back-out at 500.** *DeepSeek:* acceptable with conditions; pin `contains` as cumulative; keep trees per checkpoint. *v6:* cumulative `contains`, `tree_index` every 50 objects, bindings in the record (§3, §5).
5. **Offline suffix.** *DeepSeek:* 4 characters is too short and "can't collide" was false. *v6:* 6 characters plus a reserved offline batch range, numeric high-water only, duplicates rejected at fold and repaired by an `id_collision` supersede (§7a).
6. **Chain PRs.** *DeepSeek:* long chains recreate the big PR. *v6:* chain cap 6, stacked above, refusal above 12, membership recorded at open, stack refresh after each merge, per-move reject (§7a).
7. **Purge and checkpoints.** *DeepSeek:* a replacement doesn't repair old checkpoints; purge isn't erasure. *v6:* affected checkpoints marked `invalid: purged` and re-cut, and the spec says plainly that only rotation fixes a leak (§7a).
8. **Delegate approver.** *DeepSeek:* only narrowly scoped, and a site key isn't Rich. *v6:* a separate approver key never in a site's `ssh-agent`, delegates limited to routine forced back-outs, fold-time expiry, two delegates for cross-site (§5).

**Its 25 contradictions and 14 failure cases, and the v6 fix for each:**
- C1 recipe writers and build state: `materialized` moved to `.git/kawa/cache/`; only the integrator's fold commits the recipe (§2, §3).
- C2, C8 milestone order: event log, fold and signing in M1; approvals in M2 (§9).
- C3 case-only renames: allowed; only coexisting case twins are rejected (§7).
- C4, test 23 line endings: `.gitattributes` policy plus `core.eol=lf` (§8).
- C5, F8 checkpoint SHAs and tags: deterministic replay, identity `{contains_hash, tree}`, `cp/*` refspec (§3, §5, §7a).
- C6, F13 branch names: `<agent>/<full id>`, never reused (§4).
- C7 exit codes: 2 conflict, 8 needs approval; taskbench mapping fixed (§4, §9).
- C9, C10, F1 resolutions: data objects with blob-hash binding and in-play-by-binding attribution (§5).
- C11, F2 `recipe_hash`: includes base contents, `from_base` and bindings (§5).
- C12 merge: uses B's effective set; pending conflicts retried (§2).
- C13 creation: any creating object (§1, §5).
- C14, F9 `contains`: cumulative (§3).
- C15, F11 claims after supersede: `line_map` (§2, §7a).
- C16, F10 size caps: chunked side files (§3, §7).
- C17 integrator hook: from its reviewed workflow file (§5, §7a).
- C18 v1 scope: v1 = M1–M5, single-site then distributed (§1).
- C19 PR contents: built on `origin/main`, the `main` stream, checkpoint target (§7a).
- C20 closed PRs: `backout-request` with full checks (§9).
- C21, F5 purge: Rich-only approval, honest limits, invalid checkpoints (§7a).
- C22 ref safety: detection plus recovery from `kawa-objects` (§7a).
- C23 `/session`: explicit exemption and nonce rules (§7).
- C24 split order: inserted at the old position in dependency order (§2, §5).
- C25 stale questions: old Q1 and Q6 resolved (§10).
- F3 renames: `--find-renames` in the weave diff, `file_ids` in the object (§5).
- F4 hook deadlock: lock released before the hook; `KAWA_HOOK=1` (§5).
- F6 offline events: rebased before push, or reported (§7a).
- F7 idempotency: `request_key` deduplicated by the fold forever (§7).
- F12 first page at M4: local data first, distributed panels in M5 (§6, §9).
- F14 localhost: one canonical origin with a redirect (§7).
- Smaller defects: `Seed-Id` typo, `counters/local` and `stamps/` in the layout, bare-id conversion, `checkin --depends-on`, `checkin --rebase` vs `move rebase`, `--force` meaning, non-JSON exit 3, `parent_event` type, integrator signing key, tests 11 and 15.

## 10c. DeepSeek round 3 (final): answers and what changed
DeepSeek reviewed v6 and said it wasn't buildable until its items 1–14 were fixed. Its answers to the round-3 questions, and what v7 does:
1. **Strict resolution binding.** *DeepSeek:* stay strict in v1; whole-file results can't be applied loosely; hunk-level needs a different artifact (v2). *v7:* strict stays; a failed match pre-fills a new resolution from the old one (§5).
2. **Deterministic replay across git versions.** *DeepSeek:* trees are stable for the same index, but cherry-pick isn't stable across versions or platforms; identity must be `{contains_hash, tree}` with canonical bytes; signed heads can't be deterministic. *v7:* commit-sha equality is no longer promised; pinned git version and `ort` backend, recorded in each checkpoint; JCS for every hash; replay commits and heads unsigned (§3, §5).
3. **Offline event rebasing.** *DeepSeek:* a re-check can pass while the meaning changes. *v7:* automatic re-issue only on an exact match of ids, shas, deps, bindings, base and effective set; otherwise the author confirms; approvals, purges and trust changes are never rebased (§7a).
4. **Approver key on Rich's PC.** *DeepSeek:* not a boundary against code running as the same user; needs a second device or a token with an on-device display and per-request touch. *v7:* stated plainly in §5; the choice of device is a known open issue for M2 below.

**Its 38 numbered items, and the v7 fix for each:**
- 1 checkpoint-to-base transition: defined as one atomic fold step (§3); test 24a (and 24b for base back-out).
- 2 work and PR branch names: `<agent>/<id>/work` and `<agent>/<id>/pr` (§4, §7a).
- 3 split at check-in: two ids, two commits, two refs, one event (§2); test 25.
- 4 purge: always a request, exit 8, runs after Rich's approval (§4, §7); test 27.
- 5 duplicate offline ids: reserved ranges in `kawa-meta`, first landed wins, the loser re-mints and supersedes (§7a).
- 6 line ids across files: `<object>:<file_id>:<k>` (§5).
- 7 cache rebuild: folds supersede `line_map`s and bindings (§5).
- 8 `request_key`: a schema field on objects and events (§3, §7).
- 9 size caps: more fields chunked, hunks paginated (§3, §7).
- 10 chain PRs: never squash-merged; each move adopted with its own id (§7a, §9); test 29.
- 11 claim expiry: no local timer; same advice on every site (§7a).
- 12 `site_instance`: in the registry (§7a).
- 13 revocation vs old moves: key validity intervals plus `trust_pin` (§7a).
- 14 same-site forgery: ownership and approval rules count sites, not `Agent-Id` (§5).
- 15 base back-out commit: `tree_index` stores the replay commit (§3).
- 16 sha determinism: no longer promised (§5).
- 17 inactive bindings: defined (§5); test 26.
- 18 `checkin --rebase`: one meaning only (§2, §4).
- 19 exit codes: same with or without `--json`; 9 for push retries (§4, §7a).
- 20 UI reload: `sessionStorage`, fresh-nonce endpoint, `serve --open` (§7).
- 21 canonical origin: now actually in §7 (it had been lost from the v6 text).
- 22 missing event kinds: `pr-open`, `backout-request`, `settings`; `replaces` forks (§7a).
- 23 Line Owners labels: creating object, base move ids shown (§6).
- 24 merge commits: first-parent adoption (§3, §9).
- 25 path policy vs old repos: new writes only; adopted paths flagged (§7).
- 26 renormalize at init: separate commit before the seed (§8); test 23 on an existing repo.
- 27 canonical hash bytes: RFC 8785 JCS (§3).
- 28 prefix cache: key includes bindings and base (§5).
- 29 compaction: archive fetched by every site; `index/` on `kawa-meta` (§7a).
- 30 cancel and ids: ids never reused; cancel is undoable for 30 days (§4, §5).
- 31 approval scope: immutable scope hash (§5); test 28.
- 32 resolution schema: both variants, fingerprint checked (§5).
- 33 test 8: `cp/v1/1` cut after move.000001 (§8).
- 34 test 21: platform-specific setup and rename assertion (§8).
- 35 trust drift: `trust_pin` per fold and checkpoint (§3, §7a).
- 36 settings: event-sourced and in `recipe_hash` (§3).
- 37 compose vs UI: compare mode is toggle-only (§6).
- 38 changelog accuracy: §10b's claims for `checkin --rebase`, non-JSON exit 3 and the canonical origin are now true in the body.
- Editorial: §10 renumbered, the `x3.2.x` placeholder replaced, recipe language made consistently event-based.

## 10d. Known open issues for build
These are deliberately left open. Each must be settled, by the named owner, before the milestone listed. Nothing here blocks M1.
| # | Issue | Settle by | Owner |
|---|---|---|---|
| 1 | Repo location (§10 Q4) | before M1 starts | Rich |
| 2 | Which git version and minimum Git for Windows to pin, and confirming Linux and Windows give the same trees on the demo fixture | M1 (CI matrix) | Code quality scanner, which owns the pin in the M1 CI matrix |
| 3 | Approver device: hardware token with on-device display and per-request touch, or a phone or second-device approval showing the scope. Required for purge, trust and registry changes and delegate grants | M2 | Rich, WSRA Scanner |
| 4 | Whether a passphrase-only approver key is allowed at all for routine back-outs | M2 | Rich, WSRA Scanner |
| 5 | Hunk-level resolution reuse (a different artifact) | after v1 | Change impact |
| 6 | Per-agent keys on a shared site, if same-site attribution must become authentication | M5 | WSRA Scanner |
| 7 | Chain-length caps (6 and 12) and the 15-minute heartbeat: tune from the HoldTheIsle pilot | M5 pilot | 10thman delegator |
| 8 | Large-repo budget (replay time with a 500-object base and a test hook) | M2 | Code quality scanner |
