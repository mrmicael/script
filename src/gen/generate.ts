// World generation: strata per biome, caves, liquids, ore veins, hazards,
// landmarks, waystations, pickups and the hand-made opening around the spawn.
// Deterministic for (seed, GEN_VERSION). Bump GEN_VERSION whenever the output
// changes: saves keep the version and rebuild a fresh world if it differs.

import { BIOMES, GROUND_ROW, WORLD } from '../core/balance';
import { ARTIFACTS } from '../core/content';
import { DOOR_STAMP, LANDMARKS, WAYSTATION_STAMP, cellCovered, decorValue, type LandmarkDef } from '../core/landmarks';
import { M, MATERIALS, O } from '../core/materials';
import { fbm, hash01, mulberry32, randInt, type Rng } from '../core/rng';
import { World, type Pickup } from '../core/world';

export const GEN_VERSION = 1;

interface VeinRule {
  ore: O;
  veins: number;
  size: [number, number];
  depth: [number, number];
}

/** ore veins per biome; counts are for the whole biome */
const VEINS: VeinRule[][] = [
  [
    { ore: O.COPPER, veins: 51, size: [2, 5], depth: [1, 40] },
    { ore: O.IRON, veins: 30, size: [2, 4], depth: [7, 40] },
    { ore: O.TOPAZ, veins: 15, size: [1, 3], depth: [4, 40] },
    { ore: O.COOLANT, veins: 6, size: [1, 1], depth: [10, 40] },
  ],
  [
    { ore: O.IRON, veins: 31, size: [2, 4], depth: [40, 70] },
    { ore: O.SILVER, veins: 62, size: [2, 5], depth: [40, 95] },
    { ore: O.AMETHYST, veins: 35, size: [2, 4], depth: [44, 95] },
    { ore: O.SAPPHIRE, veins: 18, size: [1, 2], depth: [58, 95] },
    { ore: O.TOPAZ, veins: 18, size: [1, 3], depth: [40, 80] },
    { ore: O.COOLANT, veins: 10, size: [1, 2], depth: [40, 95] },
  ],
  [
    { ore: O.SILVER, veins: 28, size: [2, 4], depth: [95, 125] },
    { ore: O.GOLD, veins: 60, size: [2, 5], depth: [95, 160] },
    { ore: O.RELIC, veins: 28, size: [1, 3], depth: [100, 160] },
    { ore: O.EMERALD, veins: 16, size: [1, 2], depth: [118, 160] },
    { ore: O.COOLANT, veins: 11, size: [1, 2], depth: [95, 160] },
  ],
  [
    { ore: O.GOLD, veins: 23, size: [2, 4], depth: [160, 190] },
    { ore: O.PLATINUM, veins: 60, size: [2, 5], depth: [160, 230] },
    { ore: O.FROST_OPAL, veins: 25, size: [1, 3], depth: [168, 230] },
    { ore: O.EMERALD, veins: 14, size: [1, 2], depth: [160, 230] },
    { ore: O.COOLANT, veins: 16, size: [1, 3], depth: [160, 230] },
  ],
  [
    { ore: O.PLATINUM, veins: 23, size: [2, 4], depth: [230, 260] },
    { ore: O.OBSIDIAN, veins: 60, size: [2, 5], depth: [230, 310] },
    { ore: O.RUBY, veins: 25, size: [1, 3], depth: [238, 310] },
    { ore: O.SUNSTONE, veins: 12, size: [1, 2], depth: [262, 310] },
    { ore: O.COOLANT, veins: 13, size: [1, 2], depth: [230, 310] },
  ],
  [
    { ore: O.OBSIDIAN, veins: 23, size: [2, 4], depth: [310, 335] },
    { ore: O.STARMETAL, veins: 55, size: [2, 4], depth: [310, 380] },
    { ore: O.SUNSTONE, veins: 14, size: [1, 2], depth: [310, 380] },
    { ore: O.VOID_PEARL, veins: 14, size: [1, 2], depth: [325, 380] },
    { ore: O.COOLANT, veins: 13, size: [1, 2], depth: [310, 380] },
  ],
];

