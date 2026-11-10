import path from "node:path";
import { RepoContext } from "./context.js";
import { Recipe } from "./fold.js";
import { badInput, conflict, depRefusal } from "./errors.js";
import { getRecipe, listStreams, streamExists } from "./streams.js";
import { materializeRecipe, materializeStream, resolveBase } from "./materialize.js";
import { readObject, tryReadObject, ObjectFile, writeObject } from "./objects.js";
import { mintEvent } from "./events.js";
import { commitEvent } from "./metaops.js";
import { inPlayObjects, readRecipe } from "./recipe.js";
import { moveId, seedId } from "./ids.js";
import { reserveNumber } from "./events.js";
import {
  blobOf,
  createCanonical,
  nowIso,
  treeEntries,
  writeTreeFromContent,
} from "./work.js";

function cloneRecipe(recipe: Recipe): Recipe {
  return JSON.parse(JSON.stringify(recipe)) as Recipe;
}

async function requireRecipe(ctx: RepoContext, stream: string): Promise<Recipe> {
  if (!(await streamExists(ctx, stream))) throw badInput(`stream ${stream} does not exist`);
  const recipe = await getRecipe(ctx, stream);
  if (!recipe) throw badInput(`stream ${stream} does not exist`);
  return recipe;
}

async function baseContains(ctx: RepoContext, recipe: Recipe): Promise<string[]> {
  const base = await resolveBase(ctx, recipe);
  return base.record.contains;
}

async function effectiveSet(ctx: RepoContext, recipe: Recipe): Promise<string[]> {
  return [...(await baseContains(ctx, recipe)), ...inPlayObjects(recipe)];
}

async function treeOfStream(ctx: RepoContext, stream: string): Promise<string> {
  const mat = await materializeStream(ctx, stream);
  return mat.tree;
}

async function checkSeedPaths(
  ctx: RepoContext,
  targetTree: string,
  ids: string[],
  to: string,
): Promise<void> {
  for (const id of ids) {
    if (!id.startsWith("seed.")) continue;
    const obj = await readObject(ctx, id);
    for (const p of obj.paths) {
      const exists = await ctx.git.run(["cat-file", "-e", `${targetTree}:${p}`], { cwd: ctx.root });
      if (exists.exitCode === 0) {
        throw conflict(`${id} cannot be carried to ${to}: ${p} already exists there`, {
          error: "path_exists",
          path: p,
        });
      }
    }
  }
}

export interface CarryOptions {
  ids: string[];
  from: string;
  to: string;
  group?: string | null;
  dryRun?: boolean;
  withDeps?: boolean;
  keepPending?: boolean;
  agent: string;
}

export interface CarryResult {
  added: string[];
  skipped: string[];
  warnings: string[];
  dry_run: boolean;
}

export async function carry(ctx: RepoContext, opts: CarryOptions): Promise<CarryResult> {
  const source = await requireRecipe(ctx, opts.from);
  const target = await requireRecipe(ctx, opts.to);
  if (opts.ids.length === 0) throw badInput("carry needs at least one object id");

  const sourceInPlay = new Set(inPlayObjects(source));
  for (const id of opts.ids) {
    if (!sourceInPlay.has(id)) throw badInput(`${id} is not in play in ${opts.from}`);
  }

  const effective = new Set(await effectiveSet(ctx, target));
  const toAdd: string[] = [];
  const warnings: string[] = [];

  const addWithDeps = async (id: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    const obj = await tryReadObject(ctx, id);
    if (!obj) return;
    for (const dep of obj.depends_on) {
      if (effective.has(dep) || seen.has(dep)) continue;
      if (!opts.withDeps) {
        warnings.push(`${id} depends on ${dep}, which is not in ${opts.to}`);
        continue;
      }
      await addWithDeps(dep, seen);
    }
    if (!toAdd.includes(id)) toAdd.push(id);
  };

  const seen = new Set<string>();
  for (const id of opts.ids) await addWithDeps(id, seen);

  // A seed collides if a file it creates already exists in the target.
  await checkSeedPaths(ctx, await treeOfStream(ctx, opts.to), toAdd, opts.to);

  const trial = cloneRecipe(target);
  for (const id of toAdd) trial.objects.push({ id, in_play: true });

  const dryRun = opts.dryRun === true;
  try {
    await materializeRecipe(ctx, trial, {
      dryRun: true,
      worktreeSuffix: dryRun ? "-carry-dry" : "-carry-check",
    });
  } catch (err) {
    throw err;
  }

  if (dryRun) {
    return { added: toAdd, skipped: [], warnings, dry_run: true };
  }

  const ev = await mintEvent(ctx, opts.agent, opts.to, "carry", {
    from: opts.from,
    objects: toAdd,
    ...(opts.group ? { group: opts.group } : {}),
    ...(opts.keepPending ? { keep_pending: true } : {}),
  });
  await commitEvent(ctx, ev, opts.agent);
  await materializeStream(ctx, opts.to);
  return { added: toAdd, skipped: [], warnings, dry_run: false };
}

