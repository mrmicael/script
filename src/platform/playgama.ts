// Playgama Bridge (JS Core, loaded from the Playgama CDN). Checked against
// wiki.playgama.com (Bridge getting started, setup, API required steps,
// storage, platform, interstitial, config, game checklist) on 2026-10-07.

import { LocalPlatformBridge, loadScript, within, type AdResult } from './bridge';

type PGInterstitialState = 'loading' | 'opened' | 'closed' | 'failed';
type PGRewardedState = 'loading' | 'opened' | 'closed' | 'rewarded' | 'failed';

interface PGBridge {
  initialize(): Promise<void>;
  EVENT_NAME: { AUDIO_STATE_CHANGED: string; PAUSE_STATE_CHANGED: string; INTERSTITIAL_STATE_CHANGED: string; REWARDED_STATE_CHANGED: string };
  platform: {
    id: string;
    language: string;
    isAudioEnabled: boolean;
    sendMessage(message: string): Promise<void> | void;
    on(event: string, cb: (value: boolean) => void): void;
  };
  storage: {
    get(keys: string[]): Promise<(string | null | object)[]>;
    set(keys: string[], values: string[]): Promise<void>;
  };
  advertisement: {
    isInterstitialSupported: boolean;
    interstitialState: PGInterstitialState;
    showInterstitial(placement?: string): void;
    isRewardedSupported?: boolean;
    showRewarded?(placement?: string): void;
    on(event: string, cb: (state: PGInterstitialState & PGRewardedState) => void): void;
  };
}

declare global {
  interface Window {
    bridge?: PGBridge;
  }
}

const PG_SDK_URL = 'https://bridge.playgama.com/v2/stable/playgama-bridge.js';

/**
 * Playgama: saves go through bridge.storage (read once at boot, then served
 * from memory so the game keeps its synchronous save API), the host gets
 * game_ready, and its pause/audio events reach the game.
 */
export class PlaygamaPlatformBridge extends LocalPlatformBridge {
  readonly name: string = 'playgama';
  private sdk: PGBridge | null = null;
  private cache = new Map<string, string>();
  private writes: Promise<unknown> = Promise.resolve();
  private adBusy = false;
  private adCb: ((s: PGInterstitialState) => void) | null = null;
  private rewardCb: ((s: PGRewardedState) => void) | null = null;
  private muteCbs: ((m: boolean) => void)[] = [];
  private pauseCbs: ((p: boolean) => void)[] = [];
  private audioOn = true;
  private readySent = false;
  /** messages the Bridge accepted, in order (read by tools/qa/playgama.cjs) */
  readonly sent: string[] = [];

  constructor(private keys: string[]) {
    super();
  }

  async init(): Promise<void> {
    try {
      if (!window.bridge) await loadScript(PG_SDK_URL, 8000);
      const sdk = window.bridge;
      if (!sdk) throw new Error('no bridge');
      await within(sdk.initialize(), 10000, 'bridge init');
      this.sdk = sdk;
    } catch (e) {
      console.warn('[platform] Playgama Bridge unavailable, running locally', e);
      this.sdk = null;
      return;
    }
    const sdk = this.sdk;
    // progress first: everything after boot reads it synchronously
    try {
      const values = await sdk.storage.get(this.keys);
      this.keys.forEach((k, i) => {
        const v = values?.[i];
        if (v === null || v === undefined) return;
        this.cache.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      });
    } catch (e) {
      console.warn('[platform] Bridge storage could not be read', e);
    }
    this.audioOn = sdk.platform.isAudioEnabled !== false;
    try {
      sdk.platform.on(sdk.EVENT_NAME.AUDIO_STATE_CHANGED, (on) => {
        this.audioOn = !!on;
        for (const cb of this.muteCbs) cb(!this.audioOn);
      });
      sdk.platform.on(sdk.EVENT_NAME.PAUSE_STATE_CHANGED, (paused) => {
        for (const cb of this.pauseCbs) cb(!!paused);
      });
      sdk.advertisement.on(sdk.EVENT_NAME.INTERSTITIAL_STATE_CHANGED, (state) => this.adCb?.(state));
      if (sdk.EVENT_NAME.REWARDED_STATE_CHANGED) sdk.advertisement.on(sdk.EVENT_NAME.REWARDED_STATE_CHANGED, (state) => this.rewardCb?.(state));
    } catch (e) {
      console.warn('[platform] Bridge events', e);
    }
    this.adsEnabled = !!sdk.advertisement.isInterstitialSupported;
  }

