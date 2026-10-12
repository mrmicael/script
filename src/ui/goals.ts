// The "next goal" line: always one clear, short objective. Picked from the
// player's progress, never from a fixed script, so it fits any play speed.

import { BIOMES, BIOME_TIER, METERS_PER_TILE, drillTier } from '../core/balance';
import { KEYSTONES } from '../core/content';
import { t, type StrKey } from '../i18n/strings';
import type { Game } from '../sim/game';

export interface Goal {
  text: string;
  /** 0..1 progress, or null */
  progress: number | null;
}

const biomeName = (b: number) => t(`b_${BIOMES[b].id}` as StrKey);

export function currentGoal(g: Game): Goal {
  const p = g.profile;
  const st = p.stats;
  const m = (tiles: number) => Math.round(tiles * METERS_PER_TILE);
  if (st.tiles < 3 && !g.exp) return { text: t('g_dig'), progress: null };
  if (st.escapes + st.lifts + st.recalls + st.overheats === 0) {
    if (g.exp && g.cargoCount < 3) return { text: t('g_collect'), progress: g.cargoCount / 3 };
    return { text: t('g_return'), progress: null };
  }
  const anyBought = Object.values(p.upgrades).some((v) => v > 0);
  if (!anyBought) return { text: t('g_upgrade'), progress: null };

  const deepestBiome = Math.max(...p.biomesSeen);
  const next = deepestBiome + 1;
  // the drill gates each layer: say so before the player hits the wall
  if (next < BIOMES.length && drillTier(g.level.drill) < BIOME_TIER[next]) {
    let lvl = g.level.drill;
    while (drillTier(lvl) < BIOME_TIER[next]) lvl++;
    return { text: t('g_drill', { n: lvl + 1 }), progress: null };
  }
  if (next < BIOMES.length) {
    const target = BIOMES[next].top;
    if (st.deepest < target) {
      // nearer milestones first, in steps of 20 m
      const stepTiles = 10;
      const milestone = Math.min(target, (Math.floor(st.deepest / stepTiles) + 1) * stepTiles);
      if (milestone < target) return { text: t('g_depth', { n: m(milestone) }), progress: st.deepest / milestone };
      return { text: t('g_biome', { name: biomeName(next) }), progress: st.deepest / target };
    }
  }
  // waystation of the deepest layer reached
  for (let b = 1; b <= deepestBiome; b++) if (!p.waystations.includes(b)) return { text: t('g_waystation', { name: biomeName(b) }), progress: null };
  // keystones
  const missing = KEYSTONES.filter((k) => !p.artifacts.includes(k));
  if (missing.length) {
    const lmKeys = ['fossil', 'cathedral', 'train', 'lake', 'forge', 'stars'];
    const k = KEYSTONES.indexOf(missing[0]);
    return { text: t('g_keystone', { name: t(`lm_${lmKeys[k]}` as StrKey) }), progress: (KEYSTONES.length - missing.length) / KEYSTONES.length };
  }
  if (!p.doorOpen) return { text: t('g_door'), progress: null };
  if (!p.ended) return { text: t('g_heart'), progress: null };
  return { text: t('g_free'), progress: null };
}
