// Terrain materials and the ores embedded in them. Ids are stored in Uint8
// grids and in saves, so never renumber: append only.

export enum M {
  AIR = 0,
  GRASS = 1,
  DIRT = 2,
  CLAY = 3,
  SAND = 4,
  STONE = 5,
  CRYSTAL_ROCK = 6,
  GRANITE = 7,
  BRICK = 8,
  ALLOY = 9,
  ICE = 10,
  PERMAFROST = 11,
  BASALT = 12,
  MAGMA_ROCK = 13,
  VOIDSTONE = 14,
  BEDROCK = 15,
  FOSSIL = 16,
  VENT = 17,
  BLAST = 18,
  WATER = 19,
  LAVA = 20,
  DOOR = 21,
  ROOTS = 22,
  SLATE = 23,
  PAD = 24,
}

export const MATERIAL_COUNT = 25;

export type Liquid = 'water' | 'lava' | null;

export interface MaterialDef {
  id: M;
  key: string;
  /** false: the pod moves through it */
  solid: boolean;
  /** seconds of drilling at power 1; Infinity = cannot be drilled */
  hardness: number;
  /** minimum drill tier */
  tier: number;
  /** heat added when the tile breaks (negative cools) */
  breakHeat: number;
  liquid: Liquid;
  /** particle palette, light to dark */
  colors: [number, number, number];
  /** which sound family the break uses */
  sound: 'soft' | 'stone' | 'crystal' | 'metal' | 'ice' | 'bone' | 'none';
}

const def = (d: Omit<MaterialDef, 'liquid'> & { liquid?: Liquid }): MaterialDef => ({ liquid: null, ...d });

export const MATERIALS: MaterialDef[] = [
  def({ id: M.AIR, key: 'air', solid: false, hardness: 0, tier: 0, breakHeat: 0, colors: [0, 0, 0], sound: 'none' }),
  def({ id: M.GRASS, key: 'grass', solid: true, hardness: 0.75, tier: 1, breakHeat: 0, colors: [0x8fd14f, 0x5ea33a, 0x6b4a2e], sound: 'soft' }),
  def({ id: M.DIRT, key: 'dirt', solid: true, hardness: 1, tier: 1, breakHeat: 0.2, colors: [0xb5794a, 0x8a5634, 0x5e3a24], sound: 'soft' }),
  def({ id: M.CLAY, key: 'clay', solid: true, hardness: 1.6, tier: 1, breakHeat: 0.3, colors: [0xc98a5a, 0xa0623c, 0x6e3f27], sound: 'soft' }),
  def({ id: M.SAND, key: 'sand', solid: true, hardness: 0.6, tier: 1, breakHeat: 0.1, colors: [0xe8c886, 0xc9a35e, 0x957444], sound: 'soft' }),
  def({ id: M.STONE, key: 'stone', solid: true, hardness: 2.8, tier: 1, breakHeat: 0.6, colors: [0xa39b94, 0x77706b, 0x4d4846], sound: 'stone' }),
  def({ id: M.CRYSTAL_ROCK, key: 'crystalRock', solid: true, hardness: 3.4, tier: 2, breakHeat: 0.7, colors: [0x8f86c4, 0x5f5894, 0x3b3563], sound: 'crystal' }),
  def({ id: M.GRANITE, key: 'granite', solid: true, hardness: 4.6, tier: 2, breakHeat: 0.9, colors: [0xb59ca0, 0x7f6a71, 0x4b3d45], sound: 'stone' }),
  def({ id: M.BRICK, key: 'brick', solid: true, hardness: 4.4, tier: 3, breakHeat: 0.9, colors: [0xa8a07a, 0x7a7357, 0x4d4936], sound: 'stone' }),
  def({ id: M.ALLOY, key: 'alloy', solid: true, hardness: 8, tier: 3, breakHeat: 1.2, colors: [0x9fd6cf, 0x5f8f8c, 0x34514f], sound: 'metal' }),
  def({ id: M.ICE, key: 'ice', solid: true, hardness: 2.4, tier: 2, breakHeat: -5, colors: [0xdaf4ff, 0x9fd4ef, 0x5e9bc4], sound: 'ice' }),
  def({ id: M.PERMAFROST, key: 'permafrost', solid: true, hardness: 5, tier: 3, breakHeat: -1, colors: [0xb5c9d6, 0x7b93a6, 0x4a5d70], sound: 'ice' }),
  def({ id: M.BASALT, key: 'basalt', solid: true, hardness: 5.6, tier: 4, breakHeat: 1.5, colors: [0x6e5a5a, 0x463838, 0x261d1f], sound: 'stone' }),
  def({ id: M.MAGMA_ROCK, key: 'magmaRock', solid: true, hardness: 3.6, tier: 4, breakHeat: 14, colors: [0xffb347, 0xe0522a, 0x5a1d14], sound: 'stone' }),
  def({ id: M.VOIDSTONE, key: 'voidstone', solid: true, hardness: 7, tier: 5, breakHeat: 2, colors: [0x7d6bd1, 0x42357f, 0x1c1638], sound: 'crystal' }),
  def({ id: M.BEDROCK, key: 'bedrock', solid: true, hardness: Infinity, tier: 99, breakHeat: 0, colors: [0x4a4550, 0x2c2930, 0x16141a], sound: 'metal' }),
  def({ id: M.FOSSIL, key: 'fossil', solid: true, hardness: 1.8, tier: 1, breakHeat: 0.3, colors: [0xf4ead2, 0xd6c7a2, 0x9e8d66], sound: 'bone' }),
  def({ id: M.VENT, key: 'vent', solid: true, hardness: 2.2, tier: 1, breakHeat: 18, colors: [0xffd27a, 0xd9773a, 0x5c3424], sound: 'stone' }),
  def({ id: M.BLAST, key: 'blast', solid: true, hardness: 1.4, tier: 1, breakHeat: 0, colors: [0xff8a5c, 0xb8432c, 0x4a1d1a], sound: 'stone' }),
  def({ id: M.WATER, key: 'water', solid: false, hardness: 0, tier: 0, breakHeat: 0, liquid: 'water', colors: [0x9ee4ff, 0x4fa8d8, 0x235a8a], sound: 'none' }),
  def({ id: M.LAVA, key: 'lava', solid: false, hardness: 0, tier: 0, breakHeat: 0, liquid: 'lava', colors: [0xffe07a, 0xff7a2a, 0xb3261e], sound: 'none' }),
  def({ id: M.DOOR, key: 'door', solid: true, hardness: Infinity, tier: 99, breakHeat: 0, colors: [0xe8d48a, 0xa88b45, 0x5a4622], sound: 'metal' }),
  def({ id: M.ROOTS, key: 'roots', solid: true, hardness: 0.9, tier: 1, breakHeat: 0.1, colors: [0xc89a64, 0x8f6338, 0x5a3a1e], sound: 'soft' }),
  def({ id: M.SLATE, key: 'slate', solid: true, hardness: 4, tier: 3, breakHeat: 0.9, colors: [0x7f9a8c, 0x52665c, 0x2c3933], sound: 'stone' }),
  def({ id: M.PAD, key: 'pad', solid: true, hardness: Infinity, tier: 99, breakHeat: 0, colors: [0xffe28a, 0x8a9aa8, 0x3a4450], sound: 'metal' }),
];

