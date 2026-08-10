/**
 * ship invariants, run without vitest.
 *
 * Run: pnpm exec tsx src/services/ship.verify.ts   (from artifacts/api-server)
 *
 * The cases are shared with ship.test.ts, so this runner and CI check exactly
 * the same things. This file is only a reporter.
 */

import { collectShipCases } from "./ship.cases.js";

const results = collectShipCases();
const failures = results.filter((r) => !r.ok);

console.log(`\nship verification: ${results.length - failures.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}

console.log("all assertions pass\n");
