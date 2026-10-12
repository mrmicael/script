// An autopilot that plays through the same Input a player uses. It plans on
// the grid (drill time for rock, travel time for open cells), steers the pod
// cell by cell, and decides when to go home from the heat estimate. Used by
// the balancing simulation in Node and by ?bot in the browser for QA.

import { BIOME_TIER, GROUND_ROW, UPGRADE_ORDER, drillTier, type UpgradeId } from '../core/balance';
import { M, MATERIALS, ORES } from '../core/materials';
import type { Game, Input } from './game';
import { MinHeap } from './heap';

export interface BotStyle {
  /** multiple of the escape estimate kept as margin before turning home */
  caution: number;
  /** extra seconds of reaction time when heading home */
  lateness: number;
  /** probability per second of wandering instead of planning (casual players) */
  wander: number;
  /** how far it looks for ore */
  sight: number;
}

export const BOT_STYLES: Record<string, BotStyle> = {
  careful: { caution: 1.6, lateness: 0, wander: 0, sight: 9 },
  casual: { caution: 1.25, lateness: 1.5, wander: 0.05, sight: 6 },
  greedy: { caution: 1.05, lateness: 2.5, wander: 0, sight: 10 },
};

type Goal = 'mine' | 'home';

const NEIGH: [number, number][] = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
];

export class Bot {
  private path: number[] = [];
  private goal: Goal = 'mine';
  private replanT = 0;
  private stuckT = 0;
  private lastCell = -1;
  private rand: () => number;
  private wanderDir = 0;
  private wanderT = 0;
  /** ore cell the bot has committed to, and when */
  private target = -1;
  private targetT = 0;
  private expRef: object | null = null;
  /** upgrades in the order this bot wants them */
  priority: UpgradeId[] = ['cargo', 'drill', 'cooling', 'hull', 'engine', 'drill', 'cargo', 'hull', 'cooling', 'engine', 'scanner'];

  constructor(
    private game: Game,
    readonly style: BotStyle = BOT_STYLES.careful,
    seed = 7,
  ) {
    let s = seed >>> 0;
    this.rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /** spend money at the surface; returns what was bought */
  shop(): UpgradeId[] {
    const g = this.game;
    const bought: UpgradeId[] = [];
    for (let guard = 0; guard < 20; guard++) {
      // cheapest useful upgrade: keep levels roughly even, drill first when it gates the next biome
      let best: UpgradeId | null = null;
      let bestScore = Infinity;
      for (const id of UPGRADE_ORDER) {
        const cost = g.upgradeCost(id);
        if (cost === null) continue;
        let score = cost * (1 + g.level[id] * 0.15);
        if (id === 'scanner') score *= 2.5;
        if (id === 'recall') score *= 4;
        if (id === 'drill' && this.drillGated()) score *= 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = id;
        }
      }
      if (!best) break;
      if (!g.buy(best)) break;
      bought.push(best);
    }
    return bought;
  }

  private drillGated(): boolean {
    const g = this.game;
    const b = Math.max(...g.profile.biomesSeen);
    const need = BIOME_TIER[Math.min(5, b + 1)];
    return drillTier(g.level.drill) < need;
  }

  /** deepest waystation worth starting from */
  launchChoice(): number {
    const g = this.game;
    const ok = g.profile.waystations.filter((b) => drillTier(g.level.drill) >= BIOME_TIER[b]);
    return ok.length ? Math.max(...ok) : 0;
  }

  input(dt: number): Input {
    const g = this.game;
    const none: Input = { x: 0, up: false, down: false };
    if (g.mode !== 'expedition' && g.mode !== 'surface') return none;
    const cell = this.cell();
    if (cell === this.lastCell && !g.drill) this.stuckT += dt;
    else this.stuckT = 0;
    this.lastCell = cell;

    if (g.exp && g.exp !== this.expRef) {
      // a new expedition: back to mining
      this.expRef = g.exp;
      this.goal = 'mine';
      this.path = [];
      this.target = -1;
    }
    if (g.mode === 'expedition') {
      if (g.padBiome >= 0 && this.goal === 'home') {
        g.rideLiftUp();
        return none;
      }
      const est = g.escapeEstimate();
      const full = g.cargoCount >= g.capacity;
      const margin = est.heat * this.style.caution + 6 + this.style.lateness * 2;
      if (this.goal === 'mine' && (g.heat + margin >= g.maxHeat || full)) {
        this.goal = 'home';
        this.path = [];
      }
      if (g.heat > g.maxHeat * 0.97 && g.canRecall && this.goal === 'home') g.recall();
    } else {
      this.goal = 'mine';
    }

    this.replanT -= dt;
    if (this.stuckT > 1.2) {
      this.path = [];
      this.stuckT = 0;
      this.wanderDir = this.rand() < 0.5 ? -1 : 1;
      this.wanderT = 0.4;
    }
    if (this.wanderT > 0) {
      this.wanderT -= dt;
      return { x: this.wanderDir, up: this.rand() < 0.5, down: false };
    }
    if (this.style.wander > 0 && this.rand() < this.style.wander * dt) {
      this.wanderDir = this.rand() < 0.5 ? -1 : 1;
      this.wanderT = 0.3 + this.rand() * 0.5;
    }
    if (!this.path.length || this.replanT <= 0) {
      this.plan();
      this.replanT = 0.8;
    }
    while (this.path.length && this.path[0] === cell) this.path.shift();
    if (!this.path.length) return { x: 0, up: false, down: true };
    return this.steer(this.path[0]);
  }

