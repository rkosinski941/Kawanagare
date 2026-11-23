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
import { weaveFiles, START, END } from './weave.mjs';
import { longestPath, poolView, selfConflicts } from './pools.mjs';
import { checkInRefusal, deriveOps, intentError } from './intent.mjs';
import { CODE, NOTICE, NEEDS_ALGO, PARENT_POOL_OPTIONS } from './codes.mjs';
import { cmpCodeUnit, derivedIds, needsReportFor, waiverError } from './needs.mjs';

export { deriveNeeds, needsReport, waiverError } from './needs.mjs';

export { START, END, DEFAULT_POLICY, insideWorktree, forbiddenName, nameKey };

export function createRepo() {
  const repo = {
    scripts: Object.create(null),
    streams: Object.create(null),
    repoEvents: [],
    seq: 0,
    rafts: Object.create(null),
    redactions: [],
    waivers: [],
    waiversInvalid: [],
    policy: { ...DEFAULT_POLICY },
  };
  return repo;
}

export function project(repo) {
  repo.rafts = Object.create(null);
  repo.redactions = [];
  repo.waivers = [];
  repo.waiversInvalid = [];
  repo.policy = { ...DEFAULT_POLICY };
  const events = repo.repoEvents.slice().sort((a, b) => a.seq - b.seq);
  for (const ev of events) {
    if (ev.kind === 'raft') {
      repo.rafts[ev.raft] = { id: ev.raft, members: ev.members.slice(), eventId: ev.id };
    } else if (ev.kind === 'policy') {
      repo.policy = { ...repo.policy, ...ev.policy, eventId: ev.id };
    } else if (ev.kind === 'redact') {
      repo.redactions.push({ lineId: ev.lineId, marker: ev.marker, eventId: ev.id });
    } else if (ev.kind === 'waiver') {
      const error = waiverError(ev.waiver, ev.signer);
      if (error) {
        const moveId = ev.waiver && typeof ev.waiver === 'object' ? ev.waiver.move_id : undefined;
        repo.waiversInvalid.push({ eventId: ev.id, move_id: moveId, field: error.field, reason: error.reason });
      } else {
        repo.waivers.push({
          eventId: ev.id,
          move_id: ev.waiver.move_id,
          need_move_id: ev.waiver.need_move_id,
          reason: ev.waiver.reason,
          signer: ev.signer,
        });
      }
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
    intent: input.intent === undefined ? undefined : input.intent,
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
  const storeNodes = indexScripts(repo.scripts).nodes;
  const intentRefusal = checkInRefusal(input, {
    hasNode: (id) => Object.prototype.hasOwnProperty.call(storeNodes, id),
  });
  if (intentRefusal) {
    const result = {
      ok: false,
      refused: true,
      code: intentRefusal.code,
      field: intentRefusal.field,
      message: intentRefusalMessage(intentRefusal),
    };
    if (intentRefusal.reason !== undefined) result.reason = intentRefusal.reason;
    return result;
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
    intent: script.intent,
  });
  const view = inspect(repo, streamName);
  return {
    ok: true,
    id: script.id,
    event,
    snags: view.snags,
    notices: view.notices,
    ops_derived: view.ops_derived?.[script.id] || [],
  };
}

function intentRefusalMessage(refusal) {
  if (refusal.code === CODE.intent_missing) {
    return 'check-in refused: intent block is missing (/intent)';
  }
  if (refusal.code === CODE.intent_invalid) {
    return `check-in refused: intent_invalid ${refusal.reason} at ${refusal.field}`;
  }
  return 'check-in refused: move_empty (no records and no resolves section)';
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

function analyzeNeeds(repo, moveId, onList, waiverFor = null) {
  const onSet = new Set(onList);
  const idx = indexScripts(repo.scripts);
  const seen = new Set();
  const full = [];
  const pruned = [];
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const sc = repo.scripts[id];
    if (!sc || sc.signature === 'bad') return;
    const needs = derivedIds(idx, sc).sort(cmpOrderKey);
    for (const need of needs) {
      const waiver = waiverFor ? waiverFor(id, need) : null;
      if (waiver) {
        pruned.push({ move_id: id, need_move_id: need, event: waiver.eventId });
        continue;
      }
      visit(need);
    }
    full.push(id);
  };
  visit(moveId);
  const proposed = full.filter((id) => !onSet.has(id));
  const missing = proposed.filter((id) => id !== moveId);
  const extended = [...onList, ...proposed];
  const problems = poolProblems(repo, moveId, extended);
  const inFull = new Set(full);
  const waived = pruned
    .filter((edge) => !onSet.has(edge.need_move_id) && !inFull.has(edge.need_move_id))
    .sort((a, b) => cmpCodeUnit(a.move_id, b.move_id) || cmpCodeUnit(a.need_move_id, b.need_move_id));
  return { missing, proposed, problems, full, waived };
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

/**
 * Carry planning (spec 4.9). Read-only. Shared by carry and carryPreview so the preview is
 * exactly what carry does. Refusal order (D-S3-06): waiver_invalid, parent_pool_missing,
 * needs_derived_missing, entry_not_visible. Without withNeeds, recorded waivers prune exactly
 * their edge; withNeeds carries the full group and does not consult waivers (D-S3-08).
 */
function planCarry(repo, streamName, moveId, opts = {}) {
  const withNeeds = !!opts.withNeeds;
  const on = repo.streams[streamName] ? fold(repo, streamName).on : [];
  if (on.includes(moveId)) {
    return { state: 'already', result: { ok: true, alreadyOn: true, added: [], message: `already on in ${streamName}; nothing to do` } };
  }
  const script = repo.scripts[moveId];
  if (!script || script.signature === 'bad') {
    return {
      state: 'refuse',
      result: { ok: false, refused: true, missing: [], proposed: [], message: `carry of ${moveId} refused: script missing` },
    };
  }
  const idx = indexScripts(repo.scripts);
  const report = needsReportFor(idx, script, moveId);

  if (!withNeeds) {
    const bad = (repo.waiversInvalid || []).filter((item) => item.move_id === moveId);
    if (bad.length) {
      const first = bad[0];
      return {
        state: 'refuse',
        result: {
          ok: false,
          refused: true,
          code: CODE.waiver_invalid,
          move: moveId,
          event: first.eventId,
          field: first.field,
          reason: first.reason,
          missing: [],
          proposed: [],
          needs_report: report,
          notices: [],
          message: `carry of ${moveId} refused: waiver_invalid ${first.reason} at ${first.field} (event ${first.eventId})`,
        },
      };
    }
  }

  const waiverFor = withNeeds
    ? null
    : (from, need) => (repo.waivers || []).find((w) => w.move_id === from && w.need_move_id === need) || null;
  const analysis = analyzeNeeds(repo, moveId, on, waiverFor);
  const groupProblems = analysis.problems;
  const landList = withNeeds ? [...on, ...analysis.proposed] : [...on, moveId];
  const landProblems = withNeeds ? groupProblems : poolProblems(repo, moveId, landList);
  const parentMissing = landProblems
    .filter((problem) => problem.code === 'parent_unreachable')
    .map((problem) => {
      const entry = script.entries.find((item) => item.id === problem.entry);
      return {
        node_id: problem.pool,
        parent_move_id: idx.nodes[problem.pool]?.addedBy ?? null,
        child_node_id: entry ? entry.node : null,
        entry_id: problem.entry,
        options: [...PARENT_POOL_OPTIONS],
      };
    });
  const entryMissing = landProblems.filter((problem) => problem.code === 'entry_not_visible');
  const missing = withNeeds ? [] : analysis.missing;

  const base = {
    ok: false,
    refused: true,
    move: moveId,
    missing: analysis.missing.slice(),
    proposed: analysis.proposed.slice(),
    problems: groupProblems.slice(),
    group: `needs:${moveId}`,
    group_moves: analysis.proposed.slice(),
    needs_report: report,
    notices: [],
  };
  if (parentMissing.length) {
    const first = parentMissing[0];
    return {
      state: 'refuse',
      result: {
        ...base,
        code: CODE.parent_pool_missing,
        node_id: first.node_id,
        parent_move_id: first.parent_move_id,
        options: [...PARENT_POOL_OPTIONS],
        parent_pool_missing: parentMissing,
        message: `carry of ${moveId} refused: parent_pool_missing: pool ${first.node_id} is not reachable in ${streamName}; parent move ${first.parent_move_id ?? 'unknown'}; options add_parent (withNeeds) or refuse`,
      },
    };
  }
  if (missing.length) {
    return {
      state: 'refuse',
      result: {
        ...base,
        code: CODE.needs_derived_missing,
        move_ids: missing.slice(),
        message: refusalMessage(streamName, moveId, script, analysis),
      },
    };
  }
  if (entryMissing.length) {
    return {
      state: 'refuse',
      result: {
        ...base,
        code: CODE.entry_not_visible,
        entry_ids: entryMissing.map((problem) => problem.entry),
        message: refusalMessage(streamName, moveId, script, { ...analysis, problems: landProblems }),
      },
    };
  }

  const notices = [];
  if (report.needs_authored_only.length) {
    notices.push({
      code: NOTICE.needs_authored_unproven,
      move: moveId,
      move_ids: report.needs_authored_only.slice(),
      derive_algo: NEEDS_ALGO,
    });
  }
  if (analysis.waived.length) {
    notices.push({
      code: NOTICE.needs_derived_missing,
      move: moveId,
      move_ids: [...new Set(analysis.waived.map((edge) => edge.need_move_id))].sort(cmpCodeUnit),
      waived: analysis.waived.map((edge) => ({ ...edge })),
      derive_algo: NEEDS_ALGO,
    });
  }
  const added = withNeeds ? analysis.proposed.slice() : [moveId];
  const grouped = withNeeds && analysis.missing.length > 0;
  return {
    state: 'land',
    added,
    grouped,
    waived: analysis.waived,
    result: {
      ok: true,
      added,
      proposed: added.slice(),
      missingWere: withNeeds ? analysis.missing.slice() : [],
      group: grouped ? `needs:${moveId}` : null,
      needs_report: report,
      notices,
      message: grouped
        ? `carried needs group ${added.join(', ')} into ${streamName}`
        : `carried ${moveId} into ${streamName}`,
    },
  };
}

/** Read-only carry preview: the same reply carry would give, with no event (spec 4.9, 4.11). */
export function carryPreview(repo, streamName, moveId, opts = {}) {
  const plan = planCarry(repo, streamName, moveId, opts);
  if (plan.state !== 'land') return { ...plan.result, preview: true };
  return { ...plan.result, preview: true, would_add: plan.added.slice() };
}

export function carry(repo, streamName, moveId, opts = {}) {
  const plan = planCarry(repo, streamName, moveId, opts);
  if (plan.state !== 'land') return plan.result;
  const partial = {
    kind: 'carry',
    move: moveId,
    moves: plan.added.slice(),
    via: plan.grouped ? 'with-needs' : 'carry',
    group: plan.grouped ? `needs:${moveId}` : null,
  };
  if (plan.waived.length) partial.waivers = [...new Set(plan.waived.map((edge) => edge.event))];
  const event = appendEvent(repo, streamName, partial);
  return { ...plan.result, event };
}

/**
 * Record a needs waiver as a signed repo event (spec 4.9). One edge per event. The signer is a
 * recorded field; who may sign is NR-11 and is not checked here. A malformed waiver is refused
 * waiver_invalid and nothing is appended. The same edge waived twice is a no-op (D-S3-09).
 */
export function recordWaiver(repo, waiver, opts = {}) {
  const signer = opts.signer;
  const error = waiverError(waiver, signer);
  if (error) {
    return {
      ok: false,
      refused: true,
      code: CODE.waiver_invalid,
      field: error.field,
      reason: error.reason,
      message: `waiver refused: waiver_invalid ${error.reason} at ${error.field}`,
    };
  }
  const existing = (repo.waivers || []).find(
    (w) => w.move_id === waiver.move_id && w.need_move_id === waiver.need_move_id,
  );
  if (existing) {
    return { ok: true, alreadyWaived: true, event: null, eventId: existing.eventId, message: 'edge already waived; nothing to do' };
  }
  const event = allocEvent(repo, {
    kind: 'waiver',
    waiver: { move_id: waiver.move_id, need_move_id: waiver.need_move_id, reason: waiver.reason },
    signer,
  });
  repo.repoEvents.push(event);
  project(repo);
  return { ok: true, event, message: `waived need ${waiver.need_move_id} of ${waiver.move_id}` };
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
  // Proposed (sample run v2, G-41): same codes, order and waiver rule as a single-move carry
  // (D-S3-06, D-S3-08 without withNeeds). One code per reply: the first in refusal order.
  const waiverFor = (from, need) => (repo.waivers || []).find((w) => w.move_id === from && w.need_move_id === need) || null;
  const RANK = [CODE.waiver_invalid, CODE.parent_pool_missing, CODE.needs_derived_missing, CODE.entry_not_visible, 'script_missing'];
  for (const moveId of todo) {
    const script = repo.scripts[moveId];
    if (!script) {
      problems.push({ move: moveId, code: 'script_missing' });
      continue;
    }
    const bad = (repo.waiversInvalid || []).find((item) => item.move_id === moveId);
    if (bad) problems.push({ move: moveId, code: CODE.waiver_invalid, event: bad.eventId, field: bad.field, reason: bad.reason });
    const analysis = analyzeNeeds(repo, moveId, extended.filter((id) => id !== moveId), waiverFor);
    const missing = analysis.missing.filter((id) => !raft.members.includes(id) && !onSet.has(id));
    const pool = poolProblems(repo, moveId, extended);
    for (const item of pool.filter((p) => p.code === 'parent_unreachable')) {
      problems.push({ move: moveId, code: CODE.parent_pool_missing, node_id: item.pool, entry_id: item.entry, options: [...PARENT_POOL_OPTIONS] });
    }
    if (missing.length) problems.push({ move: moveId, code: CODE.needs_derived_missing, move_ids: missing });
    const hidden = pool.filter((p) => p.code === 'entry_not_visible').map((p) => p.entry);
    if (hidden.length) problems.push({ move: moveId, code: CODE.entry_not_visible, entry_ids: hidden });
  }
  if (problems.length) {
    problems.sort((a, b) => RANK.indexOf(a.code) - RANK.indexOf(b.code));
    return {
      ok: false,
      refused: true,
      code: problems[0].code,
      added: [],
      skipped,
      problems,
      message: `raft ${raftId} refused: ${problems[0].code}: ${[...new Set(problems.map((problem) => problem.move))].join(', ')}`,
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

  const intentInfo = collectIntentInfo(scripts, idx, moveList);
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
    ...intentInfo,
  };
}

function collectIntentInfo(scripts, idx, moveList) {
  const intentReports = [];
  const needReports = [];
  const needsReports = Object.create(null);
  const opsDerived = Object.create(null);
  const opsPartial = Object.create(null);
  const onSet = new Set(moveList);
  const hasNode = (id) => Object.prototype.hasOwnProperty.call(idx.nodes, id);

  for (const moveId of moveList) {
    const script = scripts[moveId];
    if (!script) continue;

    const report = needsReportFor(idx, script, moveId);
    needsReports[moveId] = report;
    const derivedLookup = new Set(report.needs_derived.map((edge) => edge.move_id));

    const intent = script.intent;
    if (intent === undefined || intent === null) {
      intentReports.push({ move: moveId, code: CODE.intent_missing, field: '/intent' });
    } else {
      const error = intentError(intent, moveId, { hasNode });
      if (error) {
        intentReports.push({
          move: moveId,
          code: CODE.intent_invalid,
          field: error.field,
          reason: error.reason,
        });
      } else {
        for (const need of intent.needs) {
          if (!onSet.has(need)) {
            const report = {
              move: moveId,
              need,
              code: CODE.intent_need_absent,
              provenance: derivedLookup.has(need) ? 'derived' : 'authored_only',
            };
            needReports.push(report);
            intentReports.push({ ...report });
          }
        }
      }
    }

    const derived = deriveOps(script, scripts);
    opsDerived[moveId] = derived.ops;
    if (derived.partial.length) {
      opsPartial[moveId] = derived.partial.slice();
      intentReports.push({ move: moveId, code: NOTICE.ops_derived_partial, ids: derived.partial.slice() });
    }
  }

  return {
    intent_reports: intentReports,
    intent_need_absent: needReports,
    ops_derived: opsDerived,
    ops_derived_partial: opsPartial,
    needs_reports: needsReports,
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
    intent_reports: view.intent_reports,
    intent_need_absent: view.intent_need_absent,
    ops_derived: view.ops_derived,
    ops_derived_partial: view.ops_derived_partial,
    needs_reports: view.needs_reports,
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
