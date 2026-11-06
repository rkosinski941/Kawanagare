/**
 * Pool entry records: a directory is a node, and each entry says
 * "node X is here under name N". Paths are a view walked from the root.
 * A second walk reports entries whose pool cannot be reached.
 */

import { entryVisible, attrVisible, cmpLine } from './model.mjs';
import { DEFAULT_POLICY, forbiddenName, joinRepoPath, nameKey, sameName } from './names.mjs';

export function poolView(idx, scripts, moveList, activeRes, policy, root) {
  const onSet = new Set(moveList);
  const names = policy || DEFAULT_POLICY;
  const visibleEntries = Object.values(idx.entries).filter((entry) =>
    entryVisible(entry, onSet, activeRes, idx, scripts),
  );
  const visibleAttrs = Object.values(idx.attrs).filter((attr) =>
    attrVisible(attr, onSet, activeRes, idx, scripts),
  );

  const snags = [];
  snags.push(...nameSnags(visibleEntries, idx, names));
  snags.push(...attributeSnags(visibleAttrs, scripts));

  const byPool = new Map();
  for (const entry of visibleEntries) {
    if (!byPool.has(entry.pool)) byPool.set(entry.pool, []);
    byPool.get(entry.pool).push(entry);
  }

  const cycles = findCycles(root, byPool, idx);
  const cyclePools = new Set(cycles.flat());
  for (const cycle of cycles) {
    const edges = edgesOf(cycle, byPool, idx);
    snags.push({
      kind: 9,
      code: 'cycle',
      twin: false,
      spot: cycle.slice().sort().join('|'),
      moves: unique(edges.map((entry) => entry.addedBy)),
      entries: edges.map((entry) => entry.id),
      cycle,
      detail: `pool cycle ${cycle.join(' -> ')}`,
    });
  }

  const reachable = new Set();
  const files = [];
  const directories = [];
  const emptyDirs = [];
  if (root) {
    walk(root, '', byPool, idx, reachable, files, directories, emptyDirs, new Set());
  }

  const orphansByPool = new Map();
  for (const entry of visibleEntries) {
    if (entry.pool === root) continue;
    if (reachable.has(entry.pool)) continue;
    if (cyclePools.has(entry.pool)) continue;
    if (!orphansByPool.has(entry.pool)) orphansByPool.set(entry.pool, []);
    orphansByPool.get(entry.pool).push(entry);
  }
  for (const [pool, entries] of orphansByPool) {
    const switchedBy = (idx.entryOffBy && offMovesForPool(idx, pool, onSet, scripts, activeRes)) || [];
    snags.push({
      kind: 8,
      code: 'orphan',
      twin: false,
      spot: `orphan:${pool}`,
      pool,
      moves: unique([...entries.map((entry) => entry.addedBy), ...switchedBy]),
      entries: entries.map((entry) => entry.id),
      choices: ['restore the pool', 'move the file elsewhere'],
      detail: `entries in pool ${pool} cannot be reached from the root`,
    });
  }

  return { visibleEntries, visibleAttrs, snags, files, directories, emptyDirs, reachable };
}

function nameSnags(visibleEntries, idx, policy) {
  const snags = [];
  const byPool = new Map();
  for (const entry of visibleEntries) {
    if (!byPool.has(entry.pool)) byPool.set(entry.pool, []);
    byPool.get(entry.pool).push(entry);
  }
  for (const [pool, entries] of byPool) {
    const groups = new Map();
    for (const entry of entries) {
      const key = nameKey(entry.name, policy);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      snags.push({
        kind: 7,
        code: 'duplicate_name',
        twin: false,
        spot: `${pool}:${key}`,
        pool,
        moves: unique(group.map((entry) => entry.addedBy)),
        entries: group.map((entry) => entry.id),
        names: group.map((entry) => entry.name),
        detail: `name collision in pool ${pool}: ${group.map((entry) => entry.name).join(', ')}`,
      });
    }
  }

  const byNode = new Map();
  for (const entry of visibleEntries) {
    if (!byNode.has(entry.node)) byNode.set(entry.node, []);
    byNode.get(entry.node).push(entry);
  }
  for (const [node, entries] of byNode) {
    if (entries.length < 2) continue;
    snags.push({
      kind: 7,
      code: 'node_two_names',
      twin: false,
      spot: `node:${node}`,
      node,
      moves: unique(entries.map((entry) => entry.addedBy)),
      entries: entries.map((entry) => entry.id),
      names: entries.map((entry) => entry.name),
      detail: `node ${node} is visible under ${entries.map((entry) => entry.name).join(', ')}`,
    });
  }
  return snags;
}

