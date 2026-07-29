/**
 * Stage 02 designer spread, run without vitest.
 *
 * Run: pnpm exec tsx src/services/direction-spread.verify.ts   (from artifacts/api-server)
 *
 * Exists for the same reason stage-graph.verify.ts does: vitest cannot start on
 * the development Mac, because the Linux-resolved pnpm-lock.yaml omits
 * @rollup/rollup-darwin-arm64. Do not "fix" that by touching the lockfile.
 *
 * The cases are shared with direction-spread.test.ts, so this runner and CI check
 * exactly the same things. This file is only a reporter.
 */

import { collectDirectionSpreadCases } from "./direction-spread.cases.js";

const results = collectDirectionSpreadCases();
const failures = results.filter((r) => !r.ok);

console.log(`\ndirection-spread verification: ${results.length - failures.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}

console.log("all assertions pass\n");
