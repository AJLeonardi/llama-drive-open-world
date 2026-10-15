import type { CarModel } from '../CarModel';
import type { CarId } from '../VehicleSpec';
import { buildBronco } from './bronco';
import { buildLambo } from './lambo';
import { buildWrangler } from './wrangler';

export function buildCar(id: CarId): CarModel {
  switch (id) {
    case 'bronco': return buildBronco();
    case 'lambo': return buildLambo();
    case 'wrangler': return buildWrangler();
  }
}
