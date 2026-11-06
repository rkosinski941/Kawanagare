import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RepoContext } from "../../src/core/context.js";
import { initRepo } from "../../src/core/init.js";
import { checkpointStream, createStream } from "../../src/core/streams.js";
import { addFiles, checkin, checkout, CheckinResult } from "../../src/core/work.js";
import { carry } from "../../src/core/ops.js";

export const FIXED_NOW = "2026-10-18T18:00:00-04:00";

export interface Demo {
  dir: string;
  ctx: RepoContext;
  ids: {
    move1: string;
    move2: string;
    move3: string;
    move4: string;
    move5: string;
    seed1: string;
    seed2: string;
  };
}

export function appC(): string {
  return [
    "#include <stdio.h>",
    "",
    "int main(void) {",
    "    return 0;",
    "}",
    "",
    "/* line 7 */",
    "/* line 8 */",
    "/* line 9 */",
    "/* line 10 */",
    "",
  ].join("\n");
}

export function appH(): string {
  return ["#ifndef APP_H", "#define APP_H", "", "#endif", ""].join("\n");
}

export async function git(dir: string, ...args: string[]): Promise<string> {
  const { execa } = await import("execa");
  const res = await execa("git", args, { cwd: dir, reject: false });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${res.exitCode}): ${res.stderr}${res.stdout}`);
  }
  return res.stdout;
}

export async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const abs = path.join(dir, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, "utf8");
}

async function commitAll(worktree: string, message: string): Promise<void> {
  await git(worktree, "add", "-A");
  await git(worktree, "commit", "-m", message);
}

export async function newTempDir(prefix = "kawa-test-"): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function createRepo(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "config", "user.name", "Rich Kosinski");
  await git(dir, "config", "user.email", "rich@kawanagare.invalid");
  await git(dir, "config", "core.autocrlf", "false");
  await git(dir, "config", "core.eol", "lf");
  await git(dir, "config", "core.longpaths", "true");
  await writeFile(dir, "app.c", appC());
  await writeFile(dir, "app.h", appH());
  await commitAll(dir, "initial import");
}

export interface MoveSpec {
  stream: string;
  agent: string;
  description: string;
  build: (worktree: string) => Promise<void>;
  dependsOn?: string[];
}

export async function doMove(ctx: RepoContext, spec: MoveSpec): Promise<CheckinResult & { worktree: string }> {
  const co = await ctx.withLock(spec.agent, () =>
    checkout(ctx, { stream: spec.stream, agent: spec.agent, description: spec.description }),
  );
  await spec.build(co.worktree);
  const res = await ctx.withLock(spec.agent, () =>
    checkin(ctx, {
      id: co.id,
      cwd: co.worktree,
      description: spec.description,
      dependsOn: spec.dependsOn,
    }),
  );
  return { ...res, worktree: co.worktree };
}

export async function makeDemo(dir: string): Promise<Demo> {
  const previous = process.env.KAWA_NOW;
  process.env.KAWA_NOW = FIXED_NOW;
  try {
    await createRepo(dir);
    await initRepo(dir, { agent: "rich" });
    const ctx = await RepoContext.load(dir);

    await ctx.withLock("enjoy", () => createStream(ctx, "enjoy", "v1", { base: "cp/root/0" }));

    // move.000001: enjoy, three work commits, touches app.c and app.h.
    const m1 = await doMove(ctx, {
      stream: "v1",
      agent: "enjoy",
      description: "add foo helper",
      build: async (wt) => {
        const c = appC().split("\n");
        c.splice(2, 0, "void foo(void) {", '    puts("foo");', "}");
        await writeFile(wt, "app.c", c.join("\n"));
        await commitAll(wt, "add foo body");

        const h = appH().split("\n");
        h.splice(3, 0, "void foo(void);");
        await writeFile(wt, "app.h", h.join("\n"));
        await commitAll(wt, "declare foo");

        const c2 = (await fsp.readFile(path.join(wt, "app.c"), "utf8")).replace(
          'puts("foo")',
          'puts("foo!")',
        );
        await writeFile(wt, "app.c", c2);
        await commitAll(wt, "polish foo message");
      },
    });

    await ctx.withLock("enjoy", () => checkpointStream(ctx, "enjoy", "v1"));

    await ctx.withLock("enjoy", () =>
      createStream(ctx, "enjoy", "v2", { forkFrom: { stream: "v1", checkpoint: 1 } }),
    );
    await ctx.withLock("oss", () =>
      createStream(ctx, "oss", "oss", { forkFrom: { stream: "v1", checkpoint: 1 } }),
    );

    // move.000002: oss, edits line 8 of app.c.
    const m2 = await doMove(ctx, {
      stream: "v1",
      agent: "oss",
      description: "edit line eight",
      build: async (wt) => {
        const original = await fsp.readFile(path.join(wt, "app.c"), "utf8");
        const c = original.split("\n");
        c[c.indexOf("/* line 8 */")] = "/* line 8 edited by oss */";
        await writeFile(wt, "app.c", c.join("\n"));
        await commitAll(wt, "line 8");
      },
    });

    await ctx.withLock("oss", () => carry(ctx, { ids: [m2.ids[0]], from: "v1", to: "v2", agent: "oss" }));

    // move.000003: enjoy, modifies move.000001's line 4.
    const m3 = await doMove(ctx, {
      stream: "v1",
      agent: "enjoy",
      description: "tune foo body",
      build: async (wt) => {
        const original = await fsp.readFile(path.join(wt, "app.c"), "utf8");
        const changed = original.replace('puts("foo!");', 'puts("bar");');
        await writeFile(wt, "app.c", changed);
        await commitAll(wt, "foo body");
      },
      dependsOn: [m1.ids[0]],
    });

    // seed.000002: reach, creates util.c.
    await writeFile(dir, "util.c", "int util(void) { return 1; }\n");
    const s2 = await ctx.withLock("reach", () =>
      addFiles(ctx, {
        files: ["util.c"],
        stream: "v1",
        description: "add util",
        agent: "reach",
        cwd: dir,
      }),
    );

    // move.000004: reach, edits util.c.
    const m4 = await doMove(ctx, {
      stream: "v1",
      agent: "reach",
      description: "extend util",
      build: async (wt) => {
        await writeFile(wt, "util.c", "int util(void) { return 2; }\n");
        await commitAll(wt, "util returns 2");
      },
      dependsOn: [s2.ids[0]],
    });

    // move.000005: oss, changes line 8 differently (collides with move.000002).
    const m5 = await doMove(ctx, {
      stream: "oss",
      agent: "oss",
      description: "different line eight",
      build: async (wt) => {
        const c = appC().split("\n");
        c[c.indexOf("/* line 8 */")] = "/* line 8 changed by oss differently */";
        await writeFile(wt, "app.c", c.join("\n"));
        await commitAll(wt, "different line 8");
      },
    });

    return {
      dir,
      ctx,
      ids: {
        move1: m1.ids[0],
        move2: m2.ids[0],
        move3: m3.ids[0],
        move4: m4.ids[0],
        move5: m5.ids[0],
        seed1: "seed.000001",
        seed2: s2.ids[0],
      },
    };
  } finally {
    if (previous === undefined) delete process.env.KAWA_NOW;
    else process.env.KAWA_NOW = previous;
  }
}

export async function withDemo(): Promise<Demo> {
  const dir = await newTempDir();
  return await makeDemo(dir);
}

export async function cleanupDemo(demo: Demo | null): Promise<void> {
  if (!demo) return;
  await fsp.rm(demo.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
}
