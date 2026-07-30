/**
 * Stage 05 crop rules, run without vitest.
 * Run: pnpm exec tsx src/services/crop-stage.verify.ts   (from artifacts/api-server)
 * Cases shared with crop-stage.test.ts. This file is only a reporter.
 */
import { collectCropStageCases } from "./crop-stage.cases.js";

const results = await collectCropStageCases();
const failures = results.filter((r) => !r.ok);
console.log(`\ncrop-stage verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
