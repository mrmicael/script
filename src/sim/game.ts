// The whole game rules, with no rendering: movement, drilling, heat, cargo,
// banking, lifts, recall and discoveries. Runs identically in the browser and
// in Node (balancing bots, tests). The renderer reads state and drains events.

import {
  BIOMES,
  DRILL,
  GROUND_ROW,
  HEAT,
  LIGHT_RADIUS,
  PHYSICS,
  RECALL,
  UPGRADES,
  WORLD,
  biomeIndexAt,
  climbSpeed,
  drillTier,
  type UpgradeId,
} from '../core/balance';
import { ARTIFACTS, HEART_ARTIFACT, KEYSTONES } from '../core/content';
import { M, MATERIALS, ORES, ORE_COUNT } from '../core/materials';
import { World, decodeRemoved, encodeRemoved, type Pickup } from '../core/world';
import { GEN_VERSION, generateWorld } from '../gen/generate';
import { MinHeap } from './heap';
import { newProfile, type ExpeditionSnapshot, type Profile } from './profile';

export interface Input {
  x: number;
  up: boolean;
  down: boolean;
}

export type Dir = 'down' | 'left' | 'right' | 'up';
export type Mode = 'surface' | 'expedition' | 'overheat' | 'recall' | 'liftUp' | 'liftDown';
export type HaulKind = 'escape' | 'lift' | 'recall' | 'overheat';

export interface HaulLine {
  ore: number;
  count: number;
  lost: number;
  value: number;
}

export interface Haul {
  kind: HaulKind;
  lines: HaulLine[];
  chestMoney: number;
  artifacts: number[];
  total: number;
  lostValue: number;
  depth: number;
  newRecord: boolean;
  time: number;
}

export type GameEvent =
  | { t: 'drillStart'; dir: Dir; x: number; y: number; mat: number; ore: number; dur: number }
  | { t: 'break'; x: number; y: number; mat: number; ore: number; dir: Dir }
  | { t: 'collect'; ore: number; value: number; x: number; y: number; swapped: number }
  | { t: 'cargoFull'; ore: number; x: number; y: number }
  | { t: 'cool'; amount: number; x: number; y: number }
  | { t: 'heatBurst'; amount: number; x: number; y: number; kind: 'vent' | 'magma' | 'blast' }
  | { t: 'explode'; x: number; y: number; cells: number[] }
  | { t: 'bonk'; tier: number; x: number; y: number; mat: number }
  | { t: 'land'; speed: number }
  | { t: 'expeditionStart'; fromBiome: number }
  | { t: 'heatLevel'; level: 0 | 1 | 2 | 3 }
  | { t: 'overheat' }
  | { t: 'recallStart' }
  | { t: 'liftStart'; up: boolean }
  | { t: 'banked'; haul: Haul }
  | { t: 'pickup'; kind: Pickup['kind']; x: number; y: number; value: number; artifact?: number }
  | { t: 'biome'; biome: number; first: boolean }
  | { t: 'landmark'; key: string }
  | { t: 'waystation'; biome: number }
  | { t: 'depthRecord'; depth: number }
  | { t: 'splash'; liquid: 'water' | 'lava' }
  | { t: 'doorOpen' }
  | { t: 'ending' };

export interface Pod {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: Dir;
  thrusting: boolean;
  liquid: 'water' | 'lava' | null;
}

interface DrillJob {
  dir: Dir;
  tx: number;
  ty: number;
  t: number;
  dur: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
}

interface Expedition {
  cargo: number[];
  chestMoney: number;
  artifacts: number[];
  maxDepth: number;
  startDepth: number;
  tiles: number;
  time: number;
}

const newExpedition = (startDepth: number): Expedition => ({ cargo: new Array(ORE_COUNT).fill(0), chestMoney: 0, artifacts: [], maxDepth: startDepth, startDepth, tiles: 0, time: 0 });

const { podW: PW, podH: PH } = PHYSICS;
const EPS = 1e-4;

export class Game {
  world: World;
  profile: Profile;
  pod: Pod;
  /** position at the previous fixed step, for render interpolation */
  prevX = 0;
  prevY = 0;
  heat = 0;
  mode: Mode = 'surface';
  drill: DrillJob | null = null;
  exp: Expedition | null = null;
  /** seconds into the current overheat / recall / lift sequence */
  modeT = 0;
  liftBiome = 0;
  events: GameEvent[] = [];
  /** fixed-step accumulator remainder, 0..1 of a step (render interpolation) */
  alpha = 0;
  time = 0;
  private acc = 0;
  private bonkCooldown = 0;
  private heatLevel: 0 | 1 | 2 | 3 = 0;
  private lastBiome = 0;
  /** waystation pad the pod is standing on, if any */
  padBiome = -1;
  /** set when something worth saving happened */
  dirtySave = false;