const CAVE_THRESHOLD = [0.71, 0.665, 0.67, 0.645, 0.645, 0.63];
const CHESTS = [6, 7, 7, 7, 7, 6];
const CHEST_VALUE = [40, 260, 1100, 3600, 9000, 22000];
const FLASKS = [2, 4, 4, 5, 5, 5];

/** host rock for a cell of a biome */
function host(b: number, x: number, d: number, seed: number): M {
  const n1 = fbm(x * 0.13, d * 0.22, seed + 11);
  const n2 = fbm(x * 0.17, d * 0.17, seed + 23);
  const n3 = fbm(x * 0.09, d * 0.31, seed + 37);
  switch (b) {
    case 0: {
      if (d === 0) return M.GRASS;
      if (d < 6 && hash01(x, d, seed + 5) < 0.12 && n3 > 0.45) return M.ROOTS;
      const stoneT = 0.76 - Math.min(0.12, Math.max(0, d - 8) * 0.004);
      if (d > 8 && n1 > stoneT) return M.STONE;
      if (n3 > 0.6) return M.CLAY;
      if (d > 3 && n2 > 0.68) return M.SAND;
      return M.DIRT;
    }
    case 1:
      if (n1 > 0.66) return M.GRANITE;
      if (n3 > 0.62) return M.STONE;
      return M.CRYSTAL_ROCK;
    case 2:
      if (n1 > 0.68) return M.GRANITE;
      return M.SLATE;
    case 3:
      if (n2 > 0.64) return M.ICE;
      return M.PERMAFROST;
    case 4:
      return M.BASALT;
    default:
      if (n1 > 0.7) return M.BASALT;
      return M.VOIDSTONE;
  }
}

/** biome of a cell, with a ragged border between biomes */
function biomeOf(x: number, d: number, seed: number): number {
  for (let i = BIOMES.length - 1; i > 0; i--) {
    const jitter = (fbm(x * 0.18, i * 7.3, seed + 71) - 0.5) * 7;
    if (d >= BIOMES[i].top + jitter) return i;
  }
  return 0;
}

export interface GenReport {
  landmarks: number;
  waystations: number;
  artifacts: number;
  oreCells: number[];
}

