import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { RepoContext, LocalConfig, randomInstance, META_BRANCH } from "./context.js";
import { createOrphanBranch, createAnnotatedTag } from "./metaops.js";
import { seedId } from "./ids.js";
import { ObjectFile, serializeObject, objectRef } from "./objects.js";
import { jcsHash } from "./jcs.js";
import { CheckpointRecord, checkpointRecordRel } from "./recipe.js";
import { gitVersion } from "./context.js";
import { ensureSiteKey } from "./signing.js";
import { KawaError, EXIT } from "./errors.js";

export interface InitOptions {
  adoptHistory?: boolean;
  remote?: string;
  site?: string;
  agent?: string;
  description?: string;
}

export interface InitResult {
  root: string;
  siteId: string;
  seedId: string;
  checkpoint: string;
  head: string;
  metaBranch: string;
}

const DEFAULT_BINARY_GLOBS = ["*.png", "*.exe", "*.doc", "*.pdf"];

export async function initRepo(cwd: string, opts: InitOptions = {}): Promise<InitResult> {
  let root: string;
  let gitDir: string;
  try {
    const located = await RepoContext.locate(cwd);
    root = located.root;
    gitDir = located.gitDir;
  } catch {
    const init = await new RepoContext(cwd, path.join(cwd, ".git"), dummyLocal()).git.run(["init"], {
      cwd,
    });
    if (init.exitCode !== 0) {
      throw new KawaError(5_00, `git init failed: ${init.stderr.trim()}`, EXIT.BAD_INPUT);
    }
    const located = await RepoContext.locate(cwd);
    root = located.root;
    gitDir = located.gitDir;
  }

  const ctx = new RepoContext(root, gitDir, dummyLocal());
  if (fs.existsSync(path.join(gitDir, "kawa", "local.yaml"))) {
    throw new KawaError(4_11, "this repository is already initialized for kawa", EXIT.BAD_INPUT);
  }

  // Ensure there is at least one commit and a usable identity.
  const nameRes = await ctx.git.run(["config", "user.name"], { cwd: root });
  if (nameRes.exitCode !== 0 || !nameRes.stdout.trim()) {
    await ctx.git.runOk(["config", "user.name", "kawa"], { cwd: root });
    await ctx.git.runOk(["config", "user.email", "kawa@invalid"], { cwd: root });
  }

  const hadHead = (await ctx.git.run(["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: root }))
    .exitCode === 0;
  if (!hadHead) {
    await ctx.git.runOk(["add", "-A"], { cwd: root });
    const hasFiles = (await ctx.git.run(["status", "--porcelain"], { cwd: root })).stdout.trim().length > 0;
    if (hasFiles) {
      await ctx.git.runOk(["commit", "--no-verify", "-m", "Initial commit"], { cwd: root });
    } else {
      await ctx.git.runOk(["commit", "--no-verify", "--allow-empty", "-m", "Initial commit"], {
        cwd: root,
      });
    }
  }

  // Line-ending policy, committed separately before the seed.
  const gitattributesPath = path.join(root, ".gitattributes");
  const policy = "* text=auto eol=lf\n" + DEFAULT_BINARY_GLOBS.map((g) => `${g} -text`).join("\n") + "\n";
  let existing = "";
  try {
    existing = await fsp.readFile(gitattributesPath, "utf8");
  } catch {
    existing = "";
  }
  if (!/text=auto\s+eol=lf/.test(existing)) {
    const next = existing ? existing.replace(/\s*$/, "\n") + "\n" + policy : policy;
    await fsp.writeFile(gitattributesPath, next, "utf8");
    await ctx.git.runOk(["add", "-A"], { cwd: root });
    await ctx.git.runOk(["add", "--renormalize", "."], { cwd: root });
    const staged = await ctx.git.run(["diff", "--cached", "--quiet"], { cwd: root });
    if (staged.exitCode !== 0) {
      await ctx.git.runOk(
        ["commit", "--no-verify", "-m", "Add kawa line-ending policy"],
        { cwd: root },
      );
    }
  }

  const headSha = (await ctx.git.revParse("HEAD", root)).trim();
  const headTree = await ctx.git.treeOf(headSha, root);
  const headAuthor = await ctx.git.authorOf(headSha, root);
  const files = await ctx.git.listTree(headSha, root);

  const siteId = opts.site ?? "local";
  const agent = opts.agent ?? "rich";

  const signing = await ensureSiteKey(ctx, siteId);
  const local: LocalConfig = {
    site_id: siteId,
    site_instance: randomInstance(),
    hooks: { post_materialize: null },
    integrator: true,
    trust: { pinned_allowed_signers: null },
    signing: { key: signing?.privateKey ?? null, enabled: !!signing },
  };
  ctx.local = local;

  const sid = seedId(1);
  const seed: ObjectFile = {
    id: sid,
    kind: "seed",
    ref_ids: [],
    group: null,
    agent_or_session: agent,
    author: headAuthor.name || agent,
    description: opts.description ?? "Initial import",
    checkout_description: null,
    checkin_description: null,
    base_sha: headSha,
    commit: headSha,
    request_key: null,
    paths: files,
    created_at: headAuthor.date,
    renames: [],
    depends_on: [],
    demands: [],
    resolves: null,
    supersedes: null,
    derived_from: null,
    file_ids: Object.fromEntries(files.map((p) => [p, `${sid}:${p}`])),
    legacy_alias: null,
    adopted_from: opts.adoptHistory ? headSha : null,
    signature: null,
  };

  const contains = [sid];
  const record: CheckpointRecord = {
    contains,
    contains_hash: jcsHash(contains),
    resolutions: [],
    tree: headTree,
    sha_hint: headSha,
    tree_index: [{ at: 0, tree: headTree, commit: headSha }],
    git: { version: await gitVersion(root), merge_backend: "ort" },
    trust_pin: null,
  };

  const settings = [
    "version: 3",
    "heat: { window_days: 14 }",
    `binary_globs: [${DEFAULT_BINARY_GLOBS.map((g) => `"${g}"`).join(", ")}]`,
    "max_stream_objects: 500",
    "",
  ].join("\n");

  const metaFiles: Record<string, string> = {
    ".kawa/settings.yaml": settings,
    [` .kawa/${objectRel(sid)}`.replace(/^ /, "")]: serializeObject(seed),
    ".kawa/counters/local": JSON.stringify({ move: 1, seed: 2, event: 1, res: 1 }, null, 2) + "\n",
    [`.kawa/${checkpointRecordRel("root", 0)}`]: JSON.stringify(record, null, 2) + "\n",
  };

  await createOrphanBranch(ctx, META_BRANCH, metaFiles, "kawa: initialize metadata");
  await ctx.ensureMetaWorktree();
  await createAnnotatedTag(ctx, "cp/root/0", headSha, "kawa checkpoint root/0");
  await ctx.git.runOk(["update-ref", objectRef(sid), headSha], { cwd: root });

  ctx.saveLocal();
  if (opts.remote) {
    await ctx.git.run(["remote", "add", "origin", opts.remote], { cwd: root });
    await ctx.git.run(["remote", "set-url", "origin", opts.remote], { cwd: root });
  }

  return {
    root,
    siteId,
    seedId: sid,
    checkpoint: "cp/root/0",
    head: headSha,
    metaBranch: META_BRANCH,
  };
}

function dummyLocal(): LocalConfig {
  return {
    site_id: "local",
    site_instance: randomInstance(),
    hooks: { post_materialize: null },
    integrator: true,
    trust: { pinned_allowed_signers: null },
    signing: { key: null, enabled: false },
  };
}

function objectRel(id: string): string {
  return `objects/${id}.json`;
}
