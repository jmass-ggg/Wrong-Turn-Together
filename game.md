# Wrong Turn Together — implemented browser game

## Game overview

**Wrong Turn Together** is a stylized 3D mountain-road driving and cooperative rescue game. The goal is to bring one RV and its crew to the final camp with a working vehicle. The browser build supports a **solo driving preview** and **two-player rooms**. The room journey asks two people to alternate between driving, walking, using a winch, repairing a bridge, avoiding a bear, and moving a fallen tree. Four-player rooms are not supported by the present two-seat, single-remote-avatar client.

## Game world

The continuous route is **1,600 metres** long. It starts among pines and hills, winds through mud and an early bridge, then passes bear territory, a fallen tree, rocky and riverside sections, a steep climb, a narrow cliff road, and a finish gate. The first 260 m retain the earlier road layout. Later terrain uses 160 m meshes with static Rapier collision, instanced trees and rocks, roadside signs, cliffs, barriers, fog, and distant mountains. Terrain is constructed at startup; it is culled by the renderer but **not streamed**. The river is a visual water surface beside a drivable road, not a water-physics puzzle.

| Distance | Location and actual interaction |
| --- | --- |
| 0 m | RV start and driving introduction |
| 47–71 m | Deep mud reduces grip; the winch anchor is around 79 m |
| 84 m | Checkpoint 1, gated by a completed mud rescue in co-op |
| 108–124 m | Plank stock and broken bridge with two missing collision supports |
| 174 m | Checkpoint 2, gated by crossing the repaired bridge |
| 455–625 m | Patrolling bear territory |
| 650 m | Checkpoint 3, gated by leaving bear territory |
| 760 m | Fallen tree, moved sideways by two walking players holding opposite ends |
| 830–960 m | Rocky pass with narrower road and roadside rocks |
| 970 m | Checkpoint 4, gated by clearing the fallen tree |
| 1,050–1,082 m | Riverside ford section; crossing is tracked by the room |
| 1,160 m | Checkpoint 5, gated by the river crossing flag |
| 1,200–1,300 m | Steep road climb; no dedicated hill anchor exists |
| 1,370 m | Checkpoint 6, gated by traversing the hill |
| 1,400–1,520 m | Narrow cliff road with roadside rails and a terrain drop |
| 1,550 m | Checkpoint 7, gated by traversing the cliff section |
| 1,600 m | Finish gate; the room records a result only after all seven checkpoints |

## Gameplay mechanics

The RV uses a Rapier rigid body, four raycast suspension points, throttle, reverse, steering, braking, dirt/grass/mud traction differences, collision damage, fuel, hull, and checkpoint recovery. The camera follows the RV or a walking character; players can orbit, zoom, and reset it. The minimap expands to show the whole route.

In a room, the driver and passenger can leave the RV, walk, sprint, jump, and return when close to an empty seat. At the mud, a walking player chooses a front or rear cable, carries it to the marked tree, attaches it, and reels while the driver applies throttle. The cable has a length limit and bounded pull force. This original anchor remains near the early mud; later hill and cliff sections currently lack their own winch anchors.

The bridge has a real road gap and a side walking route. Two planks start in a nearby pile. A player can pick up, carry, throw, retrieve, place, and secure them. A thrown plank has a shared landing position. Placed-but-unsecured planks have no RV support; secured planks gain collision. Server-side room actions validate proximity and ownership. Disconnected holders return carried planks to stock.

An original procedural four-legged bear patrols the forest. The room server advances its **idle → patrol → investigate → alert → chase → return** state machine from vehicle and walking-player snapshots. Its limbs animate, and it can temporarily knock down a walking player; a nearby teammate can help, or the player recovers after a short wait. The bear is synchronized as shared room state, though a full two-browser chase has not been exercised. The fallen log has a collision body and stays in place until two walking players grab opposite ends and move it off the road; its shared position persists.

Recovery returns the RV and walking teammates to the last completed checkpoint with a 10-point hull cost; it does not award unfinished checkpoints. The solo preview has local checkpoints and a local result. A completed room gets a server-recorded time, hull, fuel, checkpoint count, and crew names. No leaderboard submission exists.

## Player character