export interface MergeOptions {
  from: string;
  to: string;
  includeBackedOut?: boolean;
  dryRun?: boolean;
  agent: string;
}

export interface MergeResult {
  added: string[];
  skipped_backed_out: string[];
  dry_run: boolean;
}

export async function merge(ctx: RepoContext, opts: MergeOptions): Promise<MergeResult> {
  const source = await requireRecipe(ctx, opts.from);
  const target = await requireRecipe(ctx, opts.to);
  const targetEffective = new Set(await effectiveSet(ctx, target));
  const sourceEffective = await effectiveSet(ctx, source);

  const targetEntries = new Map(target.objects.map((o) => [o.id, o]));
  const added: string[] = [];
  const skipped: string[] = [];

  for (const id of sourceEffective) {
    if (targetEffective.has(id)) continue;
    const entry = targetEntries.get(id);
    if (entry && !entry.in_play && !entry.pending_conflict && !opts.includeBackedOut) {
      skipped.push(id);
      continue;
    }
    added.push(id);
  }

  if (added.length === 0) {
    return { added: [], skipped_backed_out: skipped, dry_run: !!opts.dryRun };
  }

  const trial = cloneRecipe(target);
  for (const id of added) trial.objects.push({ id, in_play: true });
  await materializeRecipe(ctx, trial, { dryRun: true, worktreeSuffix: "-merge-check" });

  if (opts.dryRun) {
    return { added, skipped_backed_out: skipped, dry_run: true };
  }

  const ev = await mintEvent(ctx, opts.agent, opts.to, "merge", {
    from: opts.from,
    objects: added,
    skipped_backed_out: skipped,
  });
  await commitEvent(ctx, ev, opts.agent);
  await materializeStream(ctx, opts.to);
  return { added, skipped_backed_out: skipped, dry_run: false };
}

export interface BackoutOptions {
  stream: string;
  ids: string[];
  reason?: string;
  dryRun?: boolean;
  force?: boolean;
  yes?: boolean;
  group?: string | null;
  agent: string;
}

export interface BackoutResult {
  backed_out: string[];
  dry_run: boolean;
  warnings: string[];
}

export async function backout(ctx: RepoContext, opts: BackoutOptions): Promise<BackoutResult> {
  const recipe = await requireRecipe(ctx, opts.stream);
  const base = await baseContains(ctx, recipe);
  const warnings: string[] = [];
  const inList = new Set(recipe.objects.map((o) => o.id));

  for (const id of opts.ids) {
    if (base.includes(id) && !inList.has(id)) {
      throw badInput(
        `${id} lives in the base of ${opts.stream}; backing out base objects is not part of M1`,
      );
    }
    const entry = recipe.objects.find((o) => o.id === id);
    if (!entry) throw badInput(`${id} is not in ${opts.stream}`);
    if (!entry.in_play) throw badInput(`${id} is already backed out of ${opts.stream}`);
  }

  const trial = cloneRecipe(recipe);
  for (const id of opts.ids) {
    const entry = trial.objects.find((o) => o.id === id);
    if (entry) entry.in_play = false;
  }

  await materializeRecipe(ctx, trial, { dryRun: true, worktreeSuffix: "-backout-check" });

  if (opts.dryRun) return { backed_out: opts.ids, dry_run: true, warnings };

  const ev = await mintEvent(ctx, opts.agent, opts.stream, "backout", {
    objects: opts.ids,
    reason: opts.reason ?? null,
    ...(opts.group ? { group: opts.group } : {}),
  });
  await commitEvent(ctx, ev, opts.agent);
  await materializeStream(ctx, opts.stream);
  return { backed_out: opts.ids, dry_run: false, warnings };
}

export interface RestoreOptions {
  stream: string;
  ids: string[];
  agent: string;
}

