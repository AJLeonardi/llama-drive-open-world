import { CAR_IDS, CarId, MPH_PER_MS, SPECS } from '../vehicles/VehicleSpec';

export type Screen = 'loading' | 'title' | 'select' | 'driving' | 'paused' | 'wrecked' | 'underwater' | 'together' | 'cinema';

export interface HudCallbacks {
  play(): void;
  pickCar(id: CarId): void;
  openMenu(): void;
  resume(): void;
  newCar(): void;
  /** Same kind of car, good as new, right where the wreck happened. */
  fixHere(): void;
  startOver(): void;
  toggleSound(): boolean;
  nextCamera(): void;
  flip(): void;
  peekDamage(): void;
  /** Play together (from the title or the garage menu); while connected, the menu button leaves instead. */
  together(): void;
  /** Yes to the rocket: fly to space (or back to Earth). */
  board(): void;
}

const html = (s: string) => {
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content.firstElementChild as HTMLElement;
};

const STAT_DOTS = (n: number) => '●'.repeat(n) + '○'.repeat(5 - n);
const CAR_STATS: Record<CarId, { speed: number; tough: number }> = {
  bronco: { speed: 3, tough: 5 },
  lambo: { speed: 5, tough: 2 },
  wrangler: { speed: 3, tough: 4 },
};

/** All on-screen UI (plain DOM over the canvas). */
export class Hud {
  private root = document.getElementById('ui')!;
  private screens = new Map<Screen, HTMLElement>();
  private speedEl!: HTMLElement;
  private flipBtn!: HTMLElement;
  private boostEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private soundBtn!: HTMLElement;
  private wreckPanel!: HTMLElement;
  private togetherBtn!: HTMLElement;
  private toastEl!: HTMLElement;
  private toastTimer = 0;
  private promptBtn!: HTMLElement;
  private bigEl!: HTMLElement;
  private fadeEl!: HTMLElement;
  current: Screen = 'loading';