The browser avatar is an original, skinned **3D chibi boy**, modeled to follow the supplied four-view reference: an oversized rounded head over a compact body, warm skin, dark eyes and eyebrows, short black hair, real round black glasses with lightly transparent lenses, a black baseball cap with a curved visor and back strap, a royal-blue bomber jacket and black shirt, loose black pants, chunky white-and-blue sneakers, and a detailed black backpack. The front, three-quarter, side, and rear views were inspected in a Blender render saved as [`web/docs/player-character-views.png`](web/docs/player-character-views.png). The asset is [`web/src/client/assets/player-character.glb`](web/src/client/assets/player-character.glb); [`web/tools/generate_character.py`](web/tools/generate_character.py) recreates it with Blender 4.3.

The GLB is about **1.05 MB** and has **20 skinned mesh parts**, one seven-bone armature, and 20 named PBR materials. It uses material colors and geometry rather than image textures; there is no painted facial texture or normal map. The glasses are modeled rings and temples with transparent lens geometry. The cap, glasses, hair, and backpack are weighted to the head or torso bones so they move with the rig. Meshes sharing a material are combined; character meshes do not cast dynamic shadows, and a simple ground contact shadow helps the feet read against the road.

The asset includes 15 skeletal clips: **Idle, Walk, Run, Jump, Carry, CarryWalk, Pickup, Place, Winch, Enter, SitDriver, SitPassenger, Exit, Knockdown, and Stand**. The Three.js client crossfades actions. The existing Rapier walking capsule, camera, and RV seat rules remain in place. Local movement selects walk/run/jump and carrying or winching actions; the server validates and relays the walking animation state so a teammate sees it. Bridge pickup and placement trigger one-shot gestures. A bear knockdown plays a recovery sequence. The backpack, cap, and glasses remain attached to the relevant bone throughout. The first two room jacket colors are **blue** and **red**; the same shared asset supports **green** and **yellow** material variants, but the room itself still admits only two players.

**Limits:** The seven-bone rig uses rigid weights per clothing part, so elbows and knees do not deform like a high-bone-count character rig. The character is a handmade stylized interpretation of the image, not a pixel-identical sculpt. Footstep phase and ground contact are approximate on uneven terrain; a full foot-sliding review and physical-device performance pass remain open. There is no separate handheld plank mesh attached to a hand bone; the existing shared plank follows the player in world space.

## Multiplayer architecture

The browser client renders with Three.js and simulates its locally owned RV with Rapier. `RoomService` stores rooms in Redis, assigns six-character codes, validates readiness, seats, object actions, movement order and speed, checkpoints, and recovery. The creator starts after both players are ready. The active driver's client sends bounded, sequenced vehicle snapshots; the server owns the bear state, bridge state, log grips, journey flags, and result. Other clients interpolate vehicle and character updates. Devvit Realtime carries updates in the Reddit build; local integration tests use Redis and polling. A disconnected player can rejoin the same code while the room remains available, and the room pauses until both return. Held objects and log grips are released on disconnect.

**Limits:** The room is hard-capped at two players, has only driver/passenger seats, and renders one remote avatar. Vehicle physics are simulated by the owning browser and checked for plausible snapshots by the server, not re-simulated on the server. The server therefore cannot independently prove every collision, fuel expenditure, or road crossing. Realtime delivery in a deployed Reddit post has not been tested.

## Controls

| Action | Desktop | Mobile browser |
| --- | --- | --- |
| Drive / reverse / steer | W or ↑ / S or ↓ / A D or ← → | On-screen throttle, brake, and steering buttons |
| Brake or jump while walking | Space | On-screen brake or jump |
| Enter or exit RV | F | ENTER / EXIT |
| Context interaction, cable, plank, log, teammate help | E | On-screen interaction buttons |
| Throw carried plank / release log / detach cable | Q | THROW or context button where shown |
| Retrieve a placed plank | B | Bridge interaction button where available |
| Change cable tow end / pay out | G / T | FRONT/REAR and PAY OUT |
| Orbit / zoom / reset camera | Drag / wheel or + − / C | Drag / pinch or + −; no dedicated touch reset |
| Pause and recover | Esc, then recovery button | Pause and recovery buttons |

