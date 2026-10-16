import { describe, expect, it } from 'vitest';
import { buildSdp, decodeSignal, encodeSignal, parseSdp } from '../src/net/signal';

// A data-channel offer as Safari on iOS produces it (trimmed of nothing).
const SAFARI_OFFER = [
  'v=0',
  'o=- 6573128460361383120 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 61514 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 192.168.1.23',
  'a=candidate:3442447574 1 udp 2122260223 192.168.1.23 61514 typ host generation 0 network-id 1 network-cost 10',
  'a=candidate:2011011462 1 udp 2122194687 4f1c9a3e-1b2d-4c5e-9f00-112233445566.local 58321 typ host generation 0 network-id 2',
  'a=candidate:1111111111 1 udp 2122129151 fe80::1c2b:3a4d:5e6f:7081 50000 typ host generation 0',
  'a=candidate:2208386682 1 tcp 1518280447 192.168.1.23 9 typ host tcptype active generation 0',
  'a=candidate:3442447574 1 udp 2122260223 192.168.1.23 61514 typ host generation 0 network-id 1',
  'a=ice-ufrag:Xq3a',
  'a=ice-pwd:Kt8uZcFq2lY7mP0wR4sN9bVd',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:01:12:23:34:45:56:67:78:89:9A:AB:BC:CD:DE:EF:F0',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

describe('QR handshake codes', () => {
  it('keeps just what is needed from an offer', () => {
    const s = parseSdp('offer', SAFARI_OFFER);
    expect(s.ufrag).toBe('Xq3a');
    expect(s.pwd).toBe('Kt8uZcFq2lY7mP0wR4sN9bVd');
    expect(s.setup).toBe('actpass');
    expect(s.fingerprint[0]).toBe(0x0a);
    expect(s.fingerprint[31]).toBe(0xf0);
    // UDP host candidates only, no duplicates, no TCP, no IPv6.
    expect(s.candidates).toEqual([
      { address: '192.168.1.23', port: 61514 },
      { address: '4f1c9a3e-1b2d-4c5e-9f00-112233445566.local', port: 58321 },
    ]);
  });

  it('round-trips through a short code', () => {
    const s = parseSdp('offer', SAFARI_OFFER);
    const code = encodeSignal(s);
    expect(code.length).toBeLessThan(160);
    expect(decodeSignal(code)).toEqual(s);
  });

  it('rebuilds an SDP that parses back to the same signal', () => {
    const s = parseSdp('offer', SAFARI_OFFER);
    const sdp = buildSdp(s);
    expect(sdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
    expect(sdp).toContain('a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:01:12:23:34:45:56:67:78:89:9A:AB:BC:CD:DE:EF:F0');
    expect(parseSdp('offer', sdp)).toEqual(s);
  });

  it('carries the answer role', () => {
    const answer = SAFARI_OFFER.replace('a=setup:actpass', 'a=setup:active');
    const s = decodeSignal(encodeSignal(parseSdp('answer', answer)));
    expect(s.kind).toBe('answer');
    expect(s.setup).toBe('active');
  });

  it('turns away codes that are not ours', () => {
    expect(() => decodeSignal('https://example.com')).toThrow();
    expect(() => decodeSignal('LD1~x9~a~b~c')).toThrow();
  });
});
