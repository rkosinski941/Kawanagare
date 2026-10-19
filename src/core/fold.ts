import { RepoContext } from "./context.js";
import { KawaEvent, readStreamEvents } from "./events.js";
import { isValidStreamName } from "./ids.js";

export interface RecipeObjectEntry {
  id: string;
  in_play: boolean;
  backed_out_by?: string;
  event?: string;
  pending_conflict?: boolean;
  from_base?: boolean;
}

export interface ResolutionBinding {
  id: string;
  conflict_of: string[];
  bind_event: string;
}

export interface CheckpointRef {
  n: number;
  tag: string;
  record: string;
}

export interface Recipe {
  name: string;
  forked_from: { stream: string; checkpoint: string } | null;
  base: string | null;
  description: string;
  phase: null;
  objects: RecipeObjectEntry[];
  resolutions: ResolutionBinding[];
  checkpoints: CheckpointRef[];
  folded_through: string | null;
  created: boolean;
}

export interface FoldResult {
  recipe: Recipe;
  applied: string[];
  ignored: { id: string; reason: string }[];
}

export function emptyRecipe(name: string): Recipe {
  return {
    name,
    forked_from: null,
    base: null,
    description: "",
    phase: null,
    objects: [],
    resolutions: [],
    checkpoints: [],
    folded_through: null,
    created: false,
  };
}

/**
 * Derive a stream recipe by folding its events in landed order.
 * The fold is the only writer of a recipe.
 */
export function foldEvents(name: string, events: KawaEvent[]): FoldResult {
  const recipe = emptyRecipe(name);
  const applied: string[] = [];
  const ignored: { id: string; reason: string }[] = [];
  const seen = new Map<string, string>();

  for (const ev of events) {
    if (ev.stream !== name) {
      ignored.push({ id: ev.id, reason: "wrong_stream" });
      continue;
    }
    if (seen.has(ev.id)) {
      ignored.push({ id: ev.id, reason: "duplicate_id" });
      continue;
    }
    const contentHash = JSON.stringify(ev);
    seen.set(ev.id, contentHash);
    applyEvent(recipe, ev);
    recipe.folded_through = ev.id;
    applied.push(ev.id);
  }
  return { recipe, applied, ignored };
}

function ensureEntry(recipe: Recipe, id: string): RecipeObjectEntry {
  let entry = recipe.objects.find((o) => o.id === id);
  if (!entry) {
    entry = { id, in_play: true };
    recipe.objects.push(entry);
  }
  return entry;
}

function applyEvent(recipe: Recipe, ev: KawaEvent): void {
  switch (ev.kind) {
    case "create": {
      recipe.created = true;
      recipe.base = ev.base ?? null;
      recipe.forked_from = ev.forked_from ?? null;
      recipe.description = ev.description ?? "";
      break;
    }
    case "add":
    case "merge": {
      for (const id of ev.objects ?? []) {
        const existing = recipe.objects.find((o) => o.id === id);
        if (existing) {
          if (!existing.in_play && !existing.pending_conflict) {
            // A deliberate back-out is not resurrected by add/merge.
            continue;
          }
          existing.in_play = true;
          delete existing.pending_conflict;
          continue;
        }
        recipe.objects.push({ id, in_play: true });
      }
      break;
    }
    case "carry": {
      for (const id of ev.objects ?? []) {
        const existing = recipe.objects.find((o) => o.id === id);
        if (existing) {
          if (!existing.in_play && !existing.pending_conflict) continue;
          // An explicit re-carry of an object already in play is recorded as a
          // duplicate entry so replay emits an empty commit (Kawa-Empty).
          recipe.objects.push({ id, in_play: true });
          continue;
        }
        recipe.objects.push({ id, in_play: true });
      }
      break;
    }
    case "backout": {
      for (const id of ev.objects ?? []) {
        const entries = recipe.objects.filter((o) => o.id === id);
        if (entries.length > 0) {
          for (const entry of entries) {
            entry.in_play = false;
            entry.backed_out_by = ev.by;
            entry.event = ev.id;
          }
        } else {
          recipe.objects.push({
            id,
            in_play: false,
            backed_out_by: ev.by,
            event: ev.id,
            from_base: true,
          });
        }
      }
      break;
    }
    case "restore": {
      for (const id of ev.objects ?? []) {
        const entries = recipe.objects.filter((o) => o.id === id);
        if (entries.length > 0) {
          for (const entry of entries) {
            entry.in_play = true;
            delete entry.backed_out_by;
            delete entry.event;
            delete entry.pending_conflict;
          }
        } else {
          recipe.objects.push({ id, in_play: true });
        }
      }
      break;
    }
    case "checkpoint": {
      if (ev.checkpoint) {
        recipe.base = ev.checkpoint.tag;
        if (!recipe.checkpoints.some((c) => c.tag === ev.checkpoint!.tag)) {
          recipe.checkpoints.push(ev.checkpoint);
        }
      } else if (ev.base) {
        recipe.base = ev.base;
      }
      recipe.objects = [];
      recipe.resolutions = [];
      break;
    }
    case "supersede": {
      const old = ev.old;
      const replacement = ev.new ?? [];
      if (!old) break;
      const idx = recipe.objects.findIndex((o) => o.id === old);
      if (idx >= 0) {
        const entry = recipe.objects[idx];
        const newEntries = replacement.map((id) => ({
          id,
          in_play: entry.in_play,
          ...(entry.backed_out_by ? { backed_out_by: entry.backed_out_by } : {}),
          ...(entry.event ? { event: entry.event } : {}),
        }));
        recipe.objects.splice(idx, 1, ...newEntries);
      } else {
        recipe.objects.push({ id: old, in_play: false, from_base: true, event: ev.id });
        for (const id of replacement) ensureEntry(recipe, id);
      }
      break;
    }
    case "resolution-bind": {
      if (ev.resolution && ev.conflict_of) {
        const exists = recipe.resolutions.some((r) => r.id === ev.resolution);
        if (!exists) {
          recipe.resolutions.push({
            id: ev.resolution,
            conflict_of: ev.conflict_of,
            bind_event: ev.id,
          });
        }
      }
      break;
    }
    default:
      break;
  }
}

export async function foldStream(ctx: RepoContext, name: string): Promise<FoldResult> {
  if (!isValidStreamName(name)) throw new Error(`bad stream name ${name}`);
  const events = await readStreamEvents(ctx, name);
  return foldEvents(name, events);
}
