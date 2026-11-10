import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function runSteps(steps) {
  const results = [];
  for (const args of steps) {
    const started = performance.now();
    const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
    const entry = { command: ["node", ...args].join(" "), seconds: Number(((performance.now() - started) / 1000).toFixed(2)), status: result.status ?? 1 };
    results.push(entry);
    console.log(`${entry.status === 0 ? "PASS" : "FAIL"} ${entry.seconds}s ${entry.command}`);
    if (entry.status !== 0) break;
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const steps = JSON.parse(readFileSync(new URL("./smoke-steps.json", import.meta.url), "utf8"));
  const results = runSteps(steps);
  const directory = new URL("../release/smoke/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  writeFileSync(new URL("timings.json", directory), JSON.stringify(results, null, 2) + "\n");
  console.log(`Smoke: ${results.length}/${steps.length} steps, ${results.reduce((total, result) => total + result.seconds, 0).toFixed(2)}s`);
  process.exitCode = results.at(-1)?.status ?? 1;
}