export function generateWorld(seed: number): World {
  const world = new World(seed);
  const rng = mulberry32(seed ^ 0x5eed);
  const W = world.w;
  const H = world.h;
  const biomeMap = new Uint8Array(W * H);
  /** cells reserved by landmarks, waystations and the opening: caves and veins keep out */
  const reserved = new Uint8Array(W * H);

  // 1. strata
  for (let y = GROUND_ROW; y < H; y++) {
    const d = y - GROUND_ROW;
    for (let x = 0; x < W; x++) {
      const b = biomeOf(x, d, seed);
      const i = world.idx(x, y);
      biomeMap[i] = b;
      world.mat[i] = host(b, x, d, seed);
    }
  }

  // 2. the opening around the spawn is authored, so reserve it first
  reserveRect(world, reserved, 18, GROUND_ROW, 31, GROUND_ROW + 16);

  // 3. landmarks and waystations
  const placed: { x: number; y: number; w: number; h: number }[] = [{ x: 17, y: GROUND_ROW, w: 15, h: 17 }];
  const fits = (x: number, y: number, w: number, h: number) =>
    x >= 1 && x + w <= W - 1 && placed.every((p) => x + w + 2 <= p.x || p.x + p.w + 2 <= x || y + h + 2 <= p.y || p.y + p.h + 2 <= y);

  LANDMARKS.forEach((lm, type) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = randInt(rng, 1, W - 1 - lm.w);
      const y = GROUND_ROW + randInt(rng, lm.depth[0], lm.depth[1]);
      if (!fits(x, y, lm.w, lm.h)) continue;
      placed.push({ x, y, w: lm.w, h: lm.h });
      stamp(world, reserved, lm, type, x, y, rng);
      world.landmarks.push({ id: lm.key, biome: lm.biome, x, y, w: lm.w, h: lm.h });
      return;
    }
    throw new Error(`landmark ${lm.key} did not fit (seed ${seed})`);
  });

  const doorX = Math.floor((W - DOOR_STAMP.w) / 2);
  const doorY = GROUND_ROW + DOOR_STAMP.depth[0];
  placed.push({ x: doorX, y: doorY, w: DOOR_STAMP.w, h: DOOR_STAMP.h });
  stamp(world, reserved, DOOR_STAMP, LANDMARKS.length, doorX, doorY, rng);
  world.landmarks.push({ id: 'door', biome: 5, x: doorX, y: doorY, w: DOOR_STAMP.w, h: DOOR_STAMP.h });
  for (let y = doorY; y < doorY + DOOR_STAMP.h; y++) for (let x = doorX; x < doorX + DOOR_STAMP.w; x++) if (world.get(x, y) === M.DOOR) world.doorCells.push(world.idx(x, y));

  for (let b = 1; b < BIOMES.length; b++) {
    const { w, h } = WAYSTATION_STAMP;
    for (let attempt = 0; attempt < 300; attempt++) {
      const x = randInt(rng, 3, W - 3 - w);
      const y = GROUND_ROW + BIOMES[b].top + randInt(rng, 3, 7);
      if (!fits(x, y, w, h)) continue;
      placed.push({ x, y, w, h });
      placeWaystation(world, reserved, b, x, y);
      break;
    }
    if (world.waystations.length !== b) throw new Error(`waystation ${b} did not fit (seed ${seed})`);
  }

  // 4. caves
  for (let y = GROUND_ROW + 3; y < H - 2; y++) {
    const d = y - GROUND_ROW;
    for (let x = 1; x < W - 1; x++) {
      const i = world.idx(x, y);
      if (reserved[i]) continue;
      const b = biomeMap[i];
      const n = fbm(x * 0.11, d * 0.17, seed + 101 + b);
      let t = CAVE_THRESHOLD[b];
      if (b === 0 && d < 10) t += 0.06;
      if (n > t) world.mat[i] = M.AIR;
    }
  }

  // 5. liquids settle at the bottom of caves (frozen: water; magma/unknown: lava)
  fillLiquids(world, biomeMap, reserved, rng);

  // 6. ore veins and hazards
  for (let b = 0; b < BIOMES.length; b++) {
    for (const rule of VEINS[b]) {
      for (let v = 0; v < rule.veins; v++) {
        const x = randInt(rng, 1, W - 2);
        const y = GROUND_ROW + randInt(rng, rule.depth[0], rule.depth[1] - 1);
        growVein(world, reserved, rng, x, y, rule.ore, randInt(rng, rule.size[0], rule.size[1]));
      }
    }
  }
  placeHazards(world, biomeMap, reserved, rng);

  // 7. curio artifacts in small hidden pockets
  ARTIFACTS.forEach((a, idx) => {
    if (a.keystone || a.key === 'heart') return;
    const b = a.biome;
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = randInt(rng, 2, W - 6);
      const y = GROUND_ROW + randInt(rng, BIOMES[b].top + 6, BIOMES[b].bottom - 6);
      if (!fits(x, y, 4, 3)) continue;
      placed.push({ x, y, w: 4, h: 3 });
      reserveRect(world, reserved, x - 1, y - 1, x + 5, y + 4);
      // a sealed pocket: rock all around, a little room inside
      for (let yy = y - 1; yy <= y + 3; yy++) for (let xx = x - 1; xx <= x + 4; xx++) if (world.inside(xx, yy) && !MATERIALS[world.get(xx, yy)].liquid) world.mat[world.idx(xx, yy)] = host(b, xx, yy - GROUND_ROW, seed);
      for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 4; xx++) setCell(world, xx, yy, M.AIR);
      addPickup(world, { kind: 'artifact', x: x + 1, y: y + 1, artifact: idx });
      break;
    }
  });

  // 8. chests and coolant flasks on cave floors
  for (let b = 0; b < BIOMES.length; b++) {
    const floors = cavesFloors(world, biomeMap, reserved, b);
    shuffle(floors, rng);
    let chests = CHESTS[b];
    let flasks = FLASKS[b];
    for (const i of floors) {
      if (chests <= 0 && flasks <= 0) break;
      const x = i % W;
      const y = Math.floor(i / W);
      if (world.pickups.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < 6)) continue;
      if (chests > 0) {
        chests--;
        addPickup(world, { kind: 'chest', x, y, value: Math.round(CHEST_VALUE[b] * (0.75 + rng() * 0.5)) });
      } else {
        flasks--;
        addPickup(world, { kind: 'flask', x, y });
      }
    }
  }
  // landmark chests get a value from their biome
  for (const p of world.pickups) if (p.kind === 'chest' && !p.value) p.value = Math.round(CHEST_VALUE[biomeMap[world.idx(p.x, p.y)]] * 1.5);

  // 9. the opening, then the frame of the world
  authorOpening(world);
  for (let y = 0; y < H; y++) {
    for (const x of [0, W - 1]) setCell(world, x, y, y < GROUND_ROW ? M.AIR : M.BEDROCK);
  }
  for (let y = H - 2; y < H; y++) for (let x = 0; x < W; x++) setCell(world, x, y, M.BEDROCK);
  for (let y = 0; y < GROUND_ROW; y++) for (let x = 0; x < W; x++) setCell(world, x, y, M.AIR);
  // ore only ever lives inside rock
  for (let i = 0; i < world.mat.length; i++) if (world.ore[i] && !MATERIALS[world.mat[i]].solid) world.ore[i] = O.NONE;

  return world;
}

