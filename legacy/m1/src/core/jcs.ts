import { createHash } from "node:crypto";

/**
 * RFC 8785 (JCS) canonical JSON, UTF-8, no trailing newline.
 * Used for every hash: contains_hash, recipe_hash, prefix keys, request_key,
 * the Kawa-In-Play hash and chunk hashes.
 */
export function canonicalize(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return serializeNumber(value as number);
  if (t === "string") return serializeString(value as string);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => serialize(v === undefined ? null : v)).join(",") + "]";
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return "{" + keys.map((k) => serializeString(k) + ":" + serialize(obj[k])).join(",") + "}";
  }
  // undefined / functions are not valid JCS values
  throw new Error(`cannot canonicalize value of type ${t}`);
}

function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error("cannot canonicalize non-finite number");
  if (Object.is(n, -0)) return "0";
  return JSON.stringify(n);
}

function serializeString(s: string): string {
  return JSON.stringify(s);
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function jcsHash(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
