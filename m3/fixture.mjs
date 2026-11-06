/**
 * Worked histories for the reference engine.
 *
 * `makeOdbcRepo` is the architecture example (src/odbc.c).
 * `makeDemoRepo` is the move-10 backport: the same Move-Id is carried
 * from stream v2 back into the older stream v1.
 */

import { checkin, createRepo, forkStream } from './engine.mjs';
import { END, START } from './weave.mjs';

export const O = {
  root: 'p:root',
  src: 'p:src',
  file: 'n:odbc',
  eSrc: 'E:src',
  eOdbc: 'E:odbc',
  eDb: 'E:db',
  seed1: 'seed.1',
  seed4: 'seed.4',
  m117: 'move.117',
  m118: 'move.118',
  m121: 'move.joy@lap.121',
  m122: 'move.122',
};

const H = '#include <sql.h>\n';
const OPEN = 'int open();\n';
const CLOSE = 'int close();\n';
const EXT = '#include <sqlext.h>\n';
const FLAGS = 'int open(int flags);\n';
const MODE = 'int open(int mode);\n';
const BOTH = 'int open(int flags, int mode);\n';

export function makeOdbcRepo() {
  const repo = createRepo();
  const root = checkin(repo, 'dev', {
    id: O.seed1,
    orderKey: '1',
    author: 'rich',
    site: 'desk',
    nodes: [
      { id: O.root, kind: 'pool', root: true },
      { id: O.src, kind: 'pool' },
    ],
    entries: [{ id: O.eSrc, pool: O.root, node: O.src, name: 'src' }],
  });
  if (!root.ok) throw new Error(root.message);
  const file = checkin(repo, 'dev', {
    id: O.seed4,
    orderKey: '4',
    author: 'rich',
    site: 'desk',
    nodes: [{ id: O.file, kind: 'file' }],
    entries: [{ id: O.eOdbc, pool: O.src, node: O.file, name: 'odbc.c' }],
    attributes: [
      { id: 'seed.4:kind', node: O.file, key: 'kind', value: 'text' },
      { id: 'seed.4:mode', node: O.file, key: 'mode', value: '644' },
    ],
    lines: [
      { id: 'L4.0', node: O.file, bytes: H, after: START, before: END },
      { id: 'L4.1', node: O.file, bytes: OPEN, after: 'L4.0', before: END },
      { id: 'L4.2', node: O.file, bytes: CLOSE, after: 'L4.1', before: END },
    ],
  });
  if (!file.ok) throw new Error(file.message);
  forkStream(repo, 'dev', 'release');
  const inc = checkin(repo, 'dev', {
    id: O.m117,
    orderKey: '117',
    author: 'rich',
    site: 'desk',
    lines: [{ id: 'L117.0', node: O.file, bytes: EXT, after: 'L4.0', before: 'L4.1' }],
  });
  if (!inc.ok) throw new Error(inc.message);
  const renamed = checkin(repo, 'dev', script118());
  if (!renamed.ok) throw new Error(renamed.message);
  return repo;
}

export function script118(bytes = FLAGS) {
  return {
    id: O.m118,
    orderKey: '118',
    author: 'rich',
    site: 'desk',
    off: ['L4.1'],
    lines: [{ id: 'L118.0', node: O.file, bytes, after: 'L4.0', before: 'L4.2', replaces: 'L4.1' }],
    entryOff: [O.eOdbc],
    entries: [{ id: O.eDb, pool: O.src, node: O.file, name: 'db.c' }],
  };
}

export function script121(bytes = MODE) {
  return {
    id: O.m121,
    orderKey: '121',
    author: 'joy',
    site: 'lap',
    saw: [O.seed1, O.seed4],
    off: ['L4.1'],
    lines: [{ id: 'L121.0', node: O.file, bytes, after: 'L4.0', before: 'L4.2', replaces: 'L4.1' }],
  };
}

export function script122() {
  return {
    id: O.m122,
    orderKey: '122',
    author: 'rich',
    site: 'desk',
    resolves: {
      kind: 'same_slot',
      identical: false,
      inputs: [O.m118, O.m121],
      absent: [],
      contested: ['L4.1'],
      saw: ['L118.0', 'L121.0'],
      decision: 'new text combining both',
    },
    off: ['L118.0', 'L121.0'],
    lines: [{ id: 'L122.0', node: O.file, bytes: BOTH, after: 'L4.0', before: 'L4.2', replaces: 'L4.1' }],
  };
}