  constructor(profile?: Profile) {
    this.profile = profile ?? newProfile();
    if (this.profile.gen !== GEN_VERSION) this.resetWorldProgress();
    this.world = generateWorld(this.profile.seed);
    this.applyProfileToWorld();
    this.pod = { x: WORLD.spawnX + 0.5, y: GROUND_ROW - PH / 2, vx: 0, vy: 0, grounded: true, facing: 'down', thrusting: false, liquid: null };
    const snap = this.profile.expedition;
    if (snap) this.restoreExpedition(snap);
    this.prevX = this.pod.x;
    this.prevY = this.pod.y;
    this.lastBiome = biomeIndexAt(this.depth);
  }

  // ---------------------------------------------------------------- queries
  get depth(): number {
    return Math.max(0, this.pod.y - GROUND_ROW);
  }
  get level(): Record<UpgradeId, number> {
    return this.profile.upgrades;
  }
  get maxHeat(): number {
    return UPGRADES.hull.values[this.level.hull];
  }
  get coolMult(): number {
    return UPGRADES.cooling.values[this.level.cooling];
  }
  get drillPower(): number {
    return UPGRADES.drill.values[this.level.drill];
  }
  get tier(): number {
    return drillTier(this.level.drill);
  }
  get moveSpeed(): number {
    return UPGRADES.engine.values[this.level.engine];
  }
  get climb(): number {
    return climbSpeed(this.level.engine);
  }
  get capacity(): number {
    return UPGRADES.cargo.values[this.level.cargo];
  }
  get scanRadius(): number {
    return UPGRADES.scanner.values[this.level.scanner];
  }
  get recallKeep(): number {
    return UPGRADES.recall.values[this.level.recall];
  }
  get cargoCount(): number {
    return this.exp ? this.exp.cargo.reduce((a, b) => a + b, 0) : 0;
  }
  get cargoValue(): number {
    if (!this.exp) return 0;
    let v = this.exp.chestMoney;
    this.exp.cargo.forEach((n, ore) => (v += n * ORES[ore].value));
    for (const a of this.exp.artifacts) v += ARTIFACTS[a].value;
    return v;
  }
  get heatFrac(): number {
    return Math.min(1, this.heat / this.maxHeat);
  }
  get underground(): boolean {
    return this.mode === 'expedition' || this.mode === 'recall' || this.mode === 'overheat';
  }
  biomeAt(depth = this.depth): number {
    return biomeIndexAt(depth);
  }
  /** can the emergency recall be used right now */
  get canRecall(): boolean {
    return this.mode === 'expedition' && this.recallKeep > 0 && !this.drill;
  }

  /**
   * Heat the trip to the nearest exit would add, along the open tunnels the
   * pod can actually fly through (the way it came in is always open). Shown
   * on the heat bar so the player can judge "one more tile or go home".
   */
  escapeEstimate(): { heat: number; exit: number; seconds: number } {
    const cell = Math.floor(this.pod.y) * this.world.w + Math.floor(this.pod.x);
    if (this.escCache && this.escCache.cell === cell && this.escCache.rev === this.worldRev && this.time - this.escCache.at < 0.5) return this.escCache.value;
    const value = this.computeEscape(cell);
    this.escCache = { cell, rev: this.worldRev, at: this.time, value };
    return value;
  }

  private escCache: { cell: number; rev: number; at: number; value: { heat: number; exit: number; seconds: number } } | null = null;
  /** bumps whenever a cell changes, so cached routes are recomputed */
  worldRev = 0;

  private computeEscape(start: number): { heat: number; exit: number; seconds: number } {
    const w = this.world;
    const W = w.w;
    const n = w.mat.length;
    const cool = this.coolMult;
    const up = 1 / this.climb;
    const side = 1 / this.moveSpeed;
    const down = 1 / 9;
    const pads = new Map<number, number>();
    for (const b of this.profile.waystations) {
      const ws = w.waystations.find((s) => s.biome === b);
      if (ws) {
        pads.set(ws.y * W + ws.x, b);
        pads.set(ws.y * W + ws.x + 1, b);
      }
    }
    const dist = this.escDist && this.escDist.length === n ? this.escDist : (this.escDist = new Float64Array(n));
    dist.fill(Infinity);
    const heap = new MinHeap();
    dist[start] = 0;
    heap.push(0, start);
    let found = -1;
    let exit = 0;
    while (heap.size) {
      const [d, i] = heap.pop();
      if (d > dist[i]) continue;
      const y = (i / W) | 0;
      if (y < GROUND_ROW) {
        found = i;
        break;
      }
      const pad = pads.get(i);
      if (pad !== undefined) {
        found = i;
        exit = pad;
        break;
      }
      const rate = (HEAT.ambient(y - GROUND_ROW) + HEAT.thrustPerSec) * cool;
      const x = i - y * W;
      for (let k = 0; k < 4; k++) {
        const nx = k === 0 ? x - 1 : k === 1 ? x + 1 : x;
        const ny = k === 2 ? y - 1 : k === 3 ? y + 1 : y;
        if (nx < 0 || nx >= W || ny < 0 || ny >= w.h) continue;
        const j = ny * W + nx;
        const m = w.mat[j];
        const md = MATERIALS[m];
        if (md.solid) continue;
        const t = k === 2 ? up : k === 3 ? down : side;
        let cost = t * rate;
        if (md.liquid === 'lava') cost += HEAT.lavaHeat * cool * t * 2;
        const nd = d + cost;
        if (nd < dist[j]) {
          dist[j] = nd;
          heap.push(nd, j);
        }
      }
    }
    if (found < 0) {
      // sealed in (should not happen): fall back to a straight climb
      const dy = this.depth;
      const seconds = dy * up;
      return { heat: seconds * (HEAT.ambient(dy / 2) + HEAT.thrustPerSec) * cool, exit: 0, seconds };
    }
    const heat = dist[found] * 1.1 + 1;
    return { heat, exit, seconds: heat / Math.max(0.1, (HEAT.ambient(this.depth) + HEAT.thrustPerSec) * cool) };
  }

