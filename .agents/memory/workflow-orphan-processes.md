---
name: Workflow restart orphan processes
description: Why api-server restarts left stale tsx processes squatting the port, and the dev-script pattern that fixes it
---

Workflow restarts signal only the top-level pnpm process. The chain `pnpm → sh -c → tsx CLI → node worker` meant grandchildren survived SIGTERM/SIGKILL of pnpm, kept the port bound, and served stale code while every new start died with "Port already in use". This produced repeated false test results (old code appearing to run after a merge).

**Fix (in api-server dev script):** `lsof -ti tcp:${PORT:-8080} | xargs -r kill -9; NODE_ENV=development exec tsx ./src/index.ts`
- The lsof sweep force-clears any prior listener on the port before binding.
- `exec` collapses the `sh -c` layer so signals reach tsx directly.

**How to apply:** any long-running dev script started via pnpm in this repo should use the same pre-kill + exec pattern. When verifying "is the server running new code", compare the process start time (`ps -eo pid,lstart,args`) against the merge commit time — content greps alone can be fooled by a squatting process.

**Why:** three separate verification passes were invalidated by a stale process before this was fixed (2026-07).
