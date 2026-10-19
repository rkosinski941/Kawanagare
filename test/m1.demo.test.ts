import fsp from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRecipe } from "../src/core/streams.js";
import { materializeStream } from "../src/core/materialize.js";
import { backout, carry, merge, splitMove } from "../src/core/ops.js";
import { readObject } from "../src/core/objects.js";
import { withDemo, cleanupDemo, Demo, doMove, appC, appH } from "./fixtures/make-demo-repo.js";
import { expectExit, git, treeOfFiles } from "./helpers.js";

function v1AppC(): string {
  return [
    "#include <stdio.h>",
    "",
    "void foo(void) {",
    '    puts("bar");',
    "}",
    "int main(void) {",
    "    return 0;",
    "}",
    "",
    "/* line 7 */",
    "/* line 8 edited by oss */",
    "/* line 9 */",
    "/* line 10 */",
    "",
  ].join("\n");
}

function v1AppH(): string {
  return ["#ifndef APP_H", "#define APP_H", "", "void foo(void);", "#endif", ""].join("\n");
}

function baseAppC(): string {
  return appC();
}

describe("M1 demo repo", () => {
  let demo: Demo;

  beforeEach(async () => {
    demo = await withDemo();
  });

  afterEach(async () => {
    await cleanupDemo(demo);
  });

  it("test 1: check-in squashes three work commits into one move commit", async () => {
    const msg = await git(demo.dir, "show", "-s", "--format=%B", `refs/kawa/objects/${demo.ids.move1}`);
    expect(msg).toContain("Move-Id: move.000001");
    const names = (await git(demo.dir, "show", "--name-only", "--format=", `refs/kawa/objects/${demo.ids.move1}`))
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(names).toContain("app.c");
    expect(names).toContain("app.h");
    const parents = (await git(
      demo.dir,
      "show",
      "-s",
      "--format=%P",
      `refs/kawa/objects/${demo.ids.move1}`,
    ))
      .trim()
      .split(/\s+/);
    expect(parents).toHaveLength(1);
    const workBranch = await demo.ctx.git.run(
      ["rev-parse", "--verify", "--quiet", "refs/heads/enjoy/move.000001/work"],
      { cwd: demo.dir },
    );
    expect(workBranch.exitCode).not.toBe(0);
  });

  it("test 2: replay gives one commit per object and a stable tree", async () => {
    const attrs = await fsp.readFile(path.join(demo.dir, ".gitattributes"), "utf8");
    const expected = await treeOfFiles({
      "app.c": v1AppC(),
      "app.h": v1AppH(),
      "util.c": "int util(void) { return 2; }\n",
      ".gitattributes": attrs,
    });
    const mat = await materializeStream(demo.ctx, "v1");
    expect(mat.tree).toBe(expected);

    const log = await git(demo.dir, "log", "--reverse", "--format=%H", "cp/v1/1..streams/v1");
    const shas = log.split("\n").map((s) => s.trim()).filter(Boolean);
    expect(shas).toHaveLength(4);
    const messages = await Promise.all(shas.map((s) => demo.ctx.git.messageOf(s, demo.dir)));
    expect(messages[0]).toContain(`Move-Id: ${demo.ids.move2}`);
    expect(messages[1]).toContain(`Move-Id: ${demo.ids.move3}`);
    expect(messages[2]).toContain(`Seed-Id: ${demo.ids.seed2}`);
    expect(messages[3]).toContain(`Move-Id: ${demo.ids.move4}`);

    const again = await materializeStream(demo.ctx, "v1");
    expect(again.skipped).toBe(true);
    expect(again.head).toBe(mat.head);

    await demo.ctx.git.run(["update-ref", "-d", "refs/heads/streams/v1"], { cwd: demo.dir });
    await fsp.rm(path.join(demo.ctx.gitDir, "kawa", "cache", "replay", "v1.json"), { force: true });
    const full = await materializeStream(demo.ctx, "v1");
    expect(full.tree).toBe(expected);
  });

  it("test 4: backing out move.000002 rebuilds without the line-8 edit", async () => {
    await backout(demo.ctx, { stream: "v1", ids: [demo.ids.move2], agent: "enjoy" });
    await materializeStream(demo.ctx, "v1");
    const c = await git(demo.dir, "show", "streams/v1:app.c");
    expect(c).toContain("/* line 8 */");
    expect(c).not.toContain("edited by oss");
    expect(c).toContain('puts("bar");');
  });

  it("test 8: back-carry works in both directions", async () => {
    await carry(demo.ctx, {
      ids: [demo.ids.move3],
      from: "v1",
      to: "v2",
      agent: "enjoy",
    });
    const back = await doMove(demo.ctx, {
      stream: "v2",
      agent: "enjoy",
      description: "add bar prototype",
      build: async (wt) => {
        const current = await fsp.readFile(path.join(wt, "app.h"), "utf8");
        const h = current.replace("#endif", "void bar(void);\n#endif");
        await fsp.writeFile(path.join(wt, "app.h"), h, "utf8");
        await git(wt, "add", "-A");
        await git(wt, "commit", "-q", "-m", "bar prototype");
      },
    });
    await carry(demo.ctx, {
      ids: [back.ids[0]],
      from: "v2",
      to: "v1",
      agent: "enjoy",
    });
    const v1h = await git(demo.dir, "show", "streams/v1:app.h");
    const v2h = await git(demo.dir, "show", "streams/v2:app.h");
    expect(v1h).toContain("void bar(void);");
    expect(v2h).toContain("void bar(void);");
    const v1 = await getRecipe(demo.ctx, "v1");
    const v2 = await getRecipe(demo.ctx, "v2");
    expect(v1?.objects.some((o) => o.id === back.ids[0])).toBe(true);
    expect(v2?.objects.some((o) => o.id === demo.ids.move3)).toBe(true);
  });

  it("test 9: merging v1 into v2 adds only missing objects", async () => {
    const res = await merge(demo.ctx, { from: "v1", to: "v2", agent: "enjoy" });
    expect(new Set(res.added)).toEqual(
      new Set([demo.ids.move3, demo.ids.seed2, demo.ids.move4]),
    );
    expect(res.skipped_backed_out).toEqual([]);
  });

  it("test 10: conflicts and path_exists leave recipes unchanged", async () => {
    const before = JSON.stringify(await getRecipe(demo.ctx, "v1"));
    const err = await expectExit(
      carry(demo.ctx, { ids: [demo.ids.move5], from: "oss", to: "v1", agent: "oss" }),
      2,
    );
    expect(err.detail).toBeTruthy();
    await expectExit(
      carry(demo.ctx, {
        ids: [demo.ids.move5],
        from: "oss",
        to: "v1",
        agent: "oss",
        dryRun: true,
      }),
      2,
    );
    const seedErr = await expectExit(
      carry(demo.ctx, { ids: [demo.ids.seed2], from: "v1", to: "v1", agent: "reach" }),
      2,
    );
    expect((seedErr.detail as { error?: string })?.error).toBe("path_exists");
    expect(JSON.stringify(await getRecipe(demo.ctx, "v1"))).toBe(before);
  });

  it("test 16: merge does not resurrect a backed-out move", async () => {
    await carry(demo.ctx, { ids: [demo.ids.move2], from: "v1", to: "v2", agent: "oss" });
    await backout(demo.ctx, { stream: "v2", ids: [demo.ids.move2], agent: "oss" });
    const res = await merge(demo.ctx, { from: "v1", to: "v2", agent: "enjoy" });
    expect(res.skipped_backed_out).toContain(demo.ids.move2);
    const recipe = await getRecipe(demo.ctx, "v2");
    const entry = recipe?.objects.find((o) => o.id === demo.ids.move2);
    expect(entry?.in_play).toBe(false);
  });

  it("test 17: re-carrying the same change yields an empty pick", async () => {
    await carry(demo.ctx, { ids: [demo.ids.move2], from: "v1", to: "v2", agent: "oss" });
    await demo.ctx.git.run(["update-ref", "-d", "refs/heads/streams/v2"], { cwd: demo.dir });
    await fsp.rm(path.join(demo.ctx.gitDir, "kawa", "cache", "replay", "v2.json"), { force: true });
    const mat = await materializeStream(demo.ctx, "v2");
    expect(mat.already_applied).toContain(demo.ids.move2);
    expect(mat.empty).toContain(demo.ids.move2);
    const log = await git(demo.dir, "log", "--format=%B", "streams/v2", "--grep=Kawa-Empty: true");
    expect(log).toContain("Kawa-Empty: true");
    expect(log).toContain(`Move-Id: ${demo.ids.move2}`);
  });

  it("test 24a: a checkpoint empties the stream list and replays nothing", async () => {
    const { checkpointStream, getRecipe: get } = await import("../src/core/streams.js");
    const cp = await checkpointStream(demo.ctx, "enjoy", "v1");
    expect(cp.tag).toBe("cp/v1/2");
    const recipe = await get(demo.ctx, "v1");
    expect(recipe?.objects).toHaveLength(0);
    expect(cp.record.contains).toEqual(
      expect.arrayContaining([
        demo.ids.seed1,
        demo.ids.move1,
        demo.ids.move2,
        demo.ids.move3,
        demo.ids.seed2,
        demo.ids.move4,
      ]),
    );
    const mat = await materializeStream(demo.ctx, "v1");
    expect(mat.replayed).toEqual([]);
  });

  it("test 20: move split creates two ids and updates re-pointed dependents", async () => {
    const err = await expectExit(
      splitMove(demo.ctx, { id: demo.ids.move1, paths: ["app.c"], stream: "v1", agent: "enjoy" }),
      3,
    );
    expect((err.detail as { dependents?: string[] })?.dependents).toContain(demo.ids.move3);
    const res = await splitMove(demo.ctx, {
      id: demo.ids.move1,
      paths: ["app.c"],
      stream: "v1",
      agent: "enjoy",
      repoint: { [demo.ids.move3]: ["app.c"] },
    });
    expect(res.new).toHaveLength(2);
    expect(res.new).not.toContain(demo.ids.move1);
    const { readEvent } = await import("../src/core/events.js");
    const ev = await readEvent(demo.ctx, "v1", res.supersede_event);
    expect(ev?.kind).toBe("supersede");
    expect((ev as { new?: string[] })?.new).toEqual(res.new);
    const moved = await readObject(demo.ctx, demo.ids.move3);
    expect(moved.depends_on).toContain(res.new[0]);
    expect(moved.depends_on).not.toContain(demo.ids.move1);
    const parts = await Promise.all(res.new.map((id) => readObject(demo.ctx, id)));
    expect(parts.map((p) => p.paths).flat().sort()).toEqual(["app.c", "app.h"]);
  });

  it("test 25: split check-in makes a seed then a move that depends on it", async () => {
    const { checkin, checkout } = await import("../src/core/work.js");
    const co = await demo.ctx.withLock("enjoy", () =>
      checkout(demo.ctx, { stream: "v1", agent: "enjoy", description: "add new.c" }),
    );
    await fsp.writeFile(path.join(co.worktree, "new.c"), "int nu(void) { return 3; }\n");
    const c = baseAppC().replace("/* line 9 */", "/* line 9 changed */");
    await fsp.writeFile(path.join(co.worktree, "app.c"), c, "utf8");
    await git(co.worktree, "add", "-A");
    await git(co.worktree, "commit", "-q", "-m", "add new.c and edit app.c");
    const res = await demo.ctx.withLock("enjoy", () =>
      checkin(demo.ctx, {
        id: co.id,
        cwd: co.worktree,
        description: "add new.c",
        split: true,
      }),
    );
    expect(res.kind).toBe("split");
    expect(res.ids).toHaveLength(2);
    const [seed, move] = await Promise.all(res.ids.map((id) => readObject(demo.ctx, id)));
    expect(seed.kind).toBe("seed");
    expect(move.kind).toBe("move");
    expect(move.depends_on).toContain(seed.id);
    const refs = await git(demo.dir, "for-each-ref", "refs/kawa/objects");
    expect(refs).toContain(res.ids[0]);
    expect(refs).toContain(res.ids[1]);
  });
});
