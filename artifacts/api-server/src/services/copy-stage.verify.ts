/**
 * Stage 04 Copy rules, run without vitest.
 * Run: pnpm exec tsx src/services/copy-stage.verify.ts   (from artifacts/api-server)
 * Cases shared with copy-stage.test.ts. This file is only a reporter.
 */
import { collectCopyStageCases } from "./copy-stage.cases.js";

const results = await collectCopyStageCases();
const failures = results.filter((r) => !r.ok);
console.log(`\ncopy-stage verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
