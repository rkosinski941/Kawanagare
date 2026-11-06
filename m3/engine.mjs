/**
 * KawaNagare M3 reference engine.
 *
 * In-memory, zero-dependency model of streams, moves, the line weave,
 * pools, snags, and the flow log. Git is not a store here: `exportStream`
 * only reports whether a clean stream could be exported.
 *
 * Conflicts are never resolved automatically. A resolution counts only when
 * a caller records one as an ordinary move.
 */

import { DEFAULT_POLICY, insideWorktree, forbiddenName, nameKey } from './names.mjs';
import {
  activeResolutions,
  cmpOrderKey,
  deriveRoot,
  dormantReason,
  indexScripts,
} from './model.mjs';
import { directNeedIds, weaveFiles, START, END } from './weave.mjs';
import { longestPath, poolView, selfConflicts } from './pools.mjs';

export { START, END, DEFAULT_POLICY, insideWorktree, forbiddenName, nameKey };

export function createRepo() {
  const repo = {
    scripts: Object.create(null),
    streams: Object.create(null),
    repoEvents: [],
    seq: 0,
    rafts: Object.create(null),
    redactions: [],
    policy: { ...DEFAULT_POLICY },
  };
  return repo;
}

export function project(repo) {
  repo.rafts = Object.create(null);
  repo.redactions = [];
  repo.policy = { ...DEFAULT_POLICY };
  const events = repo.repoEvents.slice().sort((a, b) => a.seq - b.seq);
  for (const ev of events) {
    if (ev.kind === 'raft') {
      repo.rafts[ev.raft] = { id: ev.raft, members: ev.members.slice(), eventId: ev.id };
    } else if (ev.kind === 'policy') {
      repo.policy = { ...repo.policy, ...ev.policy, eventId: ev.id };
    } else if (ev.kind === 'redact') {
      repo.redactions.push({ lineId: ev.lineId, marker: ev.marker, eventId: ev.id });
    }
  }
  return repo;
}

export function replayRepo(saved) {
  const repo = createRepo();
  repo.scripts = saved.scripts;
  repo.streams = saved.streams;
  repo.repoEvents = saved.repoEvents;
  repo.seq = saved.seq;
  return project(repo);
}

export function openStream(repo, name) {
  if (!repo.streams[name]) repo.streams[name] = { name, events: [] };
  return repo.streams[name];
}

function allocEvent(repo, partial) {
  repo.seq += 1;
  return { id: partial.id || `ev.${repo.seq}`, seq: repo.seq, ...partial };
}

function headEvent(stream) {
  for (let i = stream.events.length - 1; i >= 0; i--) {
    if (!stream.events[i].rejected) return stream.events[i];
  }
  return null;
}

function appendEvent(repo, streamName, partial) {
  const stream = openStream(repo, streamName);
  const head = headEvent(stream);
  const ev = allocEvent(repo, {
    ...partial,
    stream: streamName,
    parent: head ? head.id : null,
    rejected: false,
  });
  stream.events.push(ev);
  return ev;
}

function sameMeaning(ev, partial) {
  if (ev.kind !== partial.kind) return false;
  if ((ev.move || null) !== (partial.move || null)) return false;
  if ((ev.moves || []).join(',') !== (partial.moves || []).join(',')) return false;
  if ((ev.node || null) !== (partial.node || null)) return false;
  if ((ev.raft || null) !== (partial.raft || null)) return false;
  return true;
}

/**
 * Sequencer entry. A second event with the same parent is re-issued only
 * when its meaning matches the event that already won; otherwise it is an
 * event snag and does not change the stream.
 */
