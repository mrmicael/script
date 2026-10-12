// The tile grid. Generated once from a seed; the player's changes are the set
// of cells that became air (`removed`), plus collected pickups and the door.

import { GROUND_ROW, WORLD } from './balance';
import { M, MATERIALS, O } from './materials';

export type PickupKind = 'chest' | 'artifact' | 'flask';

export interface Pickup {
  id: number;
  kind: PickupKind;
  /** cell the pickup sits in (an air cell) */
  x: number;
  y: number;
  /** artifact index for kind 'artifact' */
  artifact?: number;
  /** money for chests */
  value?: number;
}

export interface Waystation {
  biome: number;
  /** left cell of the 2-wide pad (pad cells are at row y+1) */
  x: number;
  /** row the pod stands in */
  y: number;
}

export interface Landmark {
  id: string;
  biome: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class World {
  readonly w: number;
  readonly h: number;
  readonly mat: Uint8Array;
  readonly ore: Uint8Array;
  /** decoration index painted over a solid cell (landmarks); 0 = none */
  readonly decor: Uint16Array;
  /** decoration painted on the cave wall behind a cell; 0 = none */
  readonly backDecor: Uint16Array;
  /** 1 where the generated cell was removed by the player */
  readonly removed: Uint8Array;
  pickups: Pickup[] = [];
  waystations: Waystation[] = [];
  landmarks: Landmark[] = [];
  /** cells of the sealed door */
  doorCells: number[] = [];
  doorOpen = false;
  /** cells changed since the renderer last looked */
  readonly dirty = new Set<number>();

  constructor(
    readonly seed: number,
    w = WORLD.width,
    h = WORLD.skyRows + WORLD.depth,
  ) {
    this.w = w;
    this.h = h;
    this.mat = new Uint8Array(w * h);
    this.ore = new Uint8Array(w * h);
    this.decor = new Uint16Array(w * h);
    this.backDecor = new Uint16Array(w * h);
    this.removed = new Uint8Array(w * h);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  /** material; outside the grid counts as bedrock (sky above is air) */
  get(x: number, y: number): number {
    if (y < 0) return M.AIR;
    if (!this.inside(x, y)) return M.BEDROCK;
    return this.mat[y * this.w + x];
  }
  oreAt(x: number, y: number): number {
    if (!this.inside(x, y)) return O.NONE;
    return this.ore[y * this.w + x];
  }
  solid(x: number, y: number): boolean {
    return MATERIALS[this.get(x, y)].solid;
  }

  /** player removal of a cell (drilling, explosions) */
  clear(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    if (this.mat[i] === M.AIR) return;
    this.mat[i] = M.AIR;
    this.ore[i] = O.NONE;
    this.decor[i] = 0;
    this.removed[i] = 1;
    this.dirty.add(i);
  }

  /** depth in tiles below the grass line for a row */
  static depthOfRow(row: number): number {
    return row - GROUND_ROW;
  }
}

/** run-length encoding of the removed mask: alternating run lengths, base36 */
export function encodeRemoved(mask: Uint8Array): string {
  const runs: number[] = [];
  let cur = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0;
    if (v === cur) n++;
    else {
      runs.push(n);
      cur = v;
      n = 1;
    }
  }
  runs.push(n);
  return runs.map((r) => r.toString(36)).join('.');
}

/** inverse of encodeRemoved; returns null when the data does not fit the mask */
export function decodeRemoved(data: string, length: number): Uint8Array | null {
  const out = new Uint8Array(length);
  if (!data) return out;
  let pos = 0;
  let v = 0;
  for (const part of data.split('.')) {
    const n = parseInt(part, 36);
    if (!Number.isFinite(n) || n < 0 || pos + n > length) return null;
    if (v) out.fill(1, pos, pos + n);
    pos += n;
    v ^= 1;
  }
  return pos === length ? out : null;
}
