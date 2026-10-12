// Keyboard and touch, merged into the one Input the simulation reads.
// Touch controls are DOM buttons (big, multi-touch, never stuck: every
// pointer that leaves or is cancelled releases its button).

import type { Input } from '../sim/game';

type Btn = 'left' | 'right' | 'up' | 'down';

export class Controls {
  private keys = new Set<string>();
  private touch: Record<Btn, Set<number>> = { left: new Set(), right: new Set(), up: new Set(), down: new Set() };
  private stick = { x: 0, y: 0, id: -1 };
  private actionQueued = false;
  private pauseQueued = false;
  /** set by the first touch on the page: switches the interface to touch layout */
  onTouchDetected: (() => void) | null = null;
  touchUsed = false;
  /** any input at all, for "first interaction" timing */
  onAnyInput: (() => void) | null = null;
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'w', 'a', 's', 'd'].includes(k)) e.preventDefault();
      if (!e.repeat) {
        if (k === 'escape' || k === 'p') this.pauseQueued = true;
        if (k === 'e' || k === 'enter' || k === 'r' || k === 'f') this.actionQueued = true;
      }
      this.keys.add(k);
      this.onAnyInput?.();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    window.addEventListener(
      'touchstart',
      () => {
        if (!this.touchUsed) {
          this.touchUsed = true;
          this.onTouchDetected?.();
        }
      },
      { passive: true, capture: true },
    );
  }

  releaseAll(): void {
    this.keys.clear();
    for (const b of Object.values(this.touch)) b.clear();
    this.stick = { x: 0, y: 0, id: -1 };
  }

  read(): Input {
    if (!this.enabled) return { x: 0, up: false, down: false };
    const k = this.keys;
    let x = 0;
    if (k.has('arrowleft') || k.has('a') || this.touch.left.size) x -= 1;
    if (k.has('arrowright') || k.has('d') || this.touch.right.size) x += 1;
    let up = k.has('arrowup') || k.has('w') || k.has(' ') || this.touch.up.size > 0;
    let down = k.has('arrowdown') || k.has('s') || this.touch.down.size > 0;
    if (this.stick.id >= 0) {
      if (Math.abs(this.stick.x) > 0.38) x = Math.sign(this.stick.x);
      if (this.stick.y < -0.42) up = true;
      if (this.stick.y > 0.42) down = true;
    }
    return { x, up, down };
  }

  takeAction(): boolean {
    const a = this.actionQueued;
    this.actionQueued = false;
    return a;
  }
  takePause(): boolean {
    const p = this.pauseQueued;
    this.pauseQueued = false;
    return p;
  }
  queueAction(): void {
    this.actionQueued = true;
  }

  /** wire a DOM button to a direction */
  bindButton(el: HTMLElement, btn: Btn): void {
    const set = this.touch[btn];
    const down = (e: PointerEvent) => {
      e.preventDefault();
      set.add(e.pointerId);
      el.classList.add('held');
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
      this.onAnyInput?.();
    };
    const up = (e: PointerEvent) => {
      set.delete(e.pointerId);
      if (!set.size) el.classList.remove('held');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** a floating stick: touch anywhere in the zone, drag to steer */
  bindStick(zone: HTMLElement, knob: HTMLElement, base: HTMLElement): void {
    let ox = 0;
    let oy = 0;
    const R = 46;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stick.id >= 0) return;
      e.preventDefault();
      this.stick.id = e.pointerId;
      const r = zone.getBoundingClientRect();
      ox = e.clientX;
      oy = e.clientY;
      base.style.left = `${ox - r.left}px`;
      base.style.top = `${oy - r.top}px`;
      base.classList.add('on');
      knob.style.transform = 'translate(-50%, -50%)';
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic */
      }
      this.onAnyInput?.();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      let dx = (e.clientX - ox) / R;
      let dy = (e.clientY - oy) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      this.stick.x = dx;
      this.stick.y = dy;
      knob.style.transform = `translate(calc(-50% + ${dx * R}px), calc(-50% + ${dy * R}px))`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick = { x: 0, y: 0, id: -1 };
      base.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }
}
