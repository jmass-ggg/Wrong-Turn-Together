# Known issues and unverified requirements

- Phase 4: the local route-start mud rescue passes, but disconnect/overextension during active cable use and failed-attempt recovery need browser coverage. Actual Reddit Realtime rope synchronization has not been measured.
- Phase 5: two-client route-start construction, crossing, and reunion pass. Stock/carried/placed planks are visual representations; only secured planks have load-bearing Rapier colliders. Physical loose plank carry/drop/rotation, falling planks, vehicle falls, and full disconnect recovery need additional implementation/testing.
- Phase 6: six remaining obstacle systems are not implemented.
- Phase 7: the online timer is display-only. A server-validated finish, daily challenge and Redis leaderboard are not implemented.
- Phase 8: sound, complete mobile walking controls, and visual polish are incomplete.
- Phase 9: only headless software-rendered FPS has been measured. No actual mobile or hardware-accelerated FPS evidence exists.
- Phase 10: `npx devvit whoami` says “Not currently logged in.” No Reddit-hosted two-account playtest or release has occurred.
- The production build reports a chunk larger than 500 kB.