export function submitEvent(repo, streamName, partial) {
  const stream = openStream(repo, streamName);
  const head = headEvent(stream);
  const headId = head ? head.id : null;
  if ((partial.parent ?? null) !== headId) {
    const winner = stream.events.find((ev) => !ev.rejected && ev.parent === (partial.parent ?? null));
    if (winner && sameMeaning(winner, partial)) {
      return { ok: true, reissued: true, message: 're-issued; meaning unchanged' };
    }
    const ev = allocEvent(repo, {
      ...partial,
      stream: streamName,
      parent: partial.parent ?? null,
      rejected: true,
      snag: 'fork',
    });
    stream.events.push(ev);
    return {
      ok: false,
      eventSnag: true,
      event: ev,
      message: 'stale flow-log fork; meaning changed',
    };
  }
  const ev = appendEvent(repo, streamName, partial);
  return { ok: true, event: ev };
}

export function normalizeScript(input) {
  if (!input || input.id == null) throw new Error('script needs an id');
  const id = String(input.id);
  const script = {
    id,
    author: input.author || '',
    site: input.site || '',
    time: input.time || '',
    orderKey: input.orderKey != null ? String(input.orderKey) : id,
    signature: input.signature || 'ok',
    saw: input.saw ? input.saw.slice() : null,
    lines: (input.lines || []).map((line, seq) => ({
      id: line.id,
      node: line.node,
      bytes: line.bytes != null ? line.bytes : line.text != null ? line.text : '',
      after: line.after || START,
      before: line.before || END,
      replaces: line.replaces || null,
      seq,
    })),
    off: [...(input.off || input.offs || [])],
    nodes: (input.nodes || []).map((node) => ({
      id: node.id,
      kind: node.kind,
      root: !!node.root,
    })),
    entries: (input.entries || []).map((entry) => ({
      id: entry.id,
      pool: entry.pool,
      node: entry.node,
      name: entry.name,
    })),
    entryOff: [...(input.entryOff || [])],
    attributes: (input.attributes || []).map((attr, i) => ({
      id: attr.id || `${id}:attr:${i}`,
      node: attr.node,
      key: attr.key,
      value: attr.value,
    })),
    attrOff: [...(input.attrOff || [])],
    resolves: input.resolves
      ? {
          kind: input.resolves.kind || '',
          identical: !!input.resolves.identical,
          inputs: [...(input.resolves.inputs || [])],
          absent: [...(input.resolves.absent || [])],
          contested: [...(input.resolves.contested || [])],
          saw: [...(input.resolves.saw || [])],
          decision: input.resolves.decision || '',
        }
      : null,
  };
  script.rootSeed = script.nodes.some((node) => node.root);
  return script;
}

export function saveScript(repo, input) {
  const script = normalizeScript(input);
  if (repo.scripts[script.id]) throw new Error(`move ${script.id} already recorded`);
  repo.scripts[script.id] = script;
  return { ok: true, id: script.id, unattached: !isReferenced(repo, script.id) };
}

export function syncScripts(repo, scripts) {
  const added = [];
  for (const input of scripts) {
    const script = normalizeScript(input);
    if (!repo.scripts[script.id]) {
      repo.scripts[script.id] = script;
      added.push(script.id);
    }
  }
  return { ok: true, added };
}

function isReferenced(repo, moveId) {
  for (const stream of Object.values(repo.streams)) {
    for (const ev of stream.events) {
      if (ev.rejected) continue;
      if (ev.move === moveId) return true;
      if ((ev.moves || []).includes(moveId)) return true;
    }
  }
  return false;
}

function fold(repo, streamName) {
  const stream = repo.streams[streamName];
  if (!stream) throw new Error(`unknown stream ${streamName}`);
  return foldEvents(stream.events);
}

function foldEvents(events) {
  const on = [];
  const onSet = new Set();
  const locks = [];
  for (const ev of events) {
    if (ev.rejected) continue;
    applyOn(ev, on, onSet, locks);
  }
  return { on, onSet, locks };
}

