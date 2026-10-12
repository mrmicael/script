// The DOM interface over the canvas: HUD, banners, hints, touch controls,
// the workshop, pause and settings. It reads the simulation; it changes it
// only through the callbacks the controller passes in.

import { sfx } from '../audio/audio';
import { BIOMES, BIOME_TIER, GROUND_ROW, HEAT, METERS_PER_TILE, UPGRADES, UPGRADE_ORDER, WORLD, drillTier, climbSpeed, type UpgradeId } from '../core/balance';
import { ARTIFACTS, KEYSTONES } from '../core/content';
import { ORES } from '../core/materials';
import { LANG_NAMES, lang, t, type StrKey } from '../i18n/strings';
import type { Controls } from '../input/input';
import { artifactIconUrls, oreIconUrls } from '../render/textures';
import type { Game, Haul } from '../sim/game';
import type { Settings } from '../sim/profile';
import { currentGoal } from './goals';
import { ICONS } from './icons';

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
const fmt = (n: number) => '$' + Math.floor(n).toLocaleString('en');
const meters = (tiles: number) => `${Math.max(0, Math.round(tiles * METERS_PER_TILE))} m`;

export interface UiCallbacks {
  buy(id: UpgradeId): boolean;
  launch(fromBiome: number): void;
  closeWorkshop(): void;
  resume(): void;
  openWorkshop(): void;
  openSettings(): void;
  settingsChanged(s: Settings): void;
  resetSave(): void;
  action(): void;
  pause(): void;
}

type Modal = 'none' | 'workshop' | 'pause' | 'settings' | 'ending' | 'resume';

export class UI {
  readonly root: HTMLElement;
  modal: Modal = 'none';
  private hud!: HTMLElement;
  private heatEl!: HTMLElement;
  private heatFill!: HTMLElement;
  private heatHome!: HTMLElement;
  private heatLabel!: HTMLElement;
  private turnback!: HTMLElement;
  private depthEl!: HTMLElement;
  private goalEl!: HTMLElement;
  private cargoEl!: HTMLElement;
  private moneyEl!: HTMLElement;
  private rulerMe!: HTMLElement;
  private rulerRec!: HTMLElement;
  private ruler!: HTMLElement;
  private banner!: HTMLElement;
  private hintEl!: HTMLElement;
  private actionEl!: HTMLElement;
  private alertEl!: HTMLElement;
  private vignette!: HTMLElement;
  private digdown!: HTMLElement;
  private titleLogo!: HTMLElement;
  private toastEl!: HTMLElement;
  private scrim!: HTMLElement;
  private panel!: HTMLElement;
  private bannerQueue: { k: string; v: string; s?: string; img?: string }[] = [];
  private bannerT = 0;
  private hintT = 0;
  private hintKey = '';
  private lastCargo = -1;
  private workshopTab: 'up' | 'col' | 'stats' = 'up';
  private launchFrom = 0;
  private haulTimer: ReturnType<typeof setTimeout> | null = null;
  actionKind: 'lift' | 'recall' | 'shop' | null = null;

  constructor(
    private game: () => Game,
    private cb: UiCallbacks,
    private controls: Controls,
    public settings: Settings,
  ) {
    this.root = document.getElementById('ui')!;
    this.build();
  }

