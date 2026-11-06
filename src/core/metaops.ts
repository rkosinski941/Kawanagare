import fsp from "node:fs/promises";
import path from "node:path";
import { RepoContext } from "./context.js";
import { KawaEvent, stageEvent } from "./events.js";
import { Recipe, foldStream } from "./fold.js";
import { writeRecipe } from "./recipe.js";

/** Commit a staged event (and any staged object/counter files), then fold the stream. */
export async function commitEvent(
  ctx: RepoContext,
  event: KawaEvent,
  agent: string,
): Promise<Recipe> {
  stageEvent(ctx, event);
  await ctx.commitMeta(`event: ${event.id}`, agent);
  return await foldAndCommitRecipe(ctx, event.stream, agent);
}

export async function foldAndCommitRecipe(
  ctx: RepoContext,
  stream: string,
  agent: string,
): Promise<Recipe> {
  const folded = await foldStream(ctx, stream);
  writeRecipe(ctx, folded.recipe);
  await ctx.commitMeta(`fold ${stream}`, agent);
  return folded.recipe;
}

let tmpCounter = 0;

/** Write a tree from a map of repo-relative paths to contents, without touching the index. */
export async function writeTreeWithFiles(
  ctx: RepoContext,
  files: Record<string, string | Buffer>,
): Promise<string> {
  const tmpIndex = path.join(ctx.kawaDir, `tmp-index-${process.pid}-${tmpCounter++}`);
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
      const normalized = rel.replace(/\\/g, "/");
      await ctx.git.runOk(
        ["update-index", "--add", "--cacheinfo", `100644,${blob},${normalized}`],
        { cwd: ctx.root, env },
      );
    }
    return (await ctx.git.runOk(["write-tree"], { cwd: ctx.root, env })).trim();
  } finally {
    await fsp.rm(tmpIndex, { force: true }).catch(() => undefined);
    await fsp.rm(tmpIndex + ".lock", { force: true }).catch(() => undefined);
  }
}

export async function createOrphanBranch(
  ctx: RepoContext,
  branch: string,
  files: Record<string, string | Buffer>,
  message: string,
): Promise<string> {
  const tree = await writeTreeWithFiles(ctx, files);
  const date = new Date().toISOString();
  const commit = await ctx.git.commitTree({
    cwd: ctx.root,
    tree,
    parents: [],
    message: `${message}\n`,
    author: { name: "kawa", email: "kawa@invalid", date },
    committer: { name: "kawa", email: "kawa@invalid", date },
  });
  await ctx.git.runOk(["branch", branch, commit], { cwd: ctx.root });
  return commit;
}

export async function createAnnotatedTag(
  ctx: RepoContext,
  tag: string,
  commit: string,
  message: string,
): Promise<void> {
  const existing = await ctx.git.run(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], {
    cwd: ctx.root,
  });
  if (existing.exitCode === 0) return;
  await ctx.git.runOk(["tag", "-a", tag, "-m", message, commit], { cwd: ctx.root });
}
