/**
 * The dependency engine, run without vitest.
 *
 * Run: pnpm exec tsx src/services/stage-graph.verify.ts   (from artifacts/api-server)
 *
 * This exists because vitest cannot start on the development Mac: the
 * Linux-resolved pnpm-lock.yaml omits @rollup/rollup-darwin-arm64, and the same
 * gap blocks the frontend build and any standalone Tailwind compile. Do not
 * "fix" that by touching the lockfile.
 *
 * The cases are shared with stage-graph.test.ts, so this runner and CI check
 * exactly the same things. This file is only a reporter.
 */

import { collectStageGraphCases } from "./stage-graph.cases.js";

const results = collectStageGraphCases();
const failures = results.filter((r) => !r.ok);

console.log(`\nstage-graph verification: ${results.length - failures.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}

console.log("all assertions pass\n");
