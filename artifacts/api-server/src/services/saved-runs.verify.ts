/**
 * Saved-run capture and replay, run without vitest.
 *
 * Run: pnpm exec tsx src/services/saved-runs.verify.ts   (from artifacts/api-server)
 *
 * The cases are shared with saved-runs.test.ts, so this runner and CI check
 * exactly the same things. This file is only a reporter.
 */

import { collectSavedRunCases } from "./saved-runs.cases.js";

const results = collectSavedRunCases();
const failures = results.filter((r) => !r.ok);

console.log(`\nsaved-runs verification: ${results.length - failures.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}

console.log("all assertions pass\n");
