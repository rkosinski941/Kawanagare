import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { RepoContext } from "./context.js";
import { KawaError, EXIT, badInput, conflict, staleBase } from "./errors.js";
import { isValidAgent, moveId, seedId } from "./ids.js";
import { ObjectFile, objectRef, serializeObject, tryReadObject, writeObject } from "./objects.js";
import { reserveNumber } from "./events.js";
import { commitEvent } from "./metaops.js";
import { mintEvent } from "./events.js";
import { materializeStream } from "./materialize.js";
import { Recipe } from "./fold.js";
import { getRecipe, streamExists } from "./streams.js";
import { normalizeMessage } from "./trailers.js";
import { parseCommitMessage } from "./trailers.js";
import { jcsHash } from "./jcs.js";

export interface WorkState {
  id: string;
  stream: string;
  base_sha: string;
  branch: string;
  worktree: string;
  agent: string;
  ref_ids: string[];
  group: string | null;
  description: string | null;
  created_at: string;
  status: "open" | "checked_in" | "cancelled";
  cancelled_at?: string;
  cancelled_ref?: string;
  rebasing?: boolean;
}

export interface CheckoutOptions {
  stream: string;
  description?: string;
  refIds?: string[];
  group?: string | null;
  agent?: string;
}

export interface CheckoutResult {
  id: string;
  work_branch: string;
  worktree: string;
  stream: string;
  base_sha: string;
}

function workDir(ctx: RepoContext): string {
  return path.join(ctx.kawaDir, "work");
}

function statePath(ctx: RepoContext, id: string): string {
  return path.join(workDir(ctx), `${id}.json`);
}

async function writeState(ctx: RepoContext, state: WorkState): Promise<void> {
  await fsp.mkdir(workDir(ctx), { recursive: true });
  await fsp.writeFile(statePath(ctx, state.id), JSON.stringify(state, null, 2) + "\n", "utf8");
}

export async function readState(ctx: RepoContext, id: string): Promise<WorkState | null> {
  try {
    return JSON.parse(await fsp.readFile(statePath(ctx, id), "utf8")) as WorkState;
  } catch {
    return null;
  }
}

export async function listStates(ctx: RepoContext): Promise<WorkState[]> {
  await fsp.mkdir(workDir(ctx), { recursive: true });
  const names = await fsp.readdir(workDir(ctx));
  const out: WorkState[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const s = await readState(ctx, n.slice(0, -5));
    if (s) out.push(s);
  }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function findStateByCwd(states: WorkState[], cwd: string): WorkState | null {
  const norm = path.resolve(cwd).toLowerCase();
  for (const s of states) {
    const wt = path.resolve(s.worktree).toLowerCase();
    if (norm === wt || norm.startsWith(wt + path.sep)) return s;
  }
  return null;
}

export function nowIso(): string {
  return process.env.KAWA_NOW ?? new Date().toISOString();
}

async function branchExists(ctx: RepoContext, branch: string): Promise<boolean> {
  const local = await ctx.git.run(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
    cwd: ctx.root,
  });
  if (local.exitCode === 0) return true;
  const remote = await ctx.git.run(["ls-remote", "--heads", "origin", branch], {
    cwd: ctx.root,
  });
  return remote.exitCode === 0 && remote.stdout.trim().length > 0;
}

