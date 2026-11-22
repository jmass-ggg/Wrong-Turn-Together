# Tow Together — development roadmap

Updated 2026-11-21. Repository moved to `/home/james/james/reddit_game/game`. Read this with `PHASE_VERIFICATION.md`, inspect `git status`, and rerun the checks before further work. The Godot desktop project in `../game/` is preserved.

## Current phase: 5 — bridge construction (PARTIAL); Phases 2–4 remain PARTIAL pending live verification and edge cases

Implemented in the Devvit Web build:

- Installation-local Redis room records scoped to the current interactive post, six-character codes, two-player capacity, ready/start/leave, TTL, heartbeat, and reconnect by authenticated user ID. A returning player resumes a paused match during the join action without waiting for a separate heartbeat.
- A single RV simulation owner with ownership epochs and ordered, bounded, rate-limited snapshots; remote clients interpolate a kinematic RV. The server rejects snapshots from non-owners or stale epochs and enforces a shared installation snapshot budget.
- Client subscriptions to Devvit Realtime; server publishes room changes and snapshots. Local development uses the same Hono routes and a real local Redis instance, with browser polling in place of Reddit Realtime.
- A lobby, connection screen, role display, room-code copy, and a solo preview retained from Phase 1.
- Two distinct procedural characters, a kinematic Rapier walking capsule with jump and sprint, a walking follow camera, F/touch vehicle entry and exit, server-owned seat claims, character position snapshots, remote character rendering, and driver ownership transfer on seat exchange. The minimap now shows both players in co-op.
- A marked mud patch reduces RV tire grip and adds rolling resistance. The mechanic can select the front or rear tow point, carry a cable to a marked tree, attach it through a server-validated action, and reel/stop/detach. A spring/damper applies limited impulses to the actual Rapier chassis on the simulation owner; carrying the cable applies a much weaker manual pull. The cable line shows slack/tension. A Rapier unit test proves that winch force moves the RV. Server timestamps calibrate cable length on both clients; vehicle snapshots also carry cable state so an overextended cable is removed without waiting for the next room poll.

Still required for Phase 2 acceptance: an authenticated two-account Devvit playtest to verify actual Realtime transport, latency, mobile webview behavior, and owner handoff under real disconnects. The local harness tests two independent browser contexts but does not prove Reddit Realtime works.

Still required for Phase 3 acceptance: human-operated two-client walking and seat exchange in Reddit, safe exit placement on every terrain section, walking camera obstruction tests, mobile touch walking controls, character interaction states, and movement reconciliation under network delay. Local browser tests cover walking snapshots and seat ownership transfer.

Phase 4 local route-start rescue has passed with two isolated browser contexts and no position fixture: the crew drove from spawn, winched out of deep mud, detached, reunited, and reached checkpoint 1. Deeper mud ruts, visual tracks/splashes, limited manual pull, front/rear tow selection, and server-validated recovery are implemented. Phase 4 stays PARTIAL because disconnect during active winching/carrying, failed-attempt recovery, and actual Reddit Realtime behavior are not fully exercised.

Phase 5 bridge work is in progress: a real terrain/road gap at route distance 114–124, two planks with Rapier support colliders enabled only after server-validated placement and securing, a physical maintenance walkway, a stock pile, interaction prompts, synchronized state, checkpoint prerequisite, and a minimap marker. Unit tests cover support and server action transitions. `npm run test:route-bridge` passed from the real spawn through mud rescue, both plank installations, crossing, and the mechanic's return to the RV. Phase 5 remains PARTIAL because loose planks are snapped visuals rather than simulated carry/drop rigid bodies, and fall/disconnect recovery needs a complete browser pass.

## Remaining phases

| Phase | Status | Next concrete work |
|---|---|---|
| 3 — walking and seats | PARTIAL | Test safe exit and walking collision across terrain, improve animation and mobile controls, verify real Realtime character movement. |
| 4 — rope and mud | PARTIAL | Add browser disconnect/carry/overextension recovery scenarios and verify Reddit Realtime. |
| 5 — bridge and objects | PARTIAL | Add physical loose plank handling and test fall/disconnect recovery; the route-start construction/crossing now passes. |
| 6 — eight obstacles | NOT STARTED | Six additional obstacle state machines with recovery paths. |
| 7 — daily results | NOT STARTED | Server-validated checkpoints, UTC daily seed, start/finish records, leaderboard. Online checkpoint/finish scoring is deliberately disabled now. |
| 8 — polish and mobile | NOT STARTED | Art, sound, settings, contextual touch controls, character animation and minimap markers. |
| 9 — hardening | NOT STARTED | Real-device performance, packet/latency tests, security review and end-to-end obstacle tests. |
| 10 — Reddit release | BLOCKED | Registered Devvit app, developer login, two-account playtest, then explicit user approval before public publication. |

## Platform decisions

The Devvit Web server remains stateless and uses Redis plus server-sent Realtime messages; there is no long-running WebSocket relay. Room keys use the installation-scoped Redis client and include the post ID. Vehicle snapshots are accepted no more than once every 240 ms per room and character snapshots no more than once every 160 ms per player. A separate Redis counter limits accepted motion broadcasts to 70 per installation per second. The [Devvit FAQ](https://developers.reddit.com/docs/guides/faq) documents a 100-message/second installation-wide Realtime limit; room events need the remaining budget. This has not been stress-tested. Room data expires after 30 minutes without activity, and players are considered stale after 20 seconds without heartbeat.

The local API harness (`npm run local:rooms`) accepts local test identities **only** in `src/server/local.ts`, which is not included in the Devvit server bundle. Production endpoints use `context.userId` and `context.postId`. This distinction is required for honest local testing without Reddit credentials.

## Known bugs and limitations

- Devvit Realtime and Redis permissions are configured and compiled, but actual Reddit runtime behavior has not been tested. No Devvit auth token exists in this workspace.
- The local full two-client mud rescue and bridge crossing passed; Reddit-hosted transport remains unverified. Online checkpoint 1 is server validated, but there is no validated online finish submission or leaderboard. Do not treat the displayed online timer as a validated match result. The camera and avatar movement are still basic; reconnect under real packet loss and safe exit from every terrain shape are unverified.
- Winch rest length now uses an estimated server clock sampled from room responses. Network latency is not compensated with a round-trip estimate; the estimate needs validation under real Reddit latency and substantial device clock skew.
- Redis room mutations use an expiring NX lock (5 seconds). A stalled server operation crossing the lock TTL could permit a conflicting mutation; replace with a verified transaction/CAS approach if real latency exposes this risk.
- Browser software-rendered FPS is low; no mobile hardware measurements exist. Rapier/Three.js client bundle is about 4.7 MB uncompressed.

## User action needed for Phase 10

Provide or authenticate an existing registered Devvit app whose slug matches `devvit.json`, then identify a test subreddit and two independent Reddit accounts. No credentials should be committed. Public `devvit publish` requires separate approval after a concrete playtest build is reviewed.