function applyOn(ev, on, onSet, locks) {
  const add = (id) => {
    if (!id || onSet.has(id)) return;
    on.push(id);
    onSet.add(id);
  };
  const remove = (id) => {
    if (!onSet.has(id)) return;
    onSet.delete(id);
    const at = on.indexOf(id);
    if (at >= 0) on.splice(at, 1);
  };
  if (ev.kind === 'checkin' || ev.kind === 'restore') add(ev.move);
  else if (ev.kind === 'carry') for (const id of ev.moves || []) add(id);
  else if (ev.kind === 'pull') remove(ev.move);
  else if (ev.kind === 'pull_raft') for (const id of ev.moves || []) remove(id);
  else if (ev.kind === 'lock') locks.push({ node: ev.node, event: ev.id });
  else if (ev.kind === 'unlock') {
    const at = locks.findIndex((lock) => lock.node === ev.node);
    if (at >= 0) locks.splice(at, 1);
  }
}

export function movesOn(repo, streamName) {
  return fold(repo, streamName).on.slice();
}

function lockedOut(locks, script, idx) {
  if (!locks.length) return null;
  if (locks.some((lock) => lock.node === '*')) return '*';
  const touched = touchedNodes(script, idx);
  for (const lock of locks) if (touched.has(lock.node)) return lock.node;
  return null;
}

function touchedNodes(script, idx) {
  const nodes = new Set();
  for (const node of script.nodes) nodes.add(node.id);
  for (const line of script.lines) if (line.node) nodes.add(line.node);
  for (const entry of script.entries) {
    nodes.add(entry.pool);
    nodes.add(entry.node);
  }
  for (const attr of script.attributes) nodes.add(attr.node);
  for (const lineId of script.off) if (idx.lines[lineId]) nodes.add(idx.lines[lineId].node);
  for (const entryId of script.entryOff) {
    const entry = idx.entries[entryId];
    if (!entry) continue;
    nodes.add(entry.pool);
    nodes.add(entry.node);
  }
  return nodes;
}

export function checkin(repo, streamName, input) {
  const script = normalizeScript(input);
  if (repo.scripts[script.id]) {
    return { ok: false, refused: true, message: `move ${script.id} already recorded` };
  }
  const policy = repo.policy || DEFAULT_POLICY;
  const knownPools = new Set(
    Object.values(indexScripts(repo.scripts).nodes)
      .filter((node) => node.kind === 'pool')
      .map((node) => node.id),
  );
  const reasons = selfConflicts(script, policy, knownPools);
  if (reasons.length) {
    return { ok: false, refused: true, reasons, message: `check-in refused: move conflicts with itself (${reasons.map((r) => r.code).join(', ')})` };
  }
  const existing = repo.streams[streamName];
  const on = existing ? fold(repo, streamName).on : [];
  const idx = indexScripts({ ...repo.scripts, [script.id]: script });
  if (existing) {
    const node = lockedOut(fold(repo, streamName).locks, script, indexScripts(repo.scripts));
    if (node) {
      return { ok: false, refused: true, message: `check-in refused: ${node === '*' ? 'stream' : node} is locked` };
    }
  }
  const overlay = { [script.id]: script };
  const preview = computeView(repo, [...on, script.id], policy, overlay);
  const limit = policy.maxPath ?? DEFAULT_POLICY.maxPath;
  const longest = longestPath(preview.files, preview.directories);
  if (longest.length > limit) {
    return {
      ok: false,
      refused: true,
      message: `check-in refused: path ${longest.path} is ${longest.length} characters, over max_path ${limit}`,
      path: longest.path,
    };
  }
  repo.scripts[script.id] = script;
  const event = appendEvent(repo, streamName, {
    kind: 'checkin',
    move: script.id,
    site: script.site,
    author: script.author,
  });
  const view = inspect(repo, streamName);
  return { ok: true, id: script.id, event, snags: view.snags, notices: view.notices };
}

/**
 * Replication path: a flow-log event can arrive before its script.
 * The move is then waiting, which holds export and is not a snag.
 */
export function landEvent(repo, streamName, partial) {
  const event = appendEvent(repo, streamName, partial);
  return { ok: true, event };
}