Context prompts explain the current action; some advanced actions have clearer desktop than touch affordances and need device usability testing.

## Technical architecture

`web/src/shared/route.ts` defines route geometry and landmarks; `web/src/client/game/world.ts` and `world-extension.ts` build the terrain, road, and scenery. `vehicle.ts`, `character.ts`, `bridge.ts`, `roadblock.ts`, `bear.ts`, and `camera.ts` own the corresponding rendered/physics objects. `web/src/shared/bear.ts` and `roadblock.ts` hold room-independent state rules. `web/src/server/rooms/room-service.ts` validates room actions and saves state; `web/src/client/net/online-room.ts` handles client transport. `web/src/client/main.ts` joins the systems, and `web/src/client/ui/` renders the HUD and minimap. Devvit Web 0.15.4, Three.js 0.181, Rapier 0.21, Vite, TypeScript, Redis, and the existing Hono API are used. The separate Godot project was not modified.

## Testing and verification

- `npm run typecheck`: passed after the route and server-bound changes.
- `npm run test:unit`: **17 passed**, including GLB rig/material/clip structure, animation-state validation, snapshot bounds, bear warning/recovery, two-person log movement, ordered shared checkpoints and finish, bridge support, room ownership, winch force, and mud recovery.
- `npm run test:browser`: desktop and mobile-sized Chromium passed model loading, zoom controls, driving, pause, map expansion, ordered solo checkpoints, finish UI, and a 10 m-spaced downward physics-ray survey of the road outside the bridge gap.
- `npm run test:rooms`: two separate Chromium clients with Redis passed joining, ready/start, shared RV motion, walking, synchronized blue/red jacket colors, transparent lenses, local and remote walking animation, seat/driver exchange, mud winch, recovery, and reload/rejoin.
- `npm run test:route-bridge`: two clients started at the real spawn, escaped mud with the Winch animation active, carried and secured both planks with Carry animation active, observed the same completed bridge, crossed it, and reached checkpoint 1.
- Four character angles were visually inspected in a Blender render; an in-game Chromium screenshot showed the red-clad walking avatar beside the RV. Software-rendered headless Chromium measured about **5 FPS at 1280×800** and **11 FPS at 390×760** in the final smoke run. These are not hardware browser or mobile performance measurements.

The browser test uses a **local development-only position hook** to exercise all seven solo checkpoint gates and the finish; it is not a complete driven 1,600 m playthrough. No full start-to-finish co-op run, two-client bear encounter, two-client fallen-log clearance, four-client session, deployed Reddit playtest, real-device performance run, or 15–25 minute playtime measurement has been completed. Accordingly the expanded adventure is **not verified complete**.

## Current implementation status

| Status | Feature |
| --- | --- |
| COMPLETE | 1,600 m continuous generated road and static collision outside the bridge gap; solo checkpoint/finish logic; existing two-player room flow; mud winch and plank bridge through the tested early route |
| PARTIALLY IMPLEMENTED | Bear AI and animated model; shared fallen log; seven gated room checkpoints; expanded biome scenery; result screen; touch controls and long-route HUD |
| NOT IMPLEMENTED | Four-player rooms, dedicated river repair puzzle, new hill/cliff winch anchors, falling-rock hazard, audio, refuel/rest-stop mechanics, shared leaderboard |
| BLOCKED | Reddit deployment and in-app Realtime verification require registered app credentials and a Reddit playtest environment |
| NOT VERIFIED | A fully driven 1,600 m journey; late-route co-op puzzle and finish flow; two-client bear/log behavior; mobile device frame rate; target 15–25 minute duration |

## Known issues and future improvements

Software rendering is slow on the longer scene; profile on actual desktop and mobile GPUs, reduce render cost, and stream terrain/physics if needed. The river, hill, and cliff have crossing flags and scenery but lack the distinct cooperative physical preparation described in the design brief. The fallen tree requires two walkers, so it cannot be completed in solo mode; solo is a driving preview with the log collider disabled. Expand the room schema, seats, and remote avatars together before claiming four-player play. Give the late obstacles their own validated physical interactions, add audio and richer feedback, and verify the entire journey with two clients before treating the game as a finished adventure.