export async function restore(ctx: RepoContext, opts: RestoreOptions): Promise<{ restored: string[] }> {
  const recipe = await requireRecipe(ctx, opts.stream);
  const trial = cloneRecipe(recipe);
  for (const id of opts.ids) {
    const entry = trial.objects.find((o) => o.id === id);
    if (!entry) throw badInput(`${id} is not in ${opts.stream}`);
    entry.in_play = true;
    delete entry.backed_out_by;
    delete entry.event;
    delete entry.pending_conflict;
  }
  await materializeRecipe(ctx, trial, { dryRun: true, worktreeSuffix: "-restore-check" });
  const ev = await mintEvent(ctx, opts.agent, opts.stream, "restore", { objects: opts.ids });
  await commitEvent(ctx, ev, opts.agent);
  await materializeStream(ctx, opts.stream);
  return { restored: opts.ids };
}

export interface SplitOptions {
  id: string;
  paths: string[];
  stream?: string;
  repoint?: Record<string, string[]>;
  agent: string;
}

export interface SplitResult {
  old: string;
  new: string[];
  supersede_event: string;
}

export async function splitMove(ctx: RepoContext, opts: SplitOptions): Promise<SplitResult> {
  const old = await readObject(ctx, opts.id);
  if (old.kind !== "move") throw badInput(`${opts.id} is a seed, not a move`);
  if (opts.paths.length === 0) throw badInput("move split needs --paths");

  let streamName = opts.stream;
  if (!streamName) {
    const candidates: string[] = [];
    for (const s of await listStreams(ctx)) {
      const r = await readRecipe(ctx, s);
      if (r && (await effectiveSet(ctx, r)).includes(opts.id)) candidates.push(s);
    }
    if (candidates.length !== 1) {
      throw badInput("move split needs --stream when the object is in zero or several streams");
    }
    streamName = candidates[0];
  }
  const recipe = await requireRecipe(ctx, streamName);
  const entry = recipe.objects.find((o) => o.id === opts.id);
  if (!entry && !(await baseContains(ctx, recipe)).includes(opts.id)) {
    throw badInput(`${opts.id} is not in ${streamName}`);
  }

  const dependents: string[] = [];
  for (const e of recipe.objects) {
    if (e.id === opts.id || !e.in_play) continue;
    const obj = await tryReadObject(ctx, e.id);
    if (obj?.depends_on.includes(opts.id)) dependents.push(e.id);
  }
  const repoint = opts.repoint ?? {};
  const missing = dependents.filter((d) => !repoint[d] || repoint[d].length === 0);
  if (missing.length > 0) {
    throw depRefusal(
      `${opts.id} cannot be split: ${missing.join(", ")} build on it. Re-point them with --repoint.`,
      { dependents: missing },
    );
  }

  const oldCommit = await ctx.git.revParse(old.commit, ctx.root);
  const parent = await ctx.git.parentOf(oldCommit, ctx.root);
  if (!parent) throw badInput(`${opts.id} has no parent commit`);
  const oldPaths = old.paths;
  const paths1 = opts.paths.filter((p) => oldPaths.includes(p));
  const paths2 = oldPaths.filter((p) => !paths1.includes(p));
  if (paths1.length === 0) throw badInput("none of the --paths are touched by this move");
  if (paths2.length === 0) throw badInput("splitting would leave the second move empty");

  const parentEntries = await treeEntries(ctx, parent);
  const all: Record<string, Buffer | string> = {};
  for (const [p] of parentEntries) all[p] = await blobOf(ctx, parent, p);
  const tree1 = await overlay(ctx, all, oldCommit, paths1);
  const files2 = { ...all };
  for (const p of paths1) {
    // tree1 content may differ from parent; rebuild from tree1 for the second step
  }
  const tree1Entries = await treeEntries(ctx, tree1);
  const files2b: Record<string, Buffer | string> = {};
  for (const [p] of tree1Entries) files2b[p] = await blobOf(ctx, tree1, p);
  const tree2 = await overlay(ctx, files2b, oldCommit, paths2);

  const date = nowIso();
  const n1 = await reserveNumber(ctx, "move");
  const n2 = await reserveNumber(ctx, "move");
  const id1 = moveId(n1);
  const id2 = moveId(n2);

  const commit1 = await createCanonical(ctx, {
    kind: "move",
    id: id1,
    tree: tree1,
    parent,
    agent: opts.agent,
    description: `${old.description} (part 1)`,
    checkinDescription: null,
    refIds: old.ref_ids,
    date,
  });
  const commit2 = await createCanonical(ctx, {
    kind: "move",
    id: id2,
    tree: tree2,
    parent: commit1,
    agent: opts.agent,
    description: `${old.description} (part 2)`,
    checkinDescription: null,
    refIds: old.ref_ids,
    date,
  });

  const base1: ObjectFile = {
    ...old,
    id: id1,
    description: `${old.description} (part 1)`,
    paths: paths1,
    commit: commit1,
    base_sha: parent,
    created_at: date,
    supersedes: opts.id,
    derived_from: opts.id,
    depends_on: [],
    file_ids: Object.fromEntries(paths1.map((p) => [p, old.file_ids[p] ?? `${id1}:${p}`])),
  };
  const base2: ObjectFile = {
    ...old,
    id: id2,
    description: `${old.description} (part 2)`,
    paths: paths2,
    commit: commit2,
    base_sha: commit1,
    created_at: date,
    supersedes: opts.id,
    derived_from: opts.id,
    depends_on: [id1],
    file_ids: Object.fromEntries(paths2.map((p) => [p, old.file_ids[p] ?? `${id2}:${p}`])),
  };
  await writeObject(ctx, base1);
  await writeObject(ctx, base2);

  const resolvedRepoint: Record<string, string[]> = {};
  for (const [dep, values] of Object.entries(repoint)) {
    const mapped: string[] = [];
    for (const value of values) {
      let target: string | null = null;
      if (value === id1 || value === id2) target = value;
      else if (value === "1" || value === paths1[0]) target = id1;
      else if (value === "2" || value === paths2[0]) target = id2;
      else if (paths1.includes(value)) target = id1;
      else if (paths2.includes(value)) target = id2;
      else if (value === opts.id) target = id1;
      if (target && !mapped.includes(target)) mapped.push(target);
    }
    if (mapped.length === 0) {
      throw badInput(`cannot map re-point value for ${dep} to a split part`);
    }
    resolvedRepoint[dep] = mapped;
    const depObj = await tryReadObject(ctx, dep);
    if (depObj) {
      depObj.depends_on = depObj.depends_on.flatMap((d) =>
        d === opts.id ? mapped : [d],
      );
      await writeObject(ctx, depObj);
    }
  }

  const ev = await mintEvent(ctx, opts.agent, streamName, "supersede", {
    old: opts.id,
    new: [id1, id2],
    reason: "split",
    repoint: resolvedRepoint,
    line_map: {},
  });
  await commitEvent(ctx, ev, opts.agent);
  if (entry) await materializeStream(ctx, streamName);
  return { old: opts.id, new: [id1, id2], supersede_event: ev.id };
}

