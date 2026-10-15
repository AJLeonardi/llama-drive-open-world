import type { DriveInput } from '../vehicles/VehicleSim';

export type Control = 'left' | 'right' | 'gas' | 'reverse';

/**
 * Touch buttons + keyboard → DriveInput.
 * Touches are hit-tested every move, so a finger can slide from ◀ to ▶ (or from
 * GAS to REVERSE) without lifting, and several fingers work at once.
 */
export class Controls {
  private touchPressed = new Set<Control>();
  private mousePressed = new Set<Control>();
  private keys = new Set<string>();
  private steer = 0;
  onKey: ((key: string) => void) | null = null;

  constructor() {
    const handleTouches = (e: TouchEvent) => {
      const next = new Set<Control>();
      let onControl = false;
      for (const t of Array.from(e.touches)) {
        const el = document.elementFromPoint(t.clientX, t.clientY)?.closest('[data-ctl]') as HTMLElement | null;
        if (el) {
          next.add(el.dataset.ctl as Control);
          onControl = true;
        }
      }
      for (const c of ['left', 'right', 'gas', 'reverse'] as Control[]) {
        const el = document.querySelector(`[data-ctl="${c}"]`);
        el?.classList.toggle('pressed', next.has(c));
      }
      this.touchPressed = next;
      if (onControl && e.cancelable) e.preventDefault();
    };
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
      document.addEventListener(type, handleTouches as EventListener, { passive: false });

    // Mouse (desktop testing)
    document.addEventListener('mousedown', (e) => {
      const el = (e.target as HTMLElement).closest?.('[data-ctl]') as HTMLElement | null;
      if (el) this.mousePressed.add(el.dataset.ctl as Control);
    });
    document.addEventListener('mouseup', () => this.mousePressed.clear());

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      this.onKey?.(e.key.toLowerCase());
      if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.touchPressed.clear();
      this.mousePressed.clear();
    });
  }

  private down(c: Control) {
    if (this.touchPressed.has(c) || this.mousePressed.has(c)) return true;
    const k = this.keys;
    switch (c) {
      case 'left': return k.has('arrowleft') || k.has('a');
      case 'right': return k.has('arrowright') || k.has('d');
      case 'gas': return k.has('arrowup') || k.has('w');
      case 'reverse': return k.has('arrowdown') || k.has('s');
    }
  }

  /** Steering eases in (digital buttons → smooth value) so taps don't jerk the car. */
  read(dt: number): DriveInput {
    const target = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    const rate = target === 0 ? 6 : 4;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));
    return { steer: this.steer, throttle: this.down('gas') ? 1 : 0, reverse: this.down('reverse') ? 1 : 0 };
  }

  reset() {
    this.steer = 0;
  }
}
