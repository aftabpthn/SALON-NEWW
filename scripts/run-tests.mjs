import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDataDir = mkdtempSync(join(tmpdir(), "aurashine-test-"));
const dbPath = join(testDataDir, "salon-crm.sqlite");
const forwardedArgs = process.argv.slice(2);
const testTargets = forwardedArgs.length ? forwardedArgs : ["tests/*.test.js"];

const child = spawn(process.execPath, ["--import", "./tests/helpers/authenticated-fetch-preload.mjs", "--test", "--test-concurrency=1", ...testTargets], {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "test",
    AURA_DATA_DIR: testDataDir,
    AURA_DB_PATH: dbPath,
    AURA_TEST_ISOLATED: "1"
  }
});

function cleanup() {
  if (process.env.AURA_KEEP_TEST_DB === "1") {
    console.log(`Isolated test database kept at ${dbPath}`);
    return;
  }
  rmSync(testDataDir, { recursive: true, force: true });
}

child.on("exit", (code, signal) => {
  cleanup();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  cleanup();
  console.error(error);
  process.exit(1);
});
