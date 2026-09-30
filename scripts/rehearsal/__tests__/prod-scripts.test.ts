import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Exercises the exit-code logic of prod-apply.sh / prod-read.sh without ever
 * touching a network or a production database: a fake `curl` earlier on PATH
 * stands in for the Supabase management API and answers with a canned body.
 * Never spawn the real scripts with a real SUPABASE_ACCESS_TOKEN here.
 */
const REPO_ROOT = join(__dirname, "..", "..", "..");
const ERROR_BODY = JSON.stringify({ error: "syntax error at or near \"SELCT\"" });
const ARRAY_BODY = JSON.stringify([{ count: 3 }]);

function withFakeCurl(body: string, run: (env: NodeJS.ProcessEnv) => void) {
  const dir = mkdtempSync(join(tmpdir(), "fake-curl-"));
  const curlPath = join(dir, "curl");
  // Real curl reads the entire request body from stdin when --data-binary @- is used.
  // This fake must do the same, else prod-apply.sh with set -euo pipefail causes jq to
  // receive SIGPIPE when the pipe breaks on Linux, exiting 141 before stdout reaches the test.
  writeFileSync(curlPath, `#!/bin/bash\ncat > /dev/null\nprintf '%s' "$FAKE_CURL_BODY"\n`);
  chmodSync(curlPath, 0o755);
  try {
    run({
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_CURL_BODY: body,
      SUPABASE_ACCESS_TOKEN: "not-a-real-token",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runScript(script: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync("bash", [join(REPO_ROOT, "scripts", "rehearsal", script), ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
  });
}

describe("check-query-response.sh", () => {
  it("exits 0 for a JSON array body", () => {
    const res = spawnSync("bash", [join(REPO_ROOT, "scripts/rehearsal/check-query-response.sh")], {
      input: ARRAY_BODY,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
  });

  it("exits non-zero for a JSON object (SQL error) body", () => {
    const res = spawnSync("bash", [join(REPO_ROOT, "scripts/rehearsal/check-query-response.sh")], {
      input: ERROR_BODY,
      encoding: "utf8",
    });
    expect(res.status).not.toBe(0);
  });

  it("exits non-zero for a non-JSON body", () => {
    const res = spawnSync("bash", [join(REPO_ROOT, "scripts/rehearsal/check-query-response.sh")], {
      input: "not json at all",
      encoding: "utf8",
    });
    expect(res.status).not.toBe(0);
  });
});

describe("prod-apply.sh exit code", () => {
  it("exits non-zero and still prints the body when the API answers a SQL error", () => {
    withFakeCurl(ERROR_BODY, (env) => {
      const res = runScript("prod-apply.sh", ["select 1"], env);
      expect(res.status).not.toBe(0);
      expect(res.stdout).toContain("syntax error");
    });
  });

  it("exits 0 and prints the body when the API answers a result array", () => {
    withFakeCurl(ARRAY_BODY, (env) => {
      const res = runScript("prod-apply.sh", ["select 1"], env);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('"count":3');
    });
  });

  it("never prints the access token", () => {
    withFakeCurl(ARRAY_BODY, (env) => {
      const res = runScript("prod-apply.sh", ["select 1"], env);
      expect(res.stdout).not.toContain("not-a-real-token");
      expect(res.stderr).not.toContain("not-a-real-token");
    });
  });
});

describe("prod-read.sh exit code", () => {
  it("exits non-zero when the API answers a SQL error", () => {
    withFakeCurl(ERROR_BODY, (env) => {
      const res = runScript("prod-read.sh", ["select 1"], env);
      expect(res.status).not.toBe(0);
      expect(res.stdout).toContain("syntax error");
    });
  });

  it("exits 0 when the API answers a result array", () => {
    withFakeCurl(ARRAY_BODY, (env) => {
      const res = runScript("prod-read.sh", ["select 1"], env);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('"count":3');
    });
  });
});