export async function checkout(ctx: RepoContext, opts: CheckoutOptions): Promise<CheckoutResult> {
  const agent = opts.agent ?? "enjoy";
  if (!isValidAgent(agent)) throw badInput(`invalid agent id: ${agent}`);
  if (!(await streamExists(ctx, opts.stream))) {
    throw badInput(`stream ${opts.stream} does not exist`);
  }

  await ctx.resetMetaWorktree();
  const mat = await materializeStream(ctx, opts.stream);
  const baseSha = mat.head;

  const n = await reserveNumber(ctx, "move");
  const id = moveId(n);
  const branch = `${agent}/${id}/work`;
  if (await branchExists(ctx, branch)) {
    throw badInput(`work branch ${branch} already exists; kawa never reuses a work branch`);
  }

  const worktree = path.join(ctx.wtDir, id);
  await fsp.mkdir(ctx.wtDir, { recursive: true });
  if (fs.existsSync(worktree)) {
    await fsp.rm(worktree, { recursive: true, force: true });
  }
  const res = await ctx.git.run(
    ["worktree", "add", "-b", branch, worktree, baseSha],
    { cwd: ctx.root },
  );
  if (res.exitCode !== 0) {
    throw new KawaError(5_00, `cannot create work area: ${res.stderr.trim()}`, EXIT.BAD_INPUT);
  }

  const state: WorkState = {
    id,
    stream: opts.stream,
    base_sha: baseSha,
    branch,
    worktree,
    agent,
    ref_ids: opts.refIds ?? [],
    group: opts.group ?? null,
    description: opts.description ?? null,
    created_at: nowIso(),
    status: "open",
  };
  await writeState(ctx, state);
  await ctx.commitMeta(`reserve ${id}`, agent);
  return { id, work_branch: branch, worktree, stream: opts.stream, base_sha: baseSha };
}

interface DiffEntry {
  status: string;
  path: string;
  oldPath?: string;
}

async function diffEntries(ctx: RepoContext, base: string, tip: string): Promise<DiffEntry[]> {
  const res = await ctx.git.run(
    ["diff", "--name-status", "--find-renames=50%", base, tip, "--"],
    { cwd: ctx.root },
  );
  const out: DiffEntry[] = [];
  for (const line of res.stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0];
    if (status.startsWith("R") || status.startsWith("C")) {
      out.push({ status: status[0], path: parts[2] ?? parts[1], oldPath: parts[1] });
    } else {
      out.push({ status, path: parts[1] });
    }
  }
  return out;
}

export async function blobOf(ctx: RepoContext, rev: string, filePath: string): Promise<Buffer> {
  try {
    return await ctx.git.fileAtBuffer(rev, filePath, ctx.root);
  } catch {
    throw badInput(`cannot read ${filePath} at ${rev}`);
  }
}

interface TreeEntry {
  mode: string;
  blob: string;
}

export async function treeEntries(ctx: RepoContext, rev: string): Promise<Map<string, TreeEntry>> {
  const res = await ctx.git.run(["ls-tree", "-r", "-z", rev], { cwd: ctx.root });
  const map = new Map<string, TreeEntry>();
  for (const record of res.stdout.split("\x00")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    const meta = record.slice(0, tab).split(" ");
    const filePath = record.slice(tab + 1);
    map.set(filePath, { mode: meta[0], blob: meta[2] });
  }
  return map;
}

/** Build a tree based on `base` where only `selected` paths take their content from `tip`. */
async function partialTree(
  ctx: RepoContext,
  base: string,
  tip: string,
  selected: Set<string>,
  order: DiffEntry[],
): Promise<string> {
  const baseEntries = await treeEntries(ctx, base);
  const tipEntries = await treeEntries(ctx, tip);
  const files: Record<string, Buffer | string> = {};
  for (const [p, e] of baseEntries) {
    if (selected.has(p)) continue;
    files[p] = await blobOf(ctx, base, p);
  }
  for (const p of selected) {
    if (tipEntries.has(p)) {
      files[p] = await blobOf(ctx, tip, p);
    }
  }
  // Preserve executable bits via update-index --chmod after writing blob entries.
  const tree = await writeTreeFromContent(ctx, files);
  return tree;
}

