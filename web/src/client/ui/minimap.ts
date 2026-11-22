import { BEAR_TERRITORY, CHECKPOINTS, CLIFF, HILL, LOG_DISTANCE, RIVER, ROAD_WIDTH, ROUTE_LENGTH, roadX } from '../game/route';
import { MUD_START, MUD_END, ANCHOR_POINT } from '../../shared/cable';
import { BRIDGE_START, BRIDGE_END } from '../../shared/bridge';

export class Minimap {
  private expanded = false;
  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener('click', () => { this.expanded = !this.expanded; canvas.classList.toggle('expanded', this.expanded); });
  }
  draw(x: number, z: number, heading: number, checkpoint: number, players: Array<{ x: number; z: number; color: string }> = []): void {
    const size = this.expanded ? 500 : 220;
    const scale = window.devicePixelRatio || 1;
    this.canvas.width = size * scale; this.canvas.height = size * scale;
    const ctx = this.canvas.getContext('2d')!; ctx.scale(scale, scale);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#102a2bde'; ctx.beginPath(); ctx.roundRect(0, 0, size, size, 16); ctx.fill();
    const current = Math.max(0, Math.min(ROUTE_LENGTH, -z));
    const min = this.expanded ? -8 : Math.max(-5, Math.min(ROUTE_LENGTH - 74, current - 17));
    const max = this.expanded ? ROUTE_LENGTH + 8 : min + 74;
    const centerX = this.expanded ? 0 : roadX(current);
    const unit = (size - 28) / (max - min);
    const mapX = (rx: number) => size / 2 + (rx - centerX) * unit;
    const mapY = (d: number) => 14 + (d - min) * unit;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [width, color] of [[ROAD_WIDTH * unit + 4, '#557062'], [ROAD_WIDTH * unit, '#b99b76'], [2, '#f5db9c']] as const) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      for (let d = Math.max(0, min); d <= Math.min(ROUTE_LENGTH, max); d += 1.5) {
        const px = mapX(roadX(d)), py = mapY(d);
        if (d <= Math.max(0, min) + 1.5) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    for (const [i, d] of CHECKPOINTS.entries()) {
      if (d < min || d > max) continue;
      ctx.fillStyle = i < checkpoint ? '#61d5ab' : '#f4c67e';
      ctx.beginPath(); ctx.arc(mapX(roadX(d)), mapY(d), 5, 0, Math.PI * 2); ctx.fill();
    }
    const hazard = (MUD_START + MUD_END) / 2;
    if (hazard >= min && hazard <= max) {
      ctx.fillStyle = '#ef9f54'; ctx.font = '18px sans-serif';
      ctx.fillText('⚠', mapX(roadX(hazard)) - 9, mapY(hazard) + 6);
    }
    if (ANCHOR_POINT[2] * -1 >= min && ANCHOR_POINT[2] * -1 <= max) {
      ctx.fillStyle = '#f3d38e'; ctx.beginPath();
      ctx.arc(mapX(ANCHOR_POINT[0]), mapY(-ANCHOR_POINT[2]), 4, 0, Math.PI * 2); ctx.fill();
    }
    const bridge = (BRIDGE_START + BRIDGE_END) / 2;
    if (bridge >= min && bridge <= max) {
      ctx.fillStyle = '#e3ad74'; ctx.font = '16px sans-serif';
      ctx.fillText('▥', mapX(roadX(bridge)) - 7, mapY(bridge) + 5);
    }
    for (const [distance, letter, color] of [
      [BEAR_TERRITORY.center, 'B', '#dc975f'],
      [LOG_DISTANCE, 'L', '#e7b97d'],
      [(RIVER.start + RIVER.end) / 2, 'R', '#83cfda'],
      [(HILL.start + HILL.end) / 2, 'H', '#dbca8c'],
      [(CLIFF.start + CLIFF.end) / 2, 'C', '#e5ab9a'],
    ] as const) {
      if (distance < min || distance > max) continue;
      const px = mapX(roadX(distance)), py = mapY(distance);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#18302c'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(letter, px, py + 3);
    }
    if (ROUTE_LENGTH >= min && ROUTE_LENGTH <= max) {
      ctx.font = '20px sans-serif'; ctx.fillText('🏁', mapX(roadX(ROUTE_LENGTH)) - 10, mapY(ROUTE_LENGTH) + 4);
    }
    ctx.save(); ctx.translate(mapX(x), mapY(-z)); ctx.rotate(-heading);
    ctx.fillStyle = '#fff9e6'; ctx.strokeStyle = '#21353a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-7, 7); ctx.lineTo(7, 7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    for (const player of players) {
      ctx.beginPath(); ctx.arc(mapX(player.x), mapY(-player.z), 5, 0, Math.PI * 2);
      ctx.fillStyle = player.color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#152c31'; ctx.stroke();
    }
    ctx.fillStyle = '#fff5e0'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(this.expanded ? 'ROUTE  ·  TAP TO CLOSE' : 'MAP  ·  TAP TO EXPAND', 12, size - 10);
  }
}
