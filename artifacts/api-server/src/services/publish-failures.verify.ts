/**
 * Publish-failure classification, run without vitest.
 *
 * Run: pnpm exec tsx src/services/publish-failures.verify.ts   (from artifacts/api-server)
 *
 * The cases are shared with publish-failures.test.ts. This file is only a
 * reporter.
 */

import { collectPublishFailureCases } from "./publish-failures.cases.js";

const results = collectPublishFailureCases();
const failures = results.filter((r) => !r.ok);

console.log(`\npublish-failures verification: ${results.length - failures.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}

console.log("all assertions pass\n");
