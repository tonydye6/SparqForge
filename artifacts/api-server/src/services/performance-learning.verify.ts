/**
 * Performance-learning rules, run without vitest.
 * Run: pnpm exec tsx src/services/performance-learning.verify.ts   (from artifacts/api-server)
 * Cases shared with performance-learning.test.ts. This file is only a reporter.
 */
import { collectPerformanceLearningCases } from "./performance-learning.cases.js";

const results = await collectPerformanceLearningCases();
const failures = results.filter((r) => !r.ok);
console.log(`\nperformance-learning verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
