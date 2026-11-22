import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

// Acceptance attempt: all motion and interactions originate in the browser from
// the real spawn. No local test position endpoint or direct body mutation is used.
const children = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', data => process.stderr.write(data));
  children.push(child);
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* starting */ }
    await sleep(150);
  }
  throw new Error(`Server did not start: ${url}`);
}
async function redisReady() {
  for (let i = 0; i < 100; i++) {
    const connected = await new Promise(resolve => {
      const socket = connect(6398, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (connected) return;
    await sleep(150);
  }
  throw new Error('Redis did not start');
}
const room = (page, code) => page.evaluate(async roomCode => {
  const response = await fetch(`/api/rooms/${roomCode}`, { headers: { 'x-local-player': localStorage.getItem('tow-local-id') } });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()).room;
}, code);
const roadX = d => 10 * Math.sin(d * .018) + 3 * Math.sin(d * .048);
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
let browser;
try {
  run('redis-server', ['--port', '6398', '--save', '', '--appendonly', 'no']);
  await redisReady();
  run(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/local.ts']);
  await ready('http://127.0.0.1:5199/api/rooms/ABCDEF');
  run(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.local.config.ts', '--port', '5198']);
  await ready('http://127.0.0.1:5198/');
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'] });
  const a = await browser.newContext({ viewport: { width: 760, height: 550 } });
  const b = await browser.newContext({ viewport: { width: 760, height: 550 } });
  const driver = await a.newPage(), mechanic = await b.newPage();
  const errors = [];
  for (const page of [driver, mechanic]) {
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto('http://127.0.0.1:5198/?quality=low', { waitUntil: 'domcontentloaded' });
    await page.locator('#create-room').waitFor();
  }
  await driver.locator('#create-room').click();
  await driver.locator('#lobby').waitFor({ state: 'visible' });
  const code = (await driver.locator('#room-code').innerText()).trim();
  await mechanic.locator('#join-code').fill(code);
  await mechanic.locator('#join-room').click();
  await mechanic.locator('#lobby').waitFor({ state: 'visible' });
  await driver.locator('#ready-room').click();
  await mechanic.locator('#ready-room').click();
  await driver.waitForFunction(() => !document.querySelector('#start-room').disabled);
  await driver.locator('#start-room').click();
  await driver.locator('#timer').waitFor({ state: 'visible' });
  await mechanic.locator('#timer').waitFor({ state: 'visible' });
  assert.ok((await room(driver, code)).vehicle.p[2] > 0, 'match must begin at the real spawn');

  // Follow the road using normal keyboard input and server snapshots as steering feedback.
  const driveDeadline = Date.now() + 180_000;
  await driver.keyboard.down('w');
  let distance = 0;
  while (Date.now() < driveDeadline) {
    await sleep(400);
    const state = await room(driver, code);
    const [x, , z] = state.vehicle.p;
    distance = -z;
    if (distance > 56) break;
    const q = state.vehicle.q;
    const yaw = 2 * Math.atan2(q[1], q[3]);
    const desired = -Math.atan2(roadX(Math.max(0, distance) + 8) - x, 8);
    const correction = wrap(desired - yaw);
    if (correction < -.09) { await driver.keyboard.down('d'); await driver.keyboard.up('a'); }
    else if (correction > .09) { await driver.keyboard.down('a'); await driver.keyboard.up('d'); }
    else { await driver.keyboard.up('a'); await driver.keyboard.up('d'); }
    if (distance < -2 || Math.abs(x - roadX(Math.max(0, distance))) > 15)
      throw new Error(`Driver left the route before mud: ${JSON.stringify(state.vehicle.p)}`);
  }
  await driver.keyboard.up('w'); await driver.keyboard.up('a'); await driver.keyboard.up('d');
  assert.ok(distance > 56, `RV never reached mud from the route spawn (${distance.toFixed(1)} m)`);
  await driver.keyboard.down('Space');
  for (let i = 0; i < 40; i++) {
    if (Math.hypot(...(await room(driver, code)).vehicle.v) < 2) break;
    await sleep(350);
  }
  const stuck = await room(driver, code);
  assert.equal(stuck.mud.entered, true);
  console.log(`route-start: RV reached mud at ${(-stuck.vehicle.p[2]).toFixed(1)} m`);
  await mechanic.keyboard.press('f');
  await mechanic.waitForFunction(() => document.querySelector('#crew-status').textContent.includes('ON FOOT'), null, { timeout: 8000 });
  await mechanic.keyboard.press('e');
  await mechanic.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('CARRY CABLE'), null, { timeout: 8000 });
  const mechanicId = await mechanic.evaluate(() => localStorage.getItem('tow-local-id'));
  await mechanic.keyboard.down('w');
  let nearAnchor = false;
  let lastWalker;
  for (let i = 0; i < 90; i++) {
    await sleep(400);
    const state = await room(mechanic, code);
    const [x, , z] = state.characters[mechanicId].p;
    lastWalker = state.characters[mechanicId].p;
    if (Math.hypot(x - (roadX(79) + 7.3), z + 79) < 4.4) { nearAnchor = true; break; }
    if (z < -86) break;
  }
  await mechanic.keyboard.up('w');
  assert.ok(nearAnchor, `mechanic did not reach the marked anchor using walking input: ${JSON.stringify(lastWalker)}`);
  await mechanic.keyboard.press('e');
  await mechanic.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('REEL'), null, { timeout: 8000 });
  await mechanic.keyboard.press('e');
  await mechanic.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('STOP'), null, { timeout: 8000 });
  assert.equal((await room(mechanic, code)).cable.reeling, true);
  await mechanic.waitForFunction(() => window.__towTest.characters().local.animation === 'Winch', null, { timeout: 7000 });
  await driver.keyboard.up('Space'); await driver.keyboard.down('w');
  let cableReleased = false;
  for (let i = 0; i < 150; i++) {
    await sleep(400);
    const state = await room(driver, code);
    const [x, , z] = state.vehicle.p;
    const distanceNow = -z;
    if (state.mud.rescued) break;
    const yaw = 2 * Math.atan2(state.vehicle.q[1], state.vehicle.q[3]);
    const correction = wrap(-Math.atan2(roadX(distanceNow + 8) - x, 8) - yaw);
    if (correction < -.09) { await driver.keyboard.down('d'); await driver.keyboard.up('a'); }
    else if (correction > .09) { await driver.keyboard.down('a'); await driver.keyboard.up('d'); }
    else { await driver.keyboard.up('a'); await driver.keyboard.up('d'); }
    if (distanceNow > 72.5 && !cableReleased) {
      await mechanic.keyboard.press('q');
      cableReleased = true;
    }
    if (distanceNow > 94) break;
  }
  await driver.keyboard.up('w'); await driver.keyboard.up('a'); await driver.keyboard.up('d');
  const escaped = await room(driver, code);
  assert.equal(escaped.mud.rescued, true, `RV did not escape the mud: ${JSON.stringify(escaped.vehicle.p)}`);
  assert.equal((await room(mechanic, code)).mud.rescued, true);
  if (!cableReleased) await mechanic.keyboard.press('q');
  await mechanic.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('CABLE'), null, { timeout: 8000 });
  assert.equal((await room(driver, code)).cable, null);
  await driver.keyboard.down('w');
  let firstCheckpoint = false;
  for (let i = 0; i < 90; i++) {
    await sleep(400);
    const state = await room(driver, code);
    const [x, , z] = state.vehicle.p;
    if (state.checkpoint >= 1) { firstCheckpoint = true; break; }
    const yaw = 2 * Math.atan2(state.vehicle.q[1], state.vehicle.q[3]);
    const correction = wrap(-Math.atan2(roadX(-z + 8) - x, 8) - yaw);
    if (correction < -.09) { await driver.keyboard.down('d'); await driver.keyboard.up('a'); }
    else if (correction > .09) { await driver.keyboard.down('a'); await driver.keyboard.up('d'); }
    else { await driver.keyboard.up('a'); await driver.keyboard.up('d'); }
    if (-z > 92) break;
  }
  await driver.keyboard.up('w'); await driver.keyboard.up('a'); await driver.keyboard.up('d');
  assert.ok(firstCheckpoint, `RV escaped but missed the shared checkpoint: ${JSON.stringify((await room(driver, code)).vehicle.p)}`);
  assert.equal((await room(mechanic, code)).checkpoint, 1);
  await driver.keyboard.down('Space');
  for (let i = 0; i < 40; i++) {
    if (Math.hypot(...(await room(driver, code)).vehicle.v) < 2) break;
    await sleep(300);
  }
  const reunion = await room(mechanic, code);
  const gap = Math.hypot(...reunion.characters[mechanicId].p.map((value, i) => value - reunion.vehicle.p[i]));
  console.log(`checkpoint reunion gap: ${gap.toFixed(1)} m`);
  if (gap > 4.5) {
    for (let i = 0; i < 80; i++) {
      await sleep(300);
      const state = await room(mechanic, code);
      const character = state.characters[mechanicId];
      const remaining = Math.hypot(...character.p.map((value, j) => value - state.vehicle.p[j]));
      if (remaining < 4.5) break;
      const dx = state.vehicle.p[0] - character.p[0];
      const dz = state.vehicle.p[2] - character.p[2];
      const length = Math.hypot(dx, dz) || 1;
      const forward = (Math.sin(character.yaw) * dx - Math.cos(character.yaw) * dz) / length;
      const right = (Math.cos(character.yaw) * dx + Math.sin(character.yaw) * dz) / length;
      for (const [key, active] of [['w', forward > .3], ['s', forward < -.3], ['d', right > .3], ['a', right < -.3]]) {
        if (active) await mechanic.keyboard.down(key);
        else await mechanic.keyboard.up(key);
      }
    }
    for (const key of ['w', 's', 'a', 'd']) await mechanic.keyboard.up(key);
  }
  const finalRoom = await room(mechanic, code);
  const finalGap = Math.hypot(...finalRoom.characters[mechanicId].p.map((value, i) => value - finalRoom.vehicle.p[i]));
  assert.ok(finalGap < 5, `mechanic could not return to the RV: ${JSON.stringify(finalRoom.characters[mechanicId].p)} / ${JSON.stringify(finalRoom.vehicle.p)}`);
  await mechanic.keyboard.press('f');
  await mechanic.waitForFunction(() => document.querySelector('#crew-status').textContent.includes('CO-DRIVER'), null, { timeout: 8000 });
  assert.equal((await room(driver, code)).seats.passenger, mechanicId);
  await driver.keyboard.up('Space');
  if (process.env.TOW_TEST_BRIDGE === '1') {
    const stock = [roadX(108) + 6.5, 0, -108];
    const work = d => [roadX(d) + 6, 0, -d];
    async function driveTo(target, limit = 100) {
      await driver.keyboard.down('w');
      let lastState;
      for (let i = 0; i < limit; i++) {
        await sleep(400);
        const state = await room(driver, code);
        lastState = state;
        const [x, , z] = state.vehicle.p;
        const d = -z;
        if (d >= target) break;
        const yaw = 2 * Math.atan2(state.vehicle.q[1], state.vehicle.q[3]);
        const correction = wrap(-Math.atan2(roadX(d + 8) - x, 8) - yaw);
        if (correction < -.09) { await driver.keyboard.down('d'); await driver.keyboard.up('a'); }
        else if (correction > .09) { await driver.keyboard.down('a'); await driver.keyboard.up('d'); }
        else { await driver.keyboard.up('a'); await driver.keyboard.up('d'); }
      }
      for (const key of ['w', 'a', 'd']) await driver.keyboard.up(key);
      assert.ok(-lastState.vehicle.p[2] >= target, `RV did not reach ${target} m`);
    }
    async function walkNear(target, radius = 3.2) {
      let last;
      for (let i = 0; i < 110; i++) {
        await sleep(350);
        const state = await room(mechanic, code);
        last = state.characters[mechanicId].p;
        const dx = target[0] - last[0], dz = target[2] - last[2];
        if (Math.hypot(dx, dz) < radius) break;
        const [fx, fz] = await mechanic.evaluate(() => window.__towTest.cameraForward());
        const length = Math.hypot(fx, fz) || 1;
        const forward = (dx * fx + dz * fz) / length;
        const right = (dx * -fz + dz * fx) / length;
        for (const [key, enabled] of [['w', forward > 1], ['s', forward < -1], ['d', right > 1], ['a', right < -1]]) {
          if (enabled) await mechanic.keyboard.down(key); else await mechanic.keyboard.up(key);
        }
      }
      for (const key of ['w', 's', 'a', 'd']) await mechanic.keyboard.up(key);
      assert.ok(Math.hypot(target[0] - last[0], target[2] - last[2]) < radius,
        `Mechanic could not walk to bridge work area ${JSON.stringify(target)}: ${JSON.stringify(last)}`);
    }
    await driveTo(101);
    await driver.keyboard.down('Space');
    for (let i = 0; i < 40; i++) {
      if (Math.hypot(...(await room(driver, code)).vehicle.v) < 2) break;
      await sleep(300);
    }
    assert.ok(-(await room(driver, code)).vehicle.p[2] < 114, 'RV entered gap before bridge repair');
    await mechanic.keyboard.press('f');
    await mechanic.waitForFunction(() => document.querySelector('#crew-status').textContent.includes('ON FOOT'), null, { timeout: 8000 });
    for (const [index, d] of [117, 121].entries()) {
      await walkNear(stock);
      await mechanic.keyboard.press('e');
      for (let i = 0; i < 25; i++) {
        if ((await room(mechanic, code)).bridge.planks[index].stage === 'carried') break;
        await sleep(200);
      }
      assert.equal((await room(mechanic, code)).bridge.planks[index].stage, 'carried');
      await mechanic.waitForFunction(() => ['Carry', 'CarryWalk'].includes(window.__towTest.characters().local.animation),
        null, { timeout: 7000 });
      await walkNear(work(d));
      await mechanic.keyboard.press('e');
      for (let i = 0; i < 25; i++) {
        if ((await room(mechanic, code)).bridge.planks[index].stage === 'placed') break;
        await sleep(200);
      }
      assert.equal((await room(mechanic, code)).bridge.planks[index].stage, 'placed');
      await mechanic.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('SECURE PLANK'), null, { timeout: 8000 });
      await mechanic.keyboard.press('e');
      for (let i = 0; i < 25; i++) {
        if ((await room(mechanic, code)).bridge.planks[index].stage === 'secured') break;
        await sleep(200);
      }
      assert.equal((await room(mechanic, code)).bridge.planks[index].stage, 'secured',
        `Secure failed near ${JSON.stringify((await room(mechanic, code)).characters[mechanicId].p)}; prompt: ${await mechanic.locator('#action-prompt').innerText()}`);
      console.log(`route-start bridge: plank ${index + 1} carried, placed and secured`);
    }
    assert.equal((await room(driver, code)).bridge.complete, true);
    await driver.keyboard.up('Space');
    await driveTo(130, 140);
    for (let i = 0; i < 20 && !(await room(driver, code)).bridge.crossed; i++) await sleep(300);
    assert.equal((await room(driver, code)).bridge.crossed, true, 'RV did not cross the completed bridge');
    assert.equal((await room(mechanic, code)).bridge.crossed, true, 'mechanic missed synchronized crossing');
    await driver.keyboard.down('Space');
    for (let i = 0; i < 40; i++) {
      if (Math.hypot(...(await room(driver, code)).vehicle.v) < 2) break;
      await sleep(300);
    }
    const parked = (await room(driver, code)).vehicle.p;
    await walkNear([roadX(128) + 7, 0, -128], 2.5);
    await walkNear([roadX(132) + 7, 0, -132], 2.5);
    // Approach the passenger door from the catwalk side; the RV collider can
    // block a direct walk to its center even when the character is nearby.
    await walkNear([parked[0] + 2.7, parked[1], parked[2]], 2.4);
    await mechanic.keyboard.press('f');
    await mechanic.waitForFunction(() => document.querySelector('#crew-status').textContent.includes('CO-DRIVER'), null, { timeout: 8000 });
    assert.equal((await room(driver, code)).seats.passenger, mechanicId);
    await driver.keyboard.up('Space');
    console.log('route-start bridge: both clients saw completed planks and RV crossing; mechanic reunited with RV');
  }
  assert.deepEqual(errors, []);
  console.log(`route-start rescue: two clients escaped mud at ${(-escaped.vehicle.p[2]).toFixed(1)} m, reunited, and reached checkpoint 1 without position fixtures`);
  await a.close(); await b.close();
} finally {
  await browser?.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), sleep(1000)]);
    }
  }
}
