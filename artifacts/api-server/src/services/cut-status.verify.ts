/**
 * The cut's fingerprint and states, run without vitest.
 * Run: pnpm exec tsx src/services/cut-status.verify.ts   (from artifacts/api-server)
 * Cases shared with cut-status.test.ts. This file is only a reporter.
 */
import { runCases } from "./cut-status.cases.js";

const results = runCases();
const failures = results.filter(r => !r.ok);
console.log(`\ncut status verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
