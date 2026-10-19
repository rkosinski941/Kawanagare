import { RepoContext } from "./context.js";
import { Recipe, FoldResult } from "./fold.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { jcsHash } from "./jcs.js";
import { tryReadObject } from "./objects.js";

export interface CheckpointRecord {
  contains: string[];
  contains_hash: string;
  resolutions: { id: string; conflict_of: string[]; bind_event: string }[];
  tree: string;
  sha_hint: string;
  tree_index: { at: number; tree: string; commit: string }[];
  git: { version: string; merge_backend: string };
  trust_pin: string | null;
}

export function recipeRel(name: string): string {
  return `streams/${name}.yaml`;
}

export function checkpointRecordRel(stream: string, n: number): string {
  return `checkpoints/${stream}/${n}.json`;
}

export function serializeRecipe(recipe: Recipe): string {
  const view = {
    name: recipe.name,
    forked_from: recipe.forked_from,
    base: recipe.base,
    description: recipe.description,
    phase: recipe.phase,
    objects: recipe.objects.map((o) => ({
      id: o.id,
      in_play: o.in_play,
      ...(o.backed_out_by ? { backed_out_by: o.backed_out_by } : {}),
      ...(o.event ? { event: o.event } : {}),
      ...(o.pending_conflict ? { pending_conflict: true } : {}),
      ...(o.from_base ? { from_base: true } : {}),
    })),
    resolutions: recipe.resolutions,
    checkpoints: recipe.checkpoints,
    folded_through: recipe.folded_through,
  };
  return stringifyYaml(view);
}

export async function readRecipe(ctx: RepoContext, name: string): Promise<Recipe | null> {
  const raw = await ctx.readMeta(recipeRel(name));
  if (!raw) return null;
  return parseYaml(raw) as Recipe;
}

export function writeRecipe(ctx: RepoContext, recipe: Recipe): void {
  ctx.writeMetaFile(recipeRel(recipe.name), serializeRecipe(recipe));
}

export async function readCheckpointRecord(
  ctx: RepoContext,
  stream: string,
  n: number,
): Promise<CheckpointRecord | null> {
  return await ctx.readMetaJson<CheckpointRecord>(checkpointRecordRel(stream, n));
}

export async function readCheckpointRecordByTag(
  ctx: RepoContext,
  tag: string,
): Promise<CheckpointRecord | null> {
  const m = tag.match(/^cp\/(.+)\/(\d+)$/);
  if (!m) return null;
  return await readCheckpointRecord(ctx, m[1], parseInt(m[2], 10));
}

export function effectiveSet(recipe: Recipe, baseContains: string[]): string[] {
  const inPlay = recipe.objects.filter((o) => o.in_play).map((o) => o.id);
  return [...baseContains, ...inPlay];
}

export function inPlayObjects(recipe: Recipe): string[] {
  return recipe.objects.filter((o) => o.in_play).map((o) => o.id);
}

export function fromBaseBackouts(recipe: Recipe): string[] {
  return recipe.objects.filter((o) => o.from_base && !o.in_play).map((o) => o.id);
}

export async function computeRecipeHash(
  ctx: RepoContext,
  recipe: Recipe,
  base: { contains_hash: string; tree: string } | null,
): Promise<string> {
  const objects: { id: string; commit: string }[] = [];
  for (const entry of recipe.objects) {
    if (!entry.in_play) continue;
    const obj = await tryReadObject(ctx, entry.id);
    objects.push({ id: entry.id, commit: obj?.commit ?? "" });
  }
  const resolutions: { id: string; result: string[] }[] = [];
  for (const binding of recipe.resolutions) {
    const raw = await ctx.readMetaJson<{ paths?: { result_blob?: string }[] }>(
      `resolutions/${binding.id}.json`,
    );
    resolutions.push({
      id: binding.id,
      result: (raw?.paths ?? []).map((p) => p.result_blob ?? ""),
    });
  }
  const payload = {
    base: base ? { contains_hash: base.contains_hash, tree: base.tree } : null,
    from_base: fromBaseBackouts(recipe),
    objects,
    resolutions,
  };
  return jcsHash(payload);
}

export function containsHash(contains: string[]): string {
  return jcsHash(contains);
}
