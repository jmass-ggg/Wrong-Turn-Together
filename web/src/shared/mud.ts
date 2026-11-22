import { MUD_END, MUD_START } from './cable';
import { roadX } from './route';

const smooth = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Continuous mud depth keeps wheel forces stable at the edges of the pit. */
export function mudDepth(x: number, z: number): number {
  const distance = -z;
  if (distance <= MUD_START || distance >= MUD_END) return 0;
  const along = Math.min(smooth((distance - MUD_START) / 7), smooth((MUD_END - distance) / 5));
  const across = 1 - smooth((Math.abs(x - roadX(distance)) - 2.4) / 2);
  return along * across;
}