export function proposeNeeds(repo, streamName, moveId) {
  const script = repo.scripts[moveId];
  if (!script || script.signature === 'bad') {
    return { ok: false, missing: [], proposed: [], problems: [{ code: 'script_missing', move: moveId }] };
  }
  const on = repo.streams[streamName] ? fold(repo, streamName).on : [];
  return analyzeNeeds(repo, moveId, on);
}

function analyzeNeeds(repo, moveId, onList) {
  const onSet = new Set(onList);
  const idx = indexScripts(repo.scripts);
  const seen = new Set();
  const full = [];
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const sc = repo.scripts[id];
    if (!sc || sc.signature === 'bad') return;
    const needs = directNeedIds(idx, sc).slice().sort(cmpOrderKey);
    for (const need of needs) visit(need);
    full.push(id);
  };
  visit(moveId);
  const proposed = full.filter((id) => !onSet.has(id));
  const missing = proposed.filter((id) => id !== moveId);
  const extended = [...onList, ...proposed];
  const problems = poolProblems(repo, moveId, extended);
  return { missing, proposed, problems, full };
}

function poolProblems(repo, moveId, moveList) {
  const script = repo.scripts[moveId];
  if (!script) return [];
  const withMove = moveList.includes(moveId) ? moveList : [...moveList, moveId];
  const withoutMove = withMove.filter((id) => id !== moveId);
  const viewWith = computeView(repo, withMove, repo.policy);
  const problems = [];
  const reachable = new Set(viewWith.reachable || []);
  const root = deriveRoot({ ...repo.scripts, [script.id]: script });
  if (root) reachable.add(root);
  for (const entry of script.entries) {
    if (entry.pool === root) continue;
    if (!reachable.has(entry.pool)) {
      problems.push({ code: 'parent_unreachable', pool: entry.pool, entry: entry.id });
    }
  }
  if (script.entryOff.length) {
    const viewWithout = computeView(repo, withoutMove, repo.policy);
    const visible = new Set((viewWithout.visibleEntries || []).map((entry) => entry.id));
    for (const entryId of script.entryOff) {
      if (!visible.has(entryId)) problems.push({ code: 'entry_not_visible', entry: entryId });
    }
  }
  return problems;
}

export function carry(repo, streamName, moveId, opts = {}) {
  const withNeeds = !!opts.withNeeds;
  const on = repo.streams[streamName] ? fold(repo, streamName).on : [];
  if (on.includes(moveId)) {
    return { ok: true, alreadyOn: true, added: [], message: `already on in ${streamName}; nothing to do` };
  }
  const script = repo.scripts[moveId];
  if (!script || script.signature === 'bad') {
    return { ok: false, refused: true, missing: [], proposed: [], message: `carry of ${moveId} refused: script missing` };
  }
  const analysis = analyzeNeeds(repo, moveId, on);
  const blocked = analysis.missing.length > 0 || analysis.problems.length > 0;
  if (blocked && !withNeeds) {
    return {
      ok: false,
      refused: true,
      missing: analysis.missing.slice(),
      proposed: analysis.proposed.slice(),
      problems: analysis.problems.slice(),
      group: `needs:${moveId}`,
      message: refusalMessage(streamName, moveId, script, analysis),
    };
  }
  if (analysis.problems.length) {
    return {
      ok: false,
      refused: true,
      missing: analysis.missing.slice(),
      proposed: analysis.proposed.slice(),
      problems: analysis.problems.slice(),
      group: `needs:${moveId}`,
      message: refusalMessage(streamName, moveId, script, analysis),
    };
  }
  const added = analysis.proposed.slice();
  const event = appendEvent(repo, streamName, {
    kind: 'carry',
    move: moveId,
    moves: added,
    via: analysis.missing.length ? 'with-needs' : 'carry',
    group: analysis.missing.length ? `needs:${moveId}` : null,
  });
  return {
    ok: true,
    added,
    proposed: added.slice(),
    missingWere: analysis.missing.slice(),
    group: analysis.missing.length ? `needs:${moveId}` : null,
    event,
    message: analysis.missing.length
      ? `carried needs group ${added.join(', ')} into ${streamName}`
      : `carried ${moveId} into ${streamName}`,
  };
}

