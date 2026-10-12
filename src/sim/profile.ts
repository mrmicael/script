// Persistent progress. Versioned, validated field by field: a damaged or old
// save keeps every value that still makes sense instead of resetting.

import { UPGRADES, UPGRADE_ORDER, type UpgradeId } from '../core/balance';
import { ARTIFACTS } from '../core/content';
import { ORE_COUNT } from '../core/materials';
import { GEN_VERSION } from '../gen/generate';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'ddod.save';
export const SETTINGS_KEY = 'ddod.settings';

export interface Stats {
  runs: number;
  escapes: number;
  overheats: number;
  recalls: number;
  lifts: number;
  earned: number;
  tiles: number;
  /** deepest depth reached, tiles */
  deepest: number;
  bestHaul: number;
  playSec: number;
  ores: number;
}

/** an expedition in progress, saved so a closed tab resumes where it was */
export interface ExpeditionSnapshot {
  mode?: 'expedition' | 'overheat' | 'recall' | 'liftUp';
  modeT?: number;
  x: number;
  y: number;
  heat: number;
  cargo: number[];
  chestMoney: number;
  artifacts: number[];
  maxDepth: number;
  startDepth: number;
  tiles: number;
  time: number;
}

export interface Profile {
  v: number;
  seed: number;
  gen: number;
  money: number;
  upgrades: Record<UpgradeId, number>;
  /** run-length mask of removed cells (see world.encodeRemoved) */
  removed: string;
  /** pickup ids already taken */
  taken: number[];
  doorOpen: boolean;
  /** biome indices whose waystation is active */
  waystations: number[];
  /** artifacts found (the collection) */
  artifacts: number[];
  biomesSeen: number[];
  landmarksSeen: string[];
  achievements: string[];
  tips: string[];
  stats: Stats;
  expedition: ExpeditionSnapshot | null;
  ended: boolean;
  /** first day played and the last day a daily bonus was claimed (YYYY-MM-DD) */
  firstDay: string;
  lastBonusDay: string;
  bonusStreak: number;
}

export interface Settings {
  music: number;
  sfx: number;
  reducedMotion: boolean;
  shake: boolean;
  controls: 'buttons' | 'stick';
  lang: string;
  quality: 'auto' | 'high' | 'low';
}

export const defaultSettings = (): Settings => ({ music: 0.55, sfx: 0.8, reducedMotion: false, shake: true, controls: 'buttons', lang: '', quality: 'auto' });

const emptyStats = (): Stats => ({ runs: 0, escapes: 0, overheats: 0, recalls: 0, lifts: 0, earned: 0, tiles: 0, deepest: 0, bestHaul: 0, playSec: 0, ores: 0 });

export function newProfile(seed = (Math.random() * 2 ** 31) | 0): Profile {
  return {
    v: SAVE_VERSION,
    seed,
    gen: GEN_VERSION,
    money: 0,
    upgrades: { drill: 0, cooling: 0, hull: 0, engine: 0, cargo: 0, scanner: 0, recall: 0 },
    removed: '',
    taken: [],
    doorOpen: false,
    waystations: [],
    artifacts: [],
    biomesSeen: [0],
    landmarksSeen: [],
    achievements: [],
    tips: [],
    stats: emptyStats(),
    expedition: null,
    ended: false,
    firstDay: '',
    lastBonusDay: '',
    bonusStreak: 0,
  };
}

const num = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const intList = (v: unknown, lo: number, hi: number): number[] =>
  Array.isArray(v) ? [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= lo && n <= hi))] : [];
const strList = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && s.length < 64))] : []);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.length < 200000 ? v : fallback);

