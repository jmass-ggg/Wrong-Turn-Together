import { BEAR_TERRITORY, CHECKPOINTS, LOG_DISTANCE, ROUTE_LENGTH } from '../game/route';
import { Vehicle } from '../game/vehicle';
import { Minimap } from './minimap';
import type { RoomState } from '../../shared/room';
import { MUD_START } from '../../shared/cable';

export class Hud {
  readonly map: Minimap;
  private timer = document.querySelector<HTMLElement>('#timer')!;
  private status = document.querySelector<HTMLElement>('#status')!;
  private bars = [document.querySelector<HTMLElement>('#hull-fill')!, document.querySelector<HTMLElement>('#fuel-fill')!];
  private objective = document.querySelector<HTMLElement>('#objective')!;
  constructor() { this.map = new Minimap(document.querySelector<HTMLCanvasElement>('#minimap')!); }
  update(vehicle: Vehicle, elapsed: number, distance: number, checkpoint: number, room: RoomState | null = null): void {
    const seconds = Math.floor(elapsed);
    this.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    this.status.textContent = `${Math.round(distance / ROUTE_LENGTH * 100)}% ROUTE  ·  ${checkpoint}/${CHECKPOINTS.length} STOPS${room ? ' · CO-OP SYNC' : ''}  ·  ${Math.round(vehicle.speed * 3.6)} KM/H`;
    this.bars[0].style.width = `${vehicle.hull}%`;
    this.bars[1].style.width = `${vehicle.fuel}%`;
    this.objective.textContent = room
      ? !room.mud.rescued
        ? room.cable?.stage === 'attached' ? 'Drive and reel together to escape the mud'
          : distance < MUD_START - 20 ? 'Stay together · prepare for mud ahead' : 'Mud ahead · mechanic: attach the winch'
        : !room.bridge.complete
          ? `Broken bridge · secure ${room.bridge.planks.filter(p => p.stage === 'secured').length}/${room.bridge.planks.length} planks`
        : !room.bridge.crossed ? 'Bridge repaired · drive carefully across'
        : !room.bear.cleared ? `Bear territory ${BEAR_TERRITORY.start}–${BEAR_TERRITORY.end} m · regroup in the RV`
        : !room.roadblock.cleared ? `Fallen tree at ${LOG_DISTANCE} m · two walkers grab opposite ends`
        : !room.journey.riverCrossed ? 'River crossing · keep to the marked road'
        : !room.journey.hillClimbed ? 'Steep climb · use throttle and recover if stuck'
        : !room.journey.cliffCleared ? 'Cliff road · slow down and guide the driver'
        : checkpoint < CHECKPOINTS.length ? `Reach checkpoint ${checkpoint + 1}` : 'Reach the final camp'
      : checkpoint < CHECKPOINTS.length ? `Reach checkpoint ${checkpoint + 1} · follow the road` : 'Cross the finish gate';
    const t = vehicle.body.translation();
    const forward = { x: 0, z: -1 };
    const q = vehicle.model.quaternion;
    const x = 2 * (q.x * q.z + q.w * q.y) * -1;
    const z = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const players = room?.players.map((player, i) => {
      const seated = Object.values(room.seats).includes(player.id);
      const p = seated ? [t.x, t.y, t.z] : room.characters[player.id]?.p ?? [t.x, t.y, t.z];
      return { x: p[0], z: p[2], color: i === 0 ? '#65c8ec' : '#ca91e9' };
    }) ?? [];
    this.map.draw(t.x, t.z, Math.atan2(x || forward.x, -z), checkpoint, players);
  }
}