function refusalMessage(streamName, moveId, script, analysis) {
  if (script.resolves) {
    const absent = script.resolves.inputs.filter((id) => analysis.missing.includes(id));
    if (absent.length) {
      return `carry of ${moveId} refused: inputs ${absent.join(' and ')} are not in this stream; carry them as a raft or leave the resolution behind`;
    }
  }
  const parts = [`carry of ${moveId} refused`];
  if (analysis.missing.length) parts.push(`missing needs ${analysis.missing.join(', ')}`);
  if (analysis.problems.length) parts.push(analysis.problems.map((problem) => problem.code).join(', '));
  parts.push(`proposed group [${analysis.proposed.join(', ')}]`);
  parts.push('pass withNeeds to carry the group');
  return parts.join(': ');
}

export function defineRaft(repo, { id, members }) {
  if (repo.rafts[id]) return { ok: false, refused: true, message: `raft ${id} already defined` };
  const event = allocEvent(repo, { kind: 'raft', raft: id, members: members.slice() });
  repo.repoEvents.push(event);
  project(repo);
  return { ok: true, id, members: members.slice(), event };
}

export function carryRaft(repo, streamName, raftId) {
  const raft = repo.rafts[raftId];
  if (!raft) return { ok: false, refused: true, message: `unknown raft ${raftId}` };
  const on = repo.streams[streamName] ? fold(repo, streamName).on : [];
  const onSet = new Set(on);
  const skipped = raft.members.filter((id) => onSet.has(id));
  const todo = raft.members.filter((id) => !onSet.has(id));
  const extended = [...on, ...todo];
  const problems = [];
  for (const moveId of todo) {
    const script = repo.scripts[moveId];
    if (!script) {
      problems.push({ move: moveId, code: 'script_missing' });
      continue;
    }
    const analysis = analyzeNeeds(repo, moveId, extended.filter((id) => id !== moveId));
    const missing = analysis.missing.filter((id) => !raft.members.includes(id) && !onSet.has(id));
    if (missing.length) problems.push({ move: moveId, missing });
    const pool = poolProblems(repo, moveId, extended);
    if (pool.length) problems.push({ move: moveId, problems: pool });
  }
  if (problems.length) {
    return {
      ok: false,
      refused: true,
      added: [],
      skipped,
      problems,
      message: `raft ${raftId} refused: ${problems.map((problem) => problem.move).join(', ')}`,
    };
  }
  const event = appendEvent(repo, streamName, {
    kind: 'carry',
    raft: raftId,
    moves: todo,
    via: 'raft',
  });
  return {
    ok: true,
    added: todo,
    skipped,
    event,
    message: skipped.length
      ? `carried raft ${raftId}; already on: ${skipped.join(', ')}`
      : `carried raft ${raftId}`,
  };
}

export function pull(repo, streamName, moveId) {
  const script = repo.scripts[moveId];
  if (script?.rootSeed) return { ok: false, refused: true, message: 'root seed cannot be pulled' };
  const on = fold(repo, streamName).on;
  if (!on.includes(moveId)) {
    return { ok: true, alreadyOff: true, message: `move ${moveId} already off in ${streamName}` };
  }
  const event = appendEvent(repo, streamName, { kind: 'pull', move: moveId });
  return { ok: true, pulled: moveId, event, message: `pulled ${moveId} from ${streamName}` };
}

export function pullRaft(repo, streamName, raftId) {
  const raft = repo.rafts[raftId];
  if (!raft) return { ok: false, refused: true, message: `unknown raft ${raftId}` };
  const onSet = new Set(fold(repo, streamName).on);
  const moves = raft.members.filter((id) => onSet.has(id) && !repo.scripts[id]?.rootSeed);
  if (!moves.length) return { ok: true, alreadyOff: true, added: [], message: `raft ${raftId} already off in ${streamName}` };
  const event = appendEvent(repo, streamName, { kind: 'pull_raft', raft: raftId, moves });
  return { ok: true, pulled: moves, event };
}

