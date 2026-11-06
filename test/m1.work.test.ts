import fsp from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepoContext } from "../src/core/context.js";
import { initRepo } from "../src/core/init.js";
import { createStream, getRecipe } from "../src/core/streams.js";
import { materializeStream } from "../src/core/materialize.js";
import { cancel, checkin, checkout, resume } from "../src/core/work.js";
import { adopt } from "../src/core/adopt.js";
import { readStreamEvents } from "../src/core/events.js";
import { readObject } from "../src/core/objects.js";
import {
  appC,
  cleanupDemo,
  createRepo,
  Demo,
  doMove,
  newTempDir,
  withDemo,
} from "./fixtures/make-demo-repo.js";
import { expectExit, git } from "./helpers.js";

async function commitAll(wt: string, msg: string, trailers?: string): Promise<void> {
  await git(wt, "add", "-A");
  const args = ["commit", "-q", "-m", msg];
  if (trailers) args.push("-m", trailers);
  await git(wt, ...args);
}

async function lightRepo(): Promise<{ dir: string; ctx: RepoContext }> {
  const dir = await newTempDir();
  await createRepo(dir);
  await initRepo(dir, { agent: "rich" });
  const ctx = await RepoContext.load(dir);
  await ctx.withLock("enjoy", () => createStream(ctx, "enjoy", "v1", { base: "cp/root/0" }));
  return { dir, ctx };
}