  private send(message: string): void {
    if (!this.sdk) return;
    try {
      const r = this.sdk.platform.sendMessage(message);
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
      this.sent.push(message);
    } catch {
      /* a message this platform does not relay */
    }
  }

  loadingStart(): void {}
  loadingStop(): void {
    if (this.readySent) return;
    this.readySent = true;
    this.send('game_ready');
  }
  gameplayStart(): void {}
  gameplayStop(): void {}
  happytime(): void {
    this.send('player_got_achievement');
  }
  getItem(key: string): string | null {
    if (!this.sdk) return super.getItem(key);
    return this.cache.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (!this.sdk) {
      super.setItem(key, value);
      return;
    }
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    const sdk = this.sdk;
    // one write at a time, in order: a slow cloud save must never land after a newer one
    this.writes = this.writes.then(() => sdk.storage.set([key], [value])).catch((e) => console.warn('[platform] Bridge save failed', e));
  }

  /** opt-in ad: 'finished' only when Bridge says the reward was earned */
  rewardedAd(onStart: () => void): Promise<AdResult> {
    const sdk = this.sdk;
    if (!sdk || !sdk.advertisement.isRewardedSupported || !sdk.advertisement.showRewarded || this.adBusy) return Promise.resolve('unavailable');
    this.adBusy = true;
    return new Promise<AdResult>((resolve) => {
      let done = false;
      let earned = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const finish = (r: AdResult) => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        this.rewardCb = null;
        this.adBusy = false;
        resolve(r);
      };
      const arm = (ms: number, r: AdResult) => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => finish(r), ms);
      };
      this.rewardCb = (state) => {
        if (state === 'loading') arm(10000, 'unavailable');
        else if (state === 'opened') {
          arm(180000, 'error');
          onStart();
        } else if (state === 'rewarded') earned = true;
        else if (state === 'closed') finish(earned ? 'finished' : 'unavailable');
        else if (state === 'failed') finish('unavailable');
      };
      arm(4000, 'unavailable');
      try {
        sdk.advertisement.showRewarded!('reward');
      } catch {
        finish('error');
      }
    });
  }

  midgameAd(onStart: () => void): Promise<AdResult> {
    const sdk = this.sdk;
    if (!sdk || !this.adsEnabled || this.adBusy) return Promise.resolve('unavailable');
    this.adBusy = true;
    return new Promise<AdResult>((resolve) => {
      let done = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const finish = (r: AdResult) => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        this.adCb = null;
        this.adBusy = false;
        resolve(r);
      };
      // Bridge may skip a request without a word (minimum delay between ads): never wait long for nothing
      const arm = (ms: number, r: AdResult) => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => finish(r), ms);
      };
      this.adCb = (state) => {
        if (state === 'loading') arm(8000, 'unavailable');
        else if (state === 'opened') {
          arm(120000, 'error');
          onStart();
        } else if (state === 'closed') finish('finished');
        else if (state === 'failed') finish('unavailable');
      };
      arm(2500, 'unavailable');
      try {
        sdk.advertisement.showInterstitial('game_over');
      } catch {
        finish('error');
      }
    });
  }
  locale(): string {
    return this.sdk?.platform.language || navigator.language || 'en';
  }
  muted(): boolean {
    return !!this.sdk && !this.audioOn;
  }
  onMuteChange(cb: (muted: boolean) => void): void {
    this.muteCbs.push(cb);
  }
  onPauseChange(cb: (paused: boolean) => void): void {
    this.pauseCbs.push(cb);
  }
}
