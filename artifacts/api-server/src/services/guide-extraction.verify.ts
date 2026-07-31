/**
 * Guide-extraction rules, run without vitest.
 * Run: pnpm exec tsx src/services/guide-extraction.verify.ts   (from artifacts/api-server)
 * Cases shared with guide-extraction.test.ts. This file is only a reporter.
 */
import { collectGuideExtractionCases } from "./guide-extraction.cases.js";

const results = await collectGuideExtractionCases();
const failures = results.filter((r) => !r.ok);
console.log(`\nguide-extraction verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
