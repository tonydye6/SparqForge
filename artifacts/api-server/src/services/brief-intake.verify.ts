/**
 * Brief-intake derivation, run without vitest.
 *
 * Run: pnpm exec tsx src/services/brief-intake.verify.ts   (from artifacts/api-server)
 *
 * Exists for the same reason stage-graph.verify.ts does: vitest cannot start on
 * the development Mac, because the Linux-resolved pnpm-lock.yaml omits
 * @rollup/rollup-darwin-arm64. Do not "fix" that by touching the lockfile.
 *
 * The cases are shared with brief-intake.test.ts, so this runner and CI check
 * exactly the same things. This file is only a reporter.
 */

import { collectBriefIntakeCases } from "./brief-intake.cases.js";

const results = collectBriefIntakeCases();
const failures = results.filter((r) => !r.ok);

console.log(`\nbrief-intake verification: ${results.length - failures.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}

console.log("all assertions pass\n");