function attributeSnags(visibleAttrs, scripts) {
  const groups = new Map();
  for (const attr of visibleAttrs) {
    const key = `${attr.node}\0${attr.key}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(attr);
  }
  const snags = [];
  for (const [key, attrs] of groups) {
    const byMove = new Map();
    for (const attr of attrs) {
      if (!byMove.has(attr.addedBy)) byMove.set(attr.addedBy, []);
      byMove.get(attr.addedBy).push(attr);
    }
    if (byMove.size < 2) continue;
    const [node, attrKey] = key.split('\0');
    const moves = [...byMove.keys()].sort((a, b) => cmpLine(scripts, { addedBy: a, seq: 0, id: a }, { addedBy: b, seq: 0, id: b }));
    snags.push({
      kind: 10,
      code: 'attribute',
      twin: false,
      spot: `${node}:${attrKey}`,
      node,
      key: attrKey,
      moves,
      sides: moves.map((moveId) => ({
        move: moveId,
        values: byMove.get(moveId).map((attr) => attr.value),
      })),
      detail: `two visible values for ${attrKey} on ${node}`,
    });
  }
  return snags;
}

function walk(pool, path, byPool, idx, reachable, files, directories, emptyDirs, stack) {
  if (!pool || stack.has(pool)) return;
  reachable.add(pool);
  stack.add(pool);
  const node = idx.nodes[pool];
  if (node && node.kind === 'pool') directories.push({ path, node: pool });
  const children = (byPool.get(pool) || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (path && children.length === 0) emptyDirs.push({ path, node: pool });
  for (const entry of children) {
    const childPath = joinRepoPath(path, entry.name);
    const child = idx.nodes[entry.node];
    const kind = child ? child.kind : 'file';
    if (kind === 'pool') {
      walk(entry.node, childPath, byPool, idx, reachable, files, directories, emptyDirs, stack);
    } else {
      files.push({ path: childPath, node: entry.node, entryId: entry.id, name: entry.name });
    }
  }
  stack.delete(pool);
}

function findCycles(root, byPool, idx) {
  const color = new Map();
  const stack = [];
  const cycles = [];
  const pools = new Set();
  if (root) pools.add(root);
  for (const [pool, entries] of byPool) {
    pools.add(pool);
    for (const entry of entries) {
      if (idx.nodes[entry.node]?.kind === 'pool') pools.add(entry.node);
    }
  }

  function dfs(pool) {
    color.set(pool, 1);
    stack.push(pool);
    for (const entry of byPool.get(pool) || []) {
      if (idx.nodes[entry.node]?.kind !== 'pool') continue;
      const child = entry.node;
      if (color.get(child) === 1) {
        const at = stack.indexOf(child);
        if (at >= 0) cycles.push(stack.slice(at));
      } else if (color.get(child) !== 2) dfs(child);
    }
    stack.pop();
    color.set(pool, 2);
  }

  for (const pool of pools) if (color.get(pool) !== 2) dfs(pool);
  return cycles;
}

function edgesOf(cycle, byPool, idx) {
  const inCycle = new Set(cycle);
  const edges = [];
  for (const pool of cycle) {
    for (const entry of byPool.get(pool) || []) {
      if (idx.nodes[entry.node]?.kind === 'pool' && inCycle.has(entry.node)) edges.push(entry);
    }
  }
  return edges;
}

function offMovesForPool(idx, pool, onSet, scripts, activeRes) {
  const moves = [];
  for (const entry of Object.values(idx.entries)) {
    if (entry.node !== pool) continue;
    for (const moveId of idx.entryOffBy[entry.id] || []) {
      if (!onSet.has(moveId)) continue;
      const sc = scripts[moveId];
      if (sc?.resolves && !activeRes.has(moveId)) continue;
      moves.push(moveId);
    }
  }
  return moves;
}

function unique(ids) {
  return [...new Set(ids)];
}

export function selfConflicts(script, policy = DEFAULT_POLICY, knownPools = new Set()) {
  const reasons = [];
  const byNode = new Map();
  for (const entry of script.entries) {
    if (!byNode.has(entry.node)) byNode.set(entry.node, []);
    byNode.get(entry.node).push(entry);
  }
  for (const [node, entries] of byNode) {
    if (entries.length > 1) reasons.push({ code: 'two_names', node });
  }

  const seenName = new Set();
  for (const entry of script.entries) {
    const key = `${entry.pool}\0${nameKey(entry.name, policy)}`;
    if (seenName.has(key)) reasons.push({ code: 'duplicate_name', name: entry.name, pool: entry.pool });
    seenName.add(key);
    const why = forbiddenName(entry.name, policy);
    if (why) reasons.push({ code: 'forbidden_name', name: entry.name, why });
  }

  const byAttr = new Map();
  for (const attr of script.attributes) {
    const key = `${attr.node}\0${attr.key}`;
    if (!byAttr.has(key)) byAttr.set(key, 0);
    byAttr.set(key, byAttr.get(key) + 1);
  }
  for (const [key, count] of byAttr) {
    if (count > 1) reasons.push({ code: 'two_attributes', key });
  }

  const poolIds = new Set(knownPools);
  for (const node of script.nodes) if (node.kind === 'pool') poolIds.add(node.id);
  const adj = new Map();
  for (const entry of script.entries) {
    if (!poolIds.has(entry.node)) continue;
    if (!adj.has(entry.pool)) adj.set(entry.pool, []);
    adj.get(entry.pool).push(entry.node);
  }
  if (graphHasCycle(adj)) reasons.push({ code: 'cycle' });
  return reasons;
}

function graphHasCycle(adj) {
  const color = new Map();
  function dfs(node) {
    color.set(node, 1);
    for (const child of adj.get(node) || []) {
      if (color.get(child) === 1) return true;
      if (color.get(child) !== 2 && dfs(child)) return true;
    }
    color.set(node, 2);
    return false;
  }
  for (const node of adj.keys()) {
    if (color.get(node) !== 2 && dfs(node)) return true;
  }
  return false;
}

export function longestPath(files, directories) {
  let longest = 0;
  let which = '';
  for (const file of files) {
    if (file.path.length > longest) {
      longest = file.path.length;
      which = file.path;
    }
  }
  for (const dir of directories) {
    if (dir.path && dir.path.length > longest) {
      longest = dir.path.length;
      which = dir.path;
    }
  }
  return { length: longest, path: which };
}

export { sameName };
