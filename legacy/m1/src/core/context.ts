import { execa } from "execa";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitEngine } from "./git.js";
import { KawaError, EXIT } from "./errors.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface LocalConfig {
  site_id: string;
  site_instance: string;
  hooks: { post_materialize: string | null };
  integrator: boolean;
  trust: { pinned_allowed_signers: string | null };
  signing: { key: string | null; enabled: boolean };
}

export const META_BRANCH = "kawa-meta";

export function randomInstance(): string {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
}

/**
 * Everything per-machine lives under .git/kawa/ (never committed):
 * local.yaml, session.token, idem/, cache/, wt/, conflicts/, lock.
 */
export class RepoContext {
  readonly git: GitEngine;
  readonly kawaDir: string;
  readonly metaWt: string;
  readonly wtDir: string;
  readonly conflictsDir: string;
  readonly cacheDir: string;
  readonly lockPath: string;
  readonly mainRoot: string;
  local: LocalConfig;

  constructor(
    readonly root: string,
    readonly gitDir: string,
    local: LocalConfig,
  ) {
    this.git = new GitEngine(root);
    this.mainRoot = path.dirname(gitDir);
    this.kawaDir = path.join(gitDir, "kawa");
    this.metaWt = path.join(gitDir, "kawa-meta-wt");
    this.wtDir = path.join(this.kawaDir, "wt");
    this.conflictsDir = path.join(this.kawaDir, "conflicts");
    this.cacheDir = path.join(this.kawaDir, "cache");
    this.lockPath = path.join(this.kawaDir, "lock");
    this.local = local;
    for (const d of [this.kawaDir, this.wtDir, this.conflictsDir, this.cacheDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  static async locate(cwd: string): Promise<{ root: string; gitDir: string }> {
    const engine = new GitEngine(cwd);
    const root = await engine.repoRoot(cwd);
    const commonRes = await engine.run(["rev-parse", "--git-common-dir"], { cwd: root });
    let gitDir = commonRes.stdout.trim();
    if (!path.isAbsolute(gitDir)) gitDir = path.resolve(root, gitDir);
    return { root, gitDir };
  }

  /** Load an initialized repo. Throws if kawa init has not run. */
  static async load(cwd: string): Promise<RepoContext> {
    const { root, gitDir } = await RepoContext.locate(cwd);
    const localPath = path.join(gitDir, "kawa", "local.yaml");
    if (!fs.existsSync(localPath)) {
      throw new KawaError(
        4_10,
        "this repository is not initialized for kawa; run `kawa init` first",
        EXIT.BAD_INPUT,
      );
    }
    const local = parseYaml(await fsp.readFile(localPath, "utf8")) as LocalConfig;
    return new RepoContext(root, gitDir, local);
  }

  static async loadOrDefault(cwd: string): Promise<RepoContext> {
    const { root, gitDir } = await RepoContext.locate(cwd);
    const localPath = path.join(gitDir, "kawa", "local.yaml");
    let local: LocalConfig;
    if (fs.existsSync(localPath)) {
      local = parseYaml(await fsp.readFile(localPath, "utf8")) as LocalConfig;
    } else {
      local = {
        site_id: "local",
        site_instance: randomInstance(),
        hooks: { post_materialize: null },
        integrator: true,
        trust: { pinned_allowed_signers: null },
        signing: { key: null, enabled: false },
      };
    }
    return new RepoContext(root, gitDir, local);
  }

  saveLocal(): void {
    fs.mkdirSync(path.join(this.gitDir, "kawa"), { recursive: true });
    const localPath = path.join(this.kawaDir, "local.yaml");
    fs.writeFileSync(localPath, stringifyYaml(this.local), { encoding: "utf8" });
    try {
      fs.chmodSync(localPath, 0o600);
    } catch {
      /* windows */
    }
  }

  /** Paths passed here are relative to the committed .kawa/ directory. */
  metaPath(rel: string): string {
    return path.join(this.metaWt, ".kawa", rel);
  }

  async metaBranchExists(): Promise<boolean> {
    const res = await this.git.run(["rev-parse", "--verify", "--quiet", `refs/heads/${META_BRANCH}`], {
      cwd: this.root,
    });
    return res.exitCode === 0;
  }

  /** Ensure the kawa-meta worktree exists and is checked out. */
  async ensureMetaWorktree(): Promise<void> {
    if (!(await this.metaBranchExists())) {
      throw new KawaError(4_10, "kawa-meta branch is missing; run `kawa init`", EXIT.BAD_INPUT);
    }
    const gitFile = path.join(this.metaWt, ".git");
    if (!fs.existsSync(gitFile)) {
      if (fs.existsSync(this.metaWt)) {
        await fsp.rm(this.metaWt, { recursive: true, force: true });
      }
      await this.git.runOk(
        ["worktree", "prune"],
        { cwd: this.root },
      );
      const res = await this.git.run(
        ["worktree", "add", "--force", this.metaWt, META_BRANCH],
        { cwd: this.root },
      );
      if (res.exitCode !== 0) {
        throw new KawaError(
          5_00,
          `cannot open kawa-meta worktree: ${res.stderr.trim()}`,
          EXIT.BAD_INPUT,
        );
      }
    }
  }

  async readMeta(rel: string): Promise<string | null> {
    const abs = this.metaPath(rel);
    if (fs.existsSync(abs)) {
      return await fsp.readFile(abs, "utf8");
    }
    const res = await this.git.run(["show", `${META_BRANCH}:.kawa/${rel}`], { cwd: this.root });
    if (res.exitCode !== 0) return null;
    return res.stdout;
  }

  async readMetaJson<T = unknown>(rel: string): Promise<T | null> {
    const text = await this.readMeta(rel);
    if (text === null) return null;
    return JSON.parse(text) as T;
  }

  writeMetaFile(rel: string, content: string): void {
    const abs = this.metaPath(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, { encoding: "utf8" });
  }

  async listMetaDir(rel: string): Promise<string[]> {
    const abs = this.metaPath(rel);
    if (fs.existsSync(abs)) {
      return (await fsp.readdir(abs)).sort();
    }
    const res = await this.git.run(
      ["ls-tree", "-r", "--name-only", META_BRANCH, "--", `.kawa/${rel}`],
      { cwd: this.root },
    );
    if (res.exitCode !== 0) return [];
    return res.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => path.basename(p))
      .sort();
  }

  /** Commit whatever is staged/working in the meta worktree. */
  async commitMeta(message: string, agent = "kawa"): Promise<string> {
    await this.git.runOk(["add", "-A"], { cwd: this.metaWt });
    const staged = await this.git.run(["diff", "--cached", "--quiet"], { cwd: this.metaWt });
    if (staged.exitCode === 0) {
      return await this.git.revParse(META_BRANCH, this.root);
    }
    const env: Record<string, string | undefined> = {
      GIT_AUTHOR_NAME: agent,
      GIT_AUTHOR_EMAIL: `${agent}@kawa.invalid`,
      GIT_COMMITTER_NAME: "kawa",
      GIT_COMMITTER_EMAIL: "kawa@invalid",
    };
    const res = await this.git.run(["commit", "--no-verify", "--allow-empty", "-m", message], {
      cwd: this.metaWt,
      env,
    });
    if (res.exitCode !== 0) {
      if (/nothing to commit/i.test(res.stdout + res.stderr)) {
        return await this.git.revParse(META_BRANCH, this.root);
      }
      throw new KawaError(5_00, `kawa-meta commit failed: ${res.stderr.trim()}`, EXIT.BAD_INPUT);
    }
    return await this.git.revParse(META_BRANCH, this.root);
  }

  /** Ordered event files for a stream: landed commit order, ties by file name. */
  async eventFilesFor(stream: string): Promise<string[]> {
    const rel = `.kawa/events/${stream}`;
    const res = await this.git.run(
      [
        "log",
        "--reverse",
        "--first-parent",
        "--pretty=format:",
        "--name-only",
        META_BRANCH,
        "--",
        rel,
      ],
      { cwd: this.root },
    );
    if (res.exitCode !== 0) return [];
    const seen: string[] = [];
    const set = new Set<string>();
    for (const line of res.stdout.split("\n")) {
      const p = line.trim().replace(/\\/g, "/");
      if (!p || !p.endsWith(".json")) continue;
      if (path.dirname(p) !== rel) continue;
      const relPath = p.slice(".kawa/".length);
      if (set.has(relPath)) continue;
      set.add(relPath);
      seen.push(relPath);
    }
    return seen;
  }

  async allEventFiles(): Promise<string[]> {
    const res = await this.git.run(
      ["ls-tree", "-r", "--name-only", META_BRANCH, "--", ".kawa/events"],
      { cwd: this.root },
    );
    if (res.exitCode !== 0) return [];
    return res.stdout
      .split("\n")
      .map((s) => s.trim().replace(/\\/g, "/"))
      .filter((p) => p.endsWith(".json"))
      .map((p) => p.slice(".kawa/".length));
  }

  // ---- lock ----

  async acquireLock(opts: { agent?: string; waitSeconds?: number } = {}): Promise<void> {
    const wait = opts.waitSeconds ?? 60;
    const deadline = Date.now() + wait * 1000;
    await this.ensureMetaWorktree();
    for (;;) {
      let acquired = false;
      try {
        const fd = fs.openSync(this.lockPath, "wx");
        fs.writeSync(
          fd,
          JSON.stringify({
            pid: process.pid,
            host: os.hostname(),
            agent: opts.agent ?? "kawa",
            started: new Date().toISOString(),
          }),
        );
        fs.closeSync(fd);
        acquired = true;
      } catch (err: any) {
        if (err.code !== "EEXIST") throw err;
        acquired = await this.breakStaleLockIfNeeded();
        if (acquired) continue;
      }
      if (acquired) return;
      if (Date.now() >= deadline) {
        throw new KawaError(4_07, "the kawa repo lock is busy; try again later", EXIT.LOCK_TIMEOUT);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async breakStaleLockIfNeeded(): Promise<boolean> {
    try {
      const raw = fs.readFileSync(this.lockPath, "utf8");
      const info = JSON.parse(raw) as { pid: number; started: string };
      if (isProcessAlive(info.pid)) return false;
      // The owning process is gone (a crash or a kill); its lock is stale no
      // matter how recently it was taken.
      fs.rmSync(this.lockPath, { force: true });
      return true;
    } catch {
      try {
        fs.rmSync(this.lockPath, { force: true });
        return true;
      } catch {
        return false;
      }
    }
  }

  /** Discard uncommitted leftovers in the meta worktree (crash recovery). */
  async resetMetaWorktree(): Promise<void> {
    await this.ensureMetaWorktree();
    await this.git.run(["reset", "--hard", META_BRANCH], { cwd: this.metaWt });
    await this.git.run(["clean", "-fdq"], { cwd: this.metaWt });
  }

  releaseLock(): void {
    try {
      fs.rmSync(this.lockPath, { force: true });
    } catch {
      /* ignore */
    }
  }

  async withLock<T>(agent: string | undefined, fn: () => Promise<T>, waitSeconds?: number): Promise<T> {
    await this.acquireLock({ agent, waitSeconds });
    try {
      return await fn();
    } finally {
      this.releaseLock();
    }
  }
}

function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === "EPERM";
  }
}

export async function gitVersion(cwd: string): Promise<string> {
  const res = await execa("git", ["--version"], { cwd, reject: false });
  return (res.stdout || "").trim();
}