describe("M1 work areas and replay", () => {
  let demo: Demo | null = null;

  afterEach(async () => {
    await cleanupDemo(demo);
    demo = null;
  });

  it("test 14: adopt scans plain commits and squashes Change-Set-Id groups", async () => {
    const { dir, ctx } = await lightRepo();
    try {
      const base = (await git(dir, "rev-parse", "HEAD")).trim();
      await fsp.writeFile(path.join(dir, "app.c"), appC() + "int two;\n");
      await commitAll(dir, "edit app.c");
      await fsp.writeFile(path.join(dir, "b.c"), "int b;\n");
      await commitAll(dir, "add b.c", "Change-Set-Id: legacy-set-1");
      await fsp.writeFile(path.join(dir, "app.c"), appC() + "int two;\nint three;\n");
      await commitAll(dir, "edit app.c again", "Change-Set-Id: legacy-set-1");

      const first = await adopt(ctx, { scan: `${base}..HEAD`, agent: "adopt" });
      expect(first.adopted).toHaveLength(2);
      expect(first.adopted.some((a) => a.kind === "move")).toBe(true);
      const aliases = await Promise.all(
        first.adopted.map(async (a) => (await readObject(ctx, a.id)).legacy_alias),
      );
      expect(aliases.every((a) => !!a && a.startsWith("legacy-"))).toBe(true);

      const again = await adopt(ctx, { scan: `${base}..HEAD`, agent: "adopt" });
      expect(again.adopted).toHaveLength(0);
      const mat = await materializeStream(ctx, "main");
      const b = await git(dir, "show", `${mat.head}:b.c`);
      expect(b.trim()).toBe("int b;");
      const recipe = await getRecipe(ctx, "main");
      expect(recipe?.objects.length).toBeGreaterThanOrEqual(2);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("test 30: two concurrent checkouts land in order", async () => {
    demo = await withDemo();
    const co1 = await demo.ctx.withLock("enjoy", () =>
      checkout(demo!.ctx, { stream: "v1", agent: "enjoy", description: "first parallel" }),
    );
    const co2 = await demo.ctx.withLock("oss", () =>
      checkout(demo!.ctx, { stream: "v1", agent: "oss", description: "second parallel" }),
    );
    expect(co1.worktree).not.toBe(co2.worktree);

    await fsp.writeFile(
      path.join(co1.worktree, "app.c"),
      (await fsp.readFile(path.join(co1.worktree, "app.c"), "utf8")).replace("/* line 9 */", "/* line 9 co1 */"),
    );
    await commitAll(co1.worktree, "co1 change");
    await fsp.writeFile(
      path.join(co1.worktree, "app.h"),
      (await fsp.readFile(path.join(co1.worktree, "app.h"), "utf8")).replace("#endif", "int one(void);\n#endif"),
    );
    await commitAll(co1.worktree, "co1 header");

    await fsp.writeFile(
      path.join(co2.worktree, "app.c"),
      (await fsp.readFile(path.join(co2.worktree, "app.c"), "utf8")).replace(
        "/* line 7 */",
        "/* line 7 co2 */",
      ),
    );
    await commitAll(co2.worktree, "co2 header");

    const r1 = await demo.ctx.withLock("enjoy", () =>
      checkin(demo!.ctx, { id: co1.id, cwd: co1.worktree, description: "first parallel" }),
    );
    const r2 = await demo.ctx.withLock("oss", () =>
      checkin(demo!.ctx, { id: co2.id, cwd: co2.worktree, description: "second parallel" }),
    );
    expect(r1.ids[0]).toBe(co1.id);
    expect(r2.ids[0]).toBe(co2.id);
    const recipe = await getRecipe(demo.ctx, "v1");
    const ids = recipe!.objects.map((o) => o.id);
    expect(ids).toContain(co1.id);
    expect(ids).toContain(co2.id);
    expect(ids.indexOf(co1.id)).toBeLessThan(ids.indexOf(co2.id));
    await materializeStream(demo.ctx, "v1");
    const h = await git(demo.dir, "show", "streams/v1:app.h");
    expect(h).toContain("int one(void);");
    const c = await git(demo.dir, "show", "streams/v1:app.c");
    expect(c).toContain("/* line 9 co1 */");
    expect(c).toContain("/* line 7 co2 */");
  });

  it("test 31: stale base exits 6 then --rebase finishes after a fix", async () => {
    demo = await withDemo();
    const coA = await demo.ctx.withLock("enjoy", () =>
      checkout(demo!.ctx, { stream: "v1", agent: "enjoy", description: "stale A" }),
    );
    const coB = await demo.ctx.withLock("oss", () =>
      checkout(demo!.ctx, { stream: "v1", agent: "oss", description: "stale B" }),
    );
    const editLine8 = async (wt: string, text: string) => {
      const c = (await fsp.readFile(path.join(wt, "app.c"), "utf8")).split("\n");
      const at = c.findIndex((l) => l.includes("line 8"));
      expect(at).toBeGreaterThanOrEqual(0);
      c[at] = text;
      await fsp.writeFile(path.join(wt, "app.c"), c.join("\n"));
      expect(await git(wt, "status", "--porcelain")).toContain("app.c");
    };
    await editLine8(coA.worktree, "/* line 8 from A */");
    await commitAll(coA.worktree, "A line 8");
    await editLine8(coB.worktree, "/* line 8 from B */");
    await commitAll(coB.worktree, "B line 8");
    await demo.ctx.withLock("oss", () =>
      checkin(demo!.ctx, { id: coB.id, cwd: coB.worktree, description: "stale B" }),
    );

    const err = await expectExit(
      demo.ctx.withLock("enjoy", () =>
        checkin(demo!.ctx, { id: coA.id, cwd: coA.worktree, description: "stale A" }),
      ),
      6,
    );
    const conflictsFile = path.join(demo.ctx.conflictsDir, "v1.json");
    expect((err.detail as { conflicts_file?: string })?.conflicts_file ?? conflictsFile).toBeTruthy();
    expect(await fsp.stat(conflictsFile)).toBeTruthy();

    // Resolve by keeping B's line 8 and adding an unrelated change in A.
    const fixed = (await fsp.readFile(path.join(coA.worktree, "app.c"), "utf8"))
      .split("\n")
      .map((l) => (l === "/* line 8 from A */" ? "/* line 8 from B */" : l))
      .join("\n")
      .replace("/* line 10 */", "/* line 10 fixed */");
    await fsp.writeFile(path.join(coA.worktree, "app.c"), fixed);
    await commitAll(coA.worktree, "resolve stale base");
    const r = await demo.ctx.withLock("enjoy", () =>
      checkin(demo!.ctx, { id: coA.id, cwd: coA.worktree, description: "stale A", rebase: true }),
    );
    expect(r.ids[0]).toBe(coA.id);
    const c = await git(demo.dir, "show", "streams/v1:app.c");
    expect(c).toContain("/* line 8 from B */");
    expect(c).toContain("/* line 10 fixed */");
  });

  it("test 32: cancel keeps the id unreissued and resume restores the work", async () => {
    demo = await withDemo();
    const co = await demo.ctx.withLock("enjoy", () =>
      checkout(demo!.ctx, { stream: "v1", agent: "enjoy", description: "cancelled work" }),
    );
    await fsp.writeFile(path.join(co.worktree, "app.c"), appC() + "int cancelme;\n");
    await commitAll(co.worktree, "work to cancel");

    await demo.ctx.withLock("enjoy", () => cancel(demo.ctx, co.id, "enjoy"));
    const next = await demo.ctx.withLock("enjoy", () =>
      checkout(demo!.ctx, { stream: "v1", agent: "enjoy", description: "different work" }),
    );
    expect(next.id).not.toBe(co.id);

    const restored = await demo.ctx.withLock("enjoy", () => resume(demo!.ctx, co.id));
    expect(restored.id).toBe(co.id);
    expect(restored.worktree).toBe(co.worktree);
    const content = await fsp.readFile(path.join(co.worktree, "app.c"), "utf8");
    expect(content).toContain("int cancelme;");
    const r = await demo.ctx.withLock("enjoy", () =>
      checkin(demo!.ctx, { id: co.id, cwd: co.worktree, description: "cancelled work" }),
    );
    expect(r.ids[0]).toBe(co.id);
    void next;
  });

  it("test 33: a killed check-in writes no event and a retry returns one move", async () => {
    demo = await withDemo();
    const cli = path.resolve(process.cwd(), "dist", "cli", "index.js");
    expect(await fsp.stat(cli)).toBeTruthy();
    for (const step of ["after-squash", "after-object", "before-event"]) {
      const before = (await readStreamEvents(demo.ctx, "v1")).filter((e) => e.kind === "add").length;
      const co = await demo.ctx.withLock("enjoy", () =>
        checkout(demo!.ctx, { stream: "v1", agent: "enjoy", description: `crash ${step}` }),
      );
      await fsp.writeFile(
        path.join(co.worktree, "app.h"),
        (await fsp.readFile(path.join(co.worktree, "app.h"), "utf8")).replace(
          "#endif",
          `int crash_${step.replace(/-/g, "_")}(void);\n#endif`,
        ),
      );
      await commitAll(co.worktree, "crash work");
      const key = `crash-${step}`;

      const crashed = await execa("node", [cli, "checkin", "--id", co.id, "--idempotency-key", key, "--json"], {
        cwd: co.worktree,
        reject: false,
        env: { ...process.env, KAWA_TEST_CRASH_AT: step },
      });
      expect(crashed.exitCode).toBe(137);
      expect((await readStreamEvents(demo.ctx, "v1")).filter((e) => e.kind === "add").length).toBe(
        before,
      );

      const retried = await execa("node", [cli, "checkin", "--id", co.id, "--idempotency-key", key, "--json"], {
        cwd: co.worktree,
        reject: false,
        env: { ...process.env, KAWA_TEST_CRASH_AT: "" },
      });
      expect(retried.exitCode).toBe(0);
      const adds = (await readStreamEvents(demo.ctx, "v1")).filter(
        (e) => e.kind === "add" && (e.objects ?? []).includes(co.id),
      );
      expect(adds).toHaveLength(1);
      expect(adds[0].request_key).toBe(key);

      const again = await execa("node", [cli, "checkin", "--id", co.id, "--idempotency-key", key, "--json"], {
        cwd: demo.dir,
        reject: false,
      });
      expect(again.exitCode).toBe(0);
      const body = JSON.parse(again.stdout);
      expect(body.ids).toEqual([co.id]);
    }
  });

  it("test 34: incremental replay matches a full replay", async () => {
    demo = await withDemo();
    const mat1 = await materializeStream(demo.ctx, "v1");
    await doMove(demo.ctx, {
      stream: "v1",
      agent: "enjoy",
      description: "incremental change",
      build: async (wt) => {
        const c = (await fsp.readFile(path.join(wt, "app.c"), "utf8")).replace(
          "/* line 10 */",
          "/* line 10 incremental */",
        );
        await fsp.writeFile(path.join(wt, "app.c"), c);
        await commitAll(wt, "incremental");
      },
    });
    const mat2 = await materializeStream(demo.ctx, "v1");
    expect(mat2.tree).not.toBe(mat1.tree);

    await demo.ctx.git.run(["update-ref", "-d", "refs/heads/streams/v1"], { cwd: demo.dir });
    await fsp.rm(path.join(demo.ctx.gitDir, "kawa", "cache", "replay", "v1.json"), { force: true });
    const full = await materializeStream(demo.ctx, "v1");
    expect(full.tree).toBe(mat2.tree);
  });

  it("test 35: a path longer than 260 characters checks in and materializes", async () => {
    const { dir, ctx } = await lightRepo();
    try {
      const co = await ctx.withLock("enjoy", () =>
        checkout(ctx, { stream: "v1", agent: "enjoy", description: "long path" }),
      );
      let rel = "deep";
      let i = 0;
      while (path.join(co.worktree, rel, "long-file.txt").length < 280) {
        rel = path.join(rel, `segment-${String(i).padStart(2, "0")}-${"x".repeat(30)}`);
        i++;
      }
      const abs = path.join(co.worktree, rel, "long-file.txt");
      expect(abs.length).toBeGreaterThan(260);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, "long path content\n");
      await commitAll(co.worktree, "long path");
      const r = await ctx.withLock("enjoy", () =>
        checkin(ctx, { id: co.id, cwd: co.worktree, description: "long path", noSplit: true }),
      );
      expect(r.ids).toHaveLength(1);
      expect(r.ids[0]).toMatch(/^seed\./);
      const mat = await materializeStream(ctx, "v1");
      const entries = await git(dir, "ls-tree", "-r", "--name-only", mat.tree);
      expect(entries).toContain(rel.replace(/\\/g, "/") + "/long-file.txt");
      const content = await ctx.git.fileAt(mat.head, rel.replace(/\\/g, "/") + "/long-file.txt", dir);
      expect(content.toString("utf8")).toBe("long path content\n");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 300000);
});
