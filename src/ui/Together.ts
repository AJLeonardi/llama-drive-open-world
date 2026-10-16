import { Link } from '../net/Link';
import { decodeSignal } from '../net/signal';
import { QrScanner, qrSvg } from './QrScanner';

export interface TogetherCallbacks {
  connected(link: Link, isHost: boolean): void;
  back(): void;
  click(): void;
}

/** After the last code is scanned, give up connecting after this long (ms). */
const CONNECT_TIMEOUT = 15000;

const html = (s: string) => {
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content.firstElementChild as HTMLElement;
};

/**
 * "Play together" screens: one device shows a code and then scans the friend's; the other
 * scans first and then shows its own. Short words and big pictures (the players are 7).
 */
export class Together {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private link: Link | null = null;
  private scanner: QrScanner | null = null;
  private timeout = 0;
  /** Bumped on every screen change, so late async steps of an old flow do nothing. */
  private flow = 0;

  constructor(private readonly cb: TogetherCallbacks, private readonly debug: boolean) {
    this.el = html(`<div class="screen dim together"><div class="together-body"></div></div>`);
    this.body = this.el.querySelector('.together-body')!;
  }

  open() {
    this.choose();
  }

  /** Stop everything (leaving the screen without connecting). */
  close() {
    this.flow++;
    this.stopCamera();
    clearTimeout(this.timeout);
    this.link?.close();
    this.link = null;
  }

