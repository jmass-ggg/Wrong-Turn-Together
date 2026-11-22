# Phase verification log

Updated 2026-11-21. Results describe commands actually run in this workspace; rerun them after edits.

## Phase 1 — 3D foundation

**Status:** Complete as a local browser driving slice; not verified inside Reddit.

**Files:** `src/client/game/{world,route,vehicle,camera}.ts`, `src/client/ui/{hud,minimap}.ts`, `src/client/main.ts`, `src/client/style.css`, `devvit.json`, `src/server/index.ts`, `tests/browser-smoke.mjs`.

**Verified:** `npm run typecheck`, `npm run build`, `npm test`, `git diff --check` passed before Phase 2. Browser smoke drove the RV and exercised map, pause, checkpoints and finish in desktop and mobile-sized Chromium. This does not prove real-device FPS or Reddit mobile support.

## Phase 2 — two-player multiplayer

**Status:** Partial. Local two-client Redis-backed flow passes. Live Devvit Realtime and actual Reddit playtest are blocked by absent login/app registration.

**Files changed:** `devvit.json`, `package.json`, `package-lock.json`, `vite.local.config.ts`, `tsconfig.json`, `tsconfig.client.json`, `src/shared/room.ts`, `src/server/index.ts`, `src/server/local.ts`, `src/server/rooms/{room-service,routes}.ts`, `src/client/net/{online-room,vehicle-sync}.ts`, `src/client/main.ts`, `src/client/ui/hud.ts`, `src/client/style.css`, `tests/{room-service.test.ts,rooms-integration.mjs}`, and these docs.

**Actual checks:** `npm run typecheck` passed; `npm run build` produced client and CJS server bundles; `npm run test:unit` passed three room cases; `npm test` passed solo desktop and mobile-sized browser smoke plus the Redis-backed two-context room flow. After the reconnect fix, `npm run typecheck`, `npm run test:unit`, and `npm run build` passed, including a unit assertion that rejoining resumes immediately. One `npm run test:rooms` run timed out waiting for Playwright `networkidle` during a reload; changing the test to wait for `domcontentloaded` and the match UI made the rerun pass. `npx devvit whoami` failed with “Not currently logged in.” A Vite chunk-size warning remains.

**Manual verification:** Inspected browser screenshots during Phase 1. Phase 2 has automated two-context browser coverage; no human-operated Devvit client session has been run.

**Measured software rendering:** Recent headless SwiftShader smoke reported approximately 3 FPS at 1280×800 and 12 FPS at a 390×760 emulated mobile viewport. This is not a device GPU benchmark.

**Remaining:** Live Reddit post, Realtime transport, real 2-account latency and rate measurements, real owner timeout behavior, rope, bridge, obstacles, validated online finish and leaderboard. See roadmap for next steps and user action.

## Phase 3 — walking, characters, and vehicle interactions

**Status:** Partial. Two local browser contexts exercised walking snapshots and seat exchange; full interaction and live Reddit acceptance remain open.

**Files changed:** `src/client/game/{character,camera}.ts`, `src/client/main.ts`, `src/client/net/online-room.ts`, `src/client/ui/{hud,minimap}.ts`, `src/client/style.css`, `src/server/rooms/room-service.ts`, `tests/{room-service.test.ts,rooms-integration.mjs}`, and these docs.

**Implemented:** Two procedural avatars, Rapier capsule walking with sprint and jump, walking camera, remote character snapshots, authoritative occupied seats, stopped-RV/proximity checks, F/touch entry and exit, owner epoch transfer on driver change, immediate resume on rejoin, and both player markers on the minimap.

**Checks run:** `npm run typecheck`, `npm run build`, `npm test`, and `git diff --check` passed after the Phase 4 slice. The unit suite passed 5/5 cases; browser smoke and the local two-client walking/seat-swap scenario passed. The seat-swap test initially exposed stale client seat selection; the client now refreshes the room before claiming a free seat, and the rerun passed.

**Manual verification:** No human-operated two-client session yet. Browser automation used two isolated Chromium contexts against real local Redis; it checked passenger exit, ordered walking snapshots, driver exit, mechanic driver claim, and transferred ownership.

**Remaining:** Safe exit collision clearance, mobile walking controls beyond directional buttons, animation/interactions, latency reconciliation, real Devvit Realtime two-account test. The next milestone is completing and testing the two-client mud rescue with the winch slice now present.

## Phase 4 — rope, winch, and mud

