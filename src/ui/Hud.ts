import { CAR_IDS, CarId, MPH_PER_MS, SPECS } from '../vehicles/VehicleSpec';

export type Screen = 'loading' | 'title' | 'select' | 'driving' | 'paused' | 'wrecked' | 'underwater';

export interface HudCallbacks {
  play(): void;
  pickCar(id: CarId): void;
  openMenu(): void;
  resume(): void;
  newCar(): void;
  startOver(): void;
  toggleSound(): boolean;
  nextCamera(): void;
  flip(): void;
  peekDamage(): void;
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
  private healthBar!: HTMLElement;
  private healthLabel!: HTMLElement;
  private flipBtn!: HTMLElement;
  private boostEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private soundBtn!: HTMLElement;
  private wreckPanel!: HTMLElement;
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
          <div class="health"><div></div></div>
          <div class="health-label">CAR HEALTH</div>
        </div>
        <button class="round" data-act="camera" aria-label="Camera">🎥</button>
      </div>`);
    this.root.appendChild(top);
    this.speedEl = top.querySelector('.speed')!;
    this.healthBar = top.querySelector('.health > div')!;
    this.healthLabel = top.querySelector('.health-label')!;
    tap(top.querySelector('[data-act=menu]'), cb.openMenu);
    tap(top.querySelector('[data-act=camera]'), cb.nextCamera);

    this.boostEl = html(`<div class="boost-flash">BOOST! 🔥</div>`);
    this.root.appendChild(this.boostEl);
    this.flipBtn = html(`<button class="flip">Flip me over! ↻</button>`);
    this.root.appendChild(this.flipBtn);
    tap(this.flipBtn, cb.flip);
    this.fpsEl = html(`<div class="fps"></div>`);
    this.root.appendChild(this.fpsEl);

    this.add('loading', `<div class="screen dim"><div class="loading">Building the cities… 🏗️</div></div>`);

    const title = this.add('title', `
      <div class="screen dim">
        <h1>LLAMA DRIVE</h1>
        <div class="subtitle">OPEN WORLD</div>
        <button class="big">▶ PLAY</button>
        <div class="build">Build ${__BUILD_NUMBER__}</div>
      </div>`);
    tap(title.querySelector('.big'), cb.play);

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
        </div>
        <button class="big gray" data-act="sound">🔊 Sound on</button>
      </div>`);
    tap(menu.querySelector('[data-act=resume]'), cb.resume);
    tap(menu.querySelector('[data-act=newcar]'), cb.newCar);
    tap(menu.querySelector('[data-act=over]'), cb.startOver);
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
            <button class="big" data-act="newcar">🚙 Pick a new car</button>
            <button class="big blue" data-act="peek">👀 Look at the damage</button>
          </div>
        </div>
        <button class="big peek" data-act="newcar2" style="display:none">🚙 Pick a new car</button>
      </div>`);
    this.wreckPanel = wreck.querySelector('.wreck-panel')!;
    const peekBtn = wreck.querySelector('[data-act=newcar2]') as HTMLElement;
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
    if (s !== 'driving') this.setFlip(false);
  }

  private lastMph = -1;
  private lastHealth = -1;

  // Only touch the DOM when what's shown actually changes (DOM writes are costly every frame).
  setSpeed(ms: number) {
    const mph = Math.round(Math.abs(ms) * MPH_PER_MS);
    if (mph === this.lastMph) return;
    this.lastMph = mph;
    this.speedEl.firstChild!.textContent = String(mph);
  }

  setHealth(h: number) {
    h = Math.ceil(h);
    if (h === this.lastHealth) return;
    this.lastHealth = h;
    this.healthBar.style.width = `${Math.max(0, h)}%`;
    this.healthBar.style.background = h > 60 ? '#2ecc40' : h > 30 ? '#ffb000' : '#e8453c';
    this.healthLabel.textContent = h <= 0 ? 'WRECKED!' : h < 30 ? 'SMOKING!' : 'CAR HEALTH';
  }

  private flipOn = false;
  private boostOn = false;

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
