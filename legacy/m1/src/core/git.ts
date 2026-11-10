import { execa } from "execa";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { KawaError, EXIT } from "./errors.js";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitRunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  input?: string;
  encoding?: "utf8" | "buffer";
}

export interface CommitIdentity {
  name: string;
  email: string;
  date: string; // ISO 8601
}

/**
 * All git use in KawaNagare goes through this single interface
 * (spec section 2, "Storage engine boundary").
 */
export interface StorageEngine {
  run(args: string[], opts?: GitRunOptions): Promise<RunResult>;
  repoRoot(cwd: string): Promise<string>;
  revParse(ref: string, cwd?: string): Promise<string>;
  commitTree(input: {
    cwd: string;
    tree: string;
    parents: string[];
    message: string;
    author: CommitIdentity;
    committer: CommitIdentity;
    sign?: boolean;
  }): Promise<string>;
  treeOf(rev: string, cwd?: string): Promise<string>;
  parentOf(rev: string, cwd?: string): Promise<string | null>;
  authorOf(rev: string, cwd?: string): Promise<CommitIdentity>;
  messageOf(rev: string, cwd?: string): Promise<string>;
  fileAt(rev: string, filePath: string, cwd?: string): Promise<Buffer>;
  pathExistsAt(rev: string, filePath: string, cwd?: string): Promise<boolean>;
  listTree(rev: string, cwd?: string): Promise<string[]>;
}

const KAWA_COMMITTER: CommitIdentity = {
  name: "kawa",
  email: "kawa@invalid",
  date: "2000-01-01T00:00:00Z",
};

export function kawaCommitter(date: string): CommitIdentity {
  return { name: KAWA_COMMITTER.name, email: KAWA_COMMITTER.email, date };
}

export class GitEngine implements StorageEngine {
  private hooksDir: string;

  constructor(private readonly defaultCwd: string) {
    this.hooksDir = path.join(defaultCwd, ".git", "kawa", "hooks-disabled");
    try {
      mkdirSync(this.hooksDir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  private baseArgs(): string[] {
    return [
      "--no-replace-objects",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.eol=lf",
      "-c",
      "core.safecrlf=false",
      "-c",
      "core.longpaths=true",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "gc.auto=0",
      "-c",
      `core.hooksPath=${this.hooksDir}`,
    ];
  }

  async run(args: string[], opts: GitRunOptions = {}): Promise<RunResult> {
    const env: Record<string, string | undefined> = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: process.env.KAWA_KEEP_SYSTEM_CONFIG ? process.env.GIT_CONFIG_NOSYSTEM : "1",
      LC_ALL: "C",
      ...opts.env,
    };
    const res = await execa("git", [...this.baseArgs(), ...args], {
      cwd: opts.cwd ?? this.defaultCwd,
      env,
      reject: false,
      input: opts.input,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return {
      stdout: typeof res.stdout === "string" ? res.stdout : String(res.stdout ?? ""),
      stderr: typeof res.stderr === "string" ? res.stderr : String(res.stderr ?? ""),
      exitCode: res.exitCode ?? (res.failed ? 1 : 0),
    };
  }

  async runOk(args: string[], opts: GitRunOptions = {}): Promise<string> {
    const res = await this.run(args, opts);
    if (res.exitCode !== 0) {
      throw new KawaError(
        5_00,
        `git ${args.join(" ")} failed: ${res.stderr.trim() || res.stdout.trim()}`,
        EXIT.BAD_INPUT,
      );
    }
    return res.stdout;
  }

  async repoRoot(cwd: string): Promise<string> {
    const res = await this.run(["rev-parse", "--show-toplevel"], { cwd });
    if (res.exitCode !== 0) {
      throw new KawaError(5_00, "not a git repository", EXIT.BAD_INPUT);
    }
    return res.stdout.trim();
  }

  async revParse(ref: string, cwd?: string): Promise<string> {
    const res = await this.run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd });
    if (res.exitCode !== 0) throw new Error(`cannot resolve ${ref}`);
    return res.stdout.trim();
  }

  async tryRevParse(ref: string, cwd?: string): Promise<string | null> {
    const res = await this.run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd });
    if (res.exitCode !== 0) return null;
    return res.stdout.trim();
  }

  async treeOf(rev: string, cwd?: string): Promise<string> {
    return (await this.runOk(["rev-parse", `${rev}^{tree}`], { cwd })).trim();
  }