  private tap(sel: string, fn: () => void) {
    this.body.querySelector(sel)?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.click();
      fn();
    });
  }

  private show(markup: string) {
    this.body.innerHTML = markup;
    this.tap('[data-act=back]', () => {
      this.close();
      this.cb.back();
    });
  }

  private choose() {
    this.close();
    this.show(`
      <h2>👫 Play together!</h2>
      <div class="together-hint">Both on the same Wi-Fi. One shows a code, the other scans it.</div>
      <div class="menu-buttons">
        <button class="big blue" data-act="host">📱 Show my code</button>
        <button class="big orange" data-act="join">📷 Scan a code</button>
      </div>
      <button class="big gray" data-act="back">← Back</button>`);
    this.tap('[data-act=host]', () => this.host());
    this.tap('[data-act=join]', () => this.join());
  }

  private async host() {
    const flow = ++this.flow;
    this.show(`
      <div class="together-row">
        <div class="together-step">
          <div class="step-title">1. Friend scans this</div>
          <div class="qr"><div class="qr-wait">Making your code…</div></div>
        </div>
        <div class="together-step">
          <div class="step-title">2. Then show me their code</div>
          <div class="cam"><video></video><button class="cam-flip" aria-label="Switch camera">🔄</button></div>
        </div>
      </div>
      <div class="together-status"></div>
      ${this.debugBox()}
      <button class="big gray" data-act="back">← Back</button>`);
    // Camera first: Safari only shares the real local address (instead of a private
    // name) once the camera is allowed, and real addresses connect more reliably.
    // Don't wait forever on the permission question, though: the private name works too.
    const cam = this.startCamera('user', (code) => this.gotAnswer(code, flow));
    const camOk = await Promise.race([cam, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
    if (flow !== this.flow) return;
    if (camOk === false) this.status('📷 No camera? Ask a grown-up to allow the camera.');
    try {
      const { link, code } = await Link.host();
      if (flow !== this.flow) return link.close();
      this.link = link;
      link.onOpen = () => this.connected(link, true, flow);
      await this.showCode(code);
    } catch (err) {
      this.fail(err);
    }
  }

  private async gotAnswer(text: string, flow: number) {
    if (flow !== this.flow || !this.link) return;
    let kind;
    try {
      kind = decodeSignal(text).kind;
    } catch {
      return; // some other QR code: keep looking
    }
    if (kind !== 'answer') return; // our own code reflected, or the friend is also hosting
    this.stopCamera();
    this.status('🔌 Connecting…');
    try {
      await this.link.accept(text);
      this.waitForOpen(flow);
    } catch (err) {
      this.fail(err);
    }
  }

  private async join() {
    const flow = ++this.flow;
    this.show(`
      <div class="together-row">
        <div class="together-step">
          <div class="step-title">Point at your friend's code</div>
          <div class="cam big-cam"><video></video><button class="cam-flip" aria-label="Switch camera">🔄</button></div>
        </div>
      </div>
      <div class="together-status"></div>
      ${this.debugBox()}
      <button class="big gray" data-act="back">← Back</button>`);
    const camOk = await this.startCamera('environment', (code) => this.gotOffer(code, flow));
    if (flow !== this.flow) return;
    if (!camOk) this.status('📷 No camera? Ask a grown-up to allow the camera.');
  }

  private async gotOffer(text: string, flow: number) {
    if (flow !== this.flow || this.link) return;
    try {
      if (decodeSignal(text).kind !== 'offer') return;
    } catch {
      return;
    }
    this.stopCamera();
    this.status('Making your code…');
    try {
      const { link, code } = await Link.join(text);
      if (flow !== this.flow) return link.close();
      this.link = link;
      link.onOpen = () => this.connected(link, false, flow);
      this.show(`
        <div class="together-row">
          <div class="together-step">
            <div class="step-title">Now your friend scans this!</div>
            <div class="qr"></div>
          </div>
        </div>
        <div class="together-status">Waiting for your friend…</div>
        ${this.debugBox()}
        <button class="big gray" data-act="back">← Back</button>`);
      await this.showCode(code);
      // The friend may take a while to scan; give up only after a long wait.
      this.timeout = window.setTimeout(() => this.fail(new Error('timed out')), 120000);
    } catch (err) {
      this.fail(err);
    }
  }

  private waitForOpen(flow: number) {
    clearTimeout(this.timeout);
    this.timeout = window.setTimeout(() => {
      if (flow === this.flow) this.fail(new Error('timed out'));
    }, CONNECT_TIMEOUT);
  }

  private connected(link: Link, isHost: boolean, flow: number) {
    if (flow !== this.flow) return;
    clearTimeout(this.timeout);
    this.stopCamera();
    this.link = null; // it's the game's now
    this.flow++;
    this.show(`<h2>🎉 Connected! 🎉</h2>`);
    setTimeout(() => this.cb.connected(link, isHost), 900);
  }

  private fail(err: unknown) {
    console.warn('[net]', err);
    const flow = this.flow;
    this.close();
    this.flow = flow + 1;
    this.show(`
      <h2>😕 That didn't work</h2>
      <div class="together-hint">Are you both on the same Wi-Fi? Let's try again!</div>
      <div class="menu-buttons">
        <button class="big" data-act="again">↺ Try again</button>
      </div>
      <button class="big gray" data-act="back">← Back</button>`);
    this.tap('[data-act=again]', () => this.choose());
  }

  private async showCode(code: string) {
    const box = this.body.querySelector('.qr');
    if (box) box.innerHTML = await qrSvg(code);
    const mine = this.body.querySelector('.debug-mine') as HTMLTextAreaElement | null;
    if (mine) mine.value = code;
  }

  private status(text: string) {
    const s = this.body.querySelector('.together-status');
    if (s) s.textContent = text;
  }

  private async startCamera(facing: 'user' | 'environment', onCode: (text: string) => void) {
    // Typed/pasted codes (debug: testing on desktops without a second camera).
    const paste = this.body.querySelector('.debug-paste') as HTMLTextAreaElement | null;
    paste?.addEventListener('input', () => onCode(paste.value));
    const video = this.body.querySelector('video');
    if (!video || !navigator.mediaDevices?.getUserMedia) return false;
    const scanner = new QrScanner(video, facing, onCode);
    this.scanner = scanner;
    this.body.querySelector('.cam-flip')?.addEventListener('click', (e) => {
      e.stopPropagation();
      scanner.flip().catch(() => {});
    });
    try {
      await scanner.start();
      return true;
    } catch (err) {
      console.warn('[net] camera', err);
      return false;
    }
  }

  private stopCamera() {
    this.scanner?.stop();
    this.scanner = null;
  }

  private debugBox() {
    if (!this.debug) return '';
    return `<div class="debug-codes">
      <textarea class="debug-mine" readonly placeholder="my code"></textarea>
      <textarea class="debug-paste" placeholder="paste friend's code"></textarea>
    </div>`;
  }
}
