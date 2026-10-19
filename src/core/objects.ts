import { RepoContext } from "./context.js";
import { objectKind } from "./ids.js";

export interface Rename {
  from: string;
  to: string;
}

export interface ObjectFile {
  id: string;
  kind: "move" | "seed";
  ref_ids: string[];
  group: string | null;
  agent_or_session: string;
  author: string;
  description: string;
  checkout_description: string | null;
  checkin_description: string | null;
  base_sha: string;
  commit: string;
  request_key: string | null;
  paths: string[];
  created_at: string;
  renames: Rename[];
  depends_on: string[];
  demands: string[];
  resolves: null | Record<string, unknown>;
  supersedes: string | null;
  derived_from: string | null;
  file_ids: Record<string, string>;
  legacy_alias: string | null;
  adopted_from: string | null;
  signature: string | null;
}

export function objectRel(id: string): string {
  return `objects/${id}.json`;
}

export async function readObject(ctx: RepoContext, id: string): Promise<ObjectFile> {
  const raw = await ctx.readMetaJson<ObjectFile>(objectRel(id));
  if (!raw) throw new Error(`object ${id} not found in kawa-meta`);
  return raw;
}

export async function tryReadObject(ctx: RepoContext, id: string): Promise<ObjectFile | null> {
  const raw = await ctx.readMetaJson<ObjectFile>(objectRel(id));
  return raw;
}

export function serializeObject(obj: ObjectFile): string {
  return JSON.stringify(obj, null, 2) + "\n";
}

export function writeObject(ctx: RepoContext, obj: ObjectFile): void {
  ctx.writeMetaFile(objectRel(obj.id), serializeObject(obj));
}

export function emptyObject(id: string, kind: "move" | "seed"): ObjectFile {
  return {
    id,
    kind,
    ref_ids: [],
    group: null,
    agent_or_session: "",
    author: "",
    description: "",
    checkout_description: null,
    checkin_description: null,
    base_sha: "",
    commit: "",
    request_key: null,
    paths: [],
    created_at: new Date().toISOString(),
    renames: [],
    depends_on: [],
    demands: [],
    resolves: null,
    supersedes: null,
    derived_from: null,
    file_ids: {},
    legacy_alias: null,
    adopted_from: null,
    signature: null,
  };
}

export function objectRef(id: string): string {
  return `refs/kawa/objects/${id}`;
}

export function kindOf(id: string): "move" | "seed" {
  return objectKind(id) === "seed" ? "seed" : "move";
}
