import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { RepoContext } from "./context.js";
import { Recipe, foldStream } from "./fold.js";
import {
  CheckpointRecord,
  computeRecipeHash,
  fromBaseBackouts,
  inPlayObjects,
  readCheckpointRecordByTag,
} from "./recipe.js";
import { readObject } from "./objects.js";
import { KawaError, conflict, EXIT, badInput } from "./errors.js";
import { normalizeMessage, withTrailers } from "./trailers.js";
import { jcsHash } from "./jcs.js";

export interface MaterializeResult {
  stream: string;
  branch: string;
  head: string;
  tree: string;
  replayed: string[];
  already_applied: string[];
  empty: string[];
  skipped: boolean;
  recipe_hash: string;
}

interface PrefixEntry {
  key: string;
  commit: string;
  tree: string;
}

interface ReplayCache {
  recipe_hash: string;
  prefix: PrefixEntry[];
}

export interface BaseInfo {
  tag: string;
  commit: string;
  tree: string;
  record: CheckpointRecord;
}

export interface MaterializeOptions {
  dryRun?: boolean;
  worktreeSuffix?: string;
  force?: boolean;
}

export async function resolveBase(ctx: RepoContext, recipe: Recipe): Promise<BaseInfo> {
  const tag = recipe.base;
  if (!tag) throw badInput(`stream ${recipe.name} has no base checkpoint`);
  const record = await readCheckpointRecordByTag(ctx, tag);
  if (!record) throw badInput(`checkpoint record for ${tag} is missing`);
  const commit = await ctx.git.tryRevParse(`refs/tags/${tag}`, ctx.root);
  if (commit) {
    const tree = await ctx.git.treeOf(commit, ctx.root);
    if (tree === record.tree) return { tag, commit, tree, record };
  }
  const candidates = [...record.tree_index].sort((a, b) => b.at - a.at);
  for (const c of candidates) {
    const ok = await ctx.git.tryRevParse(c.commit, ctx.root);
    if (!ok) continue;
    const tree = await ctx.git.treeOf(ok, ctx.root);
    if (tree === record.tree) return { tag, commit: ok, tree, record };
  }
  if (record.sha_hint) {
    const ok = await ctx.git.tryRevParse(record.sha_hint, ctx.root);
    if (ok) {
      const tree = await ctx.git.treeOf(ok, ctx.root);
      if (tree === record.tree) return { tag, commit: ok, tree, record };
    }
  }
  throw badInput(`cannot resolve the tree for base checkpoint ${tag}`);
}

export async function materializeStream(
  ctx: RepoContext,
  stream: string,
  opts: MaterializeOptions = {},
): Promise<MaterializeResult> {
  const folded = await foldStream(ctx, stream);
  if (!folded.recipe.created) throw badInput(`stream ${stream} does not exist`);
  return await materializeRecipe(ctx, folded.recipe, opts);
}

