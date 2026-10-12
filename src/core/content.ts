// Collectible artifacts. Text lives in i18n; this is just the catalogue.

export interface ArtifactDef {
  key: string;
  biome: number;
  /** keystones open the sealed door at the bottom of the world */
  keystone: boolean;
  value: number;
}

export const ARTIFACTS: ArtifactDef[] = [
  { key: 'amberKey', biome: 0, keystone: true, value: 150 },
  { key: 'pocketWatch', biome: 0, keystone: false, value: 90 },
  { key: 'prismKey', biome: 1, keystone: true, value: 900 },
  { key: 'singingCrystal', biome: 1, keystone: false, value: 600 },
  { key: 'gearKey', biome: 2, keystone: true, value: 3500 },
  { key: 'badge', biome: 2, keystone: false, value: 2400 },
  { key: 'frostKey', biome: 3, keystone: true, value: 9000 },
  { key: 'lantern', biome: 3, keystone: false, value: 6500 },
  { key: 'emberKey', biome: 4, keystone: true, value: 24000 },
  { key: 'crown', biome: 4, keystone: false, value: 17000 },
  { key: 'voidKey', biome: 5, keystone: true, value: 60000 },
  { key: 'starMap', biome: 5, keystone: false, value: 42000 },
  // the prize behind the sealed door
  { key: 'heart', biome: 5, keystone: false, value: 250000 },
];

export const HEART_ARTIFACT = ARTIFACTS.length - 1;
export const KEYSTONES = ARTIFACTS.map((a, i) => (a.keystone ? i : -1)).filter((i) => i >= 0);
