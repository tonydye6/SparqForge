/**
 * Explore run money and failure rules, run without vitest.
 * Run: pnpm exec tsx src/services/explore-run.verify.ts   (from artifacts/api-server)
 * Cases shared with explore-run.test.ts. This file is only a reporter.
 */
import { collectExploreRunCases } from "./explore-run.cases.js";

const results = await collectExploreRunCases();
const failures = results.filter((r) => !r.ok);
console.log(`\nexplore-run verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