**Status:** PARTIAL. Real Rapier cable force and full local route-start two-client rescue work. Recovery edge cases and live Reddit verification remain.

**Files changed:** `src/shared/{route,cable,room}.ts`, `src/client/game/{route,vehicle,world,winch,character}.ts`, `src/client/main.ts`, `src/client/net/online-room.ts`, `src/client/ui/{hud,minimap}.ts`, `src/client/style.css`, `src/server/rooms/{room-service,routes}.ts`, `src/server/local.ts`, `vite.local.config.ts`, `tests/{room-service,winch-physics}.test.ts`, `tests/rooms-integration.mjs`, `package.json`, `README.md`, and these docs.

**Implemented:** Mud lowers traction and increases rolling resistance; visible fixed anchor and cable; server-authenticated pickup/attach/reel/stop/detach; front/rear tow selection by keyboard or touch; bounded motor force and weaker manual pull on the Rapier RV; carrying speed reduction; cable length and maximum extension checks; server-time estimate for cable length and HUD timer; cable state included in vehicle events; tension display and minimap hazard/anchor markers.

**Additional local verification (2026-11-21):** `npm run test:route-rescue` passed with two independent browser contexts against local Redis. The RV began at the actual route spawn; the crew drove into mud, the walking mechanic attached and operated the cable, the driver escaped, the cable was detached, both reunited, and shared checkpoint 1 advanced. No vehicle position fixture was used. `npm test` passed (11 unit/physics cases, solo desktop/mobile-sized smoke, and a Redis-backed two-client room scenario). `npm run typecheck` and `npm run build` passed; the build warns about a large chunk. The local two-client test is not a Reddit-hosted playtest.

## Phase 5 — physical bridge construction

**Status:** PARTIAL. Server state, Rapier support, and route-start two-client construction/crossing pass; loose plank physics and recovery cases remain.

**Files changed:** `src/shared/{bridge,route,room}.ts`, `src/client/game/{bridge,world}.ts`, `src/client/{main,net/online-room,ui/hud,ui/minimap}.ts`, `src/server/rooms/{room-service,routes}.ts`, `tests/{bridge-physics,room-service}.test.ts`, `tests/route-start-rescue.mjs`, `package.json`.

**Implemented:** A missing road/terrain span, two carryable visual planks, a collision-backed side walkway, support colliders that become active only after securing, server-validated pickup/place/secure/retrieve/drop, return-to-stock on disconnect, shared completion/crossing flags, checkpoint prerequisite, HUD prompt and minimap marker.

**Actual checks:** `npm run test:route-bridge` passed using two isolated browser contexts and local Redis. Both players began at the real spawn, completed mud rescue, drove to the bridge, carried/placed/secured two planks using keyboard input, crossed the bridge on Rapier colliders, and reunited; no position fixture was used. `npm run test:unit` passed 11/11 including catwalk and secured-plank support, `npm run typecheck` passed, `npm run build` passed with a large-chunk warning, and `npm test` passed solo desktop/mobile-sized smoke plus the Redis two-client room test. `git diff --check` passed for tracked files; a trailing-whitespace search of untracked `web/` source/tests/docs found none. Early browser attempts exposed an unsafe catwalk approach and a second-slot prompt error; both were fixed before the passing run.

**Remaining:** Loose planks need simulated rigid bodies, rotation, and freely placed/dropped poses before the physical-object requirement is complete. Browser fall/disconnect/recovery tests and Reddit-hosted verification are outstanding.

## Phases 6–10

| Phase | Status | Verified result | Next milestone |
|---|---|---|---|
| 6 — remaining six obstacles | NOT STARTED | No implementation or gameplay test | Build a synchronized fallen-tree rigid body and towing interaction, then the other five obstacles. |
| 7 — daily challenge and leaderboard | NOT STARTED | Current timer is display-only | Add server-controlled finish and persistent Redis ranking after obstacle prerequisites exist. |
| 8 — art, audio, mobile | NOT STARTED | Existing HUD/minimap and mobile-sized smoke only | Complete art/audio and test actual mobile controls/device. |
| 9 — full hardening | NOT STARTED | Focused regression checks only; software-rendered smoke is not a hardware benchmark | Run whole-route, disconnect, latency, and real-device performance tests. |
| 10 — Reddit playtest/release | BLOCKED | `npx devvit whoami` returned “Not currently logged in.” | Developer signs into the existing app; then upload and test with two Reddit accounts. Publication requires approval. |
