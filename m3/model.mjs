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

/**
 * The active resolution set (spec 4.4 "When it counts", D-M1-19). One deterministic fixed point:
 * walk the on resolutions in order_key order, then move id (UTF-16), starting from the empty set.
 * Add the first resolution that holds given the set chosen so far and whose addition keeps every
 * already-chosen resolution holding; then start the walk again. Stop when a full walk adds
 * nothing. Every chosen resolution holds given the others, and a resolution left out either does
 * not hold or would make a chosen one stop holding (it lost the spot to an earlier resolution).
 */
export function activeResolutions(idx, scripts, moveList) {
  const onSet = new Set(moveList);
  const resolutions = [];
  for (const id of moveList) {
    const sc = scripts[id];
    if (sc && sc.signature !== 'bad' && sc.resolves) resolutions.push(sc);
  }
  resolutions.sort((a, b) => cmpOrderKey(orderKeyOf(scripts, a.id), orderKeyOf(scripts, b.id)) || cmpCodeUnit(a.id, b.id));
  const byId = new Map(resolutions.map((sc) => [sc.id, sc]));
  let active = new Set();
  let added = true;
  while (added) {
    added = false;
    for (const resolution of resolutions) {
      if (active.has(resolution.id)) continue;
      if (!resolutionHolds(resolution, active, onSet, idx, scripts)) continue;
      const trial = new Set(active);
      trial.add(resolution.id);
      let keeps = true;
      for (const id of active) {
        if (!resolutionHolds(byId.get(id), trial, onSet, idx, scripts)) {
          keeps = false;
          break;
        }
      }
      if (!keeps) continue;
      active = trial;
      added = true;
      break;
    }
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
  const saw = spec.saw.slice().sort(cmpCodeUnit);
  if (got.length !== saw.length) return false;
  for (let i = 0; i < got.length; i++) if (got[i] !== saw[i]) return false;
  return true;
}

/**
 * Visible line ids in a contested spot (D-M1-20): a contested line that is visible, and every
 * visible replacement whose `replaces` chain reaches a contested line. The chain walk is the
 * kind 1 walk (spec 2 rule 3, D-M1-18): it climbs through lines that are not visible and stops
 * at a visible line or at a line whose maker is off (D-M1-15).
 */
function spotLineIds(contested, activeRes, onSet, idx, scripts) {
  const wanted = new Set(contested);
  const visible = Object.values(idx.lines).filter((line) => lineVisible(line, onSet, activeRes, idx, scripts));
  const visibleIds = new Set(visible.map((line) => line.id));
  const linkLive = (ref) => {
    const up = idx.lines[ref];
    return !!up && onSet.has(up.addedBy) && effectsLive(scripts[up.addedBy], activeRes);
  };
  const ids = [];
  for (const line of visible) {
    let inSpot = wanted.has(line.id);
    let ref = line.replaces;
    const walked = new Set();
    while (!inSpot && ref && !walked.has(ref)) {
      walked.add(ref);
      if (wanted.has(ref)) inSpot = true;
      else if (visibleIds.has(ref) || !linkLive(ref)) break;
      else ref = idx.lines[ref].replaces;
    }
    if (inSpot) ids.push(line.id);
  }
  ids.sort(cmpCodeUnit);
  return ids;
}

/** UTF-16 code unit order, no locale. */
export function cmpCodeUnit(a, b) {
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
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
export function dormantReason(resolution, moveList, idx, scripts, active = activeResolutions(idx, scripts, moveList)) {
  if (!resolution.resolves) return null;
  const onSet = new Set(moveList);
  if (active.has(resolution.id)) return null;
  for (const input of resolution.resolves.inputs) {
    if (!onSet.has(input)) return `input ${input} is off`;
  }
  for (const absent of resolution.resolves.absent) {
    if (onSet.has(absent)) return `absent ${absent} is on`;
  }
  return 'spot changed';
}
