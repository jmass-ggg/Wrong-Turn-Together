/** Deterministic route math shared by the server and browser. The first 260 m
 * retain their original shape so existing rescue and bridge runs remain valid. */
export const ROUTE_LENGTH = 1600;
export const CHECKPOINTS = [84, 174, 650, 970, 1160, 1370, 1550] as const;
export const ROAD_WIDTH = 8.4;
export const BEAR_TERRITORY = { start: 455, center: 525, end: 625 } as const;
export const LOG_DISTANCE = 760;
export const ROCKY_PASS = { start: 830, end: 960 } as const;
export const RIVER = { start: 1050, end: 1082 } as const;
export const HILL = { start: 1200, end: 1300 } as const;
export const CLIFF = { start: 1400, end: 1520 } as const;
const smooth = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
export function roadWidth(distance: number): number {
  return ROAD_WIDTH - 1.1 * (smooth((distance - 810) / 25) - smooth((distance - 960) / 25))
    - 1.7 * (smooth((distance - 1380) / 25) - smooth((distance - 1520) / 25));
}
export function roadX(distance: number): number {
  const original = 10 * Math.sin(distance * 0.018) + 3 * Math.sin(distance * 0.048);
  const beyond = Math.max(0, distance - 260);
  return original + smooth(beyond / 55) * (14 * Math.sin(beyond * .009) + 5 * Math.sin(beyond * .027));
}
export function roadY(distance: number): number {
  const original = 0.016 * distance + 0.85 * Math.sin(distance * 0.026);
  return original - 2.5 * (smooth((distance - 1010) / 40) - smooth((distance - 1090) / 40))
    + 9 * (smooth((distance - HILL.start) / 90) - .7 * smooth((distance - HILL.end) / 110));
}
export function groundY(x: number, z: number): number {
  const d = Math.max(0, -z);
  const offset = x - roadX(d);
  const away = Math.abs(offset);
  const edge = roadWidth(d) / 2;
  const shoulder = Math.min(1, Math.max(0, (away - edge) / 13));
  const rise = Math.min(1, Math.max(0, (away - edge - .8) / 14));
  const ridge = rise * rise * (3 - 2 * rise) *
    (5.5 + 1.5 * Math.sin(d * .045 + (offset < 0 ? 0 : 2)) + 1.2 * Math.sin(d * .11 + x * .06));
  // Keep the maintenance catwalk and the mechanic's approach clear.
  const bridgeAccess = d > 104 && d < 133 && offset > 0 ? .22 : 1;
  const cliff = d > CLIFF.start && d < CLIFF.end && offset < -edge
    ? 16 * smooth((away - edge) / 10) : 0;
  const base = roadY(d) - 0.12 + shoulder * (1.8 * Math.sin(x * 0.13 + d * 0.028) + 0.7 * Math.sin(x * 0.29 - d * 0.043)) + ridge * bridgeAccess - cliff;
  // The road bridge spans a real void; the protected shoulder remains walkable.
  if (d > 114 && d < 124 && away < 5.3) return base - 22;
  return base;
}
export function nearestRouteDistance(x: number, z: number): number {
  const around = Math.max(0, Math.min(ROUTE_LENGTH, -z));
  let best = around;
  let error = Infinity;
  for (let d = Math.max(0, around - 20); d <= Math.min(ROUTE_LENGTH, around + 20); d += 1) {
    const distance2 = (x - roadX(d)) ** 2 + (z + d) ** 2;
    if (distance2 < error) { error = distance2; best = d; }
  }
  return best;
}
