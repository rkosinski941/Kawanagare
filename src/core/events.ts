import { RepoContext } from "./context.js";
import { eventId, pad6 } from "./ids.js";

export type EventKind =
  | "create"
  | "add"
  | "carry"
  | "merge"
  | "backout"
  | "restore"
  | "checkpoint"
  | "supersede"
  | "resolution-bind"
  | "dep-accept"
  | "dep-reject"
  | "approve"
  | "purge"
  | "pr-link"
  | "pr-open"
  | "backout-request"
  | "settings"
  | "snapshot"
  | "claim-renew"
  | "claim-release"
  | "claim-handover";

export interface KawaEvent {
  id: string;
  kind: EventKind;
  stream: string;
  by: string;
  agent: string;
  site: string;
  parent_event: string | null;
  basis?: string | null;
  request_key: string | null;
  created_at: string;
  objects?: string[];
  from?: string;
  base?: string;
  forked_from?: { stream: string; checkpoint: string } | null;
  description?: string;
  checkpoint?: { n: number; tag: string; record: string };
  old?: string;
  new?: string[];
  reason?: string;
  repoint?: Record<string, string[]>;
  line_map?: Record<string, string[]>;
  conflict_of?: string[];
  resolution?: string;
  undoes?: string | null;
  settings?: Record<string, unknown>;
  signature?: string | null;
  [k: string]: unknown;
}

interface CounterFile {
  move: number;
  seed: number;
  event: number;
  res: number;
}

export function eventRel(stream: string, id: string): string {
  return `events/${stream}/${id}.json`;
}

export async function readCounters(ctx: RepoContext): Promise<CounterFile> {
  const raw = await ctx.readMetaJson<Partial<CounterFile>>("counters/local");
  return {
    move: raw?.move ?? 1,
    seed: raw?.seed ?? 1,
    event: raw?.event ?? 1,
    res: raw?.res ?? 1,
  };
}

export async function writeCounters(ctx: RepoContext, counters: CounterFile): Promise<void> {
  ctx.writeMetaFile("counters/local", JSON.stringify(counters, null, 2) + "\n");
}

/** Reserve the next number for a kind and stage the counter file (not committed yet). */
export async function reserveNumber(
  ctx: RepoContext,
  kind: "move" | "seed" | "res" | "event",
): Promise<number> {
  const counters = await readCounters(ctx);
  const n = counters[kind];
  counters[kind] = n + 1;
  await writeCounters(ctx, counters);
  return n;
}

export async function mintEvent(
  ctx: RepoContext,
  agent: string,
  stream: string,
  kind: EventKind,
  extra: Record<string, unknown> = {},
  requestKey: string | null = null,
): Promise<KawaEvent> {
  const { id } = await nextEventIdentity(ctx, agent);
  let parentEvent: string | null = null;
  try {
    const { foldStream } = await import("./fold.js");
    parentEvent = (await foldStream(ctx, stream)).recipe.folded_through;
  } catch {
    parentEvent = null;
  }
  return {
    id,
    kind,
    stream,
    by: agent,
    agent,
    site: ctx.local.site_id,
    parent_event: parentEvent,
    request_key: requestKey,
    created_at: new Date().toISOString(),
    ...extra,
  } as KawaEvent;
}

export function makeEvent(
  ctx: RepoContext,
  input: Omit<KawaEvent, "id" | "by" | "agent" | "site" | "created_at"> & {
    id?: string;
    by: string;
    agent: string;
    site: string;
  },
): KawaEvent {
  return {
    created_at: new Date().toISOString(),
    ...input,
  } as KawaEvent;
}

export function stageEvent(ctx: RepoContext, event: KawaEvent): void {
  ctx.writeMetaFile(eventRel(event.stream, event.id), JSON.stringify(event, null, 2) + "\n");
}

export async function readEvent(
  ctx: RepoContext,
  stream: string,
  id: string,
): Promise<KawaEvent | null> {
  return await ctx.readMetaJson<KawaEvent>(eventRel(stream, id));
}

export async function findEventByRequestKey(
  ctx: RepoContext,
  requestKey: string,
): Promise<KawaEvent | null> {
  for (const rel of await ctx.allEventFiles()) {
    const ev = await ctx.readMetaJson<KawaEvent>(rel);
    if (ev && ev.request_key === requestKey) return ev;
  }
  return null;
}

/** Read all events for a stream in landed (commit) order. */
export async function readStreamEvents(ctx: RepoContext, stream: string): Promise<KawaEvent[]> {
  const files = await ctx.eventFilesFor(stream);
  const events: KawaEvent[] = [];
  for (const rel of files) {
    const ev = await ctx.readMetaJson<KawaEvent>(rel.split(pathSep()).join("/"));
    if (ev) events.push(ev);
  }
  return events;
}

function pathSep(): string {
  return "/";
}

export async function nextEventIdentity(
  ctx: RepoContext,
  agent: string,
): Promise<{ id: string; n: number }> {
  const n = await reserveNumber(ctx, "event");
  return { id: eventId(agent, ctx.local.site_id, n), n };
}

export { pad6 };
