/**
 * Demo: backport move 10 into an older stream.
 * Run: node m3/demo.mjs
 *
 * Nothing here is the M1 CLI. It is the M3 reference model from
 * docs/kawanagare-m3-spec-v4.md.
 */

import { assemble, carry, inspect, movesOn, pull, restore } from './engine.mjs';
import { makeDemoRepo, V1_BACKPORT_TEXT, V1_TEXT, V2_TEXT } from './fixture.mjs';

function banner(title) {
  console.log(`\n${'='.repeat(64)}\n${title}\n${'='.repeat(64)}`);
}

function show(label, view) {
  console.log(`\n--- ${label} ---`);
  console.log(view.text || '(empty)');
  console.log('lines:', view.lines.join(', ') || '(none)');
  if (view.snags.length === 0) console.log('snags: (none)');
  else {
    console.log('snags:');
    for (const snag of view.snags) {
      console.log(`  kind ${snag.kind} ${snag.code}: ${snag.detail}`);
    }
  }
}

function fail(message) {
  console.error(`\nDemo check failed: ${message}`);
  process.exit(1);
}

const repo = makeDemoRepo();
const v1Before = movesOn(repo, 'v1').slice();

banner('1. Stream v1, moves 1..5');
console.log('moves:', v1Before.join(', '));
const v1 = assemble(repo, { stream: 'v1', path: 'main.js' });
show('v1', v1);
if (v1.text !== V1_TEXT) fail('v1 text');
if (v1.snags.length !== 0) fail('v1 snags');

banner('2. Stream v2, fork of v1 plus moves 6..10');
console.log('moves:', movesOn(repo, 'v2').join(', '));
console.log('Move 10 replaces run() with runSafe() and needs move 7.');
console.log('Move 7 anchors on move 6, so the need is transitive: 10 → 7 → 6.');
const v2 = assemble(repo, { stream: 'v2', path: 'main.js' });
show('v2', v2);
if (v2.text !== V2_TEXT) fail('v2 text');
if (!v2.text.includes('runSafe();')) fail('v2 missing fix');

banner('3. assemble preview of v1 plus move 10 (no stream is edited)');
const previewMoves = v1Before.concat(['10']);
const preview = assemble(repo, { moves: previewMoves, path: 'main.js' });
show(`preview moves=[${previewMoves.join(',')}]`, preview);
if (!preview.text.includes('runSafe();')) fail('preview text');
if (!preview.snags.some((snag) => snag.kind === 4 && snag.need === '7')) fail('preview snag');
if (movesOn(repo, 'v1').join(',') !== v1Before.join(',')) fail('assemble mutated v1');
console.log('\nBest-effort text is shown next to the snags. The fix renders, and so does the missing need.');

banner('4. carry move 10 into v1 without with-needs — refused');
const refused = carry(repo, 'v1', '10');
console.log(refused.message);
console.log('proposed group:', refused.proposed.join(', '));
if (!refused.refused) fail('carry should refuse');
if (refused.proposed.join(',') !== '6,7,10') fail(`group was ${refused.proposed}`);
if (movesOn(repo, 'v1').join(',') !== '1,2,3,4,5') fail('refusal changed v1');

banner('5. carry move 10 with the needs group (one flow-log event)');
const carried = carry(repo, 'v1', '10', { withNeeds: true });
console.log(carried.message);
console.log('event moves:', carried.event.moves.join(', '), 'group:', carried.group);
if (!carried.ok) fail('with-needs carry');
if (carried.added.join(',') !== '6,7,10') fail('added group');
const backported = inspect(repo, 'v1');
show('v1 after backport', { text: backported.files[0].bytes, lines: backported.files[0].lineIds, snags: backported.snags });
if (backported.files[0].bytes !== V1_BACKPORT_TEXT) fail('backport text');
if (backported.snags.length !== 0) fail('backport snags');

banner('6. pull move 10 from v2, then restore it');
const beforePull = inspect(repo, 'v2').files[0].bytes;
if (!beforePull.includes('runSafe();')) fail('v2 before pull');
console.log(pull(repo, 'v2', '10').message);
const pulled = inspect(repo, 'v2').files[0].bytes;
console.log('run() visible again?', pulled.includes('  run();\n'));
if (!pulled.includes('  run();\n') || pulled.includes('runSafe()')) fail('pull did not restore the bug');
console.log(restore(repo, 'v2', '10').message);
const restored = inspect(repo, 'v2').files[0].bytes;
console.log('runSafe() back?', restored.includes('runSafe();'));
if (!restored.includes('runSafe();')) fail('restore');

banner('Same Move-Id in both streams');
console.log('v1 moves:', movesOn(repo, 'v1').join(', '));
console.log('v2 moves:', movesOn(repo, 'v2').join(', '));
console.log('script count for id 10:', Object.keys(repo.scripts).filter((id) => id === '10').length);
console.log('\nA git cherry-pick would mint a new commit and a new SHA.');
console.log('Move 10 is still move 10 on v1 and on v2.');