export function restore(repo, streamName, moveId) {
  if (!repo.scripts[moveId]) return { ok: false, refused: true, message: `unknown move ${moveId}` };
  const on = fold(repo, streamName).on;
  if (on.includes(moveId)) return { ok: true, alreadyOn: true, message: `move ${moveId} already on in ${streamName}` };
  const event = appendEvent(repo, streamName, { kind: 'restore', move: moveId });
  return { ok: true, restored: moveId, event, message: `restored ${moveId} in ${streamName}` };
}

export function lock(repo, streamName, node = '*') {
  const event = appendEvent(repo, streamName, { kind: 'lock', node });
  return { ok: true, event };
}

export function unlock(repo, streamName, node = '*') {
  const event = appendEvent(repo, streamName, { kind: 'unlock', node });
  return { ok: true, event };
}

export function setPolicy(repo, policy) {
  const event = allocEvent(repo, { kind: 'policy', policy: { ...policy } });
  repo.repoEvents.push(event);
  project(repo);
  return { ok: true, policy: { ...repo.policy }, event };
}

export function redact(repo, { lineId, marker }) {
  const event = allocEvent(repo, { kind: 'redact', lineId, marker });
  repo.repoEvents.push(event);
  project(repo);
  return { ok: true, event };
}

export function forkStream(repo, fromName, toName) {
  const on = fold(repo, fromName).on.slice();
  openStream(repo, toName);
  if (on.length) appendEvent(repo, toName, { kind: 'carry', moves: on, via: 'fork' });
  return repo.streams[toName];
}

function redactionMap(repo) {
  const map = new Map();
  for (const item of repo.redactions) map.set(item.lineId, item.marker);
  return map;
}

export function computeView(repo, moveList, policy = repo.policy, scriptOverlay = null) {
  const scripts = scriptOverlay ? { ...repo.scripts, ...scriptOverlay } : repo.scripts;
  const idx = indexScripts(scripts);
  const active = activeResolutions(idx, scripts, moveList);
  const onSet = new Set(moveList);
  const root = deriveRoot(scripts);
  const names = policy || repo.policy || DEFAULT_POLICY;
  const pools = poolView(idx, scripts, moveList, active, names, root);
  const woven = weaveFiles(idx, scripts, moveList, active, redactionMap(repo));

  const attrByNode = new Map();
  for (const attr of pools.visibleAttrs) {
    if (!attrByNode.has(attr.node)) attrByNode.set(attr.node, []);
    attrByNode.get(attr.node).push(attr);
  }

  const files = pools.files.map((file) => {
    const wovenFile = woven.byNode.get(file.node);
    const attrs = (attrByNode.get(file.node) || []).slice().sort((a, b) => cmpOrderKey(a.addedBy, b.addedBy));
    const content = attrs.filter((attr) => attr.key === 'content');
    const bytes = content.length ? String(content[0].value) : wovenFile ? wovenFile.bytes : '';
    const meta = {};
    for (const attr of attrs) if (attr.key !== 'content') meta[attr.key] = attr.value;
    return {
      path: file.path,
      node: file.node,
      entryId: file.entryId,
      bytes,
      lineIds: content.length ? [] : wovenFile ? wovenFile.lineIds : [],
      meta,
    };
  });

  const snags = [...woven.snags, ...pools.snags];
  for (const snag of snags) {
    if (!snag.path && snag.node) {
      const file = files.find((item) => item.node === snag.node);
      if (file) snag.path = file.path;
    }
  }

  const notices = [];
  for (const id of moveList) {
    const sc = scripts[id];
    if (!sc || sc.signature === 'bad') {
      notices.push({
        kind: 'waiting',
        move: id,
        site: sc?.site || waitingSite(repo, id),
        detail: !sc ? `waiting on script for ${id}` : `script for ${id} failed its signature`,
      });
      continue;
    }
    if (!sc.resolves) continue;
    const reason = dormantReason(sc, moveList, idx, scripts);
    if (reason) {
      notices.push({
        kind: 'dormant_resolution',
        move: id,
        detail: `${id} dormant: ${reason}`,
        reason,
      });
    }
  }
  for (const raft of Object.values(repo.rafts)) {
    const count = raft.members.filter((id) => onSet.has(id)).length;
    if (count > 0 && count < raft.members.length) {
      notices.push({
        kind: 'raft_partial',
        raft: raft.id,
        on: count,
        of: raft.members.length,
        detail: `${raft.id}: ${count} of ${raft.members.length} members on`,
      });
    }
  }
  const referenced = referencedMoves(repo);
  for (const sc of Object.values(scripts)) {
    if (!referenced.has(sc.id)) {
      notices.push({ kind: 'unattached', move: sc.id, detail: `${sc.id} was saved but never checked in` });
    }
  }

  const eventSnags = [];
  for (const id of moveList) {
    const sc = scripts[id];
    if (sc && sc.signature === 'bad') {
      eventSnags.push({ kind: 'event', code: 'bad_signature', move: id, detail: `script ${id} failed its signature` });
    }
  }

  const blockers = collectBlockers(snags, notices, eventSnags);
  return {
    moves: moveList.slice(),
    files,
    directories: pools.directories,
    emptyDirs: pools.emptyDirs,
    snags,
    notices,
    eventSnags,
    blockers,
    exportable: blockers.length === 0,
    reachable: [...pools.reachable],
    visibleEntries: pools.visibleEntries,
    root,
  };
}