export async function writeTreeFromContent(
  ctx: RepoContext,
  files: Record<string, Buffer | string>,
): Promise<string> {
  const tmpIndex = path.join(ctx.kawaDir, `tmp-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    await ctx.git.runOk(["read-tree", "--empty"], { cwd: ctx.root, env });
    for (const [rel, content] of Object.entries(files)) {
      const blob = (
        await ctx.git.runOk(["hash-object", "-w", "--stdin"], {
          cwd: ctx.root,
          env,
          input: content as any,
        })
      ).trim();
      await ctx.git.runOk(
        ["update-index", "--add", "--cacheinfo", `100644,${blob},${rel.replace(/\\/g, "/")}`],
        { cwd: ctx.root, env },
      );
    }
    return (await ctx.git.runOk(["write-tree"], { cwd: ctx.root, env })).trim();
  } finally {
    await fsp.rm(tmpIndex, { force: true }).catch(() => undefined);
    await fsp.rm(tmpIndex + ".lock", { force: true }).catch(() => undefined);
  }
}

function checkoutTrailers(
  kind: "move" | "seed",
  id: string,
  agent: string,
  refIds: string[],
): [string, string][] {
  const out: [string, string][] = [];
  out.push(kind === "seed" ? ["Seed-Id", id] : ["Move-Id", id]);
  out.push(["Agent-Id", agent]);
  for (const r of refIds) out.push(["Ref-Id", r]);
  return out;
}

function buildMessage(
  description: string,
  checkinDescription: string | null,
  trailers: [string, string][],
): string {
  const subject = description || "(no description)";
  const body = checkinDescription && checkinDescription !== description ? checkinDescription : "";
  const parts = [subject];
  if (body) parts.push(body);
  parts.push(trailers.map(([k, v]) => `${k}: ${v}`).join("\n"));
  return parts.join("\n\n") + "\n";
}

export async function createCanonical(
  ctx: RepoContext,
  input: {
    kind: "move" | "seed";
    id: string;
    tree: string;
    parent: string;
    agent: string;
    description: string;
    checkinDescription: string | null;
    refIds: string[];
    date: string;
  },
): Promise<string> {
  const message = buildMessage(
    input.description,
    input.checkinDescription,
    checkoutTrailers(input.kind, input.id, input.agent, input.refIds),
  );
  const commit = await ctx.git.commitTree({
    cwd: ctx.root,
    tree: input.tree,
    parents: [input.parent],
    message,
    author: { name: input.agent, email: `${input.agent}@kawa.invalid`, date: input.date },
    committer: { name: "kawa", email: "kawa@invalid", date: input.date },
  });
  await ctx.git.runOk(["update-ref", objectRef(input.id), commit], { cwd: ctx.root });
  return commit;
}

export interface CheckinOptions {
  id?: string;
  cwd?: string;
  description?: string;
  split?: boolean;
  noSplit?: boolean;
  paths?: string[];
  dependsOn?: string[];
  rebase?: boolean;
  keep?: boolean;
  requestKey?: string;
  agent?: string;
  JSON?: boolean;
}

export interface CheckinResult {
  ids: string[];
  kind: "move" | "seed" | "split";
  commit: string;
  stream: string;
  already: boolean;
}

export async function checkin(
  ctx: RepoContext,
  opts: CheckinOptions,
): Promise<CheckinResult> {
  if (opts.requestKey) {
    const existing = await findRequest(ctx, opts.requestKey);
    if (existing) {
      return {
        ids: existing.objects ?? [],
        kind: "move",
        commit: existing.id,
        stream: existing.stream,
        already: true,
      };
    }
  }
  const cwd = opts.cwd ?? process.cwd();
  const states = await listStates(ctx);
  const state = opts.id
    ? states.find((s) => s.id === opts.id) ?? null
    : findStateByCwd(states, cwd);
  if (!state) throw badInput("no open kawa work area here; run `kawa checkout` first");
  if (state.status !== "open") throw badInput(`work area ${state.id} is ${state.status}`);
  const agent = opts.agent ?? state.agent;

  await ctx.resetMetaWorktree();

  const tip = await ctx.git.revParse(`refs/heads/${state.branch}`, ctx.root);
  if (tip === state.base_sha) throw badInput("nothing to check in: the work branch has no new commits");

  const headBefore = await ctx.git.revParse(`refs/heads/streams/${state.stream}`, ctx.root);
  let baseSha = state.base_sha;
  let replayedTree: string | null = null;

  if (headBefore !== baseSha) {
    const fix = await tryReplayOnto(ctx, state, headBefore, tip);
    if (!fix.ok) {
      writeConflicts(ctx, state.stream, fix.paths, tip);
      throw staleBase(
        `the stream ${state.stream} moved and your work conflicts; fix it and run \`kawa checkin --rebase\``,
        { conflicts_file: path.join(ctx.conflictsDir, `${state.stream}.json`) },
      );
    }
    // The change applies cleanly; use the new head as the canonical parent and its tree.
    baseSha = headBefore;
    replayedTree = fix.tree ?? null;
  }

  const entries = await diffEntries(ctx, state.base_sha, tip);
  if (entries.length === 0) throw badInput("nothing to check in");
  const selectedPaths = opts.paths && opts.paths.length > 0 ? new Set(opts.paths) : null;
  const chosen = selectedPaths ? entries.filter((e) => selectedPaths.has(e.path)) : entries;
  if (chosen.length === 0) throw badInput("the selected paths have no changes");

  const tipTree = await ctx.git.treeOf(tip, ctx.root);
  const baseTree = await ctx.git.treeOf(baseSha, ctx.root);
  const selectedAll = new Set(chosen.map((e) => e.path));
  let fullTree: string;
  if (selectedPaths && chosen.length !== entries.length) {
    fullTree = await partialTree(ctx, baseSha, tip, selectedAll, chosen);
  } else if (replayedTree) {
    fullTree = replayedTree;
  } else {
    fullTree = tipTree;
  }

  const allAdded = chosen.every((e) => e.status === "A");
  const mixed = !allAdded && chosen.some((e) => e.status === "A");
  const shouldSplit = opts.split === true || (mixed && opts.noSplit !== true && false);
  const split = shouldSplit && !allAdded;

  const date = nowIso();
  const checkinDescription = opts.description ?? null;
  const description = state.description ?? checkinDescription ?? "(no description)";
  const ids: string[] = [];
  let kind: "move" | "seed" | "split";
  let commit: string;

  if (split) {
    const seedN = await reserveNumber(ctx, "seed");
    const sid = seedId(seedN);
    const moveN = moveNumberFromId(state.id);
    const mid = moveId(moveN);

    const addedPaths = chosen.filter((e) => e.status === "A").map((e) => e.path);
    const seedTree = await partialTree(ctx, baseSha, tip, new Set(addedPaths), chosen);
    const seedCommit = await createCanonical(ctx, {
      kind: "seed",
      id: sid,
      tree: seedTree,
      parent: baseSha,
      agent,
      description,
      checkinDescription,
      refIds: state.ref_ids,
      date,
    });
    const moveCommit = await createCanonical(ctx, {
      kind: "move",
      id: mid,
      tree: fullTree,
      parent: seedCommit,
      agent,
      description,
      checkinDescription,
      refIds: state.ref_ids,
      date,
    });

    await writeObject(ctx, makeObject(ctx, {
      id: sid,
      kind: "seed",
      tree: seedTree,
      commit: seedCommit,
      parent: baseSha,
      agent,
      description,
      checkinDescription,
      state,
      date,
      paths: addedPaths,
      dependsOn: [],
      requestKey: opts.requestKey ?? null,
    }));
    await writeObject(ctx, makeObject(ctx, {
      id: mid,
      kind: "move",
      tree: fullTree,
      commit: moveCommit,
      parent: seedCommit,
      agent,
      description,
      checkinDescription,
      state,
      date,
      paths: chosen.map((e) => e.path),
      dependsOn: [sid, ...(opts.dependsOn ?? [])],
      requestKey: opts.requestKey ?? null,
    }));

    ids.push(sid, mid);
    kind = "split";
    commit = moveCommit;

    crashIf("after-squash");
    await finalizeCheckin(ctx, state, agent, ids, description, opts.requestKey ?? null, commit);
    return { ids, kind, commit, stream: state.stream, already: false };
  }

  let id: string;
  let objKind: "move" | "seed";
  if (allAdded) {
    const n = await reserveNumber(ctx, "seed");
    id = seedId(n);
    objKind = "seed";
  } else {
    id = state.id;
    objKind = "move";
  }
  commit = await createCanonical(ctx, {
    kind: objKind,
    id,
    tree: fullTree,
    parent: baseSha,
    agent,
    description,
    checkinDescription,
    refIds: state.ref_ids,
    date,
  });
  await writeObject(ctx, makeObject(ctx, {
    id,
    kind: objKind,
    tree: fullTree,
    commit,
    parent: baseSha,
    agent,
    description,
    checkinDescription,
    state,
    date,
    paths: chosen.map((e) => e.path),
    dependsOn: opts.dependsOn ?? [],
    requestKey: opts.requestKey ?? null,
  }));
  ids.push(id);
  kind = objKind;

  crashIf("after-squash");
  await finalizeCheckin(ctx, state, agent, ids, description, opts.requestKey ?? null, commit);
  return { ids, kind, commit, stream: state.stream, already: false };
}

