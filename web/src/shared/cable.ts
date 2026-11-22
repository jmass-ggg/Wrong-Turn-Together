import { groundY, roadX } from './route';

export type CableEnd = 'front' | 'rear';
export type CableState = {
  stage: 'carried' | 'attached';
  holderId: string;
  end: CableEnd;
  length: number;
  reeling: boolean;
  payingOut: boolean;
  changedAt: number;
};
export const MUD_START = 47;
export const MUD_END = 71;
export const ANCHOR_DISTANCE = 79;
export const ANCHOR_POINT: [number, number, number] = [
  roadX(ANCHOR_DISTANCE) + 7.3,
  groundY(roadX(ANCHOR_DISTANCE) + 7.3, -ANCHOR_DISTANCE) + 1.5,
  -ANCHOR_DISTANCE,
];
export const CABLE_MAX_LENGTH = 38;
export const WINCH_FORCE_LIMIT = 17000;
export const MANUAL_FORCE_LIMIT = 1100;
export function cableLength(cable: CableState, now: number): number {
  const travel = Math.max(0, now - cable.changedAt) * .0015;
  return cable.reeling ? Math.max(3, cable.length - travel)
    : cable.payingOut ? Math.min(CABLE_MAX_LENGTH, cable.length + travel) : cable.length;
}
export function cableForce(distance: number, length: number, outwardSpeed: number, manual = false): number {
  if (!Number.isFinite(distance) || !Number.isFinite(length) || !Number.isFinite(outwardSpeed)) return 0;
  if (distance <= length) return 0;
  const limit = manual ? MANUAL_FORCE_LIMIT : WINCH_FORCE_LIMIT;
  return Math.min(limit, Math.max(0, (distance - length) * 11000 + outwardSpeed * 1800));
}
