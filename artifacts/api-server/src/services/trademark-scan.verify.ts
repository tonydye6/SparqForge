/**
 * Trademark-scan rules, run without vitest.
 * Run: pnpm exec tsx src/services/trademark-scan.verify.ts   (from artifacts/api-server)
 * Cases shared with trademark-scan.test.ts. This file is only a reporter.
 */
import { collectTrademarkScanCases } from "./trademark-scan.cases.js";

const results = await collectTrademarkScanCases();
const failures = results.filter((r) => !r.ok);
console.log(`\ntrademark-scan verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