  private cell(): number {
    const p = this.game.pod;
    return Math.floor(p.y) * this.game.world.w + Math.floor(p.x);
  }

  private cost(i: number, from: number): number {
    const g = this.game;
    const w = g.world;
    const m = w.mat[i];
    const md = MATERIALS[m];
    const up = i < from - 1;
    let t = up ? 1 / g.climb : i > from + 1 ? 0.12 : 1 / g.moveSpeed;
    if (md.liquid === 'lava') t += 3;
    if (md.solid) {
      if (md.tier > g.tier || !Number.isFinite(md.hardness) || m === M.PAD) return Infinity;
      t += Math.max(0.11, (md.hardness + ORES[w.ore[i]].hardness) / g.drillPower) * (up ? 1.25 : 1) * (this.goal === 'home' ? 3 : 1);
      if (m === M.VENT || m === M.MAGMA_ROCK || m === M.BLAST) t += 4;
    }
    return t;
  }

  private plan(): void {
    const g = this.game;
    const w = g.world;
    const W = w.w;
    const start = this.cell();
    const sx = start % W;
    const sy = Math.floor(start / W);
    const sight = this.style.sight;
    const R = this.goal === 'home' ? 400 : 14;
    const dist = new Map<number, number>();
    const prev = new Map<number, number>();
    const heap = new MinHeap();
    heap.push(0, start);
    dist.set(start, 0);
    let best = -1;
    let bestScore = -Infinity;
    // keep chasing the same ore until it is mined, so the plan does not flip-flop
    const keep = this.goal === 'mine' && this.target >= 0 && w.ore[this.target] && MATERIALS[w.mat[this.target]].solid && g.time - this.targetT < 10 ? this.target : -1;
    const ws = g.profile.waystations.map((b) => w.waystations.find((s) => s.biome === b)!).filter(Boolean);
    while (heap.size) {
      const [d, i] = heap.pop();
      if (d > (dist.get(i) ?? Infinity)) continue;
      const x = i % W;
      const y = Math.floor(i / W);
      if (this.goal === 'home') {
        if (y < GROUND_ROW || ws.some((s) => s.y === y && (s.x === x || s.x + 1 === x))) {
          best = i;
          break;
        }
      } else if (keep >= 0) {
        if (i === keep) {
          best = i;
          break;
        }
      } else if (Math.abs(x - sx) <= sight && Math.abs(y - sy) <= sight) {
        const ore = w.ore[i];
        if (ore && i !== start && MATERIALS[w.mat[i]].solid) {
          const od = ORES[ore];
          const v = od.cools ? (g.heat > g.maxHeat * 0.4 ? 200 : 0) : od.value * (g.cargoCount >= g.capacity ? 0 : 1);
          const score = v / (d + 1.5);
          if (v > 0 && score > bestScore) {
            bestScore = score;
            best = i;
          }
        }
      }
      if (Math.abs(x - sx) > R || Math.abs(y - sy) > R) continue;
      for (const [dx, dy] of NEIGH) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || nx >= W - 1 || ny < 0 || ny >= w.h - 1) continue;
        const n = ny * W + nx;
        const c = this.cost(n, i);
        if (!Number.isFinite(c)) continue;
        const nd = d + c;
        if (nd < (dist.get(n) ?? Infinity)) {
          dist.set(n, nd);
          prev.set(n, i);
          heap.push(nd, n);
        }
      }
      if (dist.size > 6000) break;
    }
    if (this.goal === 'mine' && best >= 0 && best !== keep) {
      this.target = best;
      this.targetT = g.time;
    }
    if (best < 0) {
      this.target = -1;
      // nothing in sight: dig straight down (or up when going home)
      const target = this.goal === 'home' ? start - W : start + W;
      this.path = [target];
      return;
    }
    const path: number[] = [];
    for (let c = best; c !== start && c !== undefined; c = prev.get(c)!) path.unshift(c);
    this.path = path;
  }

  private steer(target: number): Input {
    const g = this.game;
    const p = g.pod;
    const W = g.world.w;
    const tx = target % W;
    const ty = Math.floor(target / W);
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);
    const inp: Input = { x: 0, up: false, down: false };
    const centreErr = tx + 0.5 - p.x;
    if (ty > cy) {
      // down: centre, then drill or fall
      if (Math.abs(centreErr) > 0.12) inp.x = Math.sign(centreErr);
      else inp.down = true;
    } else if (ty < cy) {
      inp.up = true;
      if (Math.abs(centreErr) > 0.08) inp.x = Math.abs(centreErr) > 0.25 ? Math.sign(centreErr) : 0;
    } else {
      inp.x = Math.sign(tx - cx) || Math.sign(centreErr);
      if (!p.grounded) {
        // hover level with the row: aim the feet at the row's floor
        const restY = cy + 1 - 0.36;
        const wantVy = Math.max(-3, Math.min(2.5, (restY - p.y) * 7));
        inp.up = p.vy > wantVy;
      }
    }
    return inp;
  }
}

