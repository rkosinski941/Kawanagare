import fsp from "node:fs/promises";
import path from "node:path";
import { expect } from "vitest";
import { KawaError } from "../src/core/errors.js";
import { git, newTempDir } from "./fixtures/make-demo-repo.js";

export { git, newTempDir } from "./fixtures/make-demo-repo.js";

export async function treeOfFiles(files: Record<string, string | Buffer>): Promise<string> {
  const dir = await newTempDir("kawa-tree-");
  try {
    await git(dir, "init", "-q");
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, content);
    }
    await git(dir, "add", "-A");
    return (await git(dir, "write-tree")).trim();
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function expectExit(promise: Promise<unknown>, code: number): Promise<KawaError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(KawaError);
    const ke = err as KawaError;
    if (ke.exitCode !== code) throw new Error(`expected exit ${code}, got ${ke.exitCode}: ${ke.message}`);
    return ke;
  }
  throw new Error(`expected failure with exit ${code}, but the call succeeded`);
}

export async function readStreamFile(
  dir: string,
  stream: string,
  file: string,
): Promise<string> {
  return await git(dir, "show", `streams/${stream}:${file}`);
}

export function lines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}
