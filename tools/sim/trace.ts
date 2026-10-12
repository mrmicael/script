import { GROUND_ROW } from '../../src/core/balance';
import { Bot, BOT_STYLES } from '../../src/sim/bot';
import { Game } from '../../src/sim/game';
import { newProfile } from '../../src/sim/profile';
const game = new Game(newProfile(12345));
const bot = new Bot(game, BOT_STYLES.careful, 12345);
const dt = 1 / 30;
let t = 0; let zero = 0; let next = 0; let tracing = false;
while (t < 60 * 20) {
  if (game.mode === 'surface' && !game.exp) { bot.shop(); const f = bot.launchChoice(); if (f > 0 && game.depth < 1) game.descendTo(f); }
  const inp = bot.input(dt);
  game.update(dt, inp);
  t += dt;
  for (const e of game.events) if (e.t === 'banked') { if (e.haul.total === 0) zero++; if (zero >= 1) tracing = true; if (zero>=2) process.exit(0); console.log('BANK', e.haul.total, e.haul.kind); }
  game.events.length = 0;
  if (tracing && t > next) { next = t + 1; const b = bot as any; const W=48; const cx=Math.floor(game.pod.x), cy=Math.floor(game.pod.y);
    let around=''; for (let y=cy-2;y<=cy+2;y++){ for(let x=cx-3;x<=cx+3;x++) around += (x===cx&&y===cy)?'@':(game.world.solid(x,y)?'#':'.'); around+='|'; }
    console.log(t.toFixed(1), game.mode, 'pos', game.pod.x.toFixed(2), (game.pod.y-GROUND_ROW).toFixed(2), 'g', game.pod.grounded, 'vy', game.pod.vy.toFixed(2), 'heat', game.heat.toFixed(0), b.goal, 'path', b.path.slice(0,3).map((i:number)=>`${i%W},${Math.floor(i/W)-GROUND_ROW}`).join(' '), JSON.stringify(inp), around); }
}