async function overlay(
  ctx: RepoContext,
  files: Record<string, Buffer | string>,
  source: string,
  paths: string[],
): Promise<string> {
  const sourceEntries = await treeEntries(ctx, source);
  const next = { ...files };
  for (const p of paths) {
    if (sourceEntries.has(p)) {
      next[p] = await blobOf(ctx, source, p);
    } else {
      delete next[p];
    }
  }
  return await writeTreeFromContent(ctx, next);
}

export interface ObjectSummary {
  id: string;
  kind: string;
  agent: string;
  description: string;
  commit: string;
  depends_on: string[];
  paths: string[];
}

export async function listObjects(
  ctx: RepoContext,
  filter: {
    stream?: string;
    kind?: "seed" | "move";
    backedOut?: boolean;
    agent?: string;
  } = {},
): Promise<ObjectSummary[]> {
  let ids: string[] = [];
  if (filter.stream) {
    const recipe = await requireRecipe(ctx, filter.stream);
    ids = filter.backedOut
      ? recipe.objects.filter((o) => !o.in_play).map((o) => o.id)
      : inPlayObjects(recipe);
  } else {
    const files = await ctx.listMetaDir("objects");
    ids = files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  }
  const out: ObjectSummary[] = [];
  for (const id of ids) {
    const obj = await tryReadObject(ctx, id);
    if (!obj) continue;
    if (filter.kind && obj.kind !== filter.kind) continue;
    if (filter.agent && obj.agent_or_session !== filter.agent) continue;
    out.push({
      id: obj.id,
      kind: obj.kind,
      agent: obj.agent_or_session,
      description: obj.description,
      commit: obj.commit,
      depends_on: obj.depends_on,
      paths: obj.paths,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return out;
}

export async function showObject(ctx: RepoContext, id: string): Promise<ObjectFile> {
  const obj = await tryReadObject(ctx, id);
  if (!obj) throw badInput(`object ${id} does not exist`);
  return obj;
}