function waitingSite(repo, moveId) {
  for (const stream of Object.values(repo.streams)) {
    for (const ev of stream.events) {
      if ((ev.move === moveId || (ev.moves || []).includes(moveId)) && ev.site) return ev.site;
    }
  }
  return null;
}

function referencedMoves(repo) {
  const refs = new Set();
  for (const stream of Object.values(repo.streams)) {
    for (const ev of stream.events) {
      if (ev.rejected) continue;
      if (ev.move) refs.add(ev.move);
      for (const id of ev.moves || []) refs.add(id);
    }
  }
  return refs;
}

function collectBlockers(snags, notices, eventSnags) {
  const blockers = [];
  for (const snag of snags) blockers.push({ type: 'snag', kind: snag.kind, code: snag.code, spot: snag.spot });
  for (const notice of notices) if (notice.kind === 'waiting') blockers.push({ type: 'waiting', move: notice.move });
  for (const snag of eventSnags) blockers.push({ type: 'event', code: snag.code, event: snag.event });
  return blockers;
}

const EXPOSE_KINDS = new Set(['pull', 'restore', 'carry', 'pull_raft', 'policy']);

function exposureMap(repo, streamName) {
  const stream = repo.streams[streamName];
  if (!stream) return new Map();
  const events = [
    ...stream.events.filter((ev) => !ev.rejected),
    ...repo.repoEvents,
  ].sort((a, b) => a.seq - b.seq);
  const on = [];
  const onSet = new Set();
  const locks = [];
  let policy = { ...DEFAULT_POLICY };
  let present = new Set();
  const exposer = new Map();
  for (const ev of events) {
    if (ev.kind === 'policy') policy = { ...policy, ...ev.policy, eventId: ev.id };
    else if (ev.stream === streamName) applyOn(ev, on, onSet, locks);
    const view = computeView(repo, on, policy);
    const keys = new Set(view.snags.map(snagKey));
    for (const key of keys) if (!present.has(key)) exposer.set(key, ev);
    present = keys;
  }
  return exposer;
}

export function snagKey(snag) {
  const moves = (snag.moves || []).slice().sort().join(',');
  return `${snag.kind}|${snag.code}|${snag.spot}|${moves}`;
}