  async parentOf(rev: string, cwd?: string): Promise<string | null> {
    const res = await this.run(["rev-list", "--parents", "-n", "1", rev], { cwd });
    if (res.exitCode !== 0) return null;
    const parts = res.stdout.trim().split(/\s+/);
    return parts.length > 1 ? parts[1] : null;
  }

  async parentsOf(rev: string, cwd?: string): Promise<string[]> {
    const res = await this.run(["rev-list", "--parents", "-n", "1", rev], { cwd });
    if (res.exitCode !== 0) return [];
    const parts = res.stdout.trim().split(/\s+/);
    return parts.slice(1);
  }

  async authorOf(rev: string, cwd?: string): Promise<CommitIdentity> {
    const res = await this.runOk(
      ["show", "-s", "--format=%an%x00%ae%x00%aI", rev],
      { cwd },
    );
    const [name, email, date] = res.replace(/\n$/, "").split("\x00");
    return { name: name ?? "", email: email ?? "", date: date ?? "1970-01-01T00:00:00Z" };
  }

  async committerOf(rev: string, cwd?: string): Promise<CommitIdentity> {
    const res = await this.runOk(
      ["show", "-s", "--format=%cn%x00%ce%x00%cI", rev],
      { cwd },
    );
    const [name, email, date] = res.replace(/\n$/, "").split("\x00");
    return { name: name ?? "", email: email ?? "", date: date ?? "1970-01-01T00:00:00Z" };
  }

  async messageOf(rev: string, cwd?: string): Promise<string> {
    return await this.runOk(["show", "-s", "--format=%B", rev], { cwd });
  }

  async commitTree(input: {
    cwd: string;
    tree: string;
    parents: string[];
    message: string;
    author: CommitIdentity;
    committer: CommitIdentity;
    sign?: boolean;
  }): Promise<string> {
    const args = ["commit-tree", input.tree];
    for (const p of input.parents) args.push("-p", p);
    if (input.sign) args.push("-S");
    const res = await this.run(args, {
      cwd: input.cwd,
      input: input.message,
      env: {
        GIT_AUTHOR_NAME: input.author.name,
        GIT_AUTHOR_EMAIL: input.author.email,
        GIT_AUTHOR_DATE: input.author.date,
        GIT_COMMITTER_NAME: input.committer.name,
        GIT_COMMITTER_EMAIL: input.committer.email,
        GIT_COMMITTER_DATE: input.committer.date,
      },
    });
    if (res.exitCode !== 0) {
      throw new KawaError(5_00, `git commit-tree failed: ${res.stderr.trim()}`, EXIT.BAD_INPUT);
    }
    return res.stdout.trim();
  }

  async fileAt(rev: string, filePath: string, cwd?: string): Promise<Buffer> {
    return await this.fileAtBuffer(rev, filePath, cwd);
  }

  async fileAtBuffer(rev: string, filePath: string, cwd?: string): Promise<Buffer> {
    const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    const res = await execa("git", [...this.baseArgs(), "cat-file", "blob", `${rev}:${filePath}`], {
      cwd: cwd ?? this.defaultCwd,
      env,
      reject: false,
      encoding: "buffer",
      stripFinalNewline: false,
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    });
    if (res.exitCode !== 0) throw new Error(`no ${filePath} at ${rev}`);
    return Buffer.from(res.stdout as Buffer);
  }

  async pathExistsAt(rev: string, filePath: string, cwd?: string): Promise<boolean> {
    const res = await this.run(["cat-file", "-e", `${rev}:${filePath}`], { cwd });
    return res.exitCode === 0;
  }

  async writeTreeIndex(cwd: string): Promise<string> {
    return (await this.runOk(["write-tree"], { cwd })).trim();
  }

  async listTree(rev: string, cwd?: string): Promise<string[]> {
    const res = await this.run(["ls-tree", "-r", "--name-only", "-z", rev], { cwd });
    if (res.exitCode !== 0) return [];
    return res.stdout.split("\x00").filter((s) => s.length > 0);
  }

  async isBinaryAt(rev: string, filePath: string, cwd?: string): Promise<boolean> {
    const res = await this.run(["diff", "--numstat", `${rev}^`, rev, "--", filePath], { cwd });
    return false; // not used in M1
  }
}