function crashIf(step: string): void {
  if (process.env.KAWA_TEST_CRASH_AT === step) {
    process.exit(137);
  }
}

function moveNumberFromId(id: string): number {
  const m = id.match(/\.(\d{6})$/);
  return m ? parseInt(m[1], 10) : 1;
}

function makeObject(
  ctx: RepoContext,
  input: {
    id: string;
    kind: "move" | "seed";
    tree: string;
    commit: string;
    parent: string;
    agent: string;
    description: string;
    checkinDescription: string | null;
    state: WorkState;
    date: string;
    paths: string[];
    dependsOn: string[];
    requestKey: string | null;
  },
): ObjectFile {
  return {
    id: input.id,
    kind: input.kind,
    ref_ids: input.state.ref_ids,
    group: input.state.group,
    agent_or_session: input.agent,
    author: input.agent,
    description: input.description,
    checkout_description: input.state.description,
    checkin_description: input.checkinDescription,
    base_sha: input.parent,
    commit: input.commit,
    request_key: input.requestKey,
    paths: input.paths,
    created_at: input.date,
    renames: [],
    depends_on: input.dependsOn,
    demands: [],
    resolves: null,
    supersedes: null,
    derived_from: null,
    file_ids: Object.fromEntries(input.paths.map((p) => [p, `${input.id}:${p}`])),
    legacy_alias: null,
    adopted_from: null,
    signature: null,
  };
}