  private escDist: Float64Array | null = null;

  // ---------------------------------------------------------------- loop
  /** advance by real seconds; runs fixed steps, never more than a quarter second of catch-up */
  update(dt: number, input: Input): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.acc += Math.min(dt, 0.25);
    const h = PHYSICS.step;
    while (this.acc >= h) {
      this.acc -= h;
      this.prevX = this.pod.x;
      this.prevY = this.pod.y;
      this.fixedStep(h, input);
    }
    this.alpha = this.acc / h;
  }

  fixedStep(h: number, input: Input): void {
    this.time += h;
    this.profile.stats.playSec += h;
    this.bonkCooldown = Math.max(0, this.bonkCooldown - h);
    switch (this.mode) {
      case 'overheat':
        this.modeT += h;
        this.pod.vx = 0;
        this.pod.vy = 0;
        if (this.modeT >= HEAT.breakdownTime + HEAT.towTime) this.finishExpedition('overheat', HEAT.overheatKeep);
        return;
      case 'recall':
        this.modeT += h;
        this.pod.vx *= 0.8;
        this.addHeat(HEAT.ambient(this.depth) * this.coolMult * h);
        if (this.mode !== 'recall') return;
        if (this.modeT >= RECALL.channel + RECALL.pullTime) this.finishExpedition('recall', this.recallKeep);
        return;
      case 'liftUp':
        this.modeT += h;
        if (this.modeT >= 1.6) this.finishExpedition('lift', 1);
        return;
      case 'liftDown':
        this.modeT += h;
        if (this.modeT >= 1.6) this.arriveAtWaystation();
        return;
    }
    if (this.drill) this.stepDrill(h);
    else this.stepMove(h, input);
    if (!this.drill) this.tryStartDrill(input);
    this.stepWorldState(h, input);
  }

  // ---------------------------------------------------------------- movement
  private stepMove(h: number, input: Input): void {
    const p = this.pod;
    const liquid = this.liquidAt(p.x, p.y);
    if (liquid !== p.liquid) {
      if (liquid) this.events.push({ t: 'splash', liquid });
      p.liquid = liquid;
    }
    const target = input.x * this.moveSpeed * (liquid ? 0.7 : 1);
    const accel = p.grounded ? PHYSICS.groundAccel : PHYSICS.airAccel;
    if (input.x !== 0) {
      if (input.x === 1) p.facing = 'right';
      else p.facing = 'left';
      const dv = target - p.vx;
      // turning around is instant-ish: braking uses the friction budget too
      const a = Math.sign(dv) !== Math.sign(p.vx) && p.vx !== 0 ? accel + PHYSICS.groundFriction : accel;
      p.vx += Math.sign(dv) * Math.min(Math.abs(dv), a * h);
    } else {
      const f = p.grounded ? PHYSICS.groundFriction : PHYSICS.airDrag;
      p.vx -= Math.sign(p.vx) * Math.min(Math.abs(p.vx), f * h);
    }
    if (input.down && !input.up && p.grounded && input.x === 0) p.facing = 'down';

    p.thrusting = input.up;
    if (input.up) {
      p.vy -= PHYSICS.thrust * h;
      if (p.vy < -this.climb) p.vy = -this.climb;
      if (p.grounded) p.facing = input.x === 0 ? 'up' : p.facing;
    }
    p.vy += PHYSICS.gravity * h;
    if (liquid) {
      const drag = liquid === 'water' ? PHYSICS.waterDrag : PHYSICS.lavaDrag;
      p.vy -= p.vy * Math.min(1, drag * h);
      p.vx -= p.vx * Math.min(1, drag * 0.4 * h);
    }
    if (p.vy > PHYSICS.maxFall) p.vy = PHYSICS.maxFall;

    // x axis
    if (p.vx !== 0) {
      const nx = p.x + p.vx * h;
      const blocked = this.sweepX(nx, input.x);
      if (blocked) p.vx = 0;
    }
    // y axis
    const wasGrounded = p.grounded;
    const fallSpeed = p.vy;
    p.grounded = false;
    if (p.vy !== 0) {
      const ny = p.y + p.vy * h;
      const hit = this.sweepY(ny, input);
      if (hit === 1) {
        p.grounded = true;
        if (!wasGrounded && fallSpeed > 6) this.events.push({ t: 'land', speed: fallSpeed });
        p.vy = 0;
      } else if (hit === -1) {
        if (p.vy < 0) p.vy = 0;
      }
    }
    if (!p.grounded && p.vy >= 0 && this.boxBlocked(p.x, p.y + 0.02)) p.grounded = true;
  }

  /** move to nx unless blocked; returns true when stopped by a wall */
  private sweepX(nx: number, dirInput: number): boolean {
    const p = this.pod;
    if (!this.boxBlocked(nx, p.y)) {
      p.x = nx;
      return false;
    }
    // ledge assist: a small lip at the feet or the head slides the pod into the gap
    if (dirInput !== 0) {
      for (const dy of [-PHYSICS.ledgeAssist, PHYSICS.ledgeAssist]) {
        const ty = dy < 0 ? Math.floor(p.y + PH / 2) - PH / 2 - EPS : Math.ceil(p.y - PH / 2) + PH / 2 + EPS;
        if (Math.abs(ty - p.y) <= Math.abs(dy) && !this.boxBlocked(p.x, ty) && !this.boxBlocked(nx, ty)) {
          p.y = ty;
          p.x = nx;
          return false;
        }
      }
    }
    // stop flush against the wall
    if (nx > p.x) p.x = Math.floor(nx + PW / 2) - PW / 2 - EPS;
    else p.x = Math.ceil(nx - PW / 2) + PW / 2 + EPS;
    if (this.boxBlocked(p.x, p.y)) p.x = Math.round((p.x - 0.5) * 1) + 0.5; // fall back to the cell centre
    return true;
  }

  /** returns 1 landed on floor, -1 hit ceiling, 0 free */
  private sweepY(ny: number, input: Input): number {
    const p = this.pod;
    if (!this.boxBlocked(p.x, ny)) {
      p.y = ny;
      return 0;
    }
    const goingDown = ny > p.y;
    // shaft assist: grazing the edge of a hole slides the pod into it
    const col = Math.floor(p.x);
    const centre = col + 0.5;
    const off = p.x - centre;
    if (Math.abs(off) > 0.02 && Math.abs(off) <= PHYSICS.shaftAssist + 0.11 && input.x === 0 && !this.boxBlocked(centre, ny) && !this.boxBlocked(centre, p.y)) {
      p.x += Math.sign(-off) * Math.min(Math.abs(off), 3 * PHYSICS.step);
      if (!this.boxBlocked(p.x, ny)) {
        p.y = ny;
        return 0;
      }
    }
    if (goingDown) p.y = Math.floor(ny + PH / 2) - PH / 2 - EPS;
    else p.y = Math.ceil(ny - PH / 2) + PH / 2 + EPS;
    return goingDown ? 1 : -1;
  }

  /** does a pod-sized box at (x,y) overlap a solid cell */
  boxBlocked(x: number, y: number): boolean {
    const x0 = Math.floor(x - PW / 2);
    const x1 = Math.floor(x + PW / 2 - EPS * 0.5);
    const y0 = Math.floor(y - PH / 2);
    const y1 = Math.floor(y + PH / 2 - EPS * 0.5);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (this.world.solid(cx, cy)) return true;
    return false;
  }

  private liquidAt(x: number, y: number): 'water' | 'lava' | null {
    return MATERIALS[this.world.get(Math.floor(x), Math.floor(y))].liquid;
  }

  // ---------------------------------------------------------------- drilling
  private tryStartDrill(input: Input): void {
    if (this.mode !== 'expedition' && this.mode !== 'surface') return;
    const p = this.pod;
    const col = Math.floor(p.x);
    const row = Math.floor(p.y);
    let dir: Dir | null = null;
    let tx = 0;
    let ty = 0;
    if (input.down && !input.up && p.grounded && input.x === 0) {
      dir = 'down';
      tx = col;
      ty = Math.floor(p.y + PH / 2 + 0.05);
    } else if (input.x !== 0 && !input.up && (p.grounded || Math.abs(p.vy) < 3.2)) {
      const edge = input.x > 0 ? p.x + PW / 2 : p.x - PW / 2;
      const cellX = input.x > 0 ? Math.floor(edge + 0.05) : Math.floor(edge - 0.05);
      // only when flush against the wall and level with the target row
      if (Math.abs(edge - (input.x > 0 ? cellX : cellX + 1)) < 0.08) {
        dir = input.x > 0 ? 'right' : 'left';
        tx = cellX;
        ty = row;
      }
    } else if (input.up && input.x === 0 && p.vy >= -0.01 && this.boxBlocked(p.x, p.y - 0.04)) {
      dir = 'up';
      tx = col;
      ty = Math.floor(p.y - PH / 2 - 0.05);
    }
    if (!dir) return;
    const m = this.world.get(tx, ty);
    const md = MATERIALS[m];
    if (!md.solid) return;
    if (md.tier > this.tier || !Number.isFinite(md.hardness)) {
      if (this.bonkCooldown <= 0) {
        this.bonkCooldown = 0.7;
        this.events.push({ t: 'bonk', tier: md.tier, x: tx, y: ty, mat: m });
      }
      return;
    }
    // sideways the pod must actually be resting at that row
    const ore = this.world.oreAt(tx, ty);
    let dur = Math.max(DRILL.minTime, (md.hardness + ORES[ore].hardness) / this.drillPower);
    if (dir === 'up') dur *= DRILL.upFactor;
    let ex = p.x;
    let ey = p.y;
    if (dir === 'down') {
      ex = tx + 0.5;
      ey = ty + 1 - PH / 2 - EPS;
    } else if (dir === 'up') {
      ex = tx + 0.5;
      ey = ty + PH / 2 + EPS;
    } else {
      ex = tx + 0.5;
      ey = ty + 1 - PH / 2 - EPS;
    }
    p.facing = dir;
    p.vx = 0;
    p.vy = 0;
    this.drill = { dir, tx, ty, t: 0, dur, sx: p.x, sy: p.y, ex, ey };
    this.events.push({ t: 'drillStart', dir, x: tx, y: ty, mat: m, ore, dur });
  }

  private stepDrill(h: number): void {
    const d = this.drill!;
    const p = this.pod;
    d.t += h;
    const k = Math.min(1, d.t / d.dur);
    // the pod eats into the tile: first settle onto the axis, then push in
    const align = Math.min(1, k * 3);
    const push = k < 0.25 ? 0 : (k - 0.25) / 0.75;
    if (d.dir === 'down' || d.dir === 'up') {
      p.x = d.sx + (d.ex - d.sx) * align;
      p.y = d.sy + (d.ey - d.sy) * push * 0.55;
    } else {
      p.y = d.sy + (d.ey - d.sy) * align;
      p.x = d.sx + (d.ex - d.sx) * push * 0.45;
    }
    if (k < 1) return;
    this.drill = null;
    this.breakTile(d.tx, d.ty, d.dir);
    // finish the move into the freed cell (the cell is air now)
    if (!this.boxBlocked(d.ex, d.ey)) {
      p.x = d.ex;
      p.y = d.ey;
    }
    p.vx = 0;
    p.vy = 0;
  }

  /** a tile is destroyed by the drill or a blast */
  breakTile(x: number, y: number, dir: Dir = 'down', fromBlast = false): void {
    const m = this.world.get(x, y) as M;
    const md = MATERIALS[m];
    if (!md.solid || !Number.isFinite(md.hardness)) return;
    const ore = this.world.oreAt(x, y);
    this.world.clear(x, y);
    this.worldRev++;
    this.dirtySave = true;
    if (this.exp) {
      this.exp.tiles++;
      this.profile.stats.tiles++;
    }
    this.events.push({ t: 'break', x, y, mat: m, ore, dir });
    const drillHeat = md.hardness * DRILL.heatPerHardness;
    if (md.breakHeat < 0) {
      this.coolBy(-md.breakHeat, x, y);
      this.addHeat(drillHeat * this.coolMult);
    } else {
      this.addHeat((drillHeat + (fromBlast ? 0 : md.breakHeat)) * this.coolMult);
      if (m === M.VENT || m === M.MAGMA_ROCK) this.events.push({ t: 'heatBurst', amount: md.breakHeat * this.coolMult, x, y, kind: m === M.VENT ? 'vent' : 'magma' });
    }
    if (ore) this.collectOre(ore, x, y);
    if (m === M.BLAST) this.explode(x, y);
  }

  private explode(x: number, y: number): void {
    const cells: number[] = [];
    const heat = 12;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 4.5 || (dx === 0 && dy === 0)) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (cy < GROUND_ROW) continue;
        const m = this.world.get(cx, cy);
        const md = MATERIALS[m];
        if (!md.solid || !Number.isFinite(md.hardness) || m === M.PAD) continue;
        cells.push(this.world.idx(cx, cy));
      }
    }
    this.events.push({ t: 'explode', x, y, cells });
    const near = Math.hypot(this.pod.x - (x + 0.5), this.pod.y - (y + 0.5)) < 3.2;
    if (near) {
      this.addHeat(heat * this.coolMult);
      this.events.push({ t: 'heatBurst', amount: heat * this.coolMult, x, y, kind: 'blast' });
    }
    for (const i of cells) {
      const cx = i % this.world.w;
      const cy = Math.floor(i / this.world.w);
      if (this.world.get(cx, cy) === M.AIR) continue;
      this.breakTile(cx, cy, 'down', true);
    }
  }

  private collectOre(ore: number, x: number, y: number): void {
    const od = ORES[ore];
    if (od.cools) {
      this.coolBy(od.cools, x, y);
      return;
    }
    if (!this.exp) return;
    this.profile.stats.ores++;
    if (this.cargoCount < this.capacity) {
      this.exp.cargo[ore]++;
      this.events.push({ t: 'collect', ore, value: od.value, x, y, swapped: 0 });
      return;
    }
    // full: a better ore pushes out the cheapest one
    let cheapest = -1;
    this.exp.cargo.forEach((n, o) => {
      if (n > 0 && (cheapest < 0 || ORES[o].value < ORES[cheapest].value)) cheapest = o;
    });
    if (cheapest >= 0 && ORES[cheapest].value < od.value) {
      this.exp.cargo[cheapest]--;
      this.exp.cargo[ore]++;
      this.events.push({ t: 'collect', ore, value: od.value, x, y, swapped: cheapest });
    } else this.events.push({ t: 'cargoFull', ore, x, y });
  }

  // ---------------------------------------------------------------- heat
  addHeat(amount: number): void {
    if (!Number.isFinite(amount)) return;
    if (!this.underground || this.mode === 'overheat') return;
    this.heat = Math.max(0, this.heat + amount);
    if (this.heat >= this.maxHeat) this.startOverheat();
  }

  private coolBy(amount: number, x: number, y: number): void {
    this.heat = Math.max(0, this.heat - amount);
    this.events.push({ t: 'cool', amount, x, y });
  }

  private stepWorldState(h: number, input: Input): void {
    const p = this.pod;
    const depth = this.depth;
    // expedition boundaries: diving below the grass line starts one, coming back up banks it
    if (this.mode === 'surface' && p.y - PH / 2 > GROUND_ROW + 0.05) this.startExpedition(0);
    else if (this.mode === 'expedition' && p.y + PH / 2 < GROUND_ROW - 0.1) {
      this.finishExpedition('escape', 1);
      return;
    }

    if (this.mode === 'surface') {
      this.heat = Math.max(0, this.heat - HEAT.surfaceCooling * h);
      this.updateHeatLevel();
      return;
    }
    if (this.mode !== 'expedition' || !this.exp) return;
    const e = this.exp;
    e.time += h;
    if (depth > e.maxDepth) e.maxDepth = depth;
    if (depth > this.profile.stats.deepest + 0.5) {
      const before = Math.floor(this.profile.stats.deepest / 10);
      this.profile.stats.deepest = depth;
      if (Math.floor(depth / 10) > before && depth > 12) this.events.push({ t: 'depthRecord', depth: Math.floor(depth) });
    }

    let rate = HEAT.ambient(depth);
    if (p.thrusting) rate += HEAT.thrustPerSec;
    rate *= this.coolMult;
    if (p.liquid === 'lava') rate += HEAT.lavaHeat * this.coolMult;
    this.addHeat(rate * h);
    if (p.liquid === 'water' && this.heat > 0) this.heat = Math.max(0, this.heat - HEAT.waterCooling * h);
    this.updateHeatLevel();

    // biome entry
    const b = this.biomeAt(depth);
    if (b !== this.lastBiome) {
      const first = !this.profile.biomesSeen.includes(b);
      if (first) this.profile.biomesSeen.push(b);
      if (b > this.lastBiome) this.events.push({ t: 'biome', biome: b, first });
      this.lastBiome = b;
      this.dirtySave = true;
    }

    this.checkPickups();
    this.checkDiscoveries();
    void input;
  }

  private updateHeatLevel(): void {
    const f = this.heatFrac;
    const lvl: 0 | 1 | 2 | 3 = f >= HEAT.critical ? 3 : f >= HEAT.danger ? 2 : f >= HEAT.warn ? 1 : 0;
    if (lvl !== this.heatLevel) {
      if (lvl > this.heatLevel) this.events.push({ t: 'heatLevel', level: lvl });
      this.heatLevel = lvl;
    }
  }

  private checkPickups(): void {
    const p = this.pod;
    for (const pk of this.world.pickups) {
      if (this.profile.taken.includes(pk.id)) continue;
      if (Math.abs(pk.x + 0.5 - p.x) > 0.8 || Math.abs(pk.y + 0.5 - p.y) > 0.8) continue;
      this.profile.taken.push(pk.id);
      this.dirtySave = true;
      if (pk.kind === 'chest') {
        this.exp!.chestMoney += pk.value ?? 0;
        this.events.push({ t: 'pickup', kind: 'chest', x: pk.x, y: pk.y, value: pk.value ?? 0 });
      } else if (pk.kind === 'flask') {
        this.coolBy(this.maxHeat * 0.4, pk.x, pk.y);
        this.events.push({ t: 'pickup', kind: 'flask', x: pk.x, y: pk.y, value: 0 });
      } else if (pk.artifact !== undefined) {
        const a = pk.artifact;
        if (!this.profile.artifacts.includes(a)) this.profile.artifacts.push(a);
        this.exp!.artifacts.push(a);
        this.events.push({ t: 'pickup', kind: 'artifact', x: pk.x, y: pk.y, value: ARTIFACTS[a].value, artifact: a });
        if (a === HEART_ARTIFACT && !this.profile.ended) {
          this.profile.ended = true;
          this.events.push({ t: 'ending' });
        }
      }
    }
  }

  private checkDiscoveries(): void {
    const p = this.pod;
    const r = LIGHT_RADIUS - 0.5;
    for (const lm of this.world.landmarks) {
      if (this.profile.landmarksSeen.includes(lm.id)) continue;
      const nx = Math.max(lm.x, Math.min(p.x, lm.x + lm.w));
      const ny = Math.max(lm.y, Math.min(p.y, lm.y + lm.h));
      if (Math.hypot(nx - p.x, ny - p.y) > r) continue;
      // only once some of it is actually exposed near the pod
      this.profile.landmarksSeen.push(lm.id);
      this.dirtySave = true;
      this.events.push({ t: 'landmark', key: lm.id });
    }
    this.padBiome = -1;
    for (const ws of this.world.waystations) {
      const inRoom = p.x > ws.x - 2 && p.x < ws.x + 4 && p.y > ws.y - 2.2 && p.y < ws.y + 1;
      if (!inRoom) continue;
      if (!this.profile.waystations.includes(ws.biome)) {
        this.profile.waystations.push(ws.biome);
        this.profile.waystations.sort((a, b) => a - b);
        this.dirtySave = true;
        this.events.push({ t: 'waystation', biome: ws.biome });
      }
      if (p.grounded && p.x > ws.x + 0.1 && p.x < ws.x + 1.9 && Math.floor(p.y) === ws.y) this.padBiome = ws.biome;
    }
    // the sealed door opens for a pod carrying every keystone's story
    if (!this.world.doorOpen && this.world.doorCells.length) {
      const i0 = this.world.doorCells[0];
      const dx = (i0 % this.world.w) - p.x;
      const dy = Math.floor(i0 / this.world.w) - p.y;
      if (Math.hypot(dx, dy) < 6 && KEYSTONES.every((k) => this.profile.artifacts.includes(k))) this.openDoor();
    }
  }

  openDoor(): void {
    for (const i of this.world.doorCells) {
      const x = i % this.world.w;
      const y = Math.floor(i / this.world.w);
      this.world.clear(x, y);
    }
    this.world.doorOpen = true;
    this.worldRev++;
    this.profile.doorOpen = true;
    this.dirtySave = true;
    this.events.push({ t: 'doorOpen' });
  }

  // ---------------------------------------------------------------- expedition flow
  private startExpedition(fromBiome: number): void {
    this.mode = 'expedition';
    this.exp = newExpedition(this.depth);
    this.profile.stats.runs++;
    this.lastBiome = this.biomeAt();
    this.dirtySave = true;
    this.events.push({ t: 'expeditionStart', fromBiome });
  }

  private startOverheat(): void {
    if (this.mode !== 'expedition' && this.mode !== 'recall') return;
    this.heat = this.maxHeat;
    this.mode = 'overheat';
    this.modeT = 0;
    if (this.drill) {
      this.pod.x = this.drill.sx;
      this.pod.y = this.drill.sy;
      this.drill = null;
    }
    this.events.push({ t: 'overheat' });
  }

  /** emergency recall: keeps part of the cargo, takes a moment, heat keeps rising meanwhile */
  recall(): boolean {
    if (!this.canRecall) return false;
    this.mode = 'recall';
    this.modeT = 0;
    this.events.push({ t: 'recallStart' });
    return true;
  }

  /** ride the waystation lift to the surface; the pod must be on the pad */
  rideLiftUp(): boolean {
    if (this.mode !== 'expedition' || this.padBiome < 0 || this.drill) return false;
    this.mode = 'liftUp';
    this.modeT = 0;
    this.events.push({ t: 'liftStart', up: true });
    return true;
  }

  /** from the surface, take the lift down to an active waystation */
  descendTo(biome: number): boolean {
    if (this.mode !== 'surface' || !this.profile.waystations.includes(biome)) return false;
    this.mode = 'liftDown';
    this.modeT = 0;
    this.liftBiome = biome;
    this.events.push({ t: 'liftStart', up: false });
    return true;
  }

  private arriveAtWaystation(): void {
    const ws = this.world.waystations.find((w) => w.biome === this.liftBiome)!;
    this.pod.x = ws.x + 1;
    this.pod.y = ws.y + 1 - PH / 2 - EPS;
    this.pod.vx = 0;
    this.pod.vy = 0;
    this.prevX = this.pod.x;
    this.prevY = this.pod.y;
    this.mode = 'surface';
    this.heat = 0;
    this.lastBiome = this.biomeAt();
    this.startExpedition(this.liftBiome);
  }

  private finishExpedition(kind: HaulKind, keep: number): void {
    if (!this.exp) return;
    const e = this.exp;
    const lines: HaulLine[] = [];
    let total = 0;
    let lostValue = 0;
    e.cargo.forEach((n, ore) => {
      if (!n) return;
      const kept = keep >= 1 ? n : Math.floor(n * keep);
      const value = kept * ORES[ore].value;
      lines.push({ ore, count: kept, lost: n - kept, value });
      total += value;
      lostValue += (n - kept) * ORES[ore].value;
    });
    lines.sort((a, b) => b.value - a.value);
    const chest = Math.floor(e.chestMoney * keep);
    lostValue += e.chestMoney - chest;
    total += chest;
    let artifactValue = 0;
    for (const a of e.artifacts) artifactValue += ARTIFACTS[a].value;
    const keptArtifacts = Math.floor(artifactValue * keep);
    lostValue += artifactValue - keptArtifacts;
    total += keptArtifacts;
    total = Math.max(0, Math.floor(total));

    // the transaction: one place, one time. Back at the workshop the pod is cooled.
    this.exp = null;
    this.heat = 0;
    this.profile.expedition = null;
    this.profile.money += total;
    const st = this.profile.stats;
    st.earned += total;
    if (kind === 'escape') st.escapes++;
    else if (kind === 'lift') st.lifts++;
    else if (kind === 'recall') st.recalls++;
    else st.overheats++;
    const newRecord = total > st.bestHaul && total > 0;
    if (newRecord) st.bestHaul = total;

    const haul: Haul = { kind, lines, chestMoney: chest, artifacts: e.artifacts, total, lostValue, depth: e.maxDepth, newRecord, time: e.time };
    this.mode = 'surface';
    this.modeT = 0;
    this.drill = null;
    if (kind !== 'escape') this.placeAtSurface(kind === 'lift' ? WORLD.spawnX + 0.5 : this.surfaceDropX());
    this.lastBiome = 0;
    this.dirtySave = true;
    this.events.push({ t: 'banked', haul });
  }

  /** towed or recalled pods are dropped beside the spawn, never into an open shaft */
  private surfaceDropX(): number {
    return WORLD.spawnX + 0.5;
  }

  private placeAtSurface(x: number): void {
    this.pod.x = x;
    this.pod.y = GROUND_ROW - PH / 2 - EPS;
    // never drop the pod onto a hole: walk to the nearest solid grass
    for (let k = 0; k < WORLD.width; k++) {
      for (const s of [k, -k]) {
        const cx = Math.floor(x) + s;
        if (cx < 1 || cx >= WORLD.width - 1) continue;
        if (this.world.solid(cx, GROUND_ROW)) {
          this.pod.x = cx + 0.5;
          k = WORLD.width;
          break;
        }
      }
    }
    this.pod.y = GROUND_ROW - PH / 2 - EPS - 2;
    this.pod.vx = 0;
    this.pod.vy = 0;
    this.pod.grounded = false;
    this.prevX = this.pod.x;
    this.prevY = this.pod.y;
  }

  // ---------------------------------------------------------------- economy
  upgradeCost(id: UpgradeId): number | null {
    const lvl = this.level[id];
    const c = UPGRADES[id].costs[lvl];
    return c === undefined ? null : c;
  }

  buy(id: UpgradeId): boolean {
    if (this.mode !== 'surface') return false;
    const cost = this.upgradeCost(id);
    if (cost === null || this.profile.money < cost) return false;
    this.profile.money -= cost;
    this.profile.upgrades[id]++;
    this.dirtySave = true;
    return true;
  }

  // ---------------------------------------------------------------- persistence
  /** profile with the live world and expedition folded in, ready to serialise */
  snapshot(): Profile {
    const p = this.profile;
    p.removed = encodeRemoved(this.world.removed);
    p.doorOpen = this.world.doorOpen;
    p.gen = GEN_VERSION;
    // Mid-drill positions overlap the target rock. Save the safe contact point
    // and restart that one tile on reload. Preserve terminal sequences as well.
    p.expedition = this.exp
      ? {
          x: this.drill?.sx ?? this.pod.x,
          y: this.drill?.sy ?? this.pod.y,
          mode: this.mode === 'overheat' || this.mode === 'recall' || this.mode === 'liftUp' ? this.mode : 'expedition',
          modeT: this.modeT,
          heat: this.heat,
          cargo: [...this.exp.cargo],
          chestMoney: this.exp.chestMoney,
          artifacts: [...this.exp.artifacts],
          maxDepth: this.exp.maxDepth,
          startDepth: this.exp.startDepth,
          tiles: this.exp.tiles,
          time: this.exp.time,
        }
      : null;
    return p;
  }

  private applyProfileToWorld(): void {
    const mask = decodeRemoved(this.profile.removed, this.world.mat.length);
    if (mask) {
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        this.world.clear(i % this.world.w, Math.floor(i / this.world.w));
      }
    }
    this.world.dirty.clear();
    if (this.profile.doorOpen) {
      for (const i of this.world.doorCells) this.world.clear(i % this.world.w, Math.floor(i / this.world.w));
      this.world.doorOpen = true;
      this.world.dirty.clear();
    }
  }

  private restoreExpedition(s: ExpeditionSnapshot): void {
    this.exp = { cargo: [...s.cargo], chestMoney: s.chestMoney, artifacts: [...s.artifacts], maxDepth: s.maxDepth, startDepth: s.startDepth, tiles: s.tiles, time: s.time };
    if (s.y < GROUND_ROW - 1 || s.y > this.world.h - 2 || s.x < 1 || s.x > this.world.w - 1 || this.boxBlocked(s.x, s.y)) {
      // Damaged positions recover the cargo once, instead of silently losing it.
      this.finishExpedition(s.mode === 'overheat' ? 'overheat' : 'lift', s.mode === 'overheat' ? HEAT.overheatKeep : 1);
      return;
    }
    this.pod.x = s.x;
    this.pod.y = s.y;
    this.heat = Math.min(s.heat, this.maxHeat);
    this.mode = s.mode ?? 'expedition';
    this.modeT = s.modeT ?? 0;
  }

  /** a save from an older generator: keep money, upgrades and the collection, rebuild the world */
  private resetWorldProgress(): void {
    const p = this.profile;
    p.gen = GEN_VERSION;
    p.removed = '';
    p.taken = [];
    p.doorOpen = false;
    p.waystations = [];
    p.landmarksSeen = [];
    p.expedition = null;
  }
}

export { BIOMES };
