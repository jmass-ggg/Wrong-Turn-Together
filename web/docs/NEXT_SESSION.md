# Next session

Inspect Git status first. `web/` is untracked and must be preserved; do not clean, stage, or publish it. Read `DEVELOPMENT_ROADMAP.md`, `PHASE_VERIFICATION.md`, and `KNOWN_ISSUES.md`.

Current work: Phase 5 is partial. `npm run test:route-bridge` passes from real spawn through mud rescue, two plank installations, RV crossing, and mechanic reunion. The next coding action is to give loose planks collision-backed carry/drop/rotation and recovery behavior without breaking the passing route, then add two-client tests for a fall or disconnect during bridge construction. Run browser harnesses sequentially because they share ports 5198, 5199, and 6398. After each edit rerun the focused test, then typecheck/build/regression tests.

After the bridge route passes, add fall and disconnect recovery tests, then implement the six remaining obstacle types as separate synchronized systems. Daily finish/leaderboard, art/audio/mobile polish, performance measurements, and platform playtest remain substantial work. `npx devvit whoami` reported “Not currently logged in” on 2026-11-21; authenticated Reddit playtesting needs the developer to log in and have a registered app. Public publication requires explicit approval.