async function findRequest(ctx: RepoContext, key: string) {
  const { findEventByRequestKey } = await import("./events.js");
  return await findEventByRequestKey(ctx, key);
}

async function tryReplayOnto(
  ctx: RepoContext,
  state: WorkState,
  newHead: string,
  tip: string,
): Promise<{ ok: boolean; paths: string[]; tree?: string }> {
  const tmp = path.join(ctx.cacheDir, "rebase-wt", state.id);
  await ctx.git.run(["worktree", "remove", "--force", tmp], { cwd: ctx.root });
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  await fsp.mkdir(path.dirname(tmp), { recursive: true });
  const add = await ctx.git.run(["worktree", "add", "--force", "--detach", tmp, newHead], {
    cwd: ctx.root,
  });
  if (add.exitCode !== 0) throw badInput(`cannot create rebase worktree: ${add.stderr.trim()}`);
  try {
    const squash = await ctx.git.commitTree({
      cwd: ctx.root,
      tree: await ctx.git.treeOf(tip, ctx.root),
      parents: [state.base_sha],
      message: "replay test\n",
      author: { name: "kawa", email: "kawa@invalid", date: nowIso() },
      committer: { name: "kawa", email: "kawa@invalid", date: nowIso() },
    });
    const pick = await ctx.git.run(["cherry-pick", "-n", squash], { cwd: tmp });
    const unmerged = await ctx.git.run(["diff", "--name-only", "--diff-filter=U"], { cwd: tmp });
    const paths = unmerged.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    if (pick.exitCode !== 0 || paths.length > 0) {
      await ctx.git.run(["reset", "--hard", newHead], { cwd: tmp });
      await ctx.git.run(["cherry-pick", "--quit"], { cwd: tmp });
      return { ok: false, paths };
    }
    const tree = (await ctx.git.writeTreeIndex(tmp)).trim();
    return { ok: true, paths: [], tree };
  } finally {
    await ctx.git.run(["worktree", "remove", "--force", tmp], { cwd: ctx.root });
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    await ctx.git.run(["worktree", "prune"], { cwd: ctx.root });
  }
}

