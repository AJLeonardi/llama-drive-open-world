/** Reads QR codes from the camera (jsQR, loaded only when needed). */
export class QrScanner {
  private stream: MediaStream | null = null;
  private timer = 0;
  private stopped = false;
  private canvas = document.createElement('canvas');
  facing: 'user' | 'environment';

  constructor(readonly video: HTMLVideoElement, facing: 'user' | 'environment', private readonly onCode: (text: string) => void) {
    this.facing = facing;
    video.setAttribute('playsinline', '');
    video.muted = true;
  }

  /** Starts the camera; rejects if there is none or permission is refused. */
  async start() {
    this.stopped = false;
    const { default: jsQR } = await import('jsqr');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing, width: { ideal: 960 } }, audio: false });
    if (this.stopped) return this.stopTracks();
    this.video.srcObject = this.stream;
    // The front camera shows mirrored, like a mirror; decoding uses the real image.
    this.video.classList.toggle('mirror', this.facing === 'user');
    await this.video.play().catch(() => {});
    const g = this.canvas.getContext('2d', { willReadFrequently: true })!;
    const scan = () => {
      if (this.stopped) return;
      const v = this.video;
      if (v.videoWidth) {
        const k = Math.min(1, 640 / v.videoWidth);
        const w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
        if (this.canvas.width !== w || this.canvas.height !== h) {
          this.canvas.width = w;
          this.canvas.height = h;
        }
        g.drawImage(v, 0, 0, w, h);
        const found = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (found?.data) this.onCode(found.data);
      }
      this.timer = window.setTimeout(scan, 120);
    };
    scan();
  }

  async flip() {
    this.stop();
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    await this.start();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.stopTracks();
    this.video.srcObject = null;
  }

  private stopTracks() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

/** A QR code as an SVG string (qrcode-generator, loaded only when needed). */
export async function qrSvg(text: string) {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