/** parse any stored value into a valid profile; never throws */
export function loadProfile(raw: string | null): { profile: Profile; status: 'new' | 'ok' | 'repaired' | 'corrupt' } {
  if (!raw) return { profile: newProfile(), status: 'new' };
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
    if (!data || typeof data !== 'object') throw new Error('not an object');
  } catch {
    return { profile: newProfile(), status: 'corrupt' };
  }
  const p = newProfile(num(data.seed, (Math.random() * 2 ** 31) | 0) | 0);
  let repaired = false;
  const fix = <T>(value: T, ok: boolean): T => {
    if (!ok) repaired = true;
    return value;
  };
  p.gen = num(data.gen, GEN_VERSION);
  p.money = Math.floor(num(data.money, 0, 0, 1e12));
  const up = (data.upgrades ?? {}) as Record<string, unknown>;
  for (const id of UPGRADE_ORDER) p.upgrades[id] = Math.floor(num(up[id], 0, 0, UPGRADES[id].costs.length));
  p.removed = str(data.removed, '');
  p.taken = intList(data.taken, 0, 1e6);
  p.doorOpen = data.doorOpen === true;
  p.waystations = intList(data.waystations, 1, 5);
  p.artifacts = intList(data.artifacts, 0, ARTIFACTS.length - 1);
  p.biomesSeen = intList(data.biomesSeen, 0, 5);
  if (!p.biomesSeen.includes(0)) p.biomesSeen.unshift(0);
  p.landmarksSeen = strList(data.landmarksSeen);
  p.achievements = strList(data.achievements);
  p.tips = strList(data.tips);
  const st = (data.stats ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(p.stats) as (keyof Stats)[]) p.stats[k] = num(st[k], 0, 0, 1e12);
  p.ended = data.ended === true;
  p.firstDay = typeof data.firstDay === 'string' ? data.firstDay : '';
  p.lastBonusDay = typeof data.lastBonusDay === 'string' ? data.lastBonusDay : '';
  p.bonusStreak = Math.floor(num(data.bonusStreak, 0, 0, 10000));
  p.expedition = fix(parseExpedition(data.expedition), data.expedition === null || data.expedition === undefined || parseExpedition(data.expedition) !== null);
  if (num(data.money, -1) < 0 && data.money !== undefined) repaired = true;
  return { profile: p, status: repaired ? 'repaired' : 'ok' };
}

function parseExpedition(v: unknown): ExpeditionSnapshot | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  if (typeof e.x !== 'number' || typeof e.y !== 'number' || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return null;
  const cargo = Array.isArray(e.cargo) ? e.cargo.slice(0, ORE_COUNT).map((n) => Math.floor(num(n, 0, 0, 1e6))) : [];
  while (cargo.length < ORE_COUNT) cargo.push(0);
  return {
    x: e.x,
    y: e.y,
    mode: e.mode === 'overheat' || e.mode === 'recall' || e.mode === 'liftUp' ? e.mode : 'expedition',
    modeT: num(e.modeT, 0, 0, 30),
    heat: num(e.heat, 0, 0, 1e4),
    cargo,
    chestMoney: Math.floor(num(e.chestMoney, 0, 0, 1e9)),
    artifacts: intList(e.artifacts, 0, ARTIFACTS.length - 1),
    maxDepth: num(e.maxDepth, 0, 0, 1e4),
    startDepth: num(e.startDepth, 0, 0, 1e4),
    tiles: Math.floor(num(e.tiles, 0, 0, 1e7)),
    time: num(e.time, 0, 0, 1e7),
  };
}

export function loadSettings(raw: string | null): Settings {
  const s = defaultSettings();
  if (!raw) return s;
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    s.music = num(d.music, s.music, 0, 1);
    s.sfx = num(d.sfx, s.sfx, 0, 1);
    s.reducedMotion = d.reducedMotion === true;
    s.shake = d.shake !== false;
    s.controls = d.controls === 'stick' ? 'stick' : 'buttons';
    s.lang = typeof d.lang === 'string' ? d.lang.slice(0, 8) : '';
    s.quality = d.quality === 'high' || d.quality === 'low' ? d.quality : 'auto';
  } catch {
    /* defaults */
  }
  return s;
}
