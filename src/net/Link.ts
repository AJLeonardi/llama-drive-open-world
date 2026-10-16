import { buildSdp, decodeSignal, encodeSignal, parseSdp } from './signal';

/** Messages on the reliable channel. */
export type NetEvent =
  | { t: 'hello'; v: number; car: string | null }
  | { t: 'car'; car: string | null }
  | { t: 'bye' };

export const PROTOCOL = 1;

/** Waiting for every local address can take a while on some routers; a LAN needs only the first few. */
const GATHER_TIMEOUT = 2500;

/**
 * A peer-to-peer connection to a friend's device on the same Wi-Fi (no server, no
 * internet). Two pre-agreed data channels: 'state' (unordered, no retries: car positions,
 * only the newest matters) and 'events' (reliable: hello, car changes, goodbye).
 */
export class Link {
  private pc: RTCPeerConnection;
  private state: RTCDataChannel;
  private events: RTCDataChannel;
  private opened = false;
  private closed = false;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onState: ((data: ArrayBuffer) => void) | null = null;
  onEvent: ((e: NetEvent) => void) | null = null;

  private constructor() {
    // No ICE servers: on the same Wi-Fi the devices can reach each other directly.
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.state = this.pc.createDataChannel('state', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    this.events = this.pc.createDataChannel('events', { negotiated: true, id: 2 });
    this.state.binaryType = 'arraybuffer';
    this.state.onmessage = (e) => this.onState?.(e.data as ArrayBuffer);
    this.events.onmessage = (e) => {
      try {
        this.onEvent?.(JSON.parse(String(e.data)) as NetEvent);
      } catch {
        /* ignore garbage */
      }
    };
    const maybeOpen = () => {
      if (this.opened || this.state.readyState !== 'open' || this.events.readyState !== 'open') return;
      this.opened = true;
      this.onOpen?.();
    };
    this.state.onopen = this.events.onopen = maybeOpen;
    this.state.onclose = this.events.onclose = () => this.close();
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed') this.close();
    };
  }

  get isOpen() {
    return this.opened && !this.closed;
  }

  /** Start hosting: returns the link and the code (text for a QR code) to show the friend. */
  static async host(): Promise<{ link: Link; code: string }> {
    const link = new Link();
    await link.pc.setLocalDescription(await link.pc.createOffer());
    await link.gathered();
    return { link, code: encodeSignal(parseSdp('offer', link.pc.localDescription!.sdp)) };
  }

  /** Join from the host's code: returns the link and the answer code to show back. */
  static async join(offerCode: string): Promise<{ link: Link; code: string }> {
    const offer = decodeSignal(offerCode);
    if (offer.kind !== 'offer') throw new Error('that is the answer code, not the host code');
    const link = new Link();
    await link.pc.setRemoteDescription({ type: 'offer', sdp: buildSdp(offer) });
    await link.pc.setLocalDescription(await link.pc.createAnswer());
    await link.gathered();
    return { link, code: encodeSignal(parseSdp('answer', link.pc.localDescription!.sdp)) };
  }

  /** Host: the friend's answer code. The link opens shortly after (onOpen). */
  async accept(answerCode: string) {
    const answer = decodeSignal(answerCode);
    if (answer.kind !== 'answer') throw new Error('that is a host code, not the answer code');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: buildSdp(answer) });
  }

  private gathered() {
    return new Promise<void>((resolve) => {
      if (this.pc.iceGatheringState === 'complete') return resolve();
      const t = setTimeout(resolve, GATHER_TIMEOUT);
      this.pc.addEventListener('icegatheringstatechange', () => {
        if (this.pc.iceGatheringState !== 'complete') return;
        clearTimeout(t);
        resolve();
      });
    });
  }

  sendState(data: ArrayBuffer) {
    // Drop rather than queue when the channel is backed up: only the newest state matters.
    if (this.isOpen && this.state.bufferedAmount < 4096) this.state.send(data);
  }

  send(e: NetEvent) {
    if (this.isOpen) this.events.send(JSON.stringify(e));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.events.readyState === 'open') this.events.send(JSON.stringify({ t: 'bye' } satisfies NetEvent));
    } catch {
      /* already gone */
    }
    this.state.close();
    this.events.close();
    this.pc.close();
    this.onClose?.();
  }
}