function setCell(world: World, x: number, y: number, m: M, ore: O = O.NONE): void {
  const i = world.idx(x, y);
  world.mat[i] = m;
  world.ore[i] = ore;
}

function reserveRect(world: World, reserved: Uint8Array, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = Math.max(0, y0); y < Math.min(world.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(world.w, x1); x++) reserved[world.idx(x, y)] = 1;
}

function addPickup(world: World, p: Omit<Pickup, 'id'>): void {
  world.pickups.push({ id: world.pickups.length + 1, ...p });
}

function stamp(world: World, reserved: Uint8Array, lm: LandmarkDef, type: number, ox: number, oy: number, rng: Rng): void {
  const carved = new Uint8Array(lm.w * lm.h);
  for (let ly = 0; ly < lm.h; ly++) {
    for (let lx = 0; lx < lm.w; lx++) {
      const x = ox + lx;
      const y = oy + ly;
      if (!world.inside(x, y)) continue;
      const i = world.idx(x, y);
      reserved[i] = 1;
      world.backDecor[i] = decorValue(type, lx, ly);
      for (const op of lm.ops) {
        if (!cellCovered(op.prim, lx, ly)) continue;
        if (op.fill === 'carve') {
          world.mat[i] = M.AIR;
          world.ore[i] = O.NONE;
          world.decor[i] = 0;
          carved[ly * lm.w + lx] = 1;
        } else if (op.fill === 'water' || op.fill === 'lava') {
          if (!carved[ly * lm.w + lx]) continue;
          world.mat[i] = op.fill === 'water' ? M.WATER : M.LAVA;
          world.ore[i] = O.NONE;
        } else {
          world.mat[i] = op.fill;
          world.ore[i] = O.NONE;
          carved[ly * lm.w + lx] = 0;
          for (const [ore, p] of op.ore ?? []) {
            if (rng() < p) {
              world.ore[i] = ore;
              break;
            }
          }
          world.decor[i] = op.decor ? decorValue(type, lx, ly) : 0;
        }
      }
    }
  }
  for (const p of lm.pickups) {
    const x = ox + p.x;
    const y = oy + p.y;
    setCell(world, x, y, M.AIR);
    addPickup(world, { kind: p.kind, x, y, artifact: p.artifact, value: p.value });
  }
}

