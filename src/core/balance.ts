// Every number that shapes how the game plays lives here, so balancing never
// means hunting through gameplay code. Units: tiles, seconds, heat points.
// One tile is shown to the player as METERS_PER_TILE meters.

export const METERS_PER_TILE = 2;

export const WORLD = {
  width: 48,
  /** air rows above the ground line (the surface scene) */
  skyRows: 8,
  /** rows of ground below the grass line, bedrock included */
  depth: 384,
  spawnX: 24,
} as const;

export const WORLD_HEIGHT = WORLD.skyRows + WORLD.depth;
/** grid row of the grass line (depth 0) */
export const GROUND_ROW = WORLD.skyRows;

export type BiomeId = 'soft' | 'crystal' | 'ruins' | 'frozen' | 'magma' | 'unknown';

export interface BiomeDef {
  id: BiomeId;
  /** depth (tiles below the grass line) where it begins */
  top: number;
  bottom: number;
  /** cave colour and the backdrop tint */
  ambient: number;
  /** how dark the unlit underground gets, 0..1 */
  darkness: number;
}

export const BIOMES: BiomeDef[] = [
  { id: 'soft', top: 0, bottom: 40, ambient: 0x3a2618, darkness: 0.55 },
  { id: 'crystal', top: 40, bottom: 95, ambient: 0x1f1a3d, darkness: 0.7 },
  { id: 'ruins', top: 95, bottom: 160, ambient: 0x1d2a26, darkness: 0.74 },
  { id: 'frozen', top: 160, bottom: 230, ambient: 0x15283a, darkness: 0.72 },
  { id: 'magma', top: 230, bottom: 310, ambient: 0x2e0f0b, darkness: 0.68 },
  { id: 'unknown', top: 310, bottom: 384, ambient: 0x120c22, darkness: 0.8 },
];

export function biomeIndexAt(depth: number): number {
  for (let i = BIOMES.length - 1; i >= 0; i--) if (depth >= BIOMES[i].top) return i;
  return 0;
}

export const PHYSICS = {
  step: 1 / 120,
  podW: 0.78,
  podH: 0.72,
  gravity: 26,
  maxFall: 15,
  thrust: 50,
  groundAccel: 46,
  airAccel: 24,
  groundFriction: 60,
  airDrag: 7,
  /** horizontal nudge into a one-tile shaft while climbing */
  shaftAssist: 0.32,
  /** vertical nudge into a side tunnel while driving */
  ledgeAssist: 0.3,
  /** liquids */
  waterDrag: 5,
  lavaDrag: 7,
} as const;

export const DRILL = {
  /** shortest time any tile can take */
  minTime: 0.11,
  /** extra time for drilling upward */
  upFactor: 1.25,
  /** heat per hardness point drilled */
  heatPerHardness: 0.22,
} as const;

export const HEAT = {
  /** ambient heat per second at a depth (tiles), before the cooling multiplier */
  ambient(depth: number): number {
    if (depth <= 0) return 0;
    return 1 + 0.05 * depth + 0.00015 * depth * depth;
  },
  thrustPerSec: 0.9,
  surfaceCooling: 45,
  waterCooling: 14,
  lavaHeat: 34,
  /** overheating keeps this share of each cargo stack */
  overheatKeep: 0.25,
  warn: 0.5,
  danger: 0.75,
  critical: 0.9,
  /** pause after an overheat before the tow starts */
  breakdownTime: 1.6,
  towTime: 1.4,
} as const;

export type UpgradeId = 'drill' | 'cooling' | 'hull' | 'engine' | 'cargo' | 'scanner' | 'recall';

export interface UpgradeDef {
  id: UpgradeId;
  /** cost of reaching level i+1 */
  costs: number[];
  /** one stat per level, index 0 = starting kit */
  values: number[];
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  // drill power (hardness points per second); every second level adds a tier
  drill: { id: 'drill', costs: [50, 320, 900, 2200, 4800, 9500, 18000, 34000, 60000], values: [2.8, 3.6, 4.4, 5.3, 6.3, 7.4, 8.7, 10.2, 12, 14] },
  // multiplier on all heat gained
  cooling: { id: 'cooling', costs: [40, 300, 1300, 5200, 18000, 52000], values: [1, 0.8, 0.66, 0.55, 0.46, 0.39, 0.33] },
  // heat capacity
  hull: { id: 'hull', costs: [45, 320, 1450, 5600, 19500, 56000], values: [100, 140, 200, 280, 390, 540, 740] },
  // horizontal speed; climb speed is derived below
  engine: { id: 'engine', costs: [40, 260, 1150, 4600, 15500, 46000], values: [5, 5.8, 6.6, 7.5, 8.4, 9.3, 10.4] },
  // cargo slots
  cargo: { id: 'cargo', costs: [35, 220, 950, 3900, 13500, 41000], values: [10, 16, 24, 34, 48, 66, 90] },
  // scan radius in tiles (0 = no scanner)
  scanner: { id: 'scanner', costs: [160, 950, 4200, 15500], values: [0, 7, 10, 13, 17] },
  // share of cargo the emergency recall keeps (0 = not installed)
  recall: { id: 'recall', costs: [260, 2600, 12500], values: [0, 0.45, 0.6, 0.75] },
};

export const UPGRADE_ORDER: UpgradeId[] = ['drill', 'cooling', 'hull', 'engine', 'cargo', 'scanner', 'recall'];

export const climbSpeed = (engineLevel: number): number => [5.2, 6.2, 7.4, 8.7, 10.1, 11.6, 13.2][engineLevel] ?? 5.2;
const TIERS = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
export const drillTier = (drillLevel: number): number => TIERS[drillLevel] ?? 5;
/** drill tier each biome's main rock needs */
export const BIOME_TIER = [1, 2, 3, 3, 4, 5];

export const RECALL = {
  /** seconds of channelling before the winch pulls the pod out */
  channel: 1.8,
  pullTime: 1.6,
} as const;

/** light radius in tiles around the pod underground */
export const LIGHT_RADIUS = 5.2;
