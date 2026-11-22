import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

const children = [];
function run(command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  children.push(child); return child;
}
async function waitFor(url, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try { const response = await fetch(url); if (response.status < 500) return; } catch { /* booting */ }
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  throw new Error(`Server unavailable: ${url}`);
}
async function waitForRedis() {
  for (let i = 0; i < 80; i++) {
    const ready = await new Promise(resolve => {
      const socket = connect(6398, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  throw new Error('Local Redis did not start');
}
let browser;
try {
  run('redis-server', ['--port', '6398', '--save', '', '--appendonly', 'no']);
  await waitForRedis();
  run(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/local.ts']);
  await waitFor('http://127.0.0.1:5199/api/rooms/ABCDEF');
  run(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.local.config.ts', '--port', '5198']);
  await waitFor('http://127.0.0.1:5198/');
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'] });
  const a = await browser.newContext({ viewport: { width: 760, height: 550 } });
  const b = await browser.newContext({ viewport: { width: 760, height: 550 } });
  const pageA = await a.newPage(), pageB = await b.newPage();
  const errors = [];
  for (const page of [pageA, pageB]) { page.on('pageerror', error => errors.push(String(error))); await page.goto('http://127.0.0.1:5198/', { waitUntil: 'networkidle' }); }
  await pageA.locator('#create-room').click();
  await pageA.locator('#lobby').waitFor({ state: 'visible' });
  const code = (await pageA.locator('#room-code').innerText()).trim();
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  await pageB.locator('#join-code').fill(code);
  await pageB.locator('#join-room').click();
  await pageB.locator('#lobby').waitFor({ state: 'visible' });
  await pageA.waitForFunction(() => document.querySelectorAll('.lobby-slot')[1].textContent.includes('NOT READY'), { timeout: 6000 });
  await pageA.locator('#ready-room').click();
  await pageB.locator('#ready-room').click();
  await pageA.locator('#start-room').waitFor({ state: 'visible' });
  await pageA.waitForFunction(() => !document.querySelector('#start-room').disabled, { timeout: 6000 });
  await pageA.locator('#start-room').click();
  await pageA.locator('#timer').waitFor({ state: 'visible' });
  await pageB.locator('#timer').waitFor({ state: 'visible', timeout: 6000 });
  await pageA.keyboard.down('w');
  await pageA.waitForFunction(() => window.__towTest.vehiclePosition()[2] < -3, null, { timeout: 25000 });
  await pageB.waitForFunction(() => window.__towTest.vehiclePosition()[2] < -1, null, { timeout: 12000 });
  await pageA.keyboard.up('w');
  const aStatus = await pageA.locator('#status').innerText();
  const bStatus = await pageB.locator('#status').innerText();
  const ownerPosition = await pageA.evaluate(() => window.__towTest.vehiclePosition());
  const remotePosition = await pageB.evaluate(() => window.__towTest.vehiclePosition());
  assert.ok(ownerPosition[2] < -2, `owner did not move: ${aStatus} ${ownerPosition}`);
  assert.ok(remotePosition[2] < -1, `remote did not follow: ${bStatus} ${remotePosition}`);
  assert.ok(Math.hypot(...remotePosition.map((value, i) => value - ownerPosition[i])) < 12,
    `RV diverged between clients: ${ownerPosition} versus ${remotePosition}`);
  assert.equal(await pageA.locator('#crew-status').innerText().then(text => text.includes('DRIVING')), true);
  assert.equal(await pageB.locator('#crew-status').innerText().then(text => text.includes('CO-DRIVER')), true);
  assert.deepEqual(errors, [], errors.join(', '));
  console.log(`two-client Redis-backed room ${code}: joined, ready, started, owner ${aStatus}, remote ${bStatus}`);
  await pageB.reload({ waitUntil: 'domcontentloaded' });
  try { await pageB.locator('#timer').waitFor({ state: 'visible', timeout: 20000 }); }
  catch (error) { console.log('reconnect diagnostics:', await pageB.locator('#intro').innerText(), errors); throw error; }
  console.log('co-driver reload: rejoined the running match');
  const getSeq = page => page.evaluate(async roomCode => {
    const id = localStorage.getItem('tow-local-id');
    const response = await fetch(`/api/rooms/${roomCode}`, { headers: { 'x-local-player': id } });
    return (await response.json()).room.vehicle.seq;
  }, code);
  const beforeReload = await getSeq(pageA);
  await pageA.reload({ waitUntil: 'domcontentloaded' });
  await pageA.locator('#timer').waitFor({ state: 'visible', timeout: 20000 });
  await pageA.keyboard.down('w'); await pageA.waitForTimeout(4000); await pageA.keyboard.up('w');
  assert.ok(await getSeq(pageA) > beforeReload, 'returning owner continues snapshot sequence');
  console.log('driver reload: restored RV authority and continued snapshots');
  await pageA.keyboard.down('Space'); await pageA.waitForTimeout(6000); await pageA.keyboard.up('Space');
  const getRoom = page => page.evaluate(async roomCode => {
    const response = await fetch(`/api/rooms/${roomCode}`, { headers: { 'x-local-player': localStorage.getItem('tow-local-id') } });
    return (await response.json()).room;
  }, code);
  await pageB.keyboard.press('f');
  await pageB.waitForFunction(() => document.querySelector('#crew-status').textContent.includes('ON FOOT'), null, { timeout: 7000 });
  const localCharacter = await pageB.evaluate(() => window.__towTest.characters().local);
  assert.equal(localCharacter.visible, true);
  assert.equal(localCharacter.jacket, 0xd54344, 'second player wears red');
  assert.ok(localCharacter.skinnedMeshes >= 20, 'loaded avatar is a skinned GLB');
  assert.ok(localCharacter.lensOpacity > 0 && localCharacter.lensOpacity < 1, 'glasses have transparent lenses');
  await pageA.waitForFunction(() => window.__towTest.characters().remote.visible, null, { timeout: 7000 });
  assert.equal(await pageA.evaluate(() => window.__towTest.characters().remote.jacket), 0xd54344,
    'other client sees the second player in red');
  assert.equal(await pageA.evaluate(() => window.__towTest.characters().local.jacket), 0x2454d7,
    'first player keeps the blue jacket');
  if (process.env.TOW_CHARACTER_SCREENSHOT)
    await pageB.screenshot({ path: process.env.TOW_CHARACTER_SCREENSHOT });
  await pageB.keyboard.down('a'); await pageB.waitForTimeout(1400);
  await pageB.waitForFunction(() => window.__towTest.characters().local.animation === 'Walk', null, { timeout: 7000 });
  await pageA.waitForFunction(() => window.__towTest.characters().remote.animation === 'Walk', null, { timeout: 7000 });
  await pageB.keyboard.up('a');
  const bId = await pageB.evaluate(() => localStorage.getItem('tow-local-id'));
  const movedRoom = await getRoom(pageB);
  assert.equal(movedRoom.seats.passenger, null);
  assert.ok(movedRoom.characters[bId].seq > 1, 'walking snapshots reached Redis');
  await pageA.keyboard.press('f');
  await pageA.waitForFunction(() => document.querySelector('#crew-status').textContent.includes('ON FOOT'), null, { timeout: 7000 });
  await pageB.keyboard.press('f');
  try { await pageB.waitForFunction(() => document.querySelector('#crew-status').textContent.includes('DRIVING'), null, { timeout: 7000 }); }
  catch (error) {
    console.log('seat swap diagnostics:', await getRoom(pageB), await pageB.locator('#action-prompt').innerText(), errors);
    throw error;
  }
  const swappedRoom = await getRoom(pageB);
  assert.equal(swappedRoom.seats.driver, bId);
  assert.equal(swappedRoom.ownerId, bId);
  console.log('two-client walking and seat swap: movement persisted, driver ownership transferred');
  const place = async (page, kind, p) => page.evaluate(async ({ code, kind, p }) => {
    const response = await fetch('/__test/place', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-local-player': localStorage.getItem('tow-local-id') },
      body: JSON.stringify({ code, kind, p }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, { code, kind, p });
  // Scenario fixture only: move the already-running room to the mud. Cable actions and forces use production routes.
  await place(pageB, 'vehicle', [9.55, 3.15, -61]);
  await place(pageA, 'character', [11.7, 3.15, -61]);
  await pageB.reload({ waitUntil: 'domcontentloaded' });
  await pageA.reload({ waitUntil: 'domcontentloaded' });
  await pageA.locator('#timer').waitFor({ state: 'visible' });
  await pageB.locator('#timer').waitFor({ state: 'visible' });
  await pageA.keyboard.press('g');
  await pageA.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('REAR CABLE'));
  await pageA.keyboard.press('g');
  await pageA.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('FRONT CABLE'));
  await pageA.keyboard.press('e');
  await pageA.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('CARRY CABLE'), null, { timeout: 7000 });
  assert.equal((await getRoom(pageA)).cable.stage, 'carried');
  await place(pageA, 'character', [15, 3.5, -79]);
  await pageA.reload({ waitUntil: 'domcontentloaded' });
  await pageA.locator('#timer').waitFor({ state: 'visible' });
  await pageA.keyboard.press('e');
  await pageA.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('E · REEL'), null, { timeout: 7000 });
  const attached = await getRoom(pageA);
  assert.equal(attached.cable.stage, 'attached');
  await pageA.keyboard.press('e');
  await pageA.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('E · STOP'), null, { timeout: 7000 });
  const beforeWinch = (await getRoom(pageB)).vehicle.p[2];
  await pageB.keyboard.down('w'); await pageB.waitForTimeout(16000); await pageB.keyboard.up('w');
  const afterWinch = (await getRoom(pageB)).vehicle.p[2];
  assert.ok(afterWinch < beforeWinch - .6, `winch and driver did not move RV through mud: ${beforeWinch} -> ${afterWinch}`);
  console.log(`two-client mud slice: mechanic attached and reeled, driver moved RV ${Math.round(beforeWinch - afterWinch)} m toward anchor`);
  await pageA.keyboard.press('e');
  await pageA.waitForFunction(() => document.querySelector('#action-prompt').textContent.includes('E · REEL'), null, { timeout: 7000 });
  await pageB.keyboard.down('Space');
  for (let i = 0; i < 30; i++) {
    if (Math.hypot(...(await getRoom(pageB)).vehicle.v) < 4) break;
    await pageB.waitForTimeout(300);
  }
  await pageB.locator('#pause-button').click();
  const beforeRecovery = await getRoom(pageB);
  await pageB.locator('#recover').click();
  await pageB.waitForFunction(async roomCode => {
    const response = await fetch(`/api/rooms/${roomCode}`, { headers: { 'x-local-player': localStorage.getItem('tow-local-id') } });
    const room = (await response.json()).room;
    return room.recoveries === 1 && room.vehicle.p[2] > 0;
  }, code, { timeout: 7000 });
  const recovered = await getRoom(pageA);
  assert.equal(recovered.cable, null);
  assert.equal(recovered.recoveries, 1);
  assert.ok(Math.abs(recovered.vehicle.hull - (beforeRecovery.vehicle.hull - 10)) < .01,
    `recovery penalty was not applied: ${beforeRecovery.vehicle.hull} -> ${recovered.vehicle.hull}`);
  await pageB.keyboard.up('Space');
  console.log('two-client recovery: driver reset the RV and released the cable; both clients received the state');
  await a.close(); await b.close();
} finally {
  await browser?.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1000))]);
    }
  }
}
