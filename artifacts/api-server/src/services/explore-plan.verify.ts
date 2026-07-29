/**
 * Stage 03 Explore plan, run without vitest.
 *
 * Run: pnpm exec tsx src/services/explore-plan.verify.ts   (from artifacts/api-server)
 *
 * Exists because vitest cannot start on the development Mac: the Linux-resolved
 * pnpm-lock.yaml omits @rollup/rollup-darwin-arm64. Do not "fix" that by
 * touching the lockfile.
 *
 * Cases are shared with explore-plan.test.ts. This file is only a reporter.
 */

import { collectExplorePlanCases } from "./explore-plan.cases.js";

const results = collectExplorePlanCases();
const failures = results.filter((r) => !r.ok);

console.log(`\nexplore-plan verification: ${results.length - failures.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}

console.log("all assertions pass\n");