  private build(): void {
    this.root.innerHTML = `
      <div class="vignette"></div>
      <div class="titlelogo logo">DIG DEEP<small>OR DIE!</small></div>
      <div class="hud">
        <div class="heat pill l0">
          <span class="ico">${ICONS.heat}</span>
          <div class="meter"><div class="fill"></div>
            <div class="tick" style="left:${HEAT.warn * 100}%"></div>
            <div class="tick" style="left:${HEAT.danger * 100}%"></div>
            <div class="tick" style="left:${HEAT.critical * 100}%"></div>
            <div class="home"></div>
          </div>
          <span class="label"></span>
          <div class="turnback"></div>
        </div>
        <div class="mid">
          <div class="depth pill"></div>
          <div class="goal"></div>
        </div>
        <div class="right">
          <div class="cargo pill"><span class="ico">${ICONS.crate}</span><span class="slots"></span><span class="val"></span></div>
          <button class="iconbtn pausebtn" aria-label="Pause">${ICONS.pause}</button>
        </div>
      </div>
      <div class="ruler"></div>
      <div class="toast"></div>
      <div class="banner"></div>
      <div class="digdown"><span></span>${ICONS.arrowDown}</div>
      <div class="alert"></div>
      <div class="hint"></div>
      <button class="action"></button>
      <div class="stickzone"><div class="stickbase"><div class="stickknob"></div></div></div>
      <div class="touch lefthand on">
        <button class="tbtn" data-b="left" aria-label="Left">${ICONS.left}</button>
        <button class="tbtn" data-b="right" aria-label="Right">${ICONS.right}</button>
      </div>
      <div class="touch righthand on">
        <button class="tbtn" data-b="down" aria-label="Drill down">${ICONS.down}</button>
        <button class="tbtn big" data-b="up" aria-label="Fly up">${ICONS.up}</button>
      </div>
      <div class="scrim"><div class="panel"></div></div>
    `;
    const r = this.root;
    this.hud = $(r, '.hud');
    this.heatEl = $(r, '.heat');
    this.heatFill = $(r, '.heat .fill');
    this.heatHome = $(r, '.heat .home');
    this.heatLabel = $(r, '.heat .label');
    this.turnback = $(r, '.turnback');
    this.depthEl = $(r, '.depth');
    this.goalEl = $(r, '.goal');
    this.cargoEl = $(r, '.cargo');
    this.moneyEl = $(r, '.cargo .val');
    this.ruler = $(r, '.ruler');
    this.banner = $(r, '.banner');
    this.hintEl = $(r, '.hint');
    this.actionEl = $(r, '.action');
    this.alertEl = $(r, '.alert');
    this.vignette = $(r, '.vignette');
    this.digdown = $(r, '.digdown');
    this.titleLogo = $(r, '.titlelogo');
    this.toastEl = $(r, '.toast');
    this.scrim = $(r, '.scrim');
    this.panel = $(r, '.panel');
    this.buildRuler();
    $(r, '.pausebtn').addEventListener('click', () => {
      sfx.click();
      this.cb.pause();
    });
    this.actionEl.addEventListener('click', () => this.cb.action());
    for (const b of r.querySelectorAll<HTMLElement>('.tbtn')) this.controls.bindButton(b, b.dataset.b as 'left' | 'right' | 'up' | 'down');
    this.controls.bindStick($(r, '.stickzone'), $(r, '.stickknob'), $(r, '.stickbase'));
    this.applyControlStyle();
    this.scrim.addEventListener('pointerdown', (e) => {
      if (e.target === this.scrim && (this.modal === 'pause' || this.modal === 'settings')) this.cb.resume();
      if (e.target === this.scrim && this.modal === 'resume') this.cb.resume();
    });
  }

  applyControlStyle(): void {
    const stick = this.settings.controls === 'stick';
    $(this.root, '.stickzone').classList.toggle('on', stick);
    $(this.root, '.touch.lefthand').classList.toggle('on', !stick);
  }

  setTouch(on: boolean): void {
    document.body.classList.toggle('touch', on);
  }

  private buildRuler(): void {
    const total = WORLD.depth;
    let html = '';
    BIOMES.forEach((b, i) => {
      const col = ['#8a5634', '#5f5894', '#52665c', '#7b93a6', '#a33a24', '#42357f'][i];
      html += `<div class="band b${i}" style="top:${(b.top / total) * 100}%;height:${((b.bottom - b.top) / total) * 100}%;background:${col}"></div>`;
    });
    html += `<div class="mark rec"></div><div class="mark me"></div>`;
    this.ruler.innerHTML = html;
    this.rulerMe = $(this.ruler, '.me');
    this.rulerRec = $(this.ruler, '.rec');
  }

