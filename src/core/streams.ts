import path from "node:path";
import fsp from "node:fs/promises";
import { RepoContext } from "./context.js";
import { Recipe, foldStream } from "./fold.js";
import { isValidStreamName } from "./ids.js";
import { badInput } from "./errors.js";
import { commitEvent, createAnnotatedTag } from "./metaops.js";
import { mintEvent } from "./events.js";
import {
  CheckpointRecord,
  checkpointRecordRel,
  readCheckpointRecordByTag,
} from "./recipe.js";
import { jcsHash } from "./jcs.js";
import { materializeStream, resolveBase } from "./materialize.js";
import { gitVersion } from "./context.js";

export interface CreateStreamOptions {
  base?: string;
  forkFrom?: { stream: string; checkpoint?: number; checkpointTag?: string };
  description?: string;
}

export async function streamExists(ctx: RepoContext, name: string): Promise<boolean> {
  const folded = await foldStream(ctx, name);
  return folded.recipe.created;
}

export async function getRecipe(ctx: RepoContext, name: string): Promise<Recipe | null> {
  const folded = await foldStream(ctx, name);
  return folded.recipe.created ? folded.recipe : null;
}

export async function createStream(
  ctx: RepoContext,
  agent: string,
  name: string,
  opts: CreateStreamOptions = {},
): Promise<Recipe> {
  if (!isValidStreamName(name)) throw badInput(`invalid stream name: ${name}`);
  if (await streamExists(ctx, name)) throw badInput(`stream ${name} already exists`);

  let baseTag = opts.base;
  let forkedFrom: { stream: string; checkpoint: string } | null = null;

  if (opts.forkFrom) {
    const src = opts.forkFrom.stream;
    if (!(await streamExists(ctx, src))) throw badInput(`stream ${src} does not exist`);
    let tag: string;
    if (opts.forkFrom.checkpointTag) {
      tag = opts.forkFrom.checkpointTag;
    } else if (opts.forkFrom.checkpoint !== undefined) {
      tag = `cp/${src}/${opts.forkFrom.checkpoint}`;
    } else {
      const cp = await checkpointStream(ctx, agent, src);
      tag = cp.tag;
    }
    baseTag = tag;
    forkedFrom = { stream: src, checkpoint: tag };
  }

  if (!baseTag) throw badInput("a stream needs --base or --from");
  const record = await readCheckpointRecordByTag(ctx, baseTag);
  if (!record) throw badInput(`checkpoint ${baseTag} does not exist`);

  const ev = await mintEvent(ctx, agent, name, "create", {
    base: baseTag,
    forked_from: forkedFrom,
    description: opts.description ?? "",
  });
  return await commitEvent(ctx, ev, agent);
}

export async function checkpointStream(
  ctx: RepoContext,
  agent: string,
  name: string,
  message?: string,
): Promise<{ tag: string; n: number; record: CheckpointRecord; head: string }> {
  const folded = await foldStream(ctx, name);
  if (!folded.recipe.created) throw badInput(`stream ${name} does not exist`);
  const recipe = folded.recipe;
  const mat = await materializeStream(ctx, name);
  const base = await resolveBase(ctx, recipe);
  const n = recipe.checkpoints.length + 1;
  const tag = `cp/${name}/${n}`;

  let contains = [...base.record.contains];
  for (const entry of recipe.objects) {
    if (entry.from_base && !entry.in_play) {
      contains = contains.filter((id) => id !== entry.id);
    } else if (entry.in_play) {
      contains.push(entry.id);
    }
  }

  const treeIndex = await buildTreeIndex(ctx, name, base.record, contains.length);

  const record: CheckpointRecord = {
    contains,
    contains_hash: jcsHash(contains),
    resolutions: recipe.resolutions.map((r) => ({ ...r })),
    tree: mat.tree,
    sha_hint: mat.head,
    tree_index: treeIndex,
    git: { version: await gitVersion(ctx.root), merge_backend: "ort" },
    trust_pin: null,
  };

  ctx.writeMetaFile(
    checkpointRecordRel(name, n),
    JSON.stringify(record, null, 2) + "\n",
  );
  await createAnnotatedTag(ctx, tag, mat.head, message ?? `kawa checkpoint ${name}/${n}`);

  const ev = await mintEvent(ctx, agent, name, "checkpoint", {
    checkpoint: { n, tag, record: checkpointRecordRel(name, n) },
    base: tag,
  });
  await commitEvent(ctx, ev, agent);
  await materializeStream(ctx, name);
  return { tag, n, record, head: mat.head };
}

async function buildTreeIndex(
  ctx: RepoContext,
  stream: string,
  base: CheckpointRecord,
  total: number,
): Promise<{ at: number; tree: string; commit: string }[]> {
  const index: { at: number; tree: string; commit: string }[] = [];
  for (const entry of base.tree_index) {
    if (entry.at < total) index.push(entry);
  }
  if (!index.some((e) => e.at === 0)) {
    index.push({ at: 0, tree: base.tree, commit: base.sha_hint });
  }
  try {
    const cachePath = path.join(ctx.cacheDir, "replay", `${stream.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
    const cache = JSON.parse(await fsp.readFile(cachePath, "utf8")) as {
      prefix: { key: string; commit: string; tree: string }[];
    };
    const baseLen = base.contains.length;
    cache.prefix.forEach((p, i) => {
      const at = baseLen + i + 1;
      if (at % 50 === 0 && at <= total) index.push({ at, tree: p.tree, commit: p.commit });
    });
  } catch {
    /* no cache */
  }
  index.sort((a, b) => a.at - b.at);
  const dedup: typeof index = [];
  for (const e of index) {
    if (!dedup.some((d) => d.at === e.at)) dedup.push(e);
  }
  return dedup;
}

export async function listStreams(ctx: RepoContext): Promise<string[]> {
  const files = await ctx.listMetaDir("streams");
  return files
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.slice(0, -".yaml".length))
    .sort();
}

export async function showStream(ctx: RepoContext, name: string): Promise<Recipe> {
  const recipe = await getRecipe(ctx, name);
  if (!recipe) throw badInput(`stream ${name} does not exist`);
  return recipe;
}

export async function ensureMaterialized(ctx: RepoContext, name: string): Promise<string> {
  const existing = await ctx.git.tryRevParse(`refs/heads/streams/${name}`, ctx.root);
  if (existing) return existing;
  const mat = await materializeStream(ctx, name);
  return mat.head;
}