export const isSolid = (m: number): boolean => MATERIALS[m]?.solid ?? true;

export enum O {
  NONE = 0,
  COPPER = 1,
  IRON = 2,
  TOPAZ = 3,
  SILVER = 4,
  AMETHYST = 5,
  SAPPHIRE = 6,
  GOLD = 7,
  EMERALD = 8,
  RELIC = 9,
  PLATINUM = 10,
  FROST_OPAL = 11,
  RUBY = 12,
  OBSIDIAN = 13,
  SUNSTONE = 14,
  STARMETAL = 15,
  VOID_PEARL = 16,
  COOLANT = 17,
  BONE = 18,
}

export const ORE_COUNT = 19;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';

export interface OreDef {
  id: O;
  key: string;
  value: number;
  rarity: Rarity;
  /** extra drill time on top of the host rock */
  hardness: number;
  /** coolant: heat removed instead of cargo */
  cools?: number;
  color: number;
  glow: boolean;
}

export const ORES: OreDef[] = [
  { id: O.NONE, key: 'none', value: 0, rarity: 'common', hardness: 0, color: 0, glow: false },
  { id: O.COPPER, key: 'copper', value: 5, rarity: 'common', hardness: 0.1, color: 0xf08a4b, glow: false },
  { id: O.IRON, key: 'iron', value: 9, rarity: 'common', hardness: 0.3, color: 0xd9c6b8, glow: false },
  { id: O.TOPAZ, key: 'topaz', value: 28, rarity: 'uncommon', hardness: 0.2, color: 0xffd23f, glow: true },
  { id: O.SILVER, key: 'silver', value: 24, rarity: 'common', hardness: 0.3, color: 0xe6f0ff, glow: false },
  { id: O.AMETHYST, key: 'amethyst', value: 60, rarity: 'uncommon', hardness: 0.4, color: 0xc86bff, glow: true },
  { id: O.SAPPHIRE, key: 'sapphire', value: 120, rarity: 'rare', hardness: 0.5, color: 0x3f8cff, glow: true },
  { id: O.GOLD, key: 'gold', value: 90, rarity: 'common', hardness: 0.3, color: 0xffc928, glow: false },
  { id: O.EMERALD, key: 'emerald', value: 280, rarity: 'rare', hardness: 0.6, color: 0x3ee07a, glow: true },
  { id: O.RELIC, key: 'relic', value: 200, rarity: 'uncommon', hardness: 0.6, color: 0x7ff0e0, glow: true },
  { id: O.PLATINUM, key: 'platinum', value: 260, rarity: 'common', hardness: 0.6, color: 0xcfe3ea, glow: false },
  { id: O.FROST_OPAL, key: 'frostOpal', value: 560, rarity: 'rare', hardness: 0.7, color: 0x9ff7ff, glow: true },
  { id: O.RUBY, key: 'ruby', value: 900, rarity: 'rare', hardness: 0.8, color: 0xff3355, glow: true },
  { id: O.OBSIDIAN, key: 'obsidian', value: 620, rarity: 'common', hardness: 0.8, color: 0x8a78b8, glow: false },
  { id: O.SUNSTONE, key: 'sunstone', value: 2000, rarity: 'epic', hardness: 1, color: 0xffa31a, glow: true },
  { id: O.STARMETAL, key: 'starmetal', value: 2400, rarity: 'common', hardness: 1, color: 0xb8c4ff, glow: true },
  { id: O.VOID_PEARL, key: 'voidPearl', value: 5200, rarity: 'epic', hardness: 1.2, color: 0xf0d0ff, glow: true },
  { id: O.COOLANT, key: 'coolant', value: 0, rarity: 'uncommon', hardness: 0.2, cools: 30, color: 0x7fe9ff, glow: true },
  { id: O.BONE, key: 'bone', value: 22, rarity: 'uncommon', hardness: 0, color: 0xf4ead2, glow: false },
];
