/**
 * Repo-path and name policy for the M3 reference model.
 *
 * Repo paths always use `/`, on every operating system. Worktree checks
 * compare canonical path segments, so a text prefix cannot treat `wt2` as
 * inside `wt`.
 */

export const DEFAULT_POLICY = Object.freeze({
  case: 'insensitive',
  unicode: 'nfc',
  forbidden: 'windows',
  maxPath: 259,
});

const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function nameKey(name, policy = DEFAULT_POLICY) {
  let x = String(name);
  if (policy.unicode === 'nfc') x = x.normalize('NFC');
  if (policy.case === 'insensitive') x = x.toLocaleLowerCase('en-US');
  return x;
}

export function sameName(a, b, policy = DEFAULT_POLICY) {
  return nameKey(a, policy) === nameKey(b, policy);
}

/** A single path segment the signed repo policy refuses at check-in. */
export function forbiddenName(name, policy = DEFAULT_POLICY) {
  if (typeof name !== 'string') return 'name must be a string';
  if (name.length === 0) return 'empty name';
  if (name === '.' || name === '..') return 'name is . or ..';
  if (name.includes('/') || name.includes('\\')) return 'name contains a slash';
  if (policy.forbidden !== 'windows') return null;
  if (/[<>:"|?*\u0000-\u001f]/.test(name)) return 'windows-forbidden character';
  if (/[. ]$/.test(name)) return 'trailing dot or space';
  if (RESERVED_WINDOWS.test(name)) return 'windows reserved device name';
  return null;
}

export function joinRepoPath(parent, name) {
  if (!parent) return name;
  return `${parent}/${name}`;
}

/**
 * Canonicalise a Windows-style path for an inside-repo test.
 * `aliases` maps short names (8.3) to long names, matched per segment.
 * `.` and `..` are resolved. Drive-letter case is kept here; folding is
 * applied by `insideWorktree` when the filesystem folds case.
 */
export function canonicalizePath(input, aliases = {}) {
  const raw = String(input).replace(/\//g, '\\');
  const keepLeading = raw.startsWith('\\\\');
  const parts = raw.split('\\');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];
    if (part === '' ) {
      if (i === 0 || (keepLeading && out.length < 2 && out.every((p) => p === ''))) out.push('');
      continue;
    }
    if (part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '') out.pop();
      continue;
    }
    const mapped = lookupAlias(part, aliases);
    out.push(mapped);
  }
  return out;
}

function lookupAlias(part, aliases) {
  if (Object.prototype.hasOwnProperty.call(aliases, part)) return aliases[part];
  const lower = part.toLowerCase();
  for (const [key, value] of Object.entries(aliases)) {
    if (key.toLowerCase() === lower) return value;
  }
  return part;
}

/**
 * True when `candidate` is strictly inside `repoRoot` after canonicalisation.
 * Comparison is segment-wise, never a string prefix, so `...\wt2` is not
 * inside `...\wt`. When `foldCase` is set (Windows, and usually macOS),
 * segments are compared case-insensitively — drive letter included.
 */
export function insideWorktree(repoRoot, candidate, opts = {}) {
  const aliases = opts.aliases || {};
  const foldCase = !!opts.foldCase;
  const root = canonicalizePath(repoRoot, aliases);
  const cand = canonicalizePath(candidate, aliases);
  if (cand.length <= root.length) return false;
  for (let i = 0; i < root.length; i++) {
    if (foldCase) {
      if (root[i].toLocaleLowerCase('en-US') !== cand[i].toLocaleLowerCase('en-US')) return false;
    } else if (root[i] !== cand[i]) return false;
  }
  return true;
}
