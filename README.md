# Wrong Turn Together

Wrong Turn Together is a cooperative mountain-road game about getting one RV and its crew to safety. Friends take turns driving, walking, repairing obstacles, and rescuing each other when the road goes wrong.

This repository contains two separate versions of the game:

| Version | Location | Current state |
| --- | --- | --- |
| Browser and Reddit/Devvit | [`web/`](web/README.md) | Playable solo driving preview and two-player rooms on a 1,600 m route |
| Godot desktop | [`game/`](game/) | Separate Godot project with generated trips and its own multiplayer implementation |

The browser and Godot versions do not share a multiplayer room or a save file. The desktop project's executable and build artifacts still use the historical **Detour** name; that name is an internal compatibility detail, not a link to another repository.

## Play the browser version locally

From the repository root:

```sh
cd web
npm ci
npm run dev
```

Open the local address printed by Vite. The browser preview can be driven solo. For two-player room testing, the project uses a local API and Redis; see [`web/README.md`](web/README.md) for the room tests, controls, and Devvit details.

The browser game includes mud and winch rescue, a repairable plank bridge, a roaming bear, a movable fallen tree, checkpoints, and a finish gate. Its river, hill, and cliff sections have scenery and progress gates but do not yet have all the planned physical preparation puzzles. The complete route has not been verified by a manual start-to-finish drive. See [`game.md`](game.md) for the implemented world, known limits, and test results.

```sh
cd web
npm run typecheck
npm run build
npm test
```

Desktop driving uses **W/A/S/D**; **F** enters or exits the RV, **E** interacts, **Q** throws a carried plank, and **C** resets the camera. Use the mouse wheel or **+ / −** buttons to zoom; touch controls support driving and interactions on mobile. The complete browser controls are in [`web/README.md`](web/README.md).

## Run the Godot desktop version

The desktop game requires Rust and Godot 4.7.2. Its game files are under `game/`, native world generation is under `native/`, and its optional online relay is under `server/relay/`.

```sh
python3 tools/build_native.py --check
godot --path game
tools/test_game.sh
```

Read [`CURRENT_GAME.md`](CURRENT_GAME.md) for the desktop game's actual controls and features, [`PLAN.md`](PLAN.md) for its roadmap, and [`docs/perf.md`](docs/perf.md) for its benchmark notes. The desktop build workflow is [`.github/workflows/build.yml`](.github/workflows/build.yml); its current artifact filenames still contain `Detour`.

## Project map

| Path | Purpose |
| --- | --- |
| [`web/`](web/README.md) | Three.js, Rapier, TypeScript, Redis-backed rooms, and Devvit integration |
| [`game/`](game/) | Godot desktop game |
| [`native/`](native/) | Rust world generation and Godot native extension |
| [`server/relay/`](server/relay/) | Optional ENet relay for the desktop game |
| [`game.md`](game.md) | Browser game details, verification, and known issues |

The project is in active development. There is no verified downloadable release linked here. Licensing remains to be decided; see [`PLAN.md`](PLAN.md).
