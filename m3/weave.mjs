/**
 * Line-record weave.
 *
 * Every line stores both anchors. A replacement occupies the replaced line's
 * slot. An insert stays in the gap between its resolved `after` and `before`
 * even when one boundary line has been replaced. Contested lines in one gap
 * are shown in `order_key` order; that order is display only.
 *
 * Pulled lines with no replacement stay in the order graph as tombstones so
 * neighbors keep their places, then drop out of the visible text.
 */

import { cmpLine, lineVisible } from './model.mjs';

export const START = 'START';
export const END = 'END';

/**
 * @returns {{byNode: Map<string, {lines: object[], bytes: string}>, snags: object[], choices: Map<string, object[]>}}
 */
export function weaveFiles(idx, scripts, moveList, activeRes, redactions) {
  const onSet = new Set(moveList);
  const visible = [];
  for (const line of Object.values(idx.lines)) {
    if (lineVisible(line, onSet, activeRes, idx, scripts)) visible.push(line);
  }

  const replacers = new Map();
  for (const line of visible) {
    if (!line.replaces) continue;
    if (!replacers.has(line.replaces)) replacers.set(line.replaces, []);
    replacers.get(line.replaces).push(line);
  }
  for (const group of replacers.values()) group.sort((a, b) => cmpLine(scripts, a, b));

  // Slot owners for ordering (D-M1-08, G-55). A replacement occupies the slot of the
  // line it replaces (spec 2 rule 3). When that line is itself a replacement that is no
  // longer visible, the slot is the older line's slot too: walk the `replaces` chain up
  // through lines that are not visible and stop at the first visible one. Ordering and
  // tombstones use these owners; snag rules keep the direct `replacers` map.
  const visibleIds = new Set(visible.map((v) => v.id));
  const slots = new Map();
  for (const line of visible) {
    let ref = line.replaces;
    const walked = new Set();
    while (ref && !walked.has(ref)) {
      walked.add(ref);
      if (!slots.has(ref)) slots.set(ref, []);
      slots.get(ref).push(line);
      if (visibleIds.has(ref)) break;
      const up = idx.lines[ref];
      ref = up ? up.replaces : null;
    }
  }

  const tombCandidates = [];
  for (const line of Object.values(idx.lines)) {
    if (visibleIds.has(line.id)) continue;
    if (!onSet.has(line.addedBy)) continue;
    const maker = scripts[line.addedBy];
    if (!maker || (maker.resolves && !activeRes.has(maker.id))) continue;
    if (slots.has(line.id) && slots.get(line.id).length) continue;
    const offs = idx.lineOffBy[line.id] || [];
    const switched = offs.some((moveId) => onSet.has(moveId) && effectsCount(scripts, moveId, activeRes));
    if (switched) tombCandidates.push(line);
  }

  // A switched-off replacement whose slot has no visible owner keeps that slot as the
  // tombstone (D-M1-08): the lines it replaced, directly or through other switched-off
  // replacements, do not become separate tombstones.
  const tombWalk = new Map();
  const occupied = new Set();
  for (const line of tombCandidates) {
    const refs = [];
    let ref = line.replaces;
    const walked = new Set();
    while (ref && !walked.has(ref) && !visibleIds.has(ref) && !slots.has(ref)) {
      walked.add(ref);
      refs.push(ref);
      occupied.add(ref);
      const up = idx.lines[ref];
      ref = up ? up.replaces : null;
    }
    if (refs.length) tombWalk.set(line, refs);
  }
  const tombstones = tombCandidates.filter((line) => !occupied.has(line.id));
  for (const [line, refs] of tombWalk) {
    if (occupied.has(line.id)) continue;
    for (const ref of refs) {
      if (!slots.has(ref)) slots.set(ref, []);
      slots.get(ref).push(line);
    }
  }
  for (const group of slots.values()) group.sort((a, b) => cmpLine(scripts, a, b));

  const byNodeIds = new Map();
  for (const line of visible) {
    if (!byNodeIds.has(line.node)) byNodeIds.set(line.node, []);
    byNodeIds.get(line.node).push(line);
  }

  const byNode = new Map();
  for (const [node, lines] of byNodeIds) {
    const nodeTombs = tombstones.filter((t) => t.node === node);
    const ordered = orderVisible(idx, scripts, lines, nodeTombs, slots);
    const bytes = ordered.map((line) => shownBytes(line, redactions)).join('');
    byNode.set(node, { lines: ordered, bytes, lineIds: ordered.map((line) => line.id) });
  }

  const snags = lineSnags(idx, scripts, moveList, activeRes, visible, replacers, slots);
  return { byNode, snags };
}