  constructor(cb: HudCallbacks) {
    const tap = (el: Element | null, fn: () => void) => el?.addEventListener('click', (e) => { e.stopPropagation(); fn(); });

    // Driving controls: ◀ ▶ bottom-left, GAS + REVERSE bottom-right.
    const controls = html(`
      <div class="controls">
        <div class="steer">
          <div class="ctl" data-ctl="left">◀</div>
          <div class="ctl" data-ctl="right">▶</div>
        </div>
        <div class="pedals">
          <div class="ctl reverse" data-ctl="reverse"><span class="arrow">▼</span>BACK</div>
          <div class="ctl gas" data-ctl="gas"><span class="arrow">▲</span>GAS</div>
        </div>
      </div>`);
    this.root.appendChild(controls);

    const top = html(`
      <div class="topbar">
        <button class="round" data-act="menu" aria-label="Garage">🚗</button>
        <div class="gauges">
          <div class="speed">0<small>MPH</small></div>
        </div>
        <button class="round" data-act="camera" aria-label="Camera">🎥</button>
      </div>`);
    this.root.appendChild(top);
    this.speedEl = top.querySelector('.speed')!;
    tap(top.querySelector('[data-act=menu]'), cb.openMenu);
    tap(top.querySelector('[data-act=camera]'), cb.nextCamera);

    this.boostEl = html(`<div class="boost-flash">BOOST! 🔥</div>`);
    this.root.appendChild(this.boostEl);
    this.flipBtn = html(`<button class="flip">Flip me over! ↻</button>`);
    this.root.appendChild(this.flipBtn);
    tap(this.flipBtn, cb.flip);
    // Parked by a rocket: "Fly to space?"
    this.promptBtn = html(`<button class="rocket-prompt"></button>`);
    this.root.appendChild(this.promptBtn);
    tap(this.promptBtn, cb.board);
    // The countdown (3, 2, 1, LIFTOFF!) and the white flash between Earth and space.
    this.bigEl = html(`<div class="big-text"></div>`);
    this.root.appendChild(this.bigEl);
    this.fadeEl = html(`<div class="fade"></div>`);
    this.root.appendChild(this.fadeEl);
    this.fpsEl = html(`<div class="fps"></div>`);
    this.root.appendChild(this.fpsEl);

    this.add('loading', `<div class="screen dim"><div class="loading">Building the cities… 🏗️</div></div>`);

    const title = this.add('title', `
      <div class="screen dim">
        <h1>LLAMA DRIVE</h1>
        <div class="subtitle">OPEN WORLD</div>
        <div class="title-buttons">
          <button class="big" data-act="play">▶ PLAY</button>
          <button class="big blue" data-act="together">👫 PLAY TOGETHER</button>
        </div>
        <div class="build">Build ${__BUILD_NUMBER__}</div>
      </div>`);
    tap(title.querySelector('[data-act=play]'), cb.play);
    tap(title.querySelector('[data-act=together]'), cb.together);

    const cards = CAR_IDS.map((id) => {
      const s = SPECS[id], st = CAR_STATS[id];
      return `<div class="card" data-car="${id}">
        <div class="name">${s.name}</div>
        <div class="blurb">${s.blurb}</div>
        <div class="stats"><span>Speed ${STAT_DOTS(st.speed)}</span><span>Tough ${STAT_DOTS(st.tough)}</span></div>
        <div class="go">DRIVE!</div>
      </div>`;
    }).join('');
    const select = this.add('select', `<div class="screen select"><h2>Pick your car!</h2><div class="cards">${cards}</div></div>`);
    select.querySelectorAll('.card').forEach((c) => tap(c, () => cb.pickCar((c as HTMLElement).dataset.car as CarId)));

    const menu = this.add('paused', `
      <div class="screen dim">
        <h2>Garage</h2>
        <div class="menu-buttons">
          <button class="big" data-act="resume">▶ Keep driving</button>
          <button class="big blue" data-act="newcar">🚙 New car</button>
          <button class="big orange" data-act="over">↺ Start over</button>
          <button class="big blue" data-act="together">👫 Play together</button>
        </div>
        <button class="big gray" data-act="sound">🔊 Sound on</button>
      </div>`);
    tap(menu.querySelector('[data-act=resume]'), cb.resume);
    tap(menu.querySelector('[data-act=newcar]'), cb.newCar);
    tap(menu.querySelector('[data-act=over]'), cb.startOver);
    this.togetherBtn = menu.querySelector('[data-act=together]')!;
    tap(this.togetherBtn, cb.together);
    this.toastEl = html(`<div class="friend-toast"></div>`);
    this.root.appendChild(this.toastEl);
    this.soundBtn = menu.querySelector('[data-act=sound]')!;
    tap(this.soundBtn, () => {
      const on = cb.toggleSound();
      this.soundBtn.textContent = on ? '🔊 Sound on' : '🔇 Sound off';
    });

    const wreck = this.add('wrecked', `
      <div class="screen dim">
        <div class="wreck-panel" style="display:flex;flex-direction:column;align-items:center">
          <h2>💥 Your car is wrecked! 💥</h2>
          <div class="wreck-msg">That was a BIG crash!</div>
          <div class="menu-buttons">
            <button class="big" data-act="fix">🔧 Fix it &amp; keep going</button>
            <button class="big orange" data-act="newcar">🚙 Pick a new car</button>
            <button class="big blue" data-act="peek">👀 Look at the damage</button>
          </div>
        </div>
        <button class="big peek" data-act="newcar2" style="display:none">🚙 Pick a new car</button>
      </div>`);
    this.wreckPanel = wreck.querySelector('.wreck-panel')!;
    const peekBtn = wreck.querySelector('[data-act=newcar2]') as HTMLElement;
    tap(wreck.querySelector('[data-act=fix]'), cb.fixHere);
    tap(wreck.querySelector('[data-act=newcar]'), cb.newCar);
    tap(peekBtn, cb.newCar);
    tap(wreck.querySelector('[data-act=peek]'), () => {
      this.wreckPanel.style.display = 'none';
      peekBtn.style.display = 'block';
      wreck.classList.remove('dim');
      wreck.style.pointerEvents = 'none';
      cb.peekDamage();
    });

    this.add('underwater', `<div class="screen underwater"><h2>🌊 SPLASH! 🐠 Say hi to the fish! 🐟</h2></div>`);
    // The rocket flight: nothing on screen but the countdown.
    this.add('cinema', `<div class="screen cinema"></div>`);
  }

