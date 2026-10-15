import { clamp } from '../util/math';
import type { EngineSound } from './VehicleSpec';

/**
 * Fake automatic gearbox, used only to make the engine sound right
 * (RPM climbs through each gear, drops on upshift). It doesn't affect physics.
 */
export class Gearbox {
  gear = 0;
  rpm: number;
  /** >0 while a shift is in progress. */
  shifting = 0;
  /** Set for one update when an upshift happens (audio uses it for the shift "blip"). */
  justShifted = false;
  private readonly tops: number[];

  constructor(private readonly eng: EngineSound, topSpeed: number) {
    this.rpm = eng.idleRpm;
    this.tops = [];
    for (let i = 0; i < eng.gears; i++) this.tops.push(topSpeed * 1.03 * Math.pow((i + 1) / eng.gears, 0.7));
  }

  gearTopSpeed(i: number) {
    return this.tops[i];
  }

  update(dt: number, speed: number, throttle: number) {
    const { idleRpm, redlineRpm, gears, shiftTime } = this.eng;
    const v = Math.abs(speed);
    this.justShifted = false;
    if (this.shifting > 0) this.shifting = Math.max(0, this.shifting - dt);

    if (this.gear < gears - 1 && (redlineRpm * v) / this.tops[this.gear] > redlineRpm * 0.95) {
      this.gear++;
      this.shifting = shiftTime;
      this.justShifted = true;
    } else if (this.gear > 0 && v < 0.85 * this.tops[this.gear - 1]) {
      this.gear--;
    }

    let target = (redlineRpm * v) / this.tops[this.gear];
    // Clutch slip at very low speed: revs follow the pedal.
    if (this.gear === 0) target = Math.max(target, idleRpm + throttle * (0.45 * redlineRpm - idleRpm));
    target = clamp(target, idleRpm, redlineRpm);
    if (this.shifting > 0) target *= 0.85;
    const rate = target > this.rpm ? 8 : 5;
    this.rpm += (target - this.rpm) * Math.min(1, rate * dt);
    return this.rpm;
  }
}
