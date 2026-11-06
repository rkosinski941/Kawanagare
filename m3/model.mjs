/**
 * Shared indexes and the one visibility rule.
 *
 * A record is visible when its maker move is on and no effective on-move
 * switches it off. A resolution move's lines and switch-offs count only
 * while that resolution is active.
 */

export function indexScripts(scripts) {
  const lines = Object.create(null);
  const entries = Object.create(null);
  const attrs = Object.create(null);
  const nodes = Object.create(null);
  const lineOffBy = Object.create(null);
  const entryOffBy = Object.create(null);
  const attrOffBy = Object.create(null);

  for (const sc of Object.values(scripts)) {
    if (!sc || sc.signature === 'bad') continue;
    for (const n of sc.nodes) nodes[n.id] = { ...n, addedBy: sc.id };
    for (const line of sc.lines) lines[line.id] = { ...line, addedBy: sc.id };
    for (const entry of sc.entries) entries[entry.id] = { ...entry, addedBy: sc.id };
    for (const attr of sc.attributes) attrs[attr.id] = { ...attr, addedBy: sc.id };
    for (const id of sc.off) push(lineOffBy, id, sc.id);
    for (const id of sc.entryOff) push(entryOffBy, id, sc.id);
    for (const id of sc.attrOff) push(attrOffBy, id, sc.id);
  }

  return { lines, entries, attrs, nodes, lineOffBy, entryOffBy, attrOffBy };
}

function push(map, id, moveId) {
  if (!map[id]) map[id] = [];
  map[id].push(moveId);
}

export function deriveRoot(scripts) {
  for (const sc of Object.values(scripts)) {
    if (!sc || sc.signature === 'bad') continue;
    for (const n of sc.nodes) if (n.root) return n.id;
  }
  return null;
}

export function effectsLive(script, activeRes) {
  if (!script) return false;
  if (script.resolves && !activeRes.has(script.id)) return false;
  return true;
}

function visibleRecord(record, onSet, activeRes, scripts, offs) {
  if (!record || !onSet.has(record.addedBy)) return false;
  if (!effectsLive(scripts[record.addedBy], activeRes)) return false;
  for (const moveId of offs || []) {
    if (!onSet.has(moveId)) continue;
    if (!effectsLive(scripts[moveId], activeRes)) continue;
    return false;
  }
  return true;
}

export function lineVisible(line, onSet, activeRes, idx, scripts) {
  return visibleRecord(line, onSet, activeRes, scripts, idx.lineOffBy[line.id]);
}

export function entryVisible(entry, onSet, activeRes, idx, scripts) {
  return visibleRecord(entry, onSet, activeRes, scripts, idx.entryOffBy[entry.id]);
}

export function attrVisible(attr, onSet, activeRes, idx, scripts) {
  return visibleRecord(attr, onSet, activeRes, scripts, idx.attrOffBy[attr.id]);
}

export function activeResolutions(idx, scripts, moveList) {
  const onSet = new Set(moveList);
  const resolutions = [];
  for (const id of moveList) {
    const sc = scripts[id];
    if (sc && sc.signature !== 'bad' && sc.resolves) resolutions.push(sc);
  }
  let active = new Set();
  const limit = resolutions.length + 2;
  for (let i = 0; i < limit; i++) {
    const next = new Set();
    for (const resolution of resolutions) {
      if (resolutionHolds(resolution, active, onSet, idx, scripts)) next.add(resolution.id);
    }
    if (sameSet(next, active)) return next;
    active = next;
  }
  return active;
}

function resolutionHolds(resolution, active, onSet, idx, scripts) {
  const spec = resolution.resolves;
  for (const input of spec.inputs) if (!onSet.has(input)) return false;
  for (const absent of spec.absent) if (onSet.has(absent)) return false;
  const without = new Set(active);
  without.delete(resolution.id);
  const got = spotLineIds(spec.contested, without, onSet, idx, scripts);
  const saw = spec.saw.slice().sort();
  if (got.length !== saw.length) return false;
  for (let i = 0; i < got.length; i++) if (got[i] !== saw[i]) return false;
  return true;
}

function spotLineIds(contested, activeRes, onSet, idx, scripts) {
  const wanted = new Set(contested);
  const ids = [];
  for (const line of Object.values(idx.lines)) {
    const inSpot = wanted.has(line.id) || (line.replaces && wanted.has(line.replaces));
    if (!inSpot) continue;
    if (!lineVisible(line, onSet, activeRes, idx, scripts)) continue;
    ids.push(line.id);
  }
  ids.sort();
  return ids;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function cmpOrderKey(a, b) {
  const as = String(a);
  const bs = String(b);
  if (/^-?\d+$/.test(as) && /^-?\d+$/.test(bs)) {
    const delta = Number(as) - Number(bs);
    if (delta) return delta;
  }
  return as.localeCompare(bs);
}

export function orderKeyOf(scripts, moveId) {
  const sc = scripts[moveId];
  return sc && sc.orderKey != null ? sc.orderKey : moveId;
}

export function cmpLine(scripts, a, b) {
  const byKey = cmpOrderKey(orderKeyOf(scripts, a.addedBy), orderKeyOf(scripts, b.addedBy));
  if (byKey) return byKey;
  const bySeq = (a.seq || 0) - (b.seq || 0);
  if (bySeq) return bySeq;
  return String(a.id).localeCompare(String(b.id));
}

/** Why a resolution is dormant, or null when it is active. */
export function dormantReason(resolution, moveList, idx, scripts) {
  if (!resolution.resolves) return null;
  const onSet = new Set(moveList);
  const active = activeResolutions(idx, scripts, moveList);
  if (active.has(resolution.id)) return null;
  for (const input of resolution.resolves.inputs) {
    if (!onSet.has(input)) return `input ${input} is off`;
  }
  for (const absent of resolution.resolves.absent) {
    if (onSet.has(absent)) return `absent ${absent} is on`;
  }
  return 'spot changed';
}
