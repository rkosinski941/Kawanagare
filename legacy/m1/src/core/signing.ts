import { execa } from "execa";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { RepoContext } from "./context.js";

export interface SiteKey {
  privateKey: string;
  publicKey: string;
}

/** One SSH signing key per site. Kept only under .git/kawa/ (never in the repo). */
export async function ensureSiteKey(ctx: RepoContext, site: string): Promise<SiteKey | null> {
  const privateKey = path.join(ctx.kawaDir, "site_key");
  const publicKey = `${privateKey}.pub`;
  if (!fs.existsSync(privateKey)) {
    await fsp.mkdir(ctx.kawaDir, { recursive: true });
    const res = await execa(
      "ssh-keygen",
      ["-q", "-t", "ed25519", "-N", "", "-C", `kawa site ${site}`, "-f", privateKey],
      { reject: false, windowsHide: true, encoding: "utf8" },
    );
    if (res.exitCode !== 0) return null;
    try {
      fs.chmodSync(privateKey, 0o600);
    } catch {
      /* windows */
    }
  }
  if (!fs.existsSync(privateKey)) return null;
  return { privateKey, publicKey };
}

/** Sign a payload with the site key (SSH signature, namespace "kawa"). */
export async function signPayload(
  key: SiteKey | null,
  payload: string,
): Promise<string | null> {
  if (!key) return null;
  const tmp = `${key.privateKey}.${process.pid}.${Date.now()}.payload`;
  try {
    await fsp.writeFile(tmp, payload, "utf8");
    const res = await execa(
      "ssh-keygen",
      ["-Y", "sign", "-f", key.privateKey, "-n", "kawa", tmp],
      { reject: false, windowsHide: true, encoding: "utf8" },
    );
    if (res.exitCode !== 0) return null;
    return await fsp.readFile(`${tmp}.sig`, "utf8");
  } catch {
    return null;
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    await fsp.rm(`${tmp}.sig`, { force: true }).catch(() => undefined);
  }
}

export async function verifyPayload(
  allowedSignersFile: string,
  signature: string,
  payload: string,
  identity: string,
): Promise<boolean> {
  const tmpSig = `${payload}.${process.pid}.sig`;
  const tmpPayload = `${payload}.${process.pid}.data`;
  try {
    await fsp.writeFile(tmpSig, signature, "utf8");
    await fsp.writeFile(tmpPayload, payload, "utf8");
    const res = await execa(
      "ssh-keygen",
      ["-Y", "verify", "-f", allowedSignersFile, "-I", identity, "-n", "kawa", "-s", tmpSig],
      { reject: false, input: await fsp.readFile(tmpPayload), windowsHide: true },
    );
    return res.exitCode === 0;
  } catch {
    return false;
  } finally {
    await fsp.rm(tmpSig, { force: true }).catch(() => undefined);
    await fsp.rm(tmpPayload, { force: true }).catch(() => undefined);
  }
}

export function keyForLocal(ctx: RepoContext): SiteKey | null {
  const configured = ctx.local.signing?.key;
  if (!configured || !fs.existsSync(configured)) return null;
  return { privateKey: configured, publicKey: `${configured}.pub` };
}
