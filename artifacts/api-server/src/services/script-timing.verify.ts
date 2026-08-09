/**
 * Script timing rules, run without vitest.
 * Run: pnpm exec tsx src/services/script-timing.verify.ts   (from artifacts/api-server)
 * Cases shared with script-timing.test.ts. This file is only a reporter.
 */
import { runCases } from "./script-timing.cases.js";

const results = runCases();
const failures = results.filter(r => !r.ok);
console.log(`\nscript-timing verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
