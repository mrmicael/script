// Balancing simulation: a bot plays from a fresh save and we log when each
// milestone happens. `npm run sim -- --style=casual --minutes=120 --seed=3`
import { BIOMES, GROUND_ROW, METERS_PER_TILE, type UpgradeId } from '../../src/core/balance';
import { ARTIFACTS } from '../../src/core/content';
import { Bot, BOT_STYLES } from '../../src/sim/bot';
import { Game } from '../../src/sim/game';
import { newProfile } from '../../src/sim/profile';

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const style = arg('style', 'careful');
const minutes = Number(arg('minutes', '60'));
const seed = Number(arg('seed', '12345'));
const verbose = process.argv.includes('--v');

const game = new Game(newProfile(seed));
const bot = new Bot(game, BOT_STYLES[style], seed);
const dt = 1 / 30;
let t = 0;
let runStart = 0;
const log = (s: string) => console.log(`${(t / 60).toFixed(1).padStart(6)}m  ${s}`);
let stuckWatch = 0;
let lastX = 0, lastY = 0;
const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en');
const runs: { kind: string; total: number; depth: number; time: number }[] = [];
const bought: Record<string, number> = {};

while (t < minutes * 60) {
  if (game.mode === 'surface' && !game.exp) {
    const b = bot.shop();
    for (const id of b) {
      bought[id] = (bought[id] ?? 0) + 1;
      log(`buy ${id} -> L${game.level[id as UpgradeId]}  (money left ${fmt(game.profile.money)})`);
    }
    const from = bot.launchChoice();
    if (from > 0 && game.depth < 1) game.descendTo(from);
    runStart = t;
  }
  const inp = bot.input(dt);
  game.update(dt, inp);
  t += dt;
  for (const e of game.events) {
    if (e.t === 'banked') {
      runs.push({ kind: e.haul.kind, total: e.haul.total, depth: e.haul.depth, time: e.haul.time });
      if (verbose || e.haul.kind !== 'escape' && e.haul.kind !== 'lift') log(`${e.haul.kind.padEnd(8)} ${fmt(e.haul.total).padStart(9)}  depth ${Math.round(e.haul.depth * METERS_PER_TILE)}m  ${e.haul.time.toFixed(0)}s  lost ${fmt(e.haul.lostValue)}`);
    } else if (e.t === 'biome' && e.first) log(`** reached ${BIOMES[e.biome].id}`);
    else if (e.t === 'waystation') log(`** waystation ${BIOMES[e.biome].id}`);
    else if (e.t === 'pickup' && e.kind === 'artifact') log(`** artifact ${ARTIFACTS[e.artifact!].key}`);
    else if (e.t === 'landmark') log(`** landmark ${e.key}`);
    else if (e.t === 'ending') log(`*** ENDING`);
  }
  game.events.length = 0;
  // stuck detector
  if (Math.abs(game.pod.x - lastX) + Math.abs(game.pod.y - lastY) < 0.01 && !game.drill && game.mode === 'expedition') stuckWatch += dt;
  else stuckWatch = 0;
  lastX = game.pod.x;
  lastY = game.pod.y;
  if (stuckWatch > 20) {
    log(`STUCK at ${game.pod.x.toFixed(2)},${(game.pod.y - GROUND_ROW).toFixed(2)} grounded=${game.pod.grounded}`);
    stuckWatch = -1e9;
  }
}
void runStart;
const byKind: Record<string, number> = {};
for (const r of runs) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
console.log('\nruns', runs.length, byKind, 'money', fmt(game.profile.money), 'earned', fmt(game.profile.stats.earned), 'deepest', Math.round(game.profile.stats.deepest * METERS_PER_TILE) + 'm');
console.log('levels', JSON.stringify(game.level));
const first10 = runs.slice(0, 12).map((r) => `${r.kind[0]}${fmt(r.total)}/${Math.round(r.time)}s/${Math.round(r.depth*2)}m`).join(' ');
console.log('first runs', first10);