function effectsCount(scripts, moveId, activeRes) {
  const sc = scripts[moveId];
  if (!sc) return false;
  if (sc.resolves && !activeRes.has(moveId)) return false;
  return true;
}

function shownBytes(line, redactions) {
  if (redactions && redactions.has(line.id)) return redactions.get(line.id);
  return line.bytes;
}

export function orderVisible(idx, scripts, visibleLines, tombstones, replacers) {
  const visibleById = new Map(visibleLines.map((line) => [line.id, line]));
  const tombById = new Map(tombstones.map((line) => [line.id, line]));
  const nodes = new Map();
  nodes.set(START, { id: START, sentinel: true });
  nodes.set(END, { id: END, sentinel: true });
  for (const line of visibleLines) nodes.set(line.id, line);
  for (const line of tombstones) nodes.set(line.id, line);

  const succs = new Map();
  const indeg = new Map();
  for (const id of nodes.keys()) {
    succs.set(id, new Set());
    indeg.set(id, 0);
  }

  function edge(from, to) {
    if (!from || !to || from === to) return;
    if (!nodes.has(from) || !nodes.has(to)) return;
    const set = succs.get(from);
    if (set.has(to)) return;
    set.add(to);
    indeg.set(to, indeg.get(to) + 1);
  }

  function resolve(ref) {
    if (!ref || ref === START) return [START];
    if (ref === END) return [END];
    if (visibleById.has(ref)) return [ref];
    if (tombById.has(ref)) return [ref];
    const reps = replacers.get(ref);
    if (reps && reps.length) return reps.map((line) => line.id);
    return [];
  }

  function anchorsFor(line) {
    // A replacement takes the slot of the line it replaces; for a chain of
    // replacements that is the slot of the first line in the chain (D-M1-08).
    let orig = null;
    let ref = line.replaces;
    const walked = new Set();
    while (ref && idx.lines[ref] && !walked.has(ref)) {
      walked.add(ref);
      orig = idx.lines[ref];
      ref = orig.replaces;
    }
    if (orig) return { after: orig.after, before: orig.before };
    return { after: line.after, before: line.before };
  }

  for (const line of [...visibleLines, ...tombstones]) {
    const { after, before } = anchorsFor(line);
    for (const left of resolve(after)) edge(left, line.id);
    for (const right of resolve(before)) edge(line.id, right);
  }

  for (const group of replacers.values()) {
    for (let i = 1; i < group.length; i++) edge(group[i - 1].id, group[i].id);
  }

  const sameGap = new Map();
  for (const line of visibleLines) {
    if (line.replaces) continue;
    const key = `${line.addedBy}\0${line.after}\0${line.before}`;
    if (!sameGap.has(key)) sameGap.set(key, []);
    sameGap.get(key).push(line);
  }
  for (const group of sameGap.values()) {
    group.sort((a, b) => (a.seq || 0) - (b.seq || 0));
    for (let i = 1; i < group.length; i++) edge(group[i - 1].id, group[i].id);
  }

  const ready = [];
  for (const [id, degree] of indeg) if (degree === 0) ready.push(id);
  ready.sort((a, b) => cmpNode(scripts, nodes, a, b));

  const orderedIds = [];
  const seen = new Set();
  while (ready.length) {
    const id = ready.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
    for (const next of succs.get(id)) {
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) === 0) {
        ready.push(next);
        ready.sort((a, b) => cmpNode(scripts, nodes, a, b));
      }
    }
  }

  if (orderedIds.length < nodes.size) {
    const rest = [...nodes.keys()].filter((id) => !seen.has(id));
    rest.sort((a, b) => cmpNode(scripts, nodes, a, b));
    orderedIds.push(...rest);
  }

  return orderedIds.filter((id) => visibleById.has(id)).map((id) => visibleById.get(id));
}

