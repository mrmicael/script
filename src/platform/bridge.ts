// All platform SDK traffic goes through here. Gameplay code never touches a
// portal SDK directly; it talks to a PlatformBridge, and outside a portal (or
// when its SDK fails) the LocalPlatformBridge keeps everything working with
// localStorage and no ads. Each portal adapter lives in its own file and only
// the one a build targets is bundled (see ./index.ts).

export type AdResult = 'finished' | 'unavailable' | 'error';

/** the signed-in portal player, for display only */
export interface PlatformAccount {
  name: string;
  avatar: string | null;
}

export type DeviceType = 'desktop' | 'tablet' | 'mobile';

export interface PlatformBridge {
  readonly name: string;
  readonly adsEnabled: boolean;
  init(): Promise<void>;
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  happytime(): void;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /** midgame ad between runs. Resolves when the game may continue. */
  midgameAd(onStart: () => void): Promise<AdResult>;
  rewardedAd(onStart: () => void): Promise<AdResult>;
  locale(): string;
  /** platform-level mute (CrazyGames muteAudio). Takes priority over game settings. */
  muted(): boolean;
  onMuteChange(cb: (muted: boolean) => void): void;
  /** host asks the game to pause (tab switch, ad, overlay). Optional per platform. */
  onPauseChange(cb: (paused: boolean) => void): void;

  // --- optional platform features: the local bridge answers with no-ops ---
  /** device class as the portal detects it, when it does */
  deviceType(): DeviceType | null;
  /** the signed-in portal player, or null for a guest */
  account(): PlatformAccount | null;
  /** label for a guest's sign-in button, or null when there is nothing to sign in to */
  readonly loginLabel: string | null;
  /** one line on what signing in adds, shown under the button */
  readonly loginHint: string | null;
  /** open the portal's sign-in. Call it straight from the click: it may open a popup. */
  login(): void;
  onAccountChange(cb: (account: PlatformAccount | null) => void): void;
  /** cloud progress replaced the local save after a sign-in: reload at a calm moment */
  onProgressReplaced(cb: () => void): void;
  /** a save could not reach the portal; the message is shown to the player */
  onSaveError(cb: (message: string) => void): void;
  /** share of the game completed, 0..100, never going backwards */
  reportProgress(percent: number): void;
  /** what the player is doing, attached to feedback they send; null clears it */
  setContext(context: Record<string, string | number> | null): void;
  readonly hasLeaderboard: boolean;
  submitScore(board: string, score: number): void;
  showLeaderboard(board?: string): void;
  unlockAchievement(id: string): void;
  /** anonymous gameplay event for the portal's statistics */
  track(event: string, value?: number): void;
  /** true when the build is running on a site known to copy games */
  isUnauthorizedHost(): Promise<boolean>;
}

export class LocalPlatformBridge implements PlatformBridge {
  readonly name: string = 'local';
  adsEnabled = false;
  private mem = new Map<string, string>();
  get loginLabel(): string | null {
    return null;
  }
  get loginHint(): string | null {
    return null;
  }
  get hasLeaderboard(): boolean {
    return false;
  }
  async init(): Promise<void> {}
  loadingStart(): void {}
  loadingStop(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  happytime(): void {}
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return this.mem.get(key) ?? null;
    }
  }
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      this.mem.set(key, value);
    }
  }
  async midgameAd(_onStart: () => void): Promise<AdResult> {
    return 'unavailable';
  }
  async rewardedAd(_onStart: () => void): Promise<AdResult> {
    return 'unavailable';
  }
  locale(): string {
    return navigator.language || 'en';
  }
  muted(): boolean {
    return false;
  }
  onMuteChange(_cb: (muted: boolean) => void): void {}
  onPauseChange(_cb: (paused: boolean) => void): void {}
  deviceType(): DeviceType | null {
    return null;
  }
  account(): PlatformAccount | null {
    return null;
  }
  login(): void {}
  onAccountChange(_cb: (account: PlatformAccount | null) => void): void {}
  onProgressReplaced(_cb: () => void): void {}
  onSaveError(_cb: (message: string) => void): void {}
  reportProgress(_percent: number): void {}
  setContext(_context: Record<string, string | number> | null): void {}
  submitScore(_board: string, _score: number): void {}
  showLeaderboard(_board?: string): void {}
  unlockAchievement(_id: string): void {}
  track(_event: string, _value?: number): void {}
  async isUnauthorizedHost(): Promise<boolean> {
    return false;
  }
}

export function loadScript(src: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    const t = setTimeout(() => reject(new Error('sdk timeout')), timeoutMs);
    s.onload = () => {
      clearTimeout(t);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(t);
      reject(new Error('sdk load failed'));
    };
    document.head.appendChild(s);
  });
}

/** settle within `ms` either way: a portal promise that never resolves must not hang boot */
export async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(what + ' timeout')), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}
