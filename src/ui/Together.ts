import { Link } from '../net/Link';
import { decodeSignal } from '../net/signal';
import { QrScanner, qrSvg } from './QrScanner';

export interface TogetherCallbacks {
  connected(link: Link, isHost: boolean): void;
  back(): void;
  click(): void;
}

/** After the friend's answer is scanned, give up connecting after this long (ms). */
const CONNECT_TIMEOUT = 15000;
/** After showing our answer, give up if the friend hasn't scanned it in this long (ms). */
const ANSWER_TIMEOUT = 60000;

const html = (s: string) => {
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content.firstElementChild as HTMLElement;
};

/**
 * "Play together": one screen, the same on both devices. Each shows its code and scans the
 * friend's, screens held up to each other. Both codes start as offers; the device whose
 * offer sorts lower answers the other's instead (its code turns into the answer), and the
 * other connects once it scans that. Short words and big pictures (the players are 7).
 */
export class Together {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private link: Link | null = null;
  private scanner: QrScanner | null = null;
  private timeout = 0;
  /** Our offer code, once made. */
  private myOffer: string | null = null;
  /** We answered the friend's offer (our code is now the answer). */
  private answering = false;
  /** An async step (answering, accepting) is under way. */
  private busy = false;
  /** Bumped on every screen change, so late async steps of an old flow do nothing. */
  private flow = 0;

  constructor(private readonly cb: TogetherCallbacks, private readonly debug: boolean) {
    this.el = html(`<div class="screen dim together"><div class="together-body"></div></div>`);
    this.body = this.el.querySelector('.together-body')!;
  }

  /** Stop everything (leaving the screen without connecting). */
  close() {
    this.flow++;
    this.stopCamera();
    clearTimeout(this.timeout);
    this.link?.close();
    this.link = null;
    this.myOffer = null;
    this.answering = false;
    this.busy = false;
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

  async open() {
    this.close();
    const flow = this.flow;
    this.show(`
      <h2>👫 Play together!</h2>
      <div class="together-hint">Same Wi-Fi. Hold the screens up to each other!</div>
      <div class="together-row">
        <div class="qr"><div class="qr-wait">Making your code…</div></div>
        <div class="cam"><video></video><button class="cam-flip" aria-label="Switch camera">🔄</button></div>
      </div>
      <div class="together-status"></div>
      ${this.debugBox()}
      <button class="big gray" data-act="back">← Back</button>`);
    // Camera first: Safari only shares the real local address (instead of a private
    // name) once the camera is allowed, and real addresses connect more reliably.
    // Don't wait forever on the permission question, though: the private name works too.
    const cam = this.startCamera((code) => this.gotCode(code, flow));
    const camOk = await Promise.race([cam, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
    if (flow !== this.flow) return;
    if (camOk === false) this.status('📷 No camera? Ask a grown-up to allow the camera.');
    try {
      const { link, code } = await Link.host();
      if (flow !== this.flow) return link.close();
      this.link = link;
      this.myOffer = code;
      link.onOpen = () => this.connected(link, true, flow);
      await this.showCode(code);
    } catch (err) {
      this.fail(err, flow);
    }
  }

  private async gotCode(text: string, flow: number) {
    if (flow !== this.flow || this.busy || this.answering || !this.myOffer || text === this.myOffer) return;
    let kind;
    try {
      kind = decodeSignal(text).kind;
    } catch {
      return; // some other QR code: keep looking
    }
    // Two offers: the higher one stays the host and waits for the other's answer.
    if (kind === 'offer' && text < this.myOffer) return;
    this.busy = true;
    try {
      if (kind === 'offer') await this.answer(text, flow);
      else await this.accept(text, flow);
    } catch (err) {
      this.fail(err, flow);
    } finally {
      if (flow === this.flow) this.busy = false;
    }
  }

  /** Answer the friend's offer: our code becomes the answer for them to scan. */
  private async answer(offer: string, flow: number) {
    const old = this.link;
    if (old) {
      old.onOpen = old.onClose = null;
      old.close();
    }
    this.link = null;
    this.stopCamera();
    this.status('Making your code…');
    const { link, code } = await Link.join(offer);
    if (flow !== this.flow) return link.close();
    this.link = link;
    this.answering = true;
    link.onOpen = () => this.connected(link, false, flow);
    await this.showCode(code);
    const cam = this.body.querySelector('.cam');
    if (cam) cam.innerHTML = `<div class="cam-done">✅</div>`;
    this.status('Got it! Now your friend scans your code.');
    this.wait(flow, ANSWER_TIMEOUT);
  }

  /** The friend answered our offer. */
  private async accept(answer: string, flow: number) {
    if (!this.link) return;
    this.stopCamera();
    this.status('🔌 Connecting…');
    await this.link.accept(answer);
    this.wait(flow, CONNECT_TIMEOUT);
  }

  private wait(flow: number, ms: number) {
    clearTimeout(this.timeout);
    this.timeout = window.setTimeout(() => this.fail(new Error('timed out'), flow), ms);
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

  private fail(err: unknown, flow: number) {
    if (flow !== this.flow) return;
    console.warn('[net]', err);
    this.close();
    this.show(`
      <h2>😕 That didn't work</h2>
      <div class="together-hint">Are you both on the same Wi-Fi? Let's try again!</div>
      <div class="menu-buttons">
        <button class="big" data-act="again">↺ Try again</button>
      </div>
      <button class="big gray" data-act="back">← Back</button>`);
    this.tap('[data-act=again]', () => this.open());
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

  /** The front camera: the screens face each other, so it sees the friend's code. */
  private async startCamera(onCode: (text: string) => void) {
    // Typed/pasted codes (debug: testing on desktops without a second camera).
    const paste = this.body.querySelector('.debug-paste') as HTMLTextAreaElement | null;
    paste?.addEventListener('input', () => onCode(paste.value.trim()));
    const video = this.body.querySelector('video');
    if (!video || !navigator.mediaDevices?.getUserMedia) return false;
    const scanner = new QrScanner(video, 'user', onCode);
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