function writeConflicts(ctx: RepoContext, stream: string, paths: string[], tip: string): void {
  const payload = {
    stream,
    object_id: null,
    paths,
    theirs: tip,
    created_at: nowIso(),
  };
  const local = path.join(ctx.conflictsDir, `${stream}.json`);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, JSON.stringify(payload, null, 2) + "\n", "utf8");
  ctx.writeMetaFile(`conflicts/${stream}.json`, JSON.stringify(payload, null, 2) + "\n");
}

async function finalizeCheckin(
  ctx: RepoContext,
  state: WorkState,
  agent: string,
  ids: string[],
  description: string,
  requestKey: string | null,
  commit: string,
): Promise<void> {
  crashIf("after-object");
  const ev = await mintEvent(
    ctx,
    agent,
    state.stream,
    "add",
    { objects: ids, description },
    requestKey,
  );
  crashIf("before-event");
  await commitEvent(ctx, ev, agent);
  await materializeStream(ctx, state.stream);

  state.status = "checked_in";
  await writeState(ctx, state);
  if (path.resolve(process.cwd()).toLowerCase().startsWith(path.resolve(state.worktree).toLowerCase())) {
    process.chdir(ctx.mainRoot);
  }

  await ctx.git.run(["worktree", "remove", "--force", state.worktree], { cwd: ctx.root });
  await fsp.rm(state.worktree, { recursive: true, force: true }).catch(() => undefined);
  await ctx.git.run(["branch", "-D", state.branch], { cwd: ctx.root });
  await ctx.git.run(["worktree", "prune"], { cwd: ctx.root });
}

export async function addFiles(
  ctx: RepoContext,
  input: {
    files: string[];
    stream: string;
    description: string;
    agent?: string;
    refIds?: string[];
    group?: string | null;
    cwd?: string;
  },
): Promise<CheckinResult> {
  const agent = input.agent ?? "enjoy";
  if (!(await streamExists(ctx, input.stream))) throw badInput(`stream ${input.stream} does not exist`);
  if (input.files.length === 0) throw badInput("no files given");
  await ctx.resetMetaWorktree();
  const mat = await materializeStream(ctx, input.stream);
  const baseSha = mat.head;
  const headTree = mat.tree;

  const files: Record<string, Buffer> = {};
  for (const rel of input.files) {
    const abs = path.resolve(input.cwd ?? process.cwd(), rel);
    const stat = await fsp.stat(abs);
    if (!stat.isFile()) throw badInput(`${rel} is not a file`);
    const norm = path.relative(ctx.root, abs).replace(/\\/g, "/");
    if (norm.startsWith("..")) throw badInput(`${rel} is outside the repository`);
    if (await ctx.git.pathExistsAt(baseSha, norm, ctx.root)) {
      throw conflict(`${norm} already exists in ${input.stream}`, { error: "path_exists" });
    }
    files[norm] = await fsp.readFile(abs);
  }

  const seedN = await reserveNumber(ctx, "seed");
  const id = seedId(seedN);
  const tree = await overlayTree(ctx, baseSha, files);
  const date = nowIso();
  const commit = await createCanonical(ctx, {
    kind: "seed",
    id,
    tree,
    parent: baseSha,
    agent,
    description: input.description,
    checkinDescription: null,
    refIds: input.refIds ?? [],
    date,
  });
  const obj: ObjectFile = {
    id,
    kind: "seed",
    ref_ids: input.refIds ?? [],
    group: input.group ?? null,
    agent_or_session: agent,
    author: agent,
    description: input.description,
    checkout_description: null,
    checkin_description: null,
    base_sha: baseSha,
    commit,
    request_key: null,
    paths: Object.keys(files),
    created_at: date,
    renames: [],
    depends_on: [],
    demands: [],
    resolves: null,
    supersedes: null,
    derived_from: null,
    file_ids: Object.fromEntries(Object.keys(files).map((p) => [p, `${id}:${p}`])),
    legacy_alias: null,
    adopted_from: null,
    signature: null,
  };
  await writeObject(ctx, obj);
  const ev = await mintEvent(ctx, agent, input.stream, "add", { objects: [id], description: input.description });
  await commitEvent(ctx, ev, agent);
  await materializeStream(ctx, input.stream);
  return { ids: [id], kind: "seed", commit, stream: input.stream, already: false };
}