export async function materializeRecipe(
  ctx: RepoContext,
  recipe: Recipe,
  opts: MaterializeOptions = {},
): Promise<MaterializeResult> {
  const stream = recipe.name;
  const base = await resolveBase(ctx, recipe);
  const objects = inPlayObjects(recipe);
  const recipeHash = await computeRecipeHash(ctx, recipe, {
    contains_hash: base.record.contains_hash,
    tree: base.record.tree,
  });

  const branch = `refs/heads/streams/${stream}`;
  const cache = await readReplayCache(ctx, stream);
  const prefixKeys = await computePrefixKeys(ctx, recipe, base, objects);

  let startIndex = 0;
  let startCommit = base.commit;
  let startTree = base.tree;
  for (let i = 0; i < objects.length; i++) {
    const cached = cache?.prefix[i];
    if (cached && cached.key === prefixKeys[i] && (await ctx.git.tryRevParse(cached.commit, ctx.root))) {
      startIndex = i + 1;
      startCommit = cached.commit;
      startTree = cached.tree;
    } else {
      break;
    }
  }

  const existingBranch = await ctx.git.tryRevParse(branch, ctx.root);
  const upToDate =
    !opts.force &&
    !!cache &&
    cache.recipe_hash === recipeHash &&
    !!existingBranch &&
    startIndex === objects.length &&
    (await ctx.git.treeOf(existingBranch, ctx.root)) === startTree;
  if (upToDate) {
    return {
      stream,
      branch,
      head: existingBranch!,
      tree: startTree,
      replayed: [],
      already_applied: [],
      empty: [],
      skipped: true,
      recipe_hash: recipeHash,
    };
  }

  if (startIndex === objects.length && objects.length > 0) {
    // Object list is unchanged; rebuild the last commit so its provenance stamp is current.
    startIndex = objects.length - 1;
    const prev = startIndex > 0 ? cache?.prefix[startIndex - 1] : null;
    if (prev && prev.key === prefixKeys[startIndex - 1] && (await ctx.git.tryRevParse(prev.commit, ctx.root))) {
      startCommit = prev.commit;
      startTree = prev.tree;
    } else {
      startCommit = base.commit;
      startTree = base.tree;
    }
  }

  const commitAt: string[] = new Array(objects.length).fill("");
  const treeAt: string[] = new Array(objects.length).fill("");
  for (let i = 0; i < startIndex; i++) {
    if (cache?.prefix[i] && cache.prefix[i].key === prefixKeys[i]) {
      commitAt[i] = cache.prefix[i].commit;
      treeAt[i] = cache.prefix[i].tree;
    }
  }

  const wt = path.join(
    ctx.cacheDir,
    "replay-wt",
    safeName(stream) + (opts.worktreeSuffix ?? ""),
  );
  await removeWorktree(ctx, wt);
  await addWorktree(ctx, wt, startCommit);

  const replayed: string[] = [];
  const already: string[] = [];
  const empties: string[] = [];
  let head = startCommit;
  let headTree = startTree;

  try {
    for (let i = startIndex; i < objects.length; i++) {
      const id = objects[i];
      const obj = await readObject(ctx, id);
      if (!obj.commit) throw badInput(`object ${id} has no canonical commit`);
      const canonical = await ctx.git.tryRevParse(obj.commit, ctx.root);
      if (!canonical) throw badInput(`canonical commit for ${id} is missing`);

      const pick = await ctx.git.run(["cherry-pick", "-n", canonical], { cwd: wt });
      const unmerged = await ctx.git.run(["diff", "--name-only", "--diff-filter=U"], { cwd: wt });
      const conflictedPaths = unmerged.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      if (pick.exitCode !== 0 || conflictedPaths.length > 0) {
        const emptyPick = /empty/i.test(pick.stderr + pick.stdout) && conflictedPaths.length === 0;
        if (!emptyPick) {
          await ctx.git.run(["reset", "--hard", head], { cwd: wt });
          await ctx.git.run(["cherry-pick", "--quit"], { cwd: wt });
          const payload = {
            stream,
            object_id: id,
            paths: conflictedPaths,
            ours: head,
            theirs: canonical,
            created_at: new Date().toISOString(),
          };
          if (!opts.dryRun) {
            ctx.writeMetaFile(`conflicts/${stream}.json`, JSON.stringify(payload, null, 2) + "\n");
          }
          const local = path.join(ctx.conflictsDir, `${stream}.json`);
          await fsp.mkdir(path.dirname(local), { recursive: true });
          await fsp.writeFile(local, JSON.stringify(payload, null, 2) + "\n", "utf8");
          throw conflict(`carrying ${id} into ${stream} conflicts; the stream was left unchanged`, {
            object_id: id,
            paths: conflictedPaths,
            conflicts_file: local,
          });
        }
        await ctx.git.run(["reset", "--hard", head], { cwd: wt });
      }

      const staged = await ctx.git.run(["diff", "--cached", "--quiet"], { cwd: wt });
      const isEmpty = staged.exitCode === 0;

      let message = normalizeMessage(await ctx.git.messageOf(canonical, ctx.root));
      const extra: [string, string][] = [];
      if (isEmpty) extra.push(["Kawa-Empty", "true"]);
      if (i === objects.length - 1) {
        extra.push(...buildStampTrailers(base, objects, recipeHash));
      }
      message = withTrailers(message, extra);

      const author = await ctx.git.authorOf(canonical, ctx.root);
      const tree = (await ctx.git.writeTreeIndex(wt)).trim();
      const commit = await ctx.git.commitTree({
        cwd: ctx.root,
        tree,
        parents: [head],
        message,
        author,
        committer: { name: "kawa", email: "kawa@invalid", date: author.date },
      });
      await ctx.git.run(["reset", "--hard", commit], { cwd: wt });
      head = commit;
      headTree = tree;
      commitAt[i] = commit;
      treeAt[i] = tree;
      replayed.push(id);
      if (isEmpty) {
        empties.push(id);
        already.push(id);
      }
    }

    if (objects.length === 0) {
      const author = await ctx.git.authorOf(base.commit, ctx.root);
      const trailerLines = buildStampTrailers(base, objects, recipeHash)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      const message = `kawa materialize ${stream}\n\n${trailerLines}\n`;
      const commit = await ctx.git.commitTree({
        cwd: ctx.root,
        tree: base.tree,
        parents: [base.commit],
        message,
        author,
        committer: { name: "kawa", email: "kawa@invalid", date: author.date },
      });
      head = commit;
      headTree = base.tree;
    }
  } finally {
    await removeWorktree(ctx, wt);
  }

  if (!opts.dryRun) {
    await ctx.git.runOk(["update-ref", branch, head], { cwd: ctx.root });
    const prefix: PrefixEntry[] = objects.map((_, i) => ({
      key: prefixKeys[i],
      commit: commitAt[i] || head,
      tree: treeAt[i] || headTree,
    }));
    await writeReplayCache(ctx, stream, { recipe_hash: recipeHash, prefix });
    const matRel = path.join(ctx.cacheDir, "materialized", `${safeName(stream)}.json`);
    await fsp.mkdir(path.dirname(matRel), { recursive: true });
    await fsp.writeFile(
      matRel,
      JSON.stringify(
        { branch: `streams/${stream}`, sha: head, tree: headTree, recipe_hash: recipeHash },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  return {
    stream,
    branch: `streams/${stream}`,
    head,
    tree: headTree,
    replayed,
    already_applied: already,
    empty: empties,
    skipped: false,
    recipe_hash: recipeHash,
  };
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}

function buildStampTrailers(
  base: BaseInfo,
  objects: string[],
  recipeHash: string,
): [string, string][] {
  return [
    ["Kawa-Recipe", recipeHash],
    ["Kawa-Base", `${base.tag}@${base.commit}`],
    ["Kawa-In-Play", objects.join(",")],
  ];
}

async function computePrefixKeys(
  ctx: RepoContext,
  recipe: Recipe,
  base: BaseInfo,
  objects: string[],
): Promise<string[]> {
  const commits: string[] = [];
  for (const id of objects) {
    const obj = await readObject(ctx, id);
    commits.push(obj.commit);
  }
  const fromBase = fromBaseBackouts(recipe);
  const bindingKeys = recipe.resolutions.map((r) => ({ id: r.id, pair: r.conflict_of }));
  const keys: string[] = [];
  for (let i = 1; i <= objects.length; i++) {
    const sliceIds = objects.slice(0, i);
    const relevantBindings = bindingKeys.filter((b) => b.pair.every((id) => sliceIds.includes(id)));
    keys.push(
      jcsHash({
        base: { tag: base.tag, tree: base.tree, contains_hash: base.record.contains_hash },
        from_base: fromBase,
        objects: sliceIds.map((id, idx) => ({ id, commit: commits[idx] })),
        bindings: relevantBindings,
      }),
    );
  }
  return keys;
}

async function readReplayCache(ctx: RepoContext, stream: string): Promise<ReplayCache | null> {
  const rel = path.join(ctx.cacheDir, "replay", `${safeName(stream)}.json`);
  try {
    return JSON.parse(await fsp.readFile(rel, "utf8")) as ReplayCache;
  } catch {
    return null;
  }
}

async function writeReplayCache(
  ctx: RepoContext,
  stream: string,
  cache: ReplayCache,
): Promise<void> {
  const rel = path.join(ctx.cacheDir, "replay", `${safeName(stream)}.json`);
  await fsp.mkdir(path.dirname(rel), { recursive: true });
  await fsp.writeFile(rel, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

async function addWorktree(ctx: RepoContext, dir: string, commit: string): Promise<void> {
  await fsp.mkdir(path.dirname(dir), { recursive: true });
  const res = await ctx.git.run(["worktree", "add", "--force", "--detach", dir, commit], {
    cwd: ctx.root,
  });
  if (res.exitCode !== 0) {
    throw new KawaError(5_00, `cannot create replay worktree: ${res.stderr.trim()}`, EXIT.BAD_INPUT);
  }
}

async function removeWorktree(ctx: RepoContext, dir: string): Promise<void> {
  if (fs.existsSync(dir)) {
    await ctx.git.run(["worktree", "remove", "--force", dir], { cwd: ctx.root });
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await ctx.git.run(["worktree", "prune"], { cwd: ctx.root });
  }
}
