import { BEAR_TERRITORY, groundY, roadX } from './route';
import type { CharacterSnapshot, VehicleSnapshot } from './room';

export type BearMode = 'idle' | 'patrol' | 'investigate' | 'alert' | 'chase' | 'return';
export interface BearState {
  p: [number, number, number];
  yaw: number;
  mode: BearMode;
  since: number;
  lastAt: number;
  patrolIndex: 0 | 1;
  targetId: string | null;
  knockedUntil: Record<string, number>;
  cooldownUntil: number;
  cleared: boolean;
}
const patrolPoints = [
  [roadX(505) + 9, -505],
  [roadX(550) - 7, -550],
] as const;
const distance2D = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
export function initialBear(now: number): BearState {
  const [x, z] = patrolPoints[0];
  return { p: [x, groundY(x, z) + 1.05, z], yaw: 0, mode: 'idle', since: now, lastAt: now,
    patrolIndex: 1, targetId: null, knockedUntil: {}, cooldownUntil: 0, cleared: false };
}
function move(bear: BearState, x: number, z: number, speed: number, dt: number): void {
  const dx = x - bear.p[0], dz = z - bear.p[2];
  const remaining = Math.hypot(dx, dz);
  if (remaining < .01) return;
  const step = Math.min(remaining, speed * dt);
  bear.p[0] += dx / remaining * step;
  bear.p[2] += dz / remaining * step;
  bear.p[1] = groundY(bear.p[0], bear.p[2]) + 1.05;
  bear.yaw = Math.atan2(-dx, -dz);
}
/** The room server alone advances gameplay-critical AI. Clients interpolate it. */
export function advanceBear(
  bear: BearState, now: number, vehicle: Pick<VehicleSnapshot, 'p' | 'v'> | null,
  characters: Record<string, CharacterSnapshot>, seated: readonly string[],
): BearState {
  const dt = Math.min(.5, Math.max(0, (now - bear.lastAt) / 1000));
  bear.lastAt = now;
  if (vehicle && -vehicle.p[2] > BEAR_TERRITORY.end + 5) bear.cleared = true;
  for (const [id, until] of Object.entries(bear.knockedUntil))
    if (until < now) delete bear.knockedUntil[id];
  if (!dt || bear.cleared) return bear;
  let targetId: string | null = null;
  let target: readonly number[] | null = null;
  let nearest = Infinity;
  for (const [id, character] of Object.entries(characters)) {
    if (seated.includes(id) || bear.knockedUntil[id] > now) continue;
    const distance = distance2D(bear.p, character.p);
    if (distance < 24 && distance < nearest) { nearest = distance; target = character.p; targetId = id; }
  }
  if (!target && vehicle && Math.hypot(...vehicle.v) > .8 && distance2D(bear.p, vehicle.p) < 19) {
    target = vehicle.p; targetId = 'rv';
  }
  const transition = (mode: BearMode) => { bear.mode = mode; bear.since = now; };
  if (bear.mode === 'idle') {
    if (target) { bear.targetId = targetId; transition('investigate'); }
    else if (now - bear.since > 1800) transition('patrol');
  } else if (bear.mode === 'patrol') {
    const [x, z] = patrolPoints[bear.patrolIndex];
    move(bear, x, z, 1.3, dt);
    if (Math.hypot(x - bear.p[0], z - bear.p[2]) < .6) bear.patrolIndex = bear.patrolIndex ? 0 : 1;
    if (target) { bear.targetId = targetId; transition('investigate'); }
  } else if (bear.mode === 'investigate') {
    if (target) move(bear, target[0], target[2], 1, dt);
    if (now - bear.since > 1400) transition(target ? 'alert' : 'return');
  } else if (bear.mode === 'alert') {
    if (now - bear.since > 1500) transition(target ? 'chase' : 'return');
  } else if (bear.mode === 'chase') {
    if (!target || now - bear.since > 11000 || -bear.p[2] < BEAR_TERRITORY.start - 12 ||
      -bear.p[2] > BEAR_TERRITORY.end + 12) transition('return');
    else {
      move(bear, target[0], target[2], targetId === 'rv' ? 3 : 4.2, dt);
      if (targetId && targetId !== 'rv' && distance2D(bear.p, target) < 1.7 && now >= bear.cooldownUntil) {
        bear.knockedUntil[targetId] = now + 4200;
        bear.cooldownUntil = now + 10000;
        transition('return');
      }
    }
  } else {
    const [x, z] = patrolPoints[0];
    move(bear, x, z, 2, dt);
    if (Math.hypot(x - bear.p[0], z - bear.p[2]) < .8) { bear.targetId = null; transition('idle'); }
  }
  return bear;
}
