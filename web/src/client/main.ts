import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { FollowCamera } from './game/camera';
import { CHECKPOINTS, ROUTE_LENGTH, nearestRouteDistance, roadX, roadY } from './game/route';
import { Vehicle } from './game/vehicle';
import { Winch } from './game/winch';
import { MudEffects } from './game/mud-effects';
import { Bear } from './game/bear';
import { Roadblock } from './game/roadblock';
import { advanceBear, initialBear } from '../shared/bear';
import { roadblockEnd } from '../shared/roadblock';
import { Avatar, JACKET_COLORS, Walker, loadCharacterAsset } from './game/character';
import { ANCHOR_POINT } from '../shared/cable';
import { BRIDGE_STOCK_POINT, BRIDGE_SLOTS, bridgeWorkPoint } from '../shared/bridge';
import type { CableEnd } from '../shared/cable';
import { makeWorld } from './game/world';
import { Hud } from './ui/hud';
import { OnlineRoom } from './net/online-room';
import { VehicleSync } from './net/vehicle-sync';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="scene"></div>
  <div id="intro" class="overlay"><div class="intro-card"><div class="eyebrow">A MOUNTAIN ROAD AWAITS</div><h1>WRONG TURN<br><em>TOGETHER</em></h1><p>Take the camper through winding pine country. Two players can share the wheel in a server-backed room.</p><button id="create-room">CREATE CO-OP ROOM <span>↗</span></button><div class="join-row"><input id="join-code" aria-label="Room code" maxlength="6" placeholder="ROOM CODE"><button id="join-room">JOIN</button></div><button id="start" class="secondary">SOLO DRIVING PREVIEW</button><small id="menu-error">Co-op requires a Reddit login, or the local Redis room harness.</small></div></div>
  <div id="lobby" class="overlay hidden"><div class="dialog lobby-card"><span class="eyebrow">TWO SEATS · ONE ROAD</span><h2>Road crew</h2><div class="room-code">ROOM <strong id="room-code"></strong> <button id="copy-room">COPY</button></div><div id="room-slots"></div><p id="room-state">Waiting for your co-driver...</p><button id="ready-room">READY UP</button><button id="start-room" disabled>START MATCH</button><button id="leave-room" class="secondary">LEAVE ROOM</button><p id="lobby-error"></p></div></div>
  <div id="connection" class="overlay hidden"><div class="dialog"><span class="eyebrow">CREW CONNECTION</span><h2>Waiting for co-driver</h2><p>The match is paused until both players return. Your RV position is saved in the room.</p><button id="reconnect-room">RECONNECT</button><button id="leave-paused-room" class="secondary">LEAVE ROOM</button></div></div>
  <div id="hud" class="hidden"><div class="top-left panel"><div class="brand">WRONG TURN TOGETHER <span> / MOUNTAIN RUN</span></div><div class="bar-row">HULL <div class="bar"><div id="hull-fill"></div></div></div><div class="bar-row">FUEL <div class="bar fuel"><div id="fuel-fill"></div></div></div></div>
  <div class="top-center panel"><span class="eyebrow">TIME ON THE ROAD</span><strong id="timer">00:00</strong><span id="status">0% ROUTE</span></div>
  <div class="top-right panel"><span class="eyebrow">NEXT UP</span><b id="objective">Reach checkpoint 1</b><span class="hint">Follow the amber dirt road.</span></div>
  <canvas id="minimap" aria-label="Route minimap" title="Tap to expand route map"></canvas>
  <div class="controls-note panel"><span id="crew-status"></span><span id="control-hint">W / ↑ THROTTLE &nbsp; S / ↓ REVERSE &nbsp; A D STEER &nbsp; SPACE BRAKE<br>SCROLL / PINCH ZOOM &nbsp; C CAMERA RESET &nbsp; ESC PAUSE</span></div>
  <div id="action-prompt" class="panel hidden"></div>
  <div id="touch"><button data-action="left">◀</button><button data-action="right">▶</button><button data-action="brake">BRAKE</button><button data-action="throttle">GO</button><button id="touch-enter" class="hidden">EXIT</button><button id="touch-jump" class="hidden">JUMP</button><button id="touch-tow-end" class="hidden">FRONT</button><button id="touch-winch" class="hidden">CABLE</button><button id="touch-pay-out" class="hidden">OUT</button><button id="touch-bridge" class="hidden">PLANK</button><button id="touch-throw" class="hidden">THROW</button><button id="touch-help" class="hidden">HELP</button><button id="touch-log" class="hidden">LOG</button></div>
  <div id="camera-controls"><button id="zoom-in" aria-label="Zoom camera in" title="Zoom in">+</button><button id="zoom-out" aria-label="Zoom camera out" title="Zoom out">−</button></div>
  <button id="pause-button" aria-label="Pause">Ⅱ</button></div>
  <div id="pause" class="overlay hidden"><div class="dialog"><span class="eyebrow">A LITTLE BREATHER</span><h2>Paused</h2><button id="resume">RESUME</button><button id="recover">RECOVER RV · −10 HULL</button><button id="restart">RESTART RUN</button><p>Drag to orbit; scroll, pinch, or use +/− to zoom. Tap the map for the whole route.</p></div></div>
  <div id="result" class="overlay hidden"><div class="dialog"><span class="eyebrow">JOURNEY COMPLETE</span><h2>Road trip complete!</h2><p id="result-time"></p><button id="again">PLAY AGAIN</button><button id="leave-finished-room" class="secondary hidden">LEAVE ROOM</button><p id="result-note" class="muted">Solo preview result. No leaderboard submission.</p></div></div>`;

async function boot(): Promise<void> {
  await RAPIER.init();
  const scene = new THREE.Scene();
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  physics.timestep = 1 / 60;
  const bridge = makeWorld(scene, physics);
  const camera = new THREE.PerspectiveCamera(65, 1, .15, 250);
  const lowQuality = new URLSearchParams(location.search).get('quality') === 'low';
  const renderer = new THREE.WebGLRenderer({ antialias: !lowQuality, powerPreference: 'high-performance' });
  renderer.setPixelRatio(lowQuality ? .65 : Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.shadowMap.enabled = !lowQuality && !matchMedia('(max-width: 700px)').matches;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  document.querySelector('#scene')!.appendChild(renderer.domElement);
  const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  window.addEventListener('resize', resize); resize();
  const vehicle = new Vehicle(scene, physics);
  let soloBear = initialBear(Date.now());
  const bear = new Bear(scene, physics, soloBear);
  const roadblock = new Roadblock(scene, physics);
  const winch = new Winch(vehicle, scene);
  const mudEffects = new MudEffects(scene);
  const characterAsset = await loadCharacterAsset();
  const walker = new Walker(scene, physics, characterAsset);
  const other = new Avatar(scene, characterAsset, JACKET_COLORS[1]);
  other.model.visible = false;
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 256; labelCanvas.height = 64;
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  const otherLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false }));
  otherLabel.scale.set(2.6, .65, 1);
  otherLabel.visible = false;
  let shownName = '';
  let localJacket = 0, remoteJacket = 1;
  let otherWasSeated: boolean | null = null;
  scene.add(otherLabel);
  const sync = new VehicleSync(vehicle);
  const online = new OnlineRoom();
  vehicle.syncVisual();
  camera.position.copy(vehicle.model.position).add(new THREE.Vector3(0, 5, 10));
  const follow = new FollowCamera(camera, physics);
  const hud = new Hud();
  const pressed = new Set<string>();
  let active = false, paused = false, finished = false, elapsed = 0, checkpoint = 0;
  let walking = false, seatPending = false, characterAcc = 0;
  let lastRecovery = 0;
  let selectedTowEnd: CableEnd = 'front';
  const toggleTowEnd = () => {
    selectedTowEnd = selectedTowEnd === 'front' ? 'rear' : 'front';
    document.querySelector<HTMLButtonElement>('#touch-tow-end')!.textContent = selectedTowEnd.toUpperCase();
  };
  const intro = document.querySelector<HTMLElement>('#intro')!;
  const hudElement = document.querySelector<HTMLElement>('#hud')!;
  const pauseElement = document.querySelector<HTMLElement>('#pause')!;
  const result = document.querySelector<HTMLElement>('#result')!;
  const lobby = document.querySelector<HTMLElement>('#lobby')!;
  const connection = document.querySelector<HTMLElement>('#connection')!;
  const menuError = document.querySelector<HTMLElement>('#menu-error')!;
  const lobbyError = document.querySelector<HTMLElement>('#lobby-error')!;
  const showError = (error: unknown) => { const target = online.room ? lobbyError : menuError; target.textContent = error instanceof Error ? error.message : String(error); };
  const leaveOnline = async () => {
    try { await online.leave(); } catch (error) { showError(error); }
    sync.setOwner(true, null); active = false; finished = false; paused = false;
    lastRecovery = 0; checkpoint = 0;
    bridge.sync(null);
    roadblock.sync(null, 1);
    walking = false; other.model.visible = false; otherLabel.visible = false;
    otherWasSeated = null;
    walker.setWalking(false, { p: [0, 1.3, 0], yaw: 0, moving: false, seq: 0, at: 0 });
    vehicle.setCheckpoint(0); vehicle.reset(); vehicle.hull = 100; vehicle.fuel = 100;
    intro.classList.remove('hidden'); lobby.classList.add('hidden'); connection.classList.add('hidden');
    hudElement.classList.add('hidden'); pauseElement.classList.add('hidden'); result.classList.add('hidden');
    document.querySelector<HTMLButtonElement>('#recover')!.disabled = false;
    document.querySelector<HTMLButtonElement>('#restart')!.disabled = false;
  };
  online.onChange = (room, me) => {
    bridge.sync(room, online.serverNow());
    const mine = Math.max(0, room.players.findIndex(player => player.id === me));
    const theirs = Math.max(0, room.players.findIndex(player => player.id !== me));
    if (localJacket !== mine) { walker.setJacketColor(JACKET_COLORS[mine] ?? JACKET_COLORS[0]); localJacket = mine; }
    if (remoteJacket !== theirs) { other.setJacketColor(JACKET_COLORS[theirs] ?? JACKET_COLORS[1]); remoteJacket = theirs; }
    const crewMate = room.players.find(player => player.id !== me);
    const displayName = crewMate && (/^[0-9a-f]{8}-/i.test(crewMate.name)
      ? (room.players[0]?.id === crewMate.id ? 'DRIVER' : 'MECHANIC') : crewMate.name);
    if (displayName && displayName !== shownName) {
      shownName = displayName;
      const ctx = labelCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, 256, 64);
      ctx.fillStyle = '#193739'; ctx.fillRect(8, 8, 240, 48);
      ctx.fillStyle = '#f8e4b7'; ctx.font = 'bold 25px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(displayName.slice(0, 16), 128, 40);
      labelTexture.needsUpdate = true;
    }
    const slot = room.players.find(p => p.id === me);
    if (room.checkpoint > checkpoint) { checkpoint = room.checkpoint; vehicle.setCheckpoint(CHECKPOINTS[checkpoint - 1]); }
    if (room.recoveries > lastRecovery && room.vehicle) {
      lastRecovery = room.recoveries;
      const snapshot = room.vehicle;
      vehicle.body.setTranslation({ x: snapshot.p[0], y: snapshot.p[1], z: snapshot.p[2] }, true);
      vehicle.body.setRotation({ x: snapshot.q[0], y: snapshot.q[1], z: snapshot.q[2], w: snapshot.q[3] }, true);
      vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      vehicle.hull = snapshot.hull; vehicle.fuel = snapshot.fuel;
      if (room.characters[me]) walker.restore(room.characters[me]);
      vehicle.syncVisual(); follow.reset();
    }
    document.querySelector('#room-code')!.textContent = room.code;
    const slots = document.querySelector('#room-slots')!;
    slots.replaceChildren();
    for (let i = 0; i < 2; i++) {
      const row = document.createElement('div'); row.className = 'lobby-slot';
      const player = room.players[i];
      row.textContent = `${i === 0 ? '① DRIVER' : '② MECHANIC'}  ·  ${player?.name ?? 'Waiting for player'}  ·  ${player ? (player.connected ? (player.ready ? 'READY' : 'NOT READY') : 'DISCONNECTED') : 'EMPTY'}`;
      slots.appendChild(row);
    }
    document.querySelector('#room-state')!.textContent = room.status === 'waiting' ? 'Both crew members must ready up.' : room.status === 'paused' ? 'Waiting for the other player to reconnect.' : 'Driving together.';
    document.querySelector<HTMLButtonElement>('#ready-room')!.textContent = slot?.ready ? 'NOT READY' : 'READY UP';
    document.querySelector<HTMLButtonElement>('#start-room')!.disabled = !(room.status === 'waiting' && room.players.length === 2 && room.players.every(p => p.ready && p.connected) && room.players[0].id === me);
    const mySeat = room.seats.driver === me ? 'driver' : room.seats.passenger === me ? 'passenger' : null;
    const nextWalking = !mySeat && (room.status === 'running' || room.status === 'paused');
    if (nextWalking !== walking) {
      walking = nextWalking;
      if (room.characters[me]) walker.setWalking(walking, room.characters[me]);
      follow.reset();
    }
    document.querySelector('#crew-status')!.textContent = `ROOM ${room.code} · ${mySeat === 'driver' ? 'DRIVING' : mySeat === 'passenger' ? 'CO-DRIVER' : 'ON FOOT'}  `;
    document.querySelector('#control-hint')!.innerHTML = walking ? 'WASD WALK · SHIFT SPRINT · SPACE JUMP · F ENTER RV<br>E PLANK/CABLE · Q THROW PLANK · SCROLL ZOOM' : 'W / ↑ THROTTLE · S / ↓ REVERSE · A D STEER · SPACE BRAKE<br>F EXIT RV · SCROLL ZOOM · C CAMERA RESET';
    document.querySelector('#touch-enter')!.classList.toggle('hidden', !room);
    document.querySelector('#touch-jump')!.classList.toggle('hidden', !walking);
    document.querySelector('#touch-winch')!.classList.toggle('hidden', !walking);
    document.querySelector('#touch-tow-end')!.classList.toggle('hidden', !walking || !!room.cable);
    document.querySelector('#touch-pay-out')!.classList.toggle('hidden', !walking || room.cable?.stage !== 'attached');
    document.querySelector('#touch-bridge')!.classList.toggle('hidden', !walking);
    document.querySelector('#touch-throw')!.classList.toggle('hidden', !walking || !room.bridge.planks.some(plank => plank.stage === 'carried' && plank.holderId === me));
    document.querySelector<HTMLButtonElement>('#touch-enter')!.textContent = walking ? 'ENTER' : 'EXIT';
    if (room.status === 'running' || room.status === 'paused' || room.status === 'finished') {
      sync.setOwner(room.ownerId === me, room.vehicle);
      intro.classList.add('hidden'); lobby.classList.add('hidden'); hudElement.classList.remove('hidden');
      active = true; connection.classList.toggle('hidden', room.status !== 'paused');
      document.querySelector<HTMLButtonElement>('#recover')!.disabled = room.seats.driver !== me;
      document.querySelector<HTMLButtonElement>('#restart')!.disabled = true;
      if (room.status === 'finished' && room.result) {
        finished = true; result.classList.remove('hidden');
        const time = Math.floor(room.result.timeMs / 1000);
        document.querySelector('#result-time')!.textContent =
          `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')} · ${room.result.checkpoints} stops · ${Math.round(room.result.hull)}% hull · ${Math.round(room.result.fuel)}% fuel · Crew: ${room.result.players.join(', ')}`;
        document.querySelector('#again')!.classList.add('hidden');
        document.querySelector('#leave-finished-room')!.classList.remove('hidden');
        document.querySelector('#result-note')!.textContent = 'Shared result validated from room progress; no leaderboard submission.';
      }
    } else {
      intro.classList.add('hidden'); lobby.classList.remove('hidden');
    }
  };
  const roomAction = (action: () => Promise<unknown>) => { void action().catch(showError); };
  document.querySelector('#create-room')!.addEventListener('click', () => roomAction(() => online.create()));
  document.querySelector('#join-room')!.addEventListener('click', () => roomAction(() => online.join((document.querySelector('#join-code') as HTMLInputElement).value)));
  document.querySelector('#copy-room')!.addEventListener('click', () => roomAction(async () => { await navigator.clipboard.writeText(online.room?.code ?? ''); }));
  document.querySelector('#ready-room')!.addEventListener('click', () => roomAction(() => online.setReady(!online.room?.players.find(p => p.id === online.me)?.ready)));
  document.querySelector('#start-room')!.addEventListener('click', () => roomAction(() => online.start()));
  document.querySelector('#leave-room')!.addEventListener('click', () => roomAction(leaveOnline));
  document.querySelector('#leave-paused-room')!.addEventListener('click', () => roomAction(leaveOnline));
  document.querySelector('#leave-finished-room')!.addEventListener('click', () => roomAction(leaveOnline));
  document.querySelector('#reconnect-room')!.addEventListener('click', () => roomAction(() => online.heartbeat()));
  void online.resume().catch(() => { localStorage.removeItem('tow-room-code'); });
  const start = () => { active = true; intro.classList.add('hidden'); hudElement.classList.remove('hidden'); };
  document.querySelector('#start')!.addEventListener('click', start);
  const togglePause = () => { if (!active || finished) return; paused = !paused; pauseElement.classList.toggle('hidden', !paused); pressed.clear(); };
  const changeSeat = async () => {
    const room = online.room;
    if (!room || room.status !== 'running' || seatPending || paused || finished) return;
    seatPending = true;
    try {
      if (!walking) await online.setSeat(null);
      else {
        const distance = walker.model.position.distanceTo(vehicle.model.position);
        if (distance > 5) throw new Error('Move closer to an RV door');
        await online.refresh();
        const latest = online.room;
        const available = !latest?.seats.driver ? 'driver' : !latest.seats.passenger ? 'passenger' : null;
        if (!available) throw new Error('Both RV seats are occupied');
        await online.setSeat(available);
      }
    } catch (error) { document.querySelector('#action-prompt')!.textContent = error instanceof Error ? error.message : String(error); }
    finally { seatPending = false; }
  };
  const useCable = async () => {
    const room = online.room;
    if (!room || !walking || paused || room.status !== 'running') return;
    try {
      const cable = room.cable;
      if (!cable) await online.cableAction('pickup', selectedTowEnd);
      else if (cable.stage === 'carried') await online.cableAction('attach');
      else await online.cableAction(cable.reeling ? 'stop' : 'reel');
    } catch (error) {
      document.querySelector('#action-prompt')!.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  const bridgeInteraction = async () => {
    const room = online.room;
    if (!room || !walking || paused || room.status !== 'running') return;
    try {
      const held = room.bridge.planks.findIndex(plank => plank.stage === 'carried' && plank.holderId === online.me);
      if (held >= 0) { await online.bridgeAction('place'); walker.playOnce('Place'); }
      else if (room.bridge.planks.some((plank, i) => plank.stage === 'placed' &&
        walker.model.position.distanceTo(new THREE.Vector3(...bridgeWorkPoint(i))) < 4.5))
        await online.bridgeAction('secure');
      else { await online.bridgeAction('pickup'); walker.playOnce('Pickup'); }
    } catch (error) {
      document.querySelector('#action-prompt')!.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  const knockedTeammate = () => {
    const room = online.room;
    if (!room || !walking) return null;
    return room.players.find(player => player.id !== online.me &&
      room.bear.knockedUntil[player.id] > online.serverNow() &&
      room.characters[player.id] &&
      walker.model.position.distanceTo(new THREE.Vector3(...room.characters[player.id].p)) < 2.8) ?? null;
  };
  const logInteraction = () => {
    const held = online.room?.roadblock.grips.includes(online.me);
    roomAction(() => online.roadblockAction(held ? 'release' : 'grab'));
  };
  document.querySelector('#pause-button')!.addEventListener('click', togglePause);
  document.querySelector('#resume')!.addEventListener('click', togglePause);
  document.querySelector('#recover')!.addEventListener('click', () => {
    if (!online.room) { vehicle.reset(); togglePause(); }
    else roomAction(async () => { await online.recover(); if (paused) togglePause(); });
  });
  const restart = () => { vehicle.setCheckpoint(0); vehicle.reset(); vehicle.hull = 100; vehicle.fuel = 100; elapsed = 0; checkpoint = 0; soloBear = initialBear(Date.now()); paused = false; finished = false; active = true; pauseElement.classList.add('hidden'); result.classList.add('hidden'); };
  document.querySelector('#restart')!.addEventListener('click', restart);
  document.querySelector('#again')!.addEventListener('click', restart);
  if (import.meta.env.DEV) {
    // Local browser integration tests can exercise the actual checkpoint/finish loop
    // without a long, software-rendered drive. This is removed from Devvit builds.
    Object.assign(window, {
      __towTest: {
        zoomLevel: () => follow.zoomLevel,
        characters: () => ({ local: walker.inspect(), remote: other.inspect() }),
        vehiclePosition: () => {
          const p = vehicle.body.translation();
          return [p.x, p.y, p.z];
        },
        unsupportedRoad: () => {
          const gaps: number[] = [];
          for (let d = 0; d <= ROUTE_LENGTH; d += 10) {
            if (d >= 110 && d <= 130) continue;
            const ray = new RAPIER.Ray(
              { x: roadX(d), y: roadY(d) + 6, z: -d }, { x: 0, y: -1, z: 0 });
            if (!physics.castRay(ray, 10, true)) gaps.push(d);
          }
          return gaps;
        },
        cameraForward: () => {
          const forward = new THREE.Vector3();
          camera.getWorldDirection(forward);
          return [forward.x, forward.z];
        },
        placeAt: (distance: number) => {
          vehicle.body.setTranslation({ x: roadX(distance), y: roadY(distance) + 1.4, z: -distance }, true);
          vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        },
      },
    });
  }
  window.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    pressed.add(e.code);
    if (e.repeat) return;
    if (e.code === 'Escape') togglePause();
    if (e.code === 'KeyC') follow.reset();
    if (e.code === 'KeyR' && active && !paused && !online.room) vehicle.reset();
    if (e.code === 'KeyF' && active && !paused) void changeSeat();
    if (e.code === 'KeyE' && active && !paused) {
      const teammate = knockedTeammate();
      if (teammate) { roomAction(() => online.helpPlayer(teammate.id)); return; }
      const log = online.room?.roadblock;
      if (walking && log && !log.cleared && (log.grips.includes(online.me) ||
        log.grips.some((holder, i) => !holder && walker.model.position.distanceTo(new THREE.Vector3(...roadblockEnd(log, i))) < 3.2))) {
        logInteraction(); return;
      }
      const nearBridge = online.room && walking &&
        (online.room.bridge.planks.some(plank => plank.stage === 'carried' && plank.holderId === online.me) ||
          walker.model.position.distanceTo(new THREE.Vector3(...BRIDGE_STOCK_POINT)) < 5 ||
          BRIDGE_SLOTS.some((_, i) => walker.model.position.distanceTo(new THREE.Vector3(...bridgeWorkPoint(i))) < 5) ||
          online.room.bridge.planks.some(plank => plank.stage === 'thrown' && plank.p &&
            walker.model.position.distanceTo(new THREE.Vector3(...plank.p)) < 5));
      if (nearBridge) void bridgeInteraction(); else void useCable();
    }
    if (e.code === 'KeyG' && active && walking && !online.room?.cable) toggleTowEnd();
    if (e.code === 'KeyQ' && active && walking && online.room) {
      if (online.room.roadblock.grips.includes(online.me)) { logInteraction(); return; }
      const held = online.room.bridge.planks.some(plank => plank.stage === 'carried' && plank.holderId === online.me);
      roomAction(() => held ? online.bridgeAction('throw') : online.cableAction('detach'));
    }
    if (e.code === 'KeyB' && active && walking && online.room) roomAction(() => online.bridgeAction('retrieve'));
    if (e.code === 'KeyT' && active && walking && online.room?.cable?.stage === 'attached')
      roomAction(() => online.cableAction(online.room?.cable?.payingOut ? 'stop' : 'out'));
  });
  window.addEventListener('keyup', e => pressed.delete(e.code));
  window.addEventListener('blur', () => { pressed.clear(); if (active && !paused && !finished) togglePause(); });
  for (const button of document.querySelectorAll<HTMLButtonElement>('#touch button[data-action]')) {
    const action = button.dataset.action!;
    button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); pressed.add(action); });
    button.addEventListener('pointerup', () => pressed.delete(action));
    button.addEventListener('pointercancel', () => pressed.delete(action));
  }
  document.querySelector('#touch-enter')!.addEventListener('click', () => void changeSeat());
  document.querySelector('#touch-jump')!.addEventListener('pointerdown', () => pressed.add('Space'));
  document.querySelector('#touch-jump')!.addEventListener('pointerup', () => pressed.delete('Space'));
  document.querySelector('#touch-winch')!.addEventListener('click', () => void useCable());
  document.querySelector('#touch-tow-end')!.addEventListener('click', toggleTowEnd);
  document.querySelector('#touch-pay-out')!.addEventListener('click', () => roomAction(() => online.cableAction(online.room?.cable?.payingOut ? 'stop' : 'out')));
  document.querySelector('#touch-bridge')!.addEventListener('click', () => void bridgeInteraction());
  document.querySelector('#touch-throw')!.addEventListener('click', () => roomAction(() => online.bridgeAction('throw')));
  document.querySelector('#touch-help')!.addEventListener('click', () => {
    const teammate = knockedTeammate();
    if (teammate) roomAction(() => online.helpPlayer(teammate.id));
  });
  document.querySelector('#touch-log')!.addEventListener('click', logInteraction);
  document.querySelector('#zoom-in')!.addEventListener('click', () => follow.zoomBy(-220));
  document.querySelector('#zoom-out')!.addEventListener('click', () => follow.zoomBy(220));
  renderer.domElement.addEventListener('wheel', e => { e.preventDefault(); follow.zoomBy(e.deltaY); }, { passive: false });
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  renderer.domElement.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    renderer.domElement.setPointerCapture(e.pointerId);
    if (pointers.size === 2) pinchDistance = Math.hypot(...pinchDelta());
  });
  const pinchDelta = (): [number, number] => {
    const [a, b] = [...pointers.values()];
    return a && b ? [a.x - b.x, a.y - b.y] : [0, 0];
  };
  const releasePointer = (e: PointerEvent) => { pointers.delete(e.pointerId); pinchDistance = 0; };
  renderer.domElement.addEventListener('pointerup', releasePointer);
  renderer.domElement.addEventListener('pointercancel', releasePointer);
  renderer.domElement.addEventListener('pointermove', e => {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const distance = Math.hypot(...pinchDelta());
      if (pinchDistance) follow.zoomBy((pinchDistance - distance) * 4);
      pinchDistance = distance;
    } else follow.rotate(e.clientX - previous.x, e.clientY - previous.y);
  });
  let last = performance.now(), accumulator = 0, uiAcc = 0, syncAcc = 0;
  function frame(now: number): void {
    requestAnimationFrame(frame);
    const dt = Math.min(.08, (now - last) / 1000); last = now;
    if (active && !paused && !finished && (!online.room || online.room.status === 'running')) {
      accumulator += dt;
      const throttle = pressed.has('KeyW') || pressed.has('ArrowUp') || pressed.has('throttle');
      const reverse = pressed.has('KeyS') || pressed.has('ArrowDown');
      const driving = !online.room || online.room.seats.driver === online.me;
      vehicle.input.throttle = driving && throttle ? 1 : 0;
      vehicle.input.reverse = driving && reverse ? 1 : 0;
      vehicle.input.steer = driving ? Number(pressed.has('KeyD') || pressed.has('ArrowRight') || pressed.has('right')) - Number(pressed.has('KeyA') || pressed.has('ArrowLeft') || pressed.has('left')) : 0;
      vehicle.input.handbrake = !driving || pressed.has('Space') || pressed.has('brake');
      let steps = 0;
      while (accumulator >= 1 / 60 && steps++ < 5) {
        if (!online.room || online.room.ownerId === online.me) {
          vehicle.step(1 / 60);
          if (online.room) winch.step(1 / 60, online.room, online.serverNow());
        }
        else sync.stepRemote(1 / 60);
        if (walking) {
          const carrying = online.room?.cable?.stage === 'carried' && online.room.cable.holderId === online.me;
          const carryingPlank = online.room?.bridge.planks.some(plank => plank.stage === 'carried' && plank.holderId === online.me);
          const distance = walker.model.position.distanceTo(vehicle.model.position);
          const carryingLog = online.room?.roadblock.grips.includes(online.me);
          walker.setActivity(carryingLog || online.room?.cable?.stage === 'attached' && online.room.cable.holderId === online.me
            ? 'Winch' : carrying || carryingPlank ? 'Carry' : null);
          if (!(online.room?.bear.knockedUntil[online.me] && online.room.bear.knockedUntil[online.me] > online.serverNow()))
            walker.step(1 / 60, pressed, camera, carrying
              ? Math.min(distance > 9 ? .45 : 1, Math.max(.25, 1 - winch.tension * .75)) : carryingPlank ? .62 : carryingLog ? .72 : 1);
        }
        physics.step(); accumulator -= 1 / 60;
        if (walking) walker.sync();
        if (!online.room) elapsed += 1 / 60;
      }
      if (steps > 5) accumulator = 0;
      vehicle.syncVisual();
      if (!online.room) {
        const p = vehicle.body.translation(), v = vehicle.body.linvel();
        advanceBear(soloBear, Date.now(), { p: [p.x, p.y, p.z], v: [v.x, v.y, v.z] }, {}, []);
      }
      if (online.room) {
        elapsed = Math.max(0, (online.serverNow() - (online.room.startedAt ?? online.serverNow())) / 1000);
        if (online.room.ownerId === online.me) {
          syncAcc += dt;
          if (syncAcc >= .28) { syncAcc = 0; void online.sendSnapshot(sync.sample()); }
        }
        if (walking) {
          characterAcc += dt;
          if (characterAcc >= .22) {
            characterAcc = 0;
            const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'left', 'right', 'throttle'].some(key => pressed.has(key));
            void online.sendCharacter(walker.sample(moving));
          }
        }
      }
      const position = vehicle.body.translation();
      const distance = nearestRouteDistance(position.x, position.z);
      if (!online.room && checkpoint < CHECKPOINTS.length && distance >= CHECKPOINTS[checkpoint] - 1 && Math.abs(position.z + CHECKPOINTS[checkpoint]) < 6 && Math.abs(position.x - roadX(CHECKPOINTS[checkpoint])) < 7) {
        checkpoint++; vehicle.setCheckpoint(CHECKPOINTS[checkpoint - 1]);
      }
      if (!online.room && distance >= ROUTE_LENGTH - 1 && Math.abs(position.x - roadX(ROUTE_LENGTH)) < 6 && checkpoint === CHECKPOINTS.length && vehicle.hull > 0) {
        finished = true; result.classList.remove('hidden');
        document.querySelector('#result-time')!.textContent = `Time ${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')} · Hull ${Math.round(vehicle.hull)}% · Fuel ${Math.round(vehicle.fuel)}%`;
      }
      if (vehicle.hull <= 0) { paused = true; pauseElement.classList.remove('hidden'); }
      uiAcc += dt;
      if (uiAcc >= .05) { hud.update(vehicle, elapsed, distance, online.room?.checkpoint ?? checkpoint, online.room); uiAcc = 0; }
    }
    const room = online.room;
    roadblock.sync(room, dt);
    const bearState = room?.bear ?? soloBear;
    bear.sync(bearState, dt);
    const knocked = !!room && bearState.knockedUntil[online.me] > online.serverNow();
    walker.setKnocked(knocked);
    if (knocked) walker.animate(dt);
    const teammateToHelp = knockedTeammate();
    document.querySelector('#touch-help')!.classList.toggle('hidden', !teammateToHelp);
    const log = room?.roadblock;
    const nearLog = walking && !!log && !log.cleared && (log.grips.includes(online.me) ||
      log.grips.some((holder, i) => !holder && walker.model.position.distanceTo(new THREE.Vector3(...roadblockEnd(log, i))) < 3.2));
    document.querySelector('#touch-log')!.classList.toggle('hidden', !nearLog);
    document.querySelector('#touch-log')!.textContent = log?.grips.includes(online.me) ? 'LET GO' : 'GRAB';
    const otherPlayer = room?.players.find(player => player.id !== online.me);
    if (otherPlayer && room) {
      other.setKnocked(room.bear.knockedUntil[otherPlayer.id] > online.serverNow());
      const occupied = room.seats.driver === otherPlayer.id ? 'driver' : room.seats.passenger === otherPlayer.id ? 'passenger' : null;
      other.model.visible = true; otherLabel.visible = true;
      other.setSeated(!!occupied);
      if (otherWasSeated !== null && otherWasSeated !== !!occupied)
        other.playOnce(occupied ? 'Enter' : 'Exit');
      otherWasSeated = !!occupied;
      if (occupied) {
        const local = new THREE.Vector3(occupied === 'driver' ? -.58 : .58, .1, -1.2);
        other.model.position.copy(vehicle.model.localToWorld(local));
        other.model.quaternion.copy(vehicle.model.quaternion);
        other.model.scale.setScalar(.68);
        other.setMotion(occupied === 'driver' ? 'SitDriver' : 'SitPassenger');
        other.animate(dt);
      } else if (room.characters[otherPlayer.id]) {
        other.model.scale.setScalar(1);
        other.model.rotation.x = 0; other.model.rotation.z = 0;
        other.follow(room.characters[otherPlayer.id], dt);
      } else { other.model.visible = false; otherLabel.visible = false; }
      otherLabel.position.copy(other.model.position).add(new THREE.Vector3(0, occupied ? 1.55 : 1.8, 0));
    } else {
      other.model.visible = false; otherLabel.visible = false;
      otherWasSeated = null;
    }
    if (walking) follow.updateWalker(walker.model.position, walker.model.rotation.y, dt, walker.body);
    else follow.update(vehicle, dt);
    winch.render(room, online.me, online.serverNow(), walking ? walker.model.position : undefined);
    bridge.sync(room, online.serverNow());
    mudEffects.update(dt, vehicle);
    const prompt = document.querySelector<HTMLElement>('#action-prompt')!;
    if (room && !paused) {
      const close = walker.model.position.distanceTo(vehicle.model.position) < 5;
      const cable = room.cable;
      const anchorNear = walker.model.position.distanceTo(new THREE.Vector3(...ANCHOR_POINT)) < 4.5;
      const nearStock = walker.model.position.distanceTo(new THREE.Vector3(...BRIDGE_STOCK_POINT)) < 4.5;
      const heldPlank = room.bridge.planks.findIndex(plank => plank.stage === 'carried' && plank.holderId === online.me);
      const nearHeldSlot = heldPlank >= 0 &&
        walker.model.position.distanceTo(new THREE.Vector3(...bridgeWorkPoint(heldPlank))) < 4.5;
      const nearLoosePlank = room.bridge.planks.some((plank, i) => plank.stage === 'placed' &&
        walker.model.position.distanceTo(new THREE.Vector3(...bridgeWorkPoint(i))) < 4.5);
      const nearThrownPlank = room.bridge.planks.some(plank => plank.stage === 'thrown' && plank.p &&
        walker.model.position.distanceTo(new THREE.Vector3(...plank.p)) < 4.5);
      prompt.textContent = knocked ? 'BEAR KNOCKED YOU DOWN · WAIT OR ASK A FRIEND TO HELP'
        : teammateToHelp ? 'E · HELP YOUR KNOCKED-DOWN FRIEND'
        : nearLog ? log?.grips.includes(online.me) ? 'WALK SIDEWAYS TOGETHER · E / Q RELEASE LOG' :
          'E · GRAB FREE LOG END · BOTH PLAYERS MOVE IT OFF THE ROAD'
        : walking
        ? heldPlank >= 0 ? nearHeldSlot ? 'E · PLACE PLANK IN BRIDGE SLOT   Q · THROW' : `CARRY PLANK ${heldPlank + 1} TO MARKED SLOT · Q THROW`
          : nearLoosePlank ? 'E · SECURE PLANK   B · RETRIEVE'
            : nearThrownPlank ? 'E · PICK UP THROWN PLANK'
              : nearStock && room.bridge.planks.some(plank => plank.stage === 'stock') ? 'E · PICK UP BRIDGE PLANK'
              : !cable ? close ? `F · ENTER RV   E · TAKE ${selectedTowEnd.toUpperCase()} CABLE   G · CHANGE TOW END` : `WALK TO RV CABLE   G · ${selectedTowEnd.toUpperCase()} TOW END`
          : cable.stage === 'carried' ? anchorNear ? 'E · ATTACH CABLE TO MARKED TREE' : 'CARRY CABLE TO MARKED TREE · Q DROP'
            : `E · ${cable.reeling ? 'STOP' : 'REEL'}   T · ${cable.payingOut ? 'STOP' : 'PAY OUT'}   Q · DETACH   TENSION ${Math.round(winch.tension * 100)}%`
        : 'F · EXIT RV';
      prompt.classList.remove('hidden');
    } else prompt.classList.add('hidden');
    const sun = scene.userData.sun as THREE.DirectionalLight;
    sun.position.set(vehicle.model.position.x - 45, 90, vehicle.model.position.z - 55);
    sun.target.position.copy(vehicle.model.position); sun.target.updateMatrixWorld();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
boot().catch(error => { document.querySelector('#intro')!.innerHTML = `<div class="dialog"><h2>Could not start the road</h2><p>${String(error)}</p></div>`; console.error(error); });