  // ------------------------------------------------------------ per frame
  update(dt: number, podScreen: { x: number; y: number } | null): void {
    const g = this.game();
    const depth = g.depth;
    // heat
    const hf = g.heatFrac;
    const lvl = hf >= HEAT.critical ? 3 : hf >= HEAT.danger ? 2 : hf >= HEAT.warn ? 1 : 0;
    this.heatEl.className = `heat pill l${lvl}`;
    this.heatFill.style.width = `${hf * 100}%`;
    this.heatLabel.textContent = t((['heatSafe', 'heatWarm', 'heatDanger', 'heatCritical'] as StrKey[])[lvl]);
    let warnHome = false;
    if (g.mode === 'expedition' && depth > 0.5) {
      const est = g.escapeEstimate();
      const at = Math.min(1, (g.heat + est.heat) / g.maxHeat);
      this.heatHome.style.display = 'block';
      this.heatHome.style.left = `${at * 100}%`;
      warnHome = g.heat + est.heat * 1.15 >= g.maxHeat * 0.92;
      this.heatHome.classList.toggle('warn', warnHome);
    } else this.heatHome.style.display = 'none';
    this.turnback.textContent = t('goHome');
    this.turnback.classList.toggle('on', warnHome && g.mode === 'expedition');
    this.vignette.style.opacity = g.underground ? String(Math.max(0, (hf - 0.72) / 0.28) * (this.settings.reducedMotion ? 0.5 : 1)) : '0';

    // depth and biome
    const b = g.biomeAt();
    const bname = depth < 0.5 ? t('surface') : t(`b_${BIOMES[b].id}` as StrKey);
    this.depthEl.innerHTML = `${meters(depth)}<small>${bname}</small>`;
    const goal = currentGoal(g);
    this.goalEl.innerHTML = `<b>▸</b> ${goal.text}`;

    // cargo / bank
    if (g.exp) {
      const n = g.cargoCount;
      $(this.cargoEl, '.slots').textContent = `${n}/${g.capacity}`;
      this.moneyEl.textContent = fmt(g.cargoValue);
      this.cargoEl.classList.toggle('full', n >= g.capacity);
      if (n !== this.lastCargo && this.lastCargo >= 0 && n > this.lastCargo) {
        this.cargoEl.classList.remove('bump');
        void this.cargoEl.offsetWidth;
        this.cargoEl.classList.add('bump');
      }
      this.lastCargo = n;
    } else {
      $(this.cargoEl, '.slots').textContent = `0/${g.capacity}`;
      this.moneyEl.textContent = fmt(g.profile.money);
      this.cargoEl.classList.remove('full');
      this.lastCargo = 0;
    }

    // ruler
    this.rulerMe.style.top = `${(Math.min(depth, WORLD.depth) / WORLD.depth) * 100}%`;
    this.rulerRec.style.top = `${(g.profile.stats.deepest / WORLD.depth) * 100}%`;
    BIOMES.forEach((_, i) => this.ruler.querySelector(`.b${i}`)!.classList.toggle('unknown', !g.profile.biomesSeen.includes(i)));

    // first dig prompt under the machine
    const showDig = g.profile.stats.tiles < 2 && g.mode === 'surface' && this.modal === 'none';
    this.digdown.classList.toggle('on', showDig && !!podScreen);
    if (showDig && podScreen) {
      this.digdown.style.left = `${podScreen.x}px`;
      this.digdown.style.top = `${podScreen.y + 20}px`;
      $(this.digdown, 'span').textContent = t('digDown');
    }
    this.titleLogo.classList.toggle('gone', !(g.profile.stats.runs === 0 && g.mode === 'surface' && depth < 0.2) || this.modal !== 'none');

    // contextual action
    let kind: 'lift' | 'recall' | 'shop' | null = null;
    if (g.mode === 'expedition' && g.padBiome >= 0) kind = 'lift';
    else if (g.mode === 'surface' && !g.exp && g.pod.y < GROUND_ROW) kind = 'shop';
    else if (g.canRecall && g.heatFrac > 0.55) kind = 'recall';
    if (this.modal !== 'none') kind = null;
    if (kind !== this.actionKind) {
      this.actionKind = kind;
      this.actionEl.classList.toggle('on', !!kind);
      this.actionEl.classList.toggle('danger', kind === 'recall');
      if (kind) this.actionEl.innerHTML = `${kind === 'lift' ? t('lift') : kind === 'recall' ? `${t('recall')} ${Math.round(g.recallKeep * 100)}%` : t('shop')} <kbd>E</kbd>`;
    }

    // overheat / recall alert
    if (g.mode === 'overheat') this.showAlert(t('haul_overheat'), '');
    else if (g.mode === 'recall') this.showAlert(t('haul_recall'), '');
    else this.alertEl.classList.remove('on');

    this.hud.classList.toggle('hidden', this.modal === 'workshop' || this.modal === 'ending');

    // banners and hints
    this.bannerT -= dt;
    if (this.bannerT <= 0) {
      if (this.banner.classList.contains('on')) {
        this.banner.classList.remove('on');
        this.bannerT = 0.35;
      } else if (this.bannerQueue.length) {
        const b2 = this.bannerQueue.shift()!;
        this.banner.innerHTML = `${b2.img ? `<img src="${b2.img}" alt="">` : ''}<div><div class="k">${b2.k}</div><div class="v">${b2.v}</div>${b2.s ? `<div class="s">${b2.s}</div>` : ''}</div>`;
        this.banner.classList.add('on');
        this.bannerT = 2.8;
      }
    }
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.hintEl.classList.remove('on');
    }
  }

  private showAlert(text: string, sub: string): void {
    this.alertEl.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.alertEl.classList.add('on');
  }

  showBanner(kind: string, value: string, sub?: string, img?: string): void {
    this.bannerQueue.push({ k: kind, v: value, s: sub, img });
  }

  showHint(key: string, text: string, seconds = 5): void {
    this.hintKey = key;
    this.hintEl.textContent = text;
    this.hintEl.classList.add('on');
    this.hintT = seconds;
  }
  hideHint(key?: string): void {
    if (key && key !== this.hintKey) return;
    this.hintT = 0;
    this.hintEl.classList.remove('on');
  }
  get hintShowing(): string {
    return this.hintT > 0 ? this.hintKey : '';
  }

  toast(text: string): void {
    const d = document.createElement('div');
    d.textContent = text;
    this.toastEl.appendChild(d);
    setTimeout(() => d.remove(), 2600);
    while (this.toastEl.children.length > 3) this.toastEl.firstChild!.remove();
  }

  // ------------------------------------------------------------ modals
  private open(modal: Modal, html: string, narrow = false): void {
    this.modal = modal;
    this.panel.className = `panel${narrow ? ' narrow' : ''}`;
    this.panel.innerHTML = html;
    this.scrim.classList.add('on');
    this.controls.releaseAll();
  }

  close(): void {
    this.modal = 'none';
    this.scrim.classList.remove('on');
    this.panel.innerHTML = '';
    if (this.haulTimer) clearTimeout(this.haulTimer);
    this.haulTimer = null;
  }

  openWorkshop(haul: Haul | null): void {
    const g = this.game();
    this.launchFrom = Math.max(0, ...g.profile.waystations.filter((b) => drillTier(g.level.drill) >= BIOME_TIER[b]), 0);
    if (!g.profile.waystations.includes(this.launchFrom)) this.launchFrom = 0;
    this.open('workshop', `
      <div class="row"><h2>${t('workshop')}</h2><span class="spacer"></span><span class="moneybar"></span></div>
      <div class="haulbox"></div>
      <div class="tabs">
        <button class="tab" data-tab="up">${t('upgrades')}</button>
        <button class="tab" data-tab="col">${t('collection')}</button>
        <button class="tab" data-tab="stats">${t('stats')}</button>
      </div>
      <div class="tabbody"></div>
      <div class="launchrow">
        <span class="goalline"></span>
        <span class="spacer"></span>
        <span class="from"></span>
        <button class="btn primary big launch">${t('launch')}</button>
      </div>`);
    const p = this.panel;
    if (haul) this.renderHaul($(p, '.haulbox'), haul);
    for (const tab of p.querySelectorAll<HTMLElement>('.tab'))
      tab.addEventListener('click', () => {
        sfx.click();
        this.workshopTab = tab.dataset.tab as 'up' | 'col' | 'stats';
        this.renderWorkshopBody();
      });
    $(p, '.launch').addEventListener('click', () => {
      sfx.click();
      this.cb.launch(this.launchFrom);
    });
    this.workshopTab = 'up';
    this.renderWorkshopBody();
    setTimeout(() => $<HTMLButtonElement>(p, '.launch')?.focus({ preventScroll: true }), 50);
  }

  private renderHaul(box: HTMLElement, h: Haul): void {
    const bad = h.kind === 'overheat' || h.kind === 'recall';
    const title = t(`haul_${h.kind}` as StrKey);
    const sub = h.kind === 'overheat' ? t('haul_overheat_sub') : h.kind === 'recall' ? t('haul_recall_sub') : `${meters(h.depth)} · ${Math.round(h.time)}s`;
    const items: string[] = [];
    for (const l of h.lines)
      items.push(`<span class="it"><img src="${oreIconUrls[l.ore]}" alt="">${l.count}× ${t(`o_${ORES[l.ore].key}` as StrKey)}${l.lost ? ` <span class="lost">−${l.lost}</span>` : ''}</span>`);
    if (h.chestMoney) items.push(`<span class="it">📦 ${t('haul_crates')} ${fmt(h.chestMoney)}</span>`);
    for (const a of h.artifacts) items.push(`<span class="it"><img src="${artifactIconUrls[a]}" alt="">${t(`a_${ARTIFACTS[a].key}` as StrKey)}</span>`);
    box.innerHTML = `<div class="haul${bad ? ' bad' : ''}">
      <div class="head"><b>${title}</b><span>${sub}</span></div>
      <div class="items">${items.join('') || `<span class="it in">${t('haul_empty')}</span>`}</div>
      <div class="row"><span>${t('haul_total')}</span><span class="total">$0</span>${h.newRecord ? `<span class="rec">${t('haul_record')}</span>` : ''}${h.lostValue > 0 ? `<span class="spacer"></span><span class="lost" style="color:var(--red);font-weight:800">${t('haul_lost', { n: fmt(h.lostValue) })}</span>` : ''}</div>
    </div>`;
    const its = [...box.querySelectorAll<HTMLElement>('.it')];
    const totalEl = $(box, '.total');
    let i = 0;
    const step = () => {
      if (i < its.length) {
        its[i].classList.add('in');
        sfx.coin(i);
        i++;
        this.haulTimer = setTimeout(step, Math.max(60, 260 - its.length * 15));
        return;
      }
      // count the total up
      const start = performance.now();
      const dur = Math.min(900, 300 + h.total / 50);
      const tick = () => {
        const k = Math.min(1, (performance.now() - start) / dur);
        totalEl.textContent = fmt(h.total * (1 - Math.pow(1 - k, 3)));
        if (k < 1) this.haulTimer = setTimeout(tick, 30);
        else sfx.bankDone(h.newRecord);
      };
      tick();
    };
    this.haulTimer = setTimeout(step, 250);
  }

  renderWorkshopBody(): void {
    if (this.modal !== 'workshop') return;
    const g = this.game();
    const p = this.panel;
    $(p, '.moneybar').textContent = fmt(g.profile.money);
    for (const tab of p.querySelectorAll<HTMLElement>('.tab')) tab.classList.toggle('on', tab.dataset.tab === this.workshopTab);
    const body = $(p, '.tabbody');
    if (this.workshopTab === 'up') body.innerHTML = this.upgradesHtml();
    else if (this.workshopTab === 'col') body.innerHTML = this.collectionHtml();
    else body.innerHTML = this.statsHtml();
    for (const btn of body.querySelectorAll<HTMLButtonElement>('.buy')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id as UpgradeId;
        if (this.cb.buy(id)) {
          sfx.upgrade();
          this.renderWorkshopBody();
          const card = $(this.panel, `.up[data-id="${id}"]`);
          card?.classList.add('flash');
        } else sfx.deny();
      });
    }
    // launch point choice
    const from = $(p, '.from');
    const ws = g.profile.waystations.filter((b) => b > 0).sort((a, b) => a - b);
    if (ws.length) {
      from.innerHTML = `<label class="row">${t('launchFrom')} <select class="fromsel">
        <option value="0">${t('surface')}</option>
        ${ws.map((b) => `<option value="${b}" ${b === this.launchFrom ? 'selected' : ''}>${t(`b_${BIOMES[b].id}` as StrKey)} · ${meters(BIOMES[b].top)}</option>`).join('')}
      </select></label>`;
      $<HTMLSelectElement>(from, '.fromsel').addEventListener('change', (e) => {
        this.launchFrom = Number((e.target as HTMLSelectElement).value);
      });
    } else from.innerHTML = '';
    $(p, '.goalline').innerHTML = `${t('nextGoal')}: <b>${currentGoal(g).text}</b>`;
  }

  private statText(id: UpgradeId, lv: number): string {
    const v = UPGRADES[id].values;
    const a = v[lv];
    const b = v[lv + 1];
    const pct = (x: number) => Math.round(x * 100);
    switch (id) {
      case 'drill': {
        const tierNow = drillTier(lv);
        const tierNext = b !== undefined ? drillTier(lv + 1) : tierNow;
        const base = b !== undefined ? t('stat_drill', { a: a.toFixed(1), b: b.toFixed(1) }) : a.toFixed(1);
        return tierNext > tierNow ? `${base} · ${t('stat_drill_tier', { rock: t(`r_${tierNext}` as StrKey) })}` : base;
      }
      case 'cooling':
        return b !== undefined ? t('stat_cooling', { a: pct(1 - a), b: pct(1 - b) }) : `−${pct(1 - a)}%`;
      case 'hull':
        return b !== undefined ? t('stat_hull', { a, b }) : String(a);
      case 'engine':
        return b !== undefined ? t('stat_engine', { a: (climbSpeed(lv) * METERS_PER_TILE).toFixed(0), b: (climbSpeed(lv + 1) * METERS_PER_TILE).toFixed(0) }) : String(climbSpeed(lv) * METERS_PER_TILE);
      case 'cargo':
        return b !== undefined ? t('stat_cargo', { a, b }) : String(a);
      case 'scanner':
        return b !== undefined ? t('stat_scanner', { a: a * METERS_PER_TILE, b: b * METERS_PER_TILE }) : String(a * METERS_PER_TILE);
      case 'recall':
        return b !== undefined ? t('stat_recall', { a: pct(a), b: pct(b) }) : `${pct(a)}%`;
    }
  }

  /** the upgrade the interface suggests: the drill when it gates the next layer, else the cheapest affordable */
  private suggestion(): UpgradeId | null {
    const g = this.game();
    const deepest = Math.max(...g.profile.biomesSeen);
    const next = Math.min(BIOMES.length - 1, deepest + 1);
    const drillCost = g.upgradeCost('drill');
    if (drillTier(g.level.drill) < BIOME_TIER[next] && drillCost !== null && drillCost <= g.profile.money) return 'drill';
    let best: UpgradeId | null = null;
    let bestCost = Infinity;
    for (const id of UPGRADE_ORDER) {
      const c = g.upgradeCost(id);
      if (c !== null && c <= g.profile.money && c < bestCost) {
        bestCost = c;
        best = id;
      }
    }
    return best;
  }

  private upgradesHtml(): string {
    const g = this.game();
    const sug = this.suggestion();
    return `<div class="upgrades">${UPGRADE_ORDER.map((id) => {
      const lv = g.level[id];
      const max = UPGRADES[id].costs.length;
      const cost = g.upgradeCost(id);
      const afford = cost !== null && cost <= g.profile.money;
      const pips = Array.from({ length: max }, (_, i) => `<span class="pip${i < lv ? ' on' : ''}"></span>`).join('');
      const label = cost === null ? t('maxed') : `${t('buy')} ${fmt(cost)}`;
      return `<div class="up${afford ? ' afford' : ''}${sug === id ? ' suggest' : ''}" data-id="${id}">
        <div class="top">${ICONS[id]}<span class="name">${t(`up_${id}` as StrKey)}${id === 'drill' ? ` Mk ${lv + 1}` : ''}</span><span class="pips">${pips}</span></div>
        <div class="desc">${t(`up_${id}_d` as StrKey)}</div>
        <div class="stat">${this.statText(id, lv)}</div>
        <button class="buy" data-id="${id}" ${afford ? '' : 'disabled'}>${afford || cost === null ? label : t('needMoney', { n: fmt(cost - g.profile.money) })}</button>
      </div>`;
    }).join('')}</div>`;
  }

  private collectionHtml(): string {
    const g = this.game();
    const have = g.profile.artifacts;
    const keys = KEYSTONES.filter((k) => have.includes(k)).length;
    return `<div class="goalline" style="margin-bottom:.5em">${t('keystones')}: <b>${keys}/${KEYSTONES.length}</b></div>
      <div class="collection">${ARTIFACTS.map((a, i) => {
        const got = have.includes(i);
        return `<div class="art${got ? '' : ' locked'}"><img src="${artifactIconUrls[i]}" alt=""><div><div class="n">${got ? t(`a_${a.key}` as StrKey) : t('undiscovered')}</div><div class="d">${got ? t(`a_${a.key}_d` as StrKey) : t(`b_${BIOMES[a.biome].id}` as StrKey)}</div></div></div>`;
      }).join('')}</div>`;
  }

  private statsHtml(): string {
    const s = this.game().profile.stats;
    const time = `${Math.floor(s.playSec / 3600)}h ${Math.floor((s.playSec % 3600) / 60)}m`;
    const rows: [StrKey, string][] = [
      ['statRuns', String(s.runs)],
      ['statEscapes', String(s.escapes + s.lifts)],
      ['statOverheats', String(s.overheats)],
      ['statDeepest', meters(s.deepest)],
      ['statBest', fmt(s.bestHaul)],
      ['statEarned', fmt(s.earned)],
      ['statTiles', s.tiles.toLocaleString('en')],
      ['statTime', time],
    ];
    return `<div class="stats">${rows.map(([k, v]) => `<span>${t(k)}</span><b>${v}</b>`).join('')}</div>`;
  }

  openPause(atSurface: boolean): void {
    this.open('pause', `<h2>${t('pause')}</h2><div class="menu">
      <button class="btn primary r">${t('resume')}</button>
      ${atSurface ? `<button class="btn w">${t('workshop')}</button>` : ''}
      <button class="btn s">${t('settings')}</button>
    </div>`, true);
    $(this.panel, '.r').addEventListener('click', () => this.cb.resume());
    this.panel.querySelector('.w')?.addEventListener('click', () => this.cb.openWorkshop());
    $(this.panel, '.s').addEventListener('click', () => this.cb.openSettings());
    setTimeout(() => $<HTMLButtonElement>(this.panel, '.r')?.focus({ preventScroll: true }), 30);
  }

  openResume(): void {
    this.open('resume', `<h2>${t('welcomeBack')}</h2><p>${t('resumeDive')}</p><div class="menu"><button class="btn primary big r">${t('resume')}</button></div>`, true);
    $(this.panel, '.r').addEventListener('click', () => this.cb.resume());
    setTimeout(() => $<HTMLButtonElement>(this.panel, '.r')?.focus({ preventScroll: true }), 30);
  }

  openSettings(): void {
    const s = this.settings;
    const seg = (name: string, opts: [string, string][], cur: string) =>
      `<span class="seg" data-name="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</span>`;
    this.open('settings', `<h2>${t('settings')}</h2><div class="settings">
      <label>${t('music')}<input type="range" min="0" max="1" step="0.05" value="${s.music}" data-k="music"></label>
      <label>${t('sounds')}<input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-k="sfx"></label>
      <label>${t('shake')}${seg('shake', [['1', t('on')], ['0', t('off')]], s.shake ? '1' : '0')}</label>
      <label>${t('reducedMotion')}${seg('reducedMotion', [['1', t('on')], ['0', t('off')]], s.reducedMotion ? '1' : '0')}</label>
      <label>${t('controls')}${seg('controls', [['buttons', t('ctrlButtons')], ['stick', t('ctrlStick')]], s.controls)}</label>
      <label>${t('language')}${seg('lang', Object.entries(LANG_NAMES), lang)}</label>
    </div>
    <div class="menu" style="margin-top:1em"><button class="btn primary c">${t('close')}</button><button class="btn reset" style="font-size:.85em">${t('resetSave')}</button></div>
    <div class="legal"><a href="./privacy.html" target="_blank" rel="noopener">${t('privacy')}</a><a href="./credits.html" target="_blank" rel="noopener">${t('credits')}</a></div>`, true);
    const p = this.panel;
    for (const input of p.querySelectorAll<HTMLInputElement>('input[type=range]'))
      input.addEventListener('input', () => {
        (s as unknown as Record<string, number>)[input.dataset.k!] = Number(input.value);
        this.cb.settingsChanged(s);
      });
    for (const sg of p.querySelectorAll<HTMLElement>('.seg'))
      for (const b of sg.querySelectorAll<HTMLButtonElement>('button'))
        b.addEventListener('click', () => {
          sfx.click();
          const name = sg.dataset.name!;
          const v = b.dataset.v!;
          if (name === 'shake' || name === 'reducedMotion') (s as unknown as Record<string, boolean>)[name] = v === '1';
          else if (name === 'controls') s.controls = v as 'buttons' | 'stick';
          else if (name === 'lang') s.lang = v;
          for (const o of sg.querySelectorAll('button')) o.classList.toggle('on', o === b);
          this.cb.settingsChanged(s);
          if (name === 'lang') this.openSettings();
          if (name === 'controls') this.applyControlStyle();
        });
    $(p, '.c').addEventListener('click', () => this.cb.resume());
    $(p, '.reset').addEventListener('click', () => {
      this.open('settings', `<h2>${t('resetSave')}</h2><p>${t('resetConfirm')}</p><div class="row"><button class="btn reset2">${t('yes')}</button><span class="spacer"></span><button class="btn primary no">${t('no')}</button></div>`, true);
      $(this.panel, '.reset2').addEventListener('click', () => this.cb.resetSave());
      $(this.panel, '.no').addEventListener('click', () => this.openSettings());
    });
  }

  openEnding(): void {
    this.open('ending', `<div style="text-align:center"><img src="${artifactIconUrls[ARTIFACTS.length - 1]}" style="width:6em;height:6em;image-rendering:pixelated" alt="">
      <h2>${t('endTitle')}</h2><p>${t('endText')}</p><button class="btn primary big k">${t('endButton')}</button></div>`, true);
    $(this.panel, '.k').addEventListener('click', () => this.cb.resume());
  }
}
