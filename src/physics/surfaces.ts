export type Surface = 'asphalt' | 'concrete' | 'dirt' | 'grass' | 'sand' | 'snow' | 'water';

export interface SurfaceProps {
  /** Tire grip (Rapier wheel friction slip). Lower = slidier. */
  grip: number;
  /** Rolling-resistance coefficient: how quickly the car coasts to a stop. */
  rolling: number;
  /** Extra speed-proportional drag (mud/water churn), 1/s. */
  drag: number;
  /** Kick up dust/spray particles when driving fast on it. */
  dust: 'none' | 'dust' | 'grass' | 'snow' | 'spray';
}

/** Tuning table: how each ground type feels. Coasting decel ≈ rolling·g + drag·v. */
export const SURFACES: Record<Surface, SurfaceProps> = {
  asphalt: { grip: 2.4, rolling: 0.012, drag: 0, dust: 'none' },
  concrete: { grip: 2.2, rolling: 0.015, drag: 0, dust: 'none' },
  dirt: { grip: 1.45, rolling: 0.05, drag: 0.01, dust: 'dust' },
  grass: { grip: 1.25, rolling: 0.08, drag: 0.02, dust: 'grass' },
  sand: { grip: 1.0, rolling: 0.18, drag: 0.05, dust: 'dust' },
  // Packed snow: slippery (great for drifting), not too draggy.
  snow: { grip: 1.05, rolling: 0.06, drag: 0.02, dust: 'snow' },
  water: { grip: 0.9, rolling: 0.25, drag: 0.35, dust: 'spray' },
};
