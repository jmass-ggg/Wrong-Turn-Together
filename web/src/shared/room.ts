import type { CableState } from './cable';
import type { BridgeState } from './bridge';
import type { BearState } from './bear';
import type { RoadblockState } from './roadblock';

export type RoomStatus = 'waiting' | 'running' | 'paused' | 'finished';
export interface RoomPlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  lastSeen: number;
}
export interface VehicleSnapshot {
  p: [number, number, number];
  q: [number, number, number, number];
  v: [number, number, number];
  a: [number, number, number];
  steer: number;
  hull: number;
  fuel: number;
  seq: number;
  at: number;
}
export interface CharacterSnapshot {
  p: [number, number, number];
  yaw: number;
  moving: boolean;
  motion?: CharacterMotion;
  seq: number;
  at: number;
}
export type CharacterMotion = 'Idle' | 'Walk' | 'Run' | 'Jump' | 'Carry' | 'CarryWalk' | 'Winch';
export interface JourneyState {
  riverEntered: boolean;
  riverCrossed: boolean;
  hillStarted: boolean;
  hillClimbed: boolean;
  cliffStarted: boolean;
  cliffCleared: boolean;
}
export const initialJourney = (): JourneyState => ({
  riverEntered: false, riverCrossed: false, hillStarted: false, hillClimbed: false,
  cliffStarted: false, cliffCleared: false,
});
export interface JourneyResult {
  timeMs: number;
  hull: number;
  fuel: number;
  players: string[];
  checkpoints: number;
}
export interface RoomState {
  code: string;
  scope: string;
  serverNow: number;
  players: RoomPlayer[];
  status: RoomStatus;
  ownerId: string;
  epoch: number;
  revision: number;
  startedAt: number | null;
  vehicle: VehicleSnapshot | null;
  seats: { driver: string | null; passenger: string | null };
  characters: Record<string, CharacterSnapshot>;
  cable: CableState | null;
  mud: { entered: boolean; winchUsed: boolean; rescued: boolean };
  checkpoint: number;
  recoveries: number;
  bridge: BridgeState;
  bear: BearState;
  roadblock: RoadblockState;
  journey: JourneyState;
  result: JourneyResult | null;
  createdAt: number;
}
export type RoomEvent = { type: 'room'; room: RoomState } | { type: 'vehicle'; code: string; epoch: number; vehicle: VehicleSnapshot; cable: CableState | null; mud: RoomState['mud']; checkpoint: number; bridge: BridgeState; bear: BearState; roadblock: RoadblockState } | { type: 'character'; code: string; playerId: string; character: CharacterSnapshot; roadblock: RoadblockState };
export const ROOM_TTL_SECONDS = 1800;
export const STALE_PLAYER_MS = 20000;
export const SNAPSHOT_MIN_MS = 240; // At most ~4 updates/second/room; installation-wide budget is shared.
export function roomChannel(scope: string, code: string): string {
  // Realtime channel names cannot contain a colon. Scope is a stable post ID.
  return `tow-${scope.replace(/[^a-zA-Z0-9_-]/g, '-')}-${code}`;
}
export function validRoomCode(code: string): boolean { return /^[A-HJ-NP-Z2-9]{6}$/.test(code); }
export function initialVehicle(at: number): VehicleSnapshot {
  return { p: [0, 1.32, 1], q: [0, 0, 0, 1], v: [0, 0, 0], a: [0, 0, 0], steer: 0, hull: 100, fuel: 100, seq: 0, at };
}