async function overlayTree(
  ctx: RepoContext,
  base: string,
  files: Record<string, Buffer>,
): Promise<string> {
  const baseEntries = await treeEntries(ctx, base);
  const all: Record<string, Buffer | string> = {};
  for (const [p] of baseEntries) {
    all[p] = await blobOf(ctx, base, p);
  }
  for (const [p, content] of Object.entries(files)) all[p] = content;
  return await writeTreeFromContent(ctx, all);
}

export async function cancel(
  ctx: RepoContext,
  id: string,
  agent: string,
): Promise<{ id: string; cancelled_ref: string }> {
  const state = await readState(ctx, id);
  if (!state) throw badInput(`no work area for ${id}`);
  if (state.status !== "open") throw badInput(`work area ${id} is ${state.status}`);
  const ref = `refs/kawa/cancelled/${id}`;
  const tip = await ctx.git.tryRevParse(`refs/heads/${state.branch}`, ctx.root);
  if (tip) await ctx.git.runOk(["update-ref", ref, tip], { cwd: ctx.root });
  if (path.resolve(process.cwd()).toLowerCase().startsWith(path.resolve(state.worktree).toLowerCase())) {
    process.chdir(ctx.mainRoot);
  }
  await ctx.git.run(["worktree", "remove", "--force", state.worktree], { cwd: ctx.root });
  await fsp.rm(state.worktree, { recursive: true, force: true }).catch(() => undefined);
  await ctx.git.run(["branch", "-D", state.branch], { cwd: ctx.root });
  await ctx.git.run(["worktree", "prune"], { cwd: ctx.root });
  state.status = "cancelled";
  state.cancelled_at = nowIso();
  state.cancelled_ref = ref;
  await writeState(ctx, state);
  return { id, cancelled_ref: ref };
}

export async function resume(
  ctx: RepoContext,
  id: string,
): Promise<CheckoutResult> {
  const state = await readState(ctx, id);
  if (!state) throw badInput(`no work area for ${id}`);
  if (state.status !== "cancelled") throw badInput(`work area ${id} is ${state.status}, not cancelled`);
  const ref = state.cancelled_ref ?? `refs/kawa/cancelled/${id}`;
  const tip = await ctx.git.tryRevParse(ref, ctx.root);
  if (!tip) throw badInput(`the cancelled work area for ${id} is no longer recoverable`);
  const days = (Date.now() - Date.parse(state.cancelled_at ?? "")) / 86_400_000;
  if (days > 30) throw badInput(`the cancelled work area for ${id} is past its 30-day recovery window`);
  if (await branchExists(ctx, state.branch)) {
    throw badInput(`work branch ${state.branch} already exists`);
  }
  const res = await ctx.git.run(["worktree", "add", "-b", state.branch, state.worktree, tip], {
    cwd: ctx.root,
  });
  if (res.exitCode !== 0) throw badInput(`cannot restore work area: ${res.stderr.trim()}`);
  state.status = "open";
  delete state.cancelled_at;
  await writeState(ctx, state);
  return {
    id,
    work_branch: state.branch,
    worktree: state.worktree,
    stream: state.stream,
    base_sha: state.base_sha,
  };
}

export async function listStale(ctx: RepoContext, hours = 24): Promise<WorkState[]> {
  const states = await listStates(ctx);
  const now = Date.now();
  return states.filter(
    (s) => s.status === "open" && now - Date.parse(s.created_at) > hours * 3_600_000,
  );
}