function placeWaystation(world: World, reserved: Uint8Array, biome: number, x: number, y: number): void {
  const { w, h } = WAYSTATION_STAMP;
  const type = LANDMARKS.length + 1;
  reserveRect(world, reserved, x - 1, y - 1, x + w + 1, y + h + 1);
  for (let ly = 0; ly < h; ly++) {
    for (let lx = 0; lx < w; lx++) {
      const i = world.idx(x + lx, y + ly);
      world.backDecor[i] = decorValue(type, lx, ly);
      world.ore[i] = O.NONE;
      world.mat[i] = ly < h - 1 ? M.AIR : lx === 2 || lx === 3 ? M.PAD : world.mat[i] === M.AIR ? M.STONE : world.mat[i];
    }
  }
  world.waystations.push({ biome, x: x + 2, y: y + h - 2 });
}

function fillLiquids(world: World, biomeMap: Uint8Array, reserved: Uint8Array, rng: Rng): void {
  const W = world.w;
  const seen = new Uint8Array(world.mat.length);
  for (let start = 0; start < world.mat.length; start++) {
    if (seen[start] || world.mat[start] !== M.AIR || reserved[start]) continue;
    const b = biomeMap[start];
    const y0 = Math.floor(start / W);
    if (y0 < GROUND_ROW) continue;
    // flood the cave
    const cells: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const x = i % W;
      for (const n of [i - 1, i + 1, i - W, i + W]) {
        if (n < 0 || n >= world.mat.length || seen[n]) continue;
        if (Math.abs((n % W) - x) > 1) continue;
        if (world.mat[n] !== M.AIR || reserved[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    const liquid = b === 3 ? M.WATER : b === 4 || (b === 5 && rng() < 0.4) ? M.LAVA : null;
    if (!liquid || cells.length < 8 || rng() < 0.3) continue;
    let bottom = 0;
    for (const i of cells) bottom = Math.max(bottom, Math.floor(i / W));
    const level = bottom - (liquid === M.WATER ? randInt(rng, 1, 3) : randInt(rng, 0, 1));
    for (const i of cells) if (Math.floor(i / W) > level) world.mat[i] = liquid;
  }
}

function growVein(world: World, reserved: Uint8Array, rng: Rng, x: number, y: number, ore: O, size: number): void {
  let cx = x;
  let cy = y;
  for (let n = 0; n < size; n++) {
    if (world.inside(cx, cy)) {
      const i = world.idx(cx, cy);
      const m = world.mat[i] as M;
      if (!reserved[i] && MATERIALS[m].solid && m !== M.BEDROCK && m !== M.FOSSIL && m !== M.GRASS && world.ore[i] === O.NONE) world.ore[i] = ore;
    }
    const r = rng();
    if (r < 0.3) cx++;
    else if (r < 0.6) cx--;
    else if (r < 0.8) cy++;
    else cy--;
  }
}

function placeHazards(world: World, biomeMap: Uint8Array, reserved: Uint8Array, rng: Rng): void {
  const W = world.w;
  const counts: [M, number[]][] = [
    [M.VENT, [0, 7, 9, 6, 12, 10]],
    [M.BLAST, [0, 5, 9, 8, 10, 10]],
    [M.MAGMA_ROCK, [0, 0, 0, 0, 26, 12]],
  ];
  for (const [m, perBiome] of counts) {
    for (let b = 0; b < BIOMES.length; b++) {
      for (let k = 0; k < perBiome[b]; k++) {
        for (let attempt = 0; attempt < 40; attempt++) {
          const x = randInt(rng, 2, W - 3);
          const y = GROUND_ROW + randInt(rng, BIOMES[b].top + 4, BIOMES[b].bottom - 3);
          const i = world.idx(x, y);
          if (reserved[i] || biomeMap[i] !== b || !MATERIALS[world.mat[i]].solid || world.ore[i]) continue;
          world.mat[i] = m;
          // magma comes in seams
          if (m === M.MAGMA_ROCK) {
            let cx = x;
            let cy = y;
            for (let s = 0; s < randInt(rng, 2, 6); s++) {
              cx += rng() < 0.7 ? (rng() < 0.5 ? -1 : 1) : 0;
              cy += rng() < 0.4 ? 1 : 0;
              const j = world.idx(cx, cy);
              if (world.inside(cx, cy) && !reserved[j] && world.mat[j] === M.BASALT && !world.ore[j]) world.mat[j] = M.MAGMA_ROCK;
            }
          }
          break;
        }
      }
    }
  }
}

function cavesFloors(world: World, biomeMap: Uint8Array, reserved: Uint8Array, b: number): number[] {
  const out: number[] = [];
  const W = world.w;
  for (let y = GROUND_ROW + BIOMES[b].top + 3; y < Math.min(world.h - 3, GROUND_ROW + BIOMES[b].bottom); y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (reserved[i] || biomeMap[i] !== b) continue;
      if (world.mat[i] !== M.AIR) continue;
      const below = world.mat[i + W];
      if (!MATERIALS[below].solid || below === M.BEDROCK) continue;
      if (world.mat[i - W] !== M.AIR) continue;
      out.push(i);
    }
  }
  return out;
}

function shuffle<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * The first minute is designed, not rolled: soft dirt straight down from the
 * spawn, copper in the very first tiles, a topaz cluster a few tiles in, a
 * side pocket with a chest, then the first stone band and a coolant crystal.
 */
function authorOpening(world: World): void {
  const G = GROUND_ROW;
  for (let y = G; y < G + 16; y++) {
    for (let x = 18; x < 31; x++) {
      const d = y - G;
      const m = d === 0 ? M.GRASS : d < 9 ? ((x + d) % 5 === 0 ? M.CLAY : M.DIRT) : d < 11 && x > 20 && x < 28 ? M.STONE : M.DIRT;
      setCell(world, x, y, m);
    }
  }
  const S = WORLD.spawnX;
  const ores: [number, number, O][] = [
    [S, 2, O.COPPER],
    [S, 3, O.COPPER],
    [S - 1, 3, O.COPPER],
    [S + 1, 5, O.TOPAZ],
    [S, 6, O.TOPAZ],
    [S + 1, 6, O.TOPAZ],
    [S - 2, 5, O.COPPER],
    [S - 2, 6, O.COPPER],
    [S, 10, O.IRON],
    [S - 1, 10, O.IRON],
    [S - 2, 12, O.COPPER],
    [S - 3, 12, O.COPPER],
    [S - 2, 13, O.COPPER],
    [S + 2, 13, O.IRON],
    [S + 1, 14, O.COOLANT],
  ];
  for (const [x, d, o] of ores) world.ore[world.idx(x, G + d)] = o;
  // side pocket with a chest at depth 7-8
  for (let y = G + 7; y <= G + 8; y++) for (let x = S + 2; x <= S + 5; x++) setCell(world, x, y, M.AIR);
  setCell(world, S + 3, G + 6, M.ROOTS);
  for (const p of world.pickups) if (p.x >= 18 && p.x < 31 && p.y < G + 16) p.x = -1;
  world.pickups = world.pickups.filter((p) => p.x >= 0);
  world.pickups.push({ id: 9000, kind: 'chest', x: S + 4, y: G + 8, value: 30 });
}