function applyExposure(repo, streamName, snags) {
  const exposer = exposureMap(repo, streamName);
  for (const snag of snags) {
    const ev = exposer.get(snagKey(snag));
    if (ev && EXPOSE_KINDS.has(ev.kind)) {
      snag.tag11 = true;
      snag.exposedBy = ev.id;
      snag.exposedByKind = ev.kind;
    } else {
      snag.tag11 = false;
      snag.exposedBy = null;
    }
  }
}

function forkSnags(repo, streamName) {
  const stream = repo.streams[streamName];
  if (!stream) return [];
  const snags = [];
  for (const ev of stream.events) {
    if (ev.rejected && ev.snag === 'fork') {
      snags.push({
        kind: 'event',
        code: 'fork',
        event: ev.id,
        stream: streamName,
        detail: 'stale flow-log fork; meaning changed',
      });
    }
  }
  return snags;
}

export function inspect(repo, streamName) {
  const { on } = fold(repo, streamName);
  const view = computeView(repo, on, repo.policy);
  applyExposure(repo, streamName, view.snags);
  view.eventSnags.push(...forkSnags(repo, streamName));
  view.blockers = collectBlockers(view.snags, view.notices, view.eventSnags);
  view.exportable = view.blockers.length === 0;
  view.stream = streamName;
  return view;
}

export function assemble(repo, arg) {
  let moveList = [];
  let streamName = null;
  let path = null;
  if (Array.isArray(arg)) {
    moveList = arg.slice();
  } else if (arg && typeof arg === 'object') {
    path = arg.path || null;
    if (arg.moves) moveList = arg.moves.slice();
    else if (arg.stream) {
      streamName = arg.stream;
      moveList = fold(repo, arg.stream).on.slice();
    }
    if (arg.with) {
      for (const id of arg.with) if (!moveList.includes(id)) moveList.push(id);
    }
    if (arg.without) {
      const drop = new Set(arg.without);
      moveList = moveList.filter((id) => !drop.has(id));
    }
    if (!arg.moves && !arg.stream && (arg.with || arg.without)) {
      throw new Error('assemble needs moves or stream');
    }
  } else {
    throw new Error('assemble needs a move list or an options object');
  }

  const view = computeView(repo, moveList, repo.policy);
  if (streamName && !arg?.moves) applyExposure(repo, streamName, view.snags);
  if (streamName) {
    view.eventSnags.push(...forkSnags(repo, streamName));
    view.blockers = collectBlockers(view.snags, view.notices, view.eventSnags);
    view.exportable = view.blockers.length === 0;
  }

  let file = null;
  if (path) file = view.files.find((item) => item.path === path) || null;
  else if (view.files.length === 1) file = view.files[0];
  const text = file ? file.bytes : null;
  return {
    text,
    bytes: text,
    lines: file ? file.lineIds : [],
    path: file ? file.path : path,
    files: view.files,
    directories: view.directories,
    emptyDirs: view.emptyDirs,
    snags: view.snags,
    notices: view.notices,
    eventSnags: view.eventSnags,
    blockers: view.blockers,
    exportable: view.exportable,
    moves: view.moves,
  };
}

export function exportStream(repo, streamName) {
  const view = inspect(repo, streamName);
  if (!view.exportable) {
    return { ok: false, exportable: false, blockers: view.blockers, files: null };
  }
  const files = Object.create(null);
  for (const file of view.files) files[file.path] = file.bytes;
  for (const dir of view.emptyDirs) files[`${dir.path}/.kawa-keep`] = '';
  return { ok: true, exportable: true, blockers: [], files };
}

export function isKeepPath(filePath) {
  return filePath === '.kawa-keep' || filePath.endsWith('/.kawa-keep');
}

export function importTree(files) {
  const out = Object.create(null);
  for (const [filePath, bytes] of Object.entries(files)) {
    if (isKeepPath(filePath)) continue;
    out[filePath] = bytes;
  }
  return out;
}
