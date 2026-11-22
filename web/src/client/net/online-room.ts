import type { CharacterSnapshot, RoomEvent, RoomState, VehicleSnapshot } from '../../shared/room';
import { roomChannel } from '../../shared/room';
import type { CableEnd } from '../../shared/cable';

type Callback = (room: RoomState, me: string) => void;
export class OnlineRoom {
  room: RoomState | null = null;
  me = '';
  connected = false;
  private clockOffset = 0;
  serverNow(): number { return Date.now() - this.clockOffset; }
  onChange: Callback = () => {};
  private closeRealtime: (() => Promise<void>) | null = null;
  private refreshTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private sending = false;
  private sendingCharacter = false;
  private readonly local = import.meta.env.DEV;
  private localId(): string {
    let id = localStorage.getItem('tow-local-id');
    if (!id) { id = `local-${crypto.randomUUID()}`; localStorage.setItem('tow-local-id', id); }
    return id;
  }
  private async request<T>(path: string, data?: unknown): Promise<T> {
    const response = await fetch(path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(this.local ? { 'x-local-player': this.localId() } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Room request failed (${response.status})`);
    return payload as T;
  }
  private accept(room: RoomState, me: string, sampleClock = true): void {
    if (this.room?.code === room.code && this.room.revision > room.revision) return;
    if (sampleClock && Number.isFinite(room.serverNow)) this.clockOffset = Date.now() - room.serverNow;
    this.room = room; this.me = me; this.connected = true; this.onChange(room, me);
  }
  private async attach(room: RoomState, me: string): Promise<void> {
    await this.detach(false);
    this.accept(room, me);
    localStorage.setItem('tow-room-code', room.code);
    if (!this.local) {
      const { connectRealtime } = await import('@devvit/web/client');
      const connection = connectRealtime({
        channel: roomChannel(room.scope, room.code),
        onConnect: () => { this.connected = true; },
        onDisconnect: () => { this.connected = false; },
        onMessage: data => {
          if (!data || typeof data !== 'object' || Array.isArray(data) || (data.type !== 'room' && data.type !== 'vehicle' && data.type !== 'character')) return;
          const message = data as unknown as RoomEvent;
          if (message.type === 'room') this.accept(message.room, this.me);
          const current = this.room;
          if (message.type === 'vehicle' && current?.code === message.code && current.epoch === message.epoch && current.vehicle && message.vehicle.seq > current.vehicle.seq) {
            this.accept({ ...current, vehicle: message.vehicle, cable: message.cable, mud: message.mud, checkpoint: message.checkpoint, bridge: message.bridge, bear: message.bear, roadblock: message.roadblock }, this.me, false);
          }
          if (message.type === 'character' && current?.code === message.code && message.character.seq > (current.characters[message.playerId]?.seq ?? -1)) {
            this.accept({ ...current, characters: { ...current.characters, [message.playerId]: message.character }, roadblock: message.roadblock }, this.me, false);
          }
        },
      });
      this.closeRealtime = () => connection.disconnect();
    }
    this.refreshTimer = window.setInterval(() => { void this.refresh().catch(() => { this.connected = false; }); }, this.local ? 300 : 4000);
    this.heartbeatTimer = window.setInterval(() => { void this.heartbeat().catch(() => { this.connected = false; }); }, 5000);
  }
  private async detach(clear = true): Promise<void> {
    if (this.refreshTimer !== null) clearInterval(this.refreshTimer);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.refreshTimer = this.heartbeatTimer = null;
    await this.closeRealtime?.(); this.closeRealtime = null;
    if (clear) { this.room = null; this.me = ''; this.connected = false; localStorage.removeItem('tow-room-code'); }
  }
  async create(): Promise<void> {
    const { room, me } = await this.request<{ room: RoomState; me: string }>('/api/rooms', {});
    await this.attach(room, me);
  }
  async join(code: string): Promise<void> {
    const { room, me } = await this.request<{ room: RoomState; me: string }>(`/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`, {});
    await this.attach(room, me);
  }
  async resume(): Promise<void> { const code = localStorage.getItem('tow-room-code'); if (code) await this.join(code); }
  async refresh(): Promise<void> {
    const room = this.room; if (!room) return;
    const result = await this.request<{ room: RoomState; me: string }>(`/api/rooms/${room.code}`);
    this.accept(result.room, result.me);
  }
  async heartbeat(): Promise<void> {
    const room = this.room; if (!room) return;
    const result = await this.request<{ room: RoomState; me: string }>(`/api/rooms/${room.code}/heartbeat`, {});
    this.accept(result.room, result.me);
  }
  async setReady(ready: boolean): Promise<void> {
    const code = this.room?.code; if (!code) return;
    const result = await this.request<{ room: RoomState; me: string }>(`/api/rooms/${code}/ready`, { ready });
    this.accept(result.room, result.me);
  }
  async start(): Promise<void> {
    const code = this.room?.code; if (!code) return;
    const result = await this.request<{ room: RoomState; me: string }>(`/api/rooms/${code}/start`, {});
    this.accept(result.room, result.me);
  }
  async leave(): Promise<void> {
    const code = this.room?.code;
    try { if (code) await this.request(`/api/rooms/${code}/leave`, {}); }
    finally { await this.detach(); }
  }
  async sendSnapshot(vehicle: VehicleSnapshot): Promise<void> {
    const room = this.room;
    if (!room || room.ownerId !== this.me || room.status !== 'running' || this.sending) return;
    this.sending = true;
    try { await this.request(`/api/rooms/${room.code}/snapshot`, { epoch: room.epoch, vehicle }); }
    catch (error) { if (!(error instanceof Error && /too frequent|stale/i.test(error.message))) console.warn('Vehicle sync:', error); }
    finally { this.sending = false; }
  }
  async setSeat(seat: 'driver' | 'passenger' | null): Promise<void> {
    const code = this.room?.code; if (!code) return;
    const result = await this.request<{ room: RoomState; me: string }>(`/api/rooms/${code}/seat`, { seat });
    this.accept(result.room, result.me);
  }
  async cableAction(action: 'pickup' | 'attach' | 'reel' | 'out' | 'stop' | 'detach', end: CableEnd = 'front'): Promise<void> {
    const code = this.room?.code; if (!code) return;
    const result = await this.request<{ room: RoomState; me: string }>(`/api/rooms/${code}/cable`, { action, end });
    this.accept(result.room, result.me);
  }
  async recover(): Promise<void> {
    const code = this.room?.code; if (!code) return;
    const result = await this.request<{ room: RoomState; me: string }>(`/api/rooms/${code}/recover`, {});
    this.accept(result.room, result.me);
  }
  async bridgeAction(action: 'pickup' | 'place' | 'secure' | 'retrieve' | 'drop' | 'throw'): Promise<void> {
    const code = this.room?.code; if (!code) return;
    const result = await this.request<{ room: RoomState; me: string }>(`/api/rooms/${code}/bridge`, { action });
    this.accept(result.room, result.me);
  }
  async helpPlayer(targetId: string): Promise<void> {
    const code = this.room?.code; if (!code) return;
    const result = await this.request<{ room: RoomState; me: string }>(`/api/rooms/${code}/help`, { targetId });
    this.accept(result.room, result.me);
  }
  async roadblockAction(action: 'grab' | 'release'): Promise<void> {
    const code = this.room?.code; if (!code) return;
    const result = await this.request<{ room: RoomState; me: string }>(`/api/rooms/${code}/roadblock`, { action });
    this.accept(result.room, result.me);
  }
  async sendCharacter(character: CharacterSnapshot): Promise<void> {
    const room = this.room;
    if (!room || room.status !== 'running' || this.sendingCharacter || Object.values(room.seats).includes(this.me)) return;
    this.sendingCharacter = true;
    try { await this.request(`/api/rooms/${room.code}/character`, { character }); }
    catch (error) { if (!(error instanceof Error && /too frequent|stale/i.test(error.message))) console.warn('Character sync:', error); }
    finally { this.sendingCharacter = false; }
  }
}
