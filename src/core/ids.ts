export const ID_PATTERN =
  /^(move|seed|res)\.([a-z0-9-]{1,32}@[a-z0-9-]{1,32}\.)?\d{6}(-[a-z2-7]{6})?$/;

export const STREAM_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

export const AGENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function pad6(n: number): string {
  return String(n).padStart(6, "0");
}

export function moveId(n: number, agent?: string, site?: string): string {
  return prefix("move", n, agent, site);
}

export function seedId(n: number, agent?: string, site?: string): string {
  return prefix("seed", n, agent, site);
}

export function resId(n: number, agent?: string, site?: string): string {
  return prefix("res", n, agent, site);
}

function prefix(kind: string, n: number, agent?: string, site?: string): string {
  if (agent && site) return `${kind}.${agent}@${site}.${pad6(n)}`;
  return `${kind}.${pad6(n)}`;
}

export function eventId(agent: string, site: string, n: number): string {
  return `${agent}@${site}.${pad6(n)}`;
}

export function objectKind(id: string): "move" | "seed" | "res" {
  if (id.startsWith("seed.")) return "seed";
  if (id.startsWith("res.")) return "res";
  return "move";
}

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function isValidStreamName(name: string): boolean {
  if (!STREAM_PATTERN.test(name)) return false;
  if (name.includes("..")) return false;
  if (name.startsWith("-")) return false;
  return true;
}

export function isValidAgent(agent: string): boolean {
  return AGENT_PATTERN.test(agent);
}

/** Numeric counter part of an id (the <n> in ...<n>[-<rand>]). */
export function idNumber(id: string): number {
  const m = id.match(/\.(\d{6})(-[a-z2-7]{6})?$/);
  if (!m) throw new Error(`no numeric part in id ${id}`);
  return parseInt(m[1], 10);
}
