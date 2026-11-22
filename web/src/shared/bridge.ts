import { groundY, roadX, roadY } from './route';

export const BRIDGE_START = 114;
export const BRIDGE_END = 124;
export const BRIDGE_SLOTS = [117, 121] as const;
export const BRIDGE_STOCK_POINT: [number, number, number] = [roadX(108) + 6.5, roadY(108) + 1.3, -108];
export type BridgePlank = { stage: 'stock' | 'carried' | 'thrown' | 'placed' | 'secured'; holderId: string; p?: [number, number, number]; from?: [number, number, number]; thrownAt?: number };
export type BridgeState = { planks: [BridgePlank, BridgePlank]; complete: boolean; entered: boolean; crossed: boolean };
export const initialBridge = (): BridgeState => ({
  planks: [{ stage: 'stock', holderId: '' }, { stage: 'stock', holderId: '' }],
  complete: false, entered: false, crossed: false,
});
export function bridgeWorkPoint(index: number): [number, number, number] {
  const d = BRIDGE_SLOTS[index];
  return [roadX(d) + 6, roadY(d) + 1.3, -d];
}
export function plankLanding(position: readonly number[], yaw: number): [number, number, number] {
  const x = position[0] - Math.sin(yaw) * 3.5;
  const z = position[2] - Math.cos(yaw) * 3.5;
  const d = Math.max(0, -z);
  const road = Math.abs(x - roadX(d)) < 4.2;
  return [x, (road ? roadY(d) : groundY(x, z)) + .18, z];
}