  /** Small "new version" button (shown when an update arrives mid-game). */
  showUpdate(onTap: () => void) {
    if (this.root.querySelector('.update-btn')) return;
    const b = html(`<button class="update-btn">✨ New version — tap to update</button>`);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onTap();
    });
    this.root.appendChild(b);
  }

  /** A screen built elsewhere (the play-together screens). */
  addScreen(name: Screen, el: HTMLElement) {
    this.screens.set(name, el);
    this.root.appendChild(el);
  }

  /** While playing together, the garage menu's button leaves instead. */
  setTogether(connected: boolean) {
    this.togetherBtn.textContent = connected ? '👋 Stop playing together' : '👫 Play together';
  }

  /** A short message near the top that fades away. */
  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 3500);
  }

  private add(name: Screen, markup: string) {
    const el = html(markup);
    this.screens.set(name, el);
    this.root.appendChild(el);
    return el;
  }

  show(s: Screen) {
    this.current = s;
    for (const [name, el] of this.screens) el.classList.toggle('on', name === s);
    this.root.classList.toggle('driving', s === 'driving');
    this.root.classList.toggle('wrecked', s === 'wrecked');
    if (s === 'wrecked') {
      // Reset the "look at the damage" state each time.
      const el = this.screens.get('wrecked')!;
      this.wreckPanel.style.display = 'flex';
      (el.querySelector('[data-act=newcar2]') as HTMLElement).style.display = 'none';
      el.classList.add('dim');
      el.style.pointerEvents = '';
    }
    if (s !== 'driving') {
      this.setFlip(false);
      this.setPrompt(null);
    }
  }

  private lastMph = -1;

  // Only touch the DOM when what's shown actually changes (DOM writes are costly every frame).
  setSpeed(ms: number) {
    const mph = Math.round(Math.abs(ms) * MPH_PER_MS);
    if (mph === this.lastMph) return;
    this.lastMph = mph;
    this.speedEl.firstChild!.textContent = String(mph);
  }

  private flipOn = false;
  private boostOn = false;
  private promptText: string | null = null;
  private bigText: string | null = null;

  /** The rocket button (null hides it). */
  setPrompt(text: string | null) {
    if (text === this.promptText) return;
    this.promptText = text;
    this.promptBtn.classList.toggle('on', text !== null);
    if (text) this.promptBtn.textContent = text;
  }

  /** Big text in the middle of the screen (the countdown; null hides it). */
  setBig(text: string | null) {
    if (text === this.bigText) return;
    this.bigText = text;
    this.bigEl.classList.toggle('on', text !== null);
    if (text) {
      this.bigEl.textContent = text;
      // Restart the pop-in animation for each new number.
      this.bigEl.classList.remove('pop');
      void this.bigEl.offsetWidth;
      this.bigEl.classList.add('pop');
    }
  }

  /** Fade the screen to white (and back). */
  setFade(on: boolean) {
    this.fadeEl.classList.toggle('on', on);
  }

  /** Up in space there's no map of Earth to show. */
  setSpace(on: boolean) {
    this.root.classList.toggle('in-space', on);
  }

  setFlip(on: boolean) {
    if (on === this.flipOn) return;
    this.flipOn = on;
    this.flipBtn.classList.toggle('on', on);
  }

  setBoost(on: boolean) {
    if (on === this.boostOn) return;
    this.boostOn = on;
    this.boostEl.classList.toggle('on', on);
  }

  setFps(text: string | null) {
    this.fpsEl.classList.toggle('on', text !== null);
    if (text) this.fpsEl.textContent = text;
  }
}
