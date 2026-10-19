import fsp from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { initRepo } from "../../src/core/init.js";
import { newTempDir } from "../fixtures/make-demo-repo.js";

async function git(dir: string, ...args: string[]): Promise<string> {
  const res = await execa("git", args, { cwd: dir, reject: false });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

describe("CRLF working tree", () => {
  it("renormalizes a CRLF blob to LF before seed.000001", async () => {
    const dir = await newTempDir("kawa-crlf-");
    try {
      await git(dir, "init", "-q", "-b", "main");
      await git(dir, "config", "user.name", "Rich Kosinski");
      await git(dir, "config", "user.email", "rich@kawanagare.invalid");
      await git(dir, "config", "core.autocrlf", "false");
      await git(dir, "config", "core.eol", "lf");
      await fsp.writeFile(path.join(dir, "app.c"), "int main(void) {\r\n    return 0;\r\n}\r\n");
      await git(dir, "add", "--", "app.c");
      await git(dir, "commit", "-m", "crlf import");

      const before = (await git(dir, "rev-parse", "HEAD:app.c")).trim();
      await initRepo(dir, { agent: "rich" });

      const subjects = (await git(dir, "log", "--format=%s")).split("\n").filter(Boolean);
      expect(subjects[0]).toBe("Add kawa line-ending policy");

      const seed = await execa("git", ["cat-file", "-p", "refs/kawa/objects/seed.000001:app.c"], {
        cwd: dir,
        encoding: "buffer",
        stripFinalNewline: false,
        reject: false,
      });
      expect(seed.exitCode).toBe(0);
      const bytes = Buffer.from(seed.stdout as Buffer);
      expect(bytes.includes(0x0d)).toBe(false);
      expect(bytes.toString("utf8")).toBe("int main(void) {\n    return 0;\n}\n");

      const after = (await git(dir, "rev-parse", "HEAD:app.c")).trim();
      expect(after).not.toBe(before);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
