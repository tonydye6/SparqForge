/**
 * smart-bar invariants, run without vitest.
 *
 * Run: pnpm exec tsx src/services/smart-bar.verify.ts   (from artifacts/api-server)
 *
 * The cases are shared with smart-bar.test.ts. This file is only a reporter.
 */

import { collectSmartBarCases } from "./smart-bar.cases.js";

const results = collectSmartBarCases();
const failures = results.filter((r) => !r.ok);

console.log(`\nsmart-bar verification: ${results.length - failures.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}

console.log("all assertions pass\n");
