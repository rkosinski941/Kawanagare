# KawaNagare: what you'd see as a user (brief v7)

KawaNagare helps bots in shared GitHub repos see collisions early and undo work safely. This is the outside view only.

## The words
- **Move:** one change, possibly to many files. `move.oddjobs@box.000042` is bot `oddjobs`'s 42nd move at site `box`. Ids are never reused.
- **Stream:** an ordered list of moves that kawa builds into a set of files, like "main game" or "release". The same move can be in several streams.
- **Carry:** add a move to another stream as well; it stays where it was. **Back out:** take it out of one stream. **Restore:** put it back in the same place.
- **Site:** one copy of the repo (not a website or a machine). Each site has its own streams; moves travel between sites.
- **Claim:** "I'm on these lines." **Limbo:** work nobody is finishing. **Bundle:** an optional PR of several unrelated moves.

## A day with it
1. **`checkout`** gives you a private kawa work area (not `git checkout`). A collision check runs. It **warns, never blocks**: you see who holds a claim on your lines, when it expires, and whether to wait, ask them, or stack your move on theirs.
2. **`checkin`** makes one move and prints its id (it's also on Rich's page). You can check in some files only. Splitting a move later gives two new ids; history and "who did what" follow them.
3. **While it waits for review**, start your next move.
4. **Hand off** by sending "carry move.oddjobs@box.000042 to release" on any channel. The receiving bot treats it as a request: it checks the move's signature and dependencies and does a dry run before carrying. Knowing an id lets you ask; it doesn't bypass any check.
5. **If a carry conflicts**, nothing changes. You, the bot doing the carry, write a small resolution for that pair. It's reused later only if the files on both sides are exactly what it was written against; otherwise you're asked to redo it, starting from the old one.
6. **If you back out the wrong thing**, `restore` puts it back.
7. **Who did what:** any line shows which move added it, who and why, even long after the PR merged.

## The clocks (wall-clock time)
| | When | What happens |
|---|---|---|
| Claim | 4 h, renew any time before it ends | **When it ends, your work is safe but others stop being warned.** After that, start a new claim. |
| Limbo | 1 day after the claim ends | Your work area is kept, outside every stream; resume it any time. |
| Cancel | after 7 days in limbo, by anyone | Frees the work area; it's recoverable for 30 more days. |

## Approvals
Rich approves (or a delegate he names, for routine cases): backing out moves others build on, or moves from several sites. Purging a leaked secret and adding a site need Rich himself. Each approval names exactly what it covers; if things change first, it has to be asked again.

## Sites and keys
Moves travel with `kawa site push` and `kawa site fetch`, through GitHub. **Every site has one key shared by all its bots, so a signature proves the site, not the bot.** On the shared box, another bot could make a move under your name. Separate sites (your own VM) are the real separation.

## What it doesn't protect against
- Two bots editing the same lines after a warning.
- A bot on your own site using your name.
- A leaked secret: kawa stops using it, but copies stay in git and GitHub. Change the secret.

## What stays the same
- **GitHub is the source of truth.** Kawa never pushes to `main`; people merge PRs as today, and kawa checks merged results against what it built. It picks up hand merges, closes and renames within about 15 minutes. A hand-closed PR backs its move out only if the checks pass; otherwise the move stays and Rich's page flags it.
- **One move = one PR.** Dependent moves go up as one PR per chain (up to 6; longer chains become stacked PRs).
- **Rich's page** (local, for Rich and the bots on that site): open moves, owners, PR links, approvals waiting, claims and expiry, the integrator's queue of PRs to open, and limbo. Errors are plain sentences, so you can pass them on when a human has to act.

## What we want from you
Your gut reaction: what's confusing, annoying or missing, and what would stop you trusting it?
