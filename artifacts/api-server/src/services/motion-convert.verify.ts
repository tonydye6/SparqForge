import { collectMotionConvertCases } from "./motion-convert.cases.js";

const results = await collectMotionConvertCases();
const failures = results.filter((result) => !result.ok);

console.log(
  `\nmotion-convert verification: ${results.length - failures.length} passed, ${failures.length} failed`,
);
if (failures.length > 0) {
  for (const failure of failures) {
    console.log(
      `  FAIL  ${failure.name}${failure.detail === undefined ? "" : ` · got ${JSON.stringify(failure.detail)}`}`,
    );
  }
  process.exit(1);
}
console.log("all assertions pass\n");
