import { LOG_DISTANCE, groundY, roadX } from './route';

export interface RoadblockState {
  p: [number, number, number];
  grips: [string | null, string | null];
  cleared: boolean;
}
export function initialRoadblock(): RoadblockState {
  const x = roadX(LOG_DISTANCE), z = -LOG_DISTANCE;
  return { p: [x, groundY(x, z) + .55, z], grips: [null, null], cleared: false };
}
export function roadblockEnd(state: RoadblockState, index: number): [number, number, number] {
  return [state.p[0] + (index === 0 ? -4.4 : 4.4), state.p[1] + .8, state.p[2]];
}
/** Two walking players must keep a grip on opposite ends. Their lateral steps
 * move a collision-enabled log; one player alone cannot clear it. */
export function dragRoadblock(state: RoadblockState, id: string, from: readonly number[], to: readonly number[]): void {
  const side = state.grips.indexOf(id);
  if (side < 0 || !state.grips[1 - side] || state.cleared) return;
  const dx = to[0] - from[0], dz = to[2] - from[2];
  if (Math.abs(dx) > 1.8 || Math.abs(dz) > 1.8 || Math.abs(dx) < .01) return;
  const origin = roadX(LOG_DISTANCE);
  state.p[0] = Math.max(origin - 10, Math.min(origin + 10, state.p[0] + dx * .5));
  state.p[1] = groundY(state.p[0], state.p[2]) + .55;
  if (Math.abs(state.p[0] - origin) >= 8.5) {
    state.cleared = true;
    state.grips = [null, null];
  }
}