export const STEP4 = `${H}${EXT}${FLAGS}${CLOSE}`;
export const STEP5 = `${H}${EXT}${OPEN}${CLOSE}`;
export const STEP7 = `${H}${EXT}${BOTH}${CLOSE}`;
export const RELEASE = `${H}${OPEN}${CLOSE}`;

export function makeDemoRepo() {
  const repo = createRepo();
  const file = 'n:main';
  const root = 'p:root';
  const lines = (id, bytes, after, before, extra = {}) => ({
    id,
    node: file,
    bytes,
    after,
    before,
    ...extra,
  });
  const ok = (result) => {
    if (!result.ok) throw new Error(result.message);
    return result;
  };

  ok(checkin(repo, 'v1', {
    id: '1',
    orderKey: '1',
    author: 'ada',
    site: 'bot',
    nodes: [
      { id: root, kind: 'pool', root: true },
      { id: file, kind: 'file' },
    ],
    entries: [{ id: 'E:main', pool: root, node: file, name: 'main.js' }],
    lines: [
      lines('L1a', 'function main() {\n', START, END),
      lines('L1b', '  return 0;\n', 'L1a', END),
      lines('L1c', '}\n', 'L1b', END),
    ],
  }));
  ok(checkin(repo, 'v1', {
    id: '2',
    orderKey: '2',
    author: 'ada',
    site: 'bot',
    off: ['L1b'],
    lines: [lines('L2a', '  return 1;\n', 'L1a', 'L1c', { replaces: 'L1b' })],
  }));
  ok(checkin(repo, 'v1', {
    id: '3',
    orderKey: '3',
    author: 'ada',
    site: 'bot',
    lines: [lines('L3a', '  // v1 entry\n', 'L1a', 'L1b')],
  }));
  ok(checkin(repo, 'v1', {
    id: '4',
    orderKey: '4',
    author: 'ada',
    site: 'bot',
    lines: [lines('L4a', '  // done\n', 'L2a', 'L1c')],
  }));
  ok(checkin(repo, 'v1', {
    id: '5',
    orderKey: '5',
    author: 'ada',
    site: 'bot',
    lines: [lines('L5a', '  // release: v1\n', 'L3a', 'L1b')],
  }));
  forkStream(repo, 'v1', 'v2');
  ok(checkin(repo, 'v2', {
    id: '6',
    orderKey: '6',
    author: 'bo',
    site: 'bot',
    lines: [lines('L6a', '  // helpers loaded\n', 'L5a', 'L1b')],
  }));
  ok(checkin(repo, 'v2', {
    id: '7',
    orderKey: '7',
    author: 'bo',
    site: 'bot',
    lines: [
      lines('L7a', '  init();\n', 'L6a', 'L1b'),
      lines('L7b', '  run();\n', 'L7a', 'L1b'),
    ],
  }));
  ok(checkin(repo, 'v2', {
    id: '8',
    orderKey: '8',
    author: 'bo',
    site: 'bot',
    lines: [lines('L8a', '  // metric: ok\n', 'L7a', 'L7b')],
  }));
  ok(checkin(repo, 'v2', {
    id: '9',
    orderKey: '9',
    author: 'bo',
    site: 'bot',
    lines: [lines('L9a', '  // trace off\n', 'L8a', 'L7b')],
  }));
  ok(checkin(repo, 'v2', {
    id: '10',
    orderKey: '10',
    author: 'bo',
    site: 'bot',
    off: ['L7b'],
    lines: [lines('L10a', '  runSafe();\n', 'L7a', 'L1b', { replaces: 'L7b' })],
  }));
  return repo;
}

export const V1_TEXT = [
  'function main() {\n',
  '  // v1 entry\n',
  '  // release: v1\n',
  '  return 1;\n',
  '  // done\n',
  '}\n',
].join('');

export const V2_TEXT = [
  'function main() {\n',
  '  // v1 entry\n',
  '  // release: v1\n',
  '  // helpers loaded\n',
  '  init();\n',
  '  // metric: ok\n',
  '  // trace off\n',
  '  runSafe();\n',
  '  return 1;\n',
  '  // done\n',
  '}\n',
].join('');

export const V1_BACKPORT_TEXT = [
  'function main() {\n',
  '  // v1 entry\n',
  '  // release: v1\n',
  '  // helpers loaded\n',
  '  init();\n',
  '  runSafe();\n',
  '  return 1;\n',
  '  // done\n',
  '}\n',
].join('');
