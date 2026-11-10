export interface ParsedMessage {
  subject: string;
  body: string[];
  trailers: [string, string][];
}

const TRAILER_RE = /^([A-Za-z0-9][A-Za-z0-9-]*):[ \t]?(.*)$/;

export function parseCommitMessage(raw: string): ParsedMessage {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
  const lines = text.split("\n");
  const trailerStart = findTrailerStart(lines);
  if (trailerStart < 0) {
    const [subject = "", ...rest] = lines;
    return { subject, body: trimBlank(rest), trailers: [] };
  }
  const head = lines.slice(0, trailerStart);
  const trailerLines = lines.slice(trailerStart);
  const trailers: [string, string][] = [];
  for (const line of trailerLines) {
    const m = line.match(TRAILER_RE);
    if (m) trailers.push([m[1], m[2]]);
  }
  const [subject = "", ...rest] = trimBlank(head);
  return { subject, body: trimBlank(rest), trailers };
}

function findTrailerStart(lines: string[]): number {
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "") continue;
    if (TRAILER_RE.test(lines[i])) {
      last = i;
      continue;
    }
    break;
  }
  return last;
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

export function formatCommitMessage(parsed: ParsedMessage): string {
  const parts: string[] = [];
  parts.push(parsed.subject);
  if (parsed.body.length > 0) {
    parts.push(parsed.body.join("\n"));
  }
  if (parsed.trailers.length > 0) {
    parts.push(parsed.trailers.map(([k, v]) => `${k}: ${v}`).join("\n"));
  }
  return parts.join("\n\n") + "\n";
}

export function getTrailer(parsed: ParsedMessage, key: string): string | null {
  const found = parsed.trailers.filter(([k]) => k.toLowerCase() === key.toLowerCase());
  if (found.length === 0) return null;
  return found[found.length - 1][1];
}

export function getAllTrailers(parsed: ParsedMessage, key: string): string[] {
  return parsed.trailers
    .filter(([k]) => k.toLowerCase() === key.toLowerCase())
    .map(([, v]) => v);
}

const TRAILER_ORDER = [
  "Move-Id",
  "Seed-Id",
  "Agent-Id",
  "Ref-Id",
  "Kawa-Empty",
  "Kawa-Resolved-By",
  "Kawa-Recipe",
  "Kawa-Base",
  "Kawa-In-Play",
];

export function orderedTrailers(trailers: [string, string][]): [string, string][] {
  const rank = (k: string) => {
    const i = TRAILER_ORDER.findIndex((x) => x.toLowerCase() === k.toLowerCase());
    return i < 0 ? TRAILER_ORDER.length : i;
  };
  return [...trailers].sort((a, b) => rank(a[0]) - rank(b[0]));
}

export function normalizeMessage(raw: string): string {
  const parsed = parseCommitMessage(raw);
  parsed.trailers = orderedTrailers(parsed.trailers);
  return formatCommitMessage(parsed);
}

export function withTrailers(raw: string, extra: [string, string][]): string {
  const parsed = parseCommitMessage(raw);
  const keys = new Set(extra.map(([k]) => k.toLowerCase()));
  parsed.trailers = orderedTrailers([
    ...parsed.trailers.filter(([k]) => !keys.has(k.toLowerCase())),
    ...extra,
  ]);
  return formatCommitMessage(parsed);
}
