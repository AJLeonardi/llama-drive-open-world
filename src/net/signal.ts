/**
 * WebRTC handshake squeezed into a QR code.
 *
 * Two devices on the same Wi-Fi connect without any server: one shows its offer as a QR
 * code, the other scans it and shows its answer, the first scans that. A data-channel-only
 * SDP is mostly boilerplate, so only the parts that differ are sent (ICE username and
 * password, the DTLS fingerprint, the DTLS role and the host candidates) and the SDP is
 * rebuilt around them on the other side. That keeps a code to ~120 characters, which a
 * camera reads instantly. No three.js or DOM here, so it's tested in Node.
 */

export interface Signal {
  kind: 'offer' | 'answer';
  ufrag: string;
  pwd: string;
  /** SHA-256 DTLS certificate fingerprint, 32 bytes. */
  fingerprint: Uint8Array;
  setup: 'actpass' | 'active' | 'passive';
  /** UDP host candidates: an IPv4 address or an mDNS name (xxxx.local). */
  candidates: { address: string; port: number }[];
}

const PREFIX = 'LD1';
/** Codes are short and kids' phones are close: a handful of candidates is plenty. */
const MAX_CANDIDATES = 4;
const SETUPS = ['actpass', 'active', 'passive'] as const;

/** The essentials of a local description (after ICE gathering has finished). */
export function parseSdp(kind: Signal['kind'], sdp: string): Signal {
  const line = (key: string) => {
    const m = sdp.match(new RegExp(`^a=${key}:(.*)$`, 'm'));
    if (!m) throw new Error(`SDP has no ${key}`);
    return m[1].trim();
  };
  const fp = line('fingerprint').split(' ');
  if (fp[0].toLowerCase() !== 'sha-256') throw new Error(`unsupported fingerprint ${fp[0]}`);
  const fingerprint = new Uint8Array(fp[1].split(':').map((h) => parseInt(h, 16)));
  const setup = line('setup') as Signal['setup'];
  const candidates: Signal['candidates'] = [];
  const seen = new Set<string>();
  for (const m of sdp.matchAll(/^a=candidate:\S+ (\d) (\S+) \d+ (\S+) (\d+) typ (\S+)/gm)) {
    const [, component, proto, address, port, typ] = m;
    // Data channels use one component; same Wi-Fi means host candidates only.
    if (component !== '1' || proto.toLowerCase() !== 'udp' || typ !== 'host') continue;
    if (address.includes(':')) continue; // IPv6: long, and IPv4 or mDNS always works on a LAN
    const key = `${address}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ address, port: Number(port) });
  }
  return { kind, ufrag: line('ice-ufrag'), pwd: line('ice-pwd'), fingerprint, setup, candidates: candidates.slice(0, MAX_CANDIDATES) };
}

/** A full SDP the browser accepts as the remote description. */
export function buildSdp(s: Signal): string {
  const hex = Array.from(s.fingerprint, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
  const lines = [
    'v=0',
    `o=- ${sessionId(s)} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${s.ufrag}`,
    `a=ice-pwd:${s.pwd}`,
    `a=fingerprint:sha-256 ${hex}`,
    `a=setup:${s.setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ];
  s.candidates.forEach((c, i) => {
    // Priorities only need to be distinct and in the order we were given them.
    lines.push(`a=candidate:${i + 1} 1 udp ${2122260223 - i * 256} ${c.address} ${c.port} typ host generation 0`);
  });
  lines.push('a=end-of-candidates');
  return lines.join('\r\n') + '\r\n';
}

/** Stable per signal, so the same code always gives the same SDP. */
function sessionId(s: Signal) {
  let h = 7;
  for (const ch of s.ufrag + s.pwd) h = (h * 31 + ch.charCodeAt(0)) % 1e9;
  return 1000000000 + h;
}

/**
 * The text that goes in the QR code: `LD1` then fields joined by `~`
 * (kind+setup, ufrag, pwd, fingerprint as base64, then candidates as `ip:port` or
 * `name.local:port`, IPv4 written in base64 to save room).
 */
export function encodeSignal(s: Signal): string {
  const head = `${s.kind === 'offer' ? 'o' : 'a'}${SETUPS.indexOf(s.setup)}`;
  const cands = s.candidates.map((c) => `${packAddress(c.address)}:${c.port.toString(36)}`);
  return [PREFIX, head, s.ufrag, s.pwd, toBase64(s.fingerprint), ...cands].join('~');
}

export function decodeSignal(text: string): Signal {
  const parts = text.trim().split('~');
  if (parts[0] !== PREFIX || parts.length < 5) throw new Error('not a Llama Drive code');
  const [, head, ufrag, pwd, fp, ...cands] = parts;
  const kind = head[0] === 'o' ? 'offer' : head[0] === 'a' ? 'answer' : null;
  const setup = SETUPS[Number(head[1])];
  if (!kind || !setup) throw new Error('bad code header');
  const fingerprint = fromBase64(fp);
  if (fingerprint.length !== 32) throw new Error('bad fingerprint');
  const candidates = cands.map((c) => {
    const i = c.lastIndexOf(':');
    return { address: unpackAddress(c.slice(0, i)), port: parseInt(c.slice(i + 1), 36) };
  });
  return { kind, ufrag, pwd, fingerprint, setup, candidates };
}

// IPv4 as 4 bytes in base64 (6 chars, prefixed with '!'); anything else as is.
function packAddress(a: string) {
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  return m ? '!' + toBase64(new Uint8Array(m.slice(1).map(Number))) : a;
}

function unpackAddress(a: string) {
  return a.startsWith('!') ? Array.from(fromBase64(a.slice(1))).join('.') : a;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64(bytes: Uint8Array) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.ceil(((Math.min(3, bytes.length - i)) * 8) / 6);
    for (let k = 0; k < chars; k++) out += B64[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}

function fromBase64(s: string) {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const v = k < chunk.length ? B64.indexOf(chunk[k]) : 0;
      if (v < 0) throw new Error('bad base64');
      n = (n << 6) | v;
    }
    const bytes = Math.floor((chunk.length * 6) / 8);
    for (let k = 0; k < bytes; k++) out.push((n >> (16 - 8 * k)) & 255);
  }
  return new Uint8Array(out);
}
