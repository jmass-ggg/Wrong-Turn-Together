# Wrong Turn Together — browser and Devvit build

This is the browser version of Wrong Turn Together, expanded into a **1,600 m** mountain road. It supports a solo driving preview and **two-player** Redis-backed rooms. The separate Godot desktop project retains its historical internal Detour name. See [../game.md](../game.md) for the world, controls, mechanics, verification, and known gaps.

The route keeps the original mud winch and repairable plank bridge, then adds a server-driven animated bear, a two-person movable fallen tree, rocky and river scenery, a hill, a cliff road, seven ordered checkpoints, and a shared finish result. The river, hill, and cliff still need their proposed physical preparation puzzles. Four-player play is not supported.

The old capsule avatar has been replaced with the original, rigged [`src/client/assets/player-character.glb`](src/client/assets/player-character.glb): black cap and glasses, blue/red jacket variants, black pants, white-blue sneakers, and backpack. It has 15 skeletal clips and is loaded once, then cloned with a separate skeleton per player. To regenerate it when Blender 4.3 is available, run `blender --background --python tools/generate_character.py`. The room still supports only two of the four prepared jacket colors.

## Run locally

```sh
npm ci
npm run dev                # solo browser preview
npm run typecheck
npm run build              # Devvit client and server bundles
npm test                   # unit, browser smoke, two-browser Redis room test
npm run test:route-bridge  # two-browser mud rescue and bridge repair from spawn
```

The room test starts local Redis and a local API. `npm run playtest` requires a registered Devvit app and developer login; an actual Reddit webview has not been verified here. Production updates use the existing Devvit Realtime integration; local tests use Redis-backed polling.

In co-op, both players ready up before the creator starts. Press **F** to leave the RV; **E** is context interaction for cable, plank, log, or a knocked-down friend. At the bridge, carry a plank to its marked slot, press **E** to place, then **E** again to secure. **Q** throws a carried plank. Both players can grab opposite ends of the tree and walk it sideways. Use the **+ / −** buttons, wheel, or pinch to zoom; drag to orbit and press **C** to reset the camera. Mobile buttons expose driving, enter/exit, bridge, winch, throw, log, and help actions.

The test suite currently verifies the character asset, two-client jacket colors and walking animations, an early cooperative run through mud and the bridge with Winch and Carry clips, the seven solo checkpoint gates via a development-only position hook, and a physics-ray survey of the whole road. It does **not** verify a full driven journey or a two-browser bear/tree encounter. In software-rendered headless Chromium, the final run measured roughly 5 FPS at 1280×800 and 11 FPS at 390×760; hardware and Reddit mobile performance remain unmeasured.