function cmpNode(scripts, nodes, a, b) {
  if (a === START && b !== START) return -1;
  if (b === START && a !== START) return 1;
  if (a === END && b !== END) return 1;
  if (b === END && a !== END) return -1;
  return cmpLine(scripts, nodes.get(a), nodes.get(b));
}

function lineSnags(idx, scripts, moveList, activeRes, visible, replacers, slots) {
  const onSet = new Set(moveList);
  const visibleIds = new Set(visible.map((v) => v.id));
  const snags = [];
  const waitingMoves = moveList.filter((id) => {
    const sc = scripts[id];
    return !sc || sc.signature === 'bad';
  });

  const slotGroups = new Map();
  for (const line of visible) {
    if (!line.replaces) continue;
    if (!slotGroups.has(line.replaces)) slotGroups.set(line.replaces, []);
    slotGroups.get(line.replaces).push(line);
  }
  for (const [slot, lines] of slotGroups) {
    const byMove = new Map();
    for (const line of lines) {
      if (!byMove.has(line.addedBy)) byMove.set(line.addedBy, []);
      byMove.get(line.addedBy).push(line);
    }
    if (byMove.size < 2) continue;
    const moves = [...byMove.keys()].sort((a, b) => cmpLine(scripts, { addedBy: a, seq: 0, id: a }, { addedBy: b, seq: 0, id: b }));
    const sides = moves.map((moveId) => ({
      move: moveId,
      lines: byMove.get(moveId).map((line) => line.id),
      bytes: byMove.get(moveId).map((line) => line.bytes).join(''),
    }));
    snags.push({
      kind: 1,
      code: 'same_slot',
      twin: sides.every((side) => side.bytes === sides[0].bytes),
      spot: slot,
      node: lines[0].node,
      moves,
      lines: lines.map((line) => line.id),
      sides,
      choices: dormantChoices(scripts, moveList, activeRes, slot),
      detail: `line ${slot} replaced by ${moves.join(', ')}`,
    });
  }

  const gaps = new Map();
  for (const line of visible) {
    if (line.replaces) continue;
    const key = `${line.node}\0${line.after}\0${line.before}`;
    if (!gaps.has(key)) gaps.set(key, []);
    gaps.get(key).push(line);
  }
  for (const [key, lines] of gaps) {
    const byMove = new Map();
    for (const line of lines) {
      if (!byMove.has(line.addedBy)) byMove.set(line.addedBy, []);
      byMove.get(line.addedBy).push(line);
    }
    if (byMove.size < 2) continue;
    const [, after, before] = key.split('\0');
    const moves = [...byMove.keys()];
    const runs = moves.map((moveId) => {
      const group = byMove.get(moveId).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
      return { move: moveId, lines: group.map((line) => line.id), bytes: group.map((line) => line.bytes).join(''), count: group.length };
    });
    const identical = runs.every((run) => run.bytes === runs[0].bytes);
    const common = runs.every((run) => run.count === 1 && isCommonLine(run.bytes));
    snags.push({
      kind: 2,
      code: 'same_gap',
      twin: identical && !common,
      spot: `${after}|${before}`,
      node: lines[0].node,
      moves,
      lines: lines.map((line) => line.id),
      sides: runs,
      after,
      before,
      detail: `same gap ${after} | ${before}`,
    });
  }

  // Kind 3 follows replacement chains (D-M1-13, G-56): the replacements of an `after`
  // anchor are the visible owners of its slot, direct or through switched-off links.
  const slotOwners = (id) => (slots.get(id) || []).filter((owner) => visibleIds.has(owner.id));
  const kind3 = new Map();
  for (const line of visible) {
    if (line.replaces) continue;
    if (!line.after || line.after === START) continue;
    const reps = slotOwners(line.after);
    if (!reps.length) continue;
    const anchorLine = idx.lines[line.after];
    // The original successor minted with the anchor is the next line of that
    // move, not a later insert. Ordering slides it past the replacement.
    if (anchorLine && anchorLine.addedBy === line.addedBy) continue;
    const saw = new Set(scripts[line.addedBy]?.saw || []);
    // Saw exemption (D-M1-12): a replacing move whose `saw` lists the inserting move made
    // the replacement with the insert in view; that is a sequential edit, not kind 3.
    const unseen = reps.filter((rep) => rep.addedBy !== line.addedBy && !saw.has(rep.addedBy) && !(scripts[rep.addedBy]?.saw || []).includes(line.addedBy));
    if (!unseen.length) continue;
    if (!kind3.has(line.after)) kind3.set(line.after, []);
    kind3.get(line.after).push(line);
  }
  for (const [anchor, lines] of kind3) {
    const reps = slotOwners(anchor);
    snags.push({
      kind: 3,
      code: 'insert_beside_replaced',
      twin: false,
      spot: anchor,
      node: lines[0].node,
      moves: unique([...lines.map((line) => line.addedBy), ...reps.map((line) => line.addedBy)]),
      lines: lines.map((line) => line.id),
      detail: `insert after ${anchor}, which is replaced`,
    });
  }

  const reportedLost = new Set();
  for (const line of visible) {
    for (const anchor of [line.after, line.before, line.replaces]) {
      if (!anchor || anchor === START || anchor === END) continue;
      const target = idx.lines[anchor];
      // Kind 5 same-move exemption (D-K5-01): a line minted in the same move as its
      // `after`/`before` anchor is that anchor's original neighbour, not a later insert.
      // When the anchor is switched off with no replacement (a pure deletion), the anchor
      // stays in the order graph as a tombstone and the neighbour keeps its place, so
      // nothing is lost. Same rule as the kind 3 skip above. `replaces` is not exempt.
      if (target && anchor !== line.replaces && target.addedBy === line.addedBy) continue;
      if (!target) {
        if (waitingMoves.length === 0) {
          snags.push({
            kind: 4,
            code: 'missing_need',
            twin: false,
            spot: anchor,
            node: line.node,
            moves: [line.addedBy],
            lines: [line.id],
            need: null,
            detail: `anchor ${anchor} is not in any script`,
          });
        }
        continue;
      }
      if (!onSet.has(target.addedBy)) {
        snags.push({
          kind: 4,
          code: 'missing_need',
          twin: false,
          spot: anchor,
          node: line.node,
          moves: [line.addedBy, target.addedBy],
          lines: [line.id],
          need: target.addedBy,
          detail: `line ${line.id} needs move ${target.addedBy} (anchor ${anchor})`,
        });
        continue;
      }
      const targetVisible = visible.some((v) => v.id === anchor);
      // Chain-aware (D-M1-12, G-56): a slot held by a visible replacement through a
      // `replaces` chain (spec 2 rule 3) is replaced, not lost.
      const replaced = (slots.get(anchor) || []).some((l) => visibleIds.has(l.id));
      if (!targetVisible && !replaced && !reportedLost.has(`${line.id}:${anchor}`)) {
        reportedLost.add(`${line.id}:${anchor}`);
        const offs = (idx.lineOffBy[anchor] || []).filter((moveId) => onSet.has(moveId) && effectsCount(scripts, moveId, activeRes));
        // Saw exemption (D-M1-12): every switching-off move saw the anchored line's move.
        if (offs.length && offs.every((moveId) => (scripts[moveId]?.saw || []).includes(line.addedBy))) continue;
        snags.push({
          kind: 5,
          code: 'anchor_lost',
          twin: false,
          spot: anchor,
          node: line.node,
          moves: unique([line.addedBy, ...offs]),
          lines: [line.id],
          detail: `anchor ${anchor} was switched off without a replacement`,
        });
      }
    }
  }

  for (const [lineId, offs] of Object.entries(idx.lineOffBy)) {
    const target = idx.lines[lineId];
    if (!target) continue;
    for (const moveId of offs) {
      if (!onSet.has(moveId) || !effectsCount(scripts, moveId, activeRes)) continue;
      if (onSet.has(target.addedBy)) continue;
      const already = snags.some((snag) => snag.kind === 4 && snag.need === target.addedBy && snag.moves.includes(moveId));
      if (already) continue;
      snags.push({
        kind: 4,
        code: 'missing_need',
        twin: false,
        spot: lineId,
        node: target.node,
        moves: [moveId, target.addedBy],
        lines: [lineId],
        need: target.addedBy,
        detail: `move ${moveId} switches off ${lineId}, whose maker ${target.addedBy} is off`,
      });
    }
  }

  return mergeBySpot(mergeBySpot(dedupeKind4(snags), 4), 5);
}

