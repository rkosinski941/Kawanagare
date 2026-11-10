import fsp from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { materializeStream } from "../../src/core/materialize.js";
import { cleanupDemo, makeDemo, newTempDir } from "../fixtures/make-demo-repo.js";

/**
 * Prints the tree hash of each materialized demo stream.
 * Commit SHAs are not compared: spec §5 identifies a replay by {contains_hash, tree}.
 */
describe("demo fixture trees", () => {
  it("writes the materialized stream trees", async () => {
    const dir = await newTempDir("kawa-demo-trees-");
    const demo = await makeDemo(dir);
    try {
      const names = ["v1", "v2", "oss"] as const;
      const streams: Record<string, string> = {};
      for (const name of names) {
        const mat = await materializeStream(demo.ctx, name);
        streams[name] = mat.tree;
        expect(mat.tree).toMatch(/^[0-9a-f]{40}$/);
      }
      const version = await demo.ctx.git.run(["--version"], { cwd: dir });
      const payload = {
        git: version.stdout.trim(),
        streams,
      };
      const out = process.env.KAWA_TREE_OUT ?? path.join(process.cwd(), "demo-trees.json");
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await fsp.writeFile(out, JSON.stringify(payload, null, 2) + "\n", "utf8");
    } finally {
      await cleanupDemo(demo);
    }
  });
});
