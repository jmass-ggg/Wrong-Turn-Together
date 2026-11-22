import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const port = 5198;
const url = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.local.config.ts', '--port', String(port)], {
  stdio: 'ignore',
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(url)).ok) { ready = true; break; } } catch { /* waiting for server */ }
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  assert.ok(ready, 'Vite preview did not start');
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
  });
  for (const mobile of [false, true]) {
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 760 } : { width: 1280, height: 800 },
      hasTouch: mobile,
      isMobile: mobile,
    });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('#start').click();
    assert.equal(await page.locator('#timer').isVisible(), true);
    if (!mobile) {
      await page.waitForTimeout(500);
      assert.deepEqual(await page.evaluate(() => window.__towTest.unsupportedRoad()), [],
      'road lacks a physics surface outside the repairable bridge gap');
    }
    const initialZoom = await page.evaluate(() => window.__towTest.zoomLevel());
    await page.locator('#zoom-out').click();
    assert.ok(await page.evaluate(() => window.__towTest.zoomLevel()) > initialZoom, 'zoom out button did not move the camera');
    await page.locator('#zoom-in').click();
    assert.ok(Math.abs((await page.evaluate(() => window.__towTest.zoomLevel())) - initialZoom) < .01, 'zoom in button did not restore the camera distance');
    if (mobile) {
      const go = page.locator('[data-action="throttle"]');
      const bounds = await go.boundingBox();
      assert.ok(bounds, 'touch throttle is visible');
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
    } else {
      await page.keyboard.down('w');
    }
    const fps = await page.evaluate(() => new Promise(resolve => {
      let frames = 0;
      const started = performance.now();
      const sample = timestamp => {
        frames++;
        if (timestamp - started >= 2000) resolve(Math.round(frames * 1000 / (timestamp - started)));
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    await page.waitForTimeout(6500);
    if (mobile) await page.mouse.up();
    if (!mobile) await page.keyboard.up('w');
    const status = await page.locator('#status').innerText();
    assert.match(status, /[1-9]\d*% ROUTE/, `RV did not drive forward: ${status}`);
    await page.locator('#minimap').click();
    assert.equal(await page.locator('#minimap').evaluate(el => el.classList.contains('expanded')), true);
    await page.locator('#minimap').click();
    await page.locator('#pause-button').click();
    assert.equal(await page.locator('#pause').isVisible(), true);
    await page.locator('#resume').click();
    assert.equal(await page.locator('#pause').isVisible(), false);
    await page.evaluate(() => window.__towTest.placeAt(1601));
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#result').isVisible(), false, 'finish requires both checkpoints');
    for (const [index, distance] of [84, 174, 650, 970, 1160, 1370, 1550].entries()) {
      await page.evaluate(d => window.__towTest.placeAt(d), distance);
      await page.waitForFunction(expected => document.querySelector('#status').textContent.includes(`${expected}/7 STOPS`), index + 1, { timeout: 5000 });
    }
    assert.match(await page.locator('#status').innerText(), /7\/7 STOPS/);
    await page.evaluate(() => window.__towTest.placeAt(1601));
    await page.locator('#result').waitFor({ state: 'visible', timeout: 5000 });
    assert.match(await page.locator('#result-time').innerText(), /Hull .*Fuel/);
    assert.deepEqual(errors, [], `browser errors: ${errors.join(', ')}`);
    console.log(`${mobile ? 'mobile viewport' : 'desktop'} smoke: ${status}; ${fps} FPS in headless SwiftShader; map, pause, checkpoints, and finish work`);
    await page.close();
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