function dormantChoices(scripts, moveList, activeRes, slot) {
  const choices = [];
  for (const id of moveList) {
    const sc = scripts[id];
    if (!sc?.resolves || activeRes.has(id)) continue;
    for (const line of sc.lines) {
      if (line.replaces !== slot) continue;
      choices.push({ move: id, line: line.id, bytes: line.bytes, dormant: true });
    }
  }
  return choices;
}

function isCommonLine(bytes) {
  const trimmed = String(bytes).replace(/\r\n|\n|\r/g, '').trim();
  return trimmed === '' || trimmed === '}';
}

function unique(ids) {
  return [...new Set(ids)];
}

function mergeBySpot(snags, kind) {
  const out = [];
  const grouped = new Map();
  for (const snag of snags) {
    if (snag.kind !== kind) {
      out.push(snag);
      continue;
    }
    const key = `${snag.node || ''}|${snag.spot}|${snag.need || ''}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, snag);
      out.push(snag);
      continue;
    }
    existing.moves = unique([...existing.moves, ...snag.moves]);
    existing.lines = unique([...(existing.lines || []), ...(snag.lines || [])]);
  }
  return out;
}

function dedupeKind4(snags) {
  const seen = new Set();
  const out = [];
  for (const snag of snags) {
    if (snag.kind !== 4) {
      out.push(snag);
      continue;
    }
    const key = `${snag.spot}|${snag.need}|${snag.moves.slice().sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(snag);
  }
  return out;
}

/** Direct maker-move needs of a script. The move itself is not included. */
export function directNeedIds(idx, script) {
  const needs = new Set();
  const take = (lineId) => {
    if (!lineId || lineId === START || lineId === END) return;
    const line = idx.lines[lineId];
    if (line && line.addedBy !== script.id) needs.add(line.addedBy);
  };
  for (const line of script.lines) {
    take(line.after);
    take(line.before);
    take(line.replaces);
  }
  for (const lineId of script.off) take(lineId);
  for (const entry of script.entries) {
    const poolNode = idx.nodes[entry.pool];
    if (poolNode && poolNode.addedBy !== script.id) needs.add(poolNode.addedBy);
    const node = idx.nodes[entry.node];
    if (node && node.addedBy !== script.id) needs.add(node.addedBy);
  }
  for (const entryId of script.entryOff) {
    const entry = idx.entries[entryId];
    if (entry && entry.addedBy !== script.id) needs.add(entry.addedBy);
  }
  for (const attrId of script.attrOff) {
    const attr = idx.attrs[attrId];
    if (attr && attr.addedBy !== script.id) needs.add(attr.addedBy);
  }
  if (script.resolves) {
    for (const input of script.resolves.inputs) if (input !== script.id) needs.add(input);
  }
  return [...needs];
}
