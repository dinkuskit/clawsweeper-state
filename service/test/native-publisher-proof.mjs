// Controlled interoperability proof. Requires the built, pinned ClawSweeper
// publisher path and a local fixture URL; never use a production endpoint.
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [modulePath, url] = process.argv.slice(2);
assert.match(url ?? "", /^http:\/\/127\.0\.0\.1:[0-9]+\/?$/);
const { publishMainWithStateAppend } = await import(pathToFileURL(modulePath));
const root = mkdtempSync(join(tmpdir(), "dinkuskit-publisher-proof-"));
const secret = "local-fixture-only-not-a-credential";
let gitCalls = 0;
const result = [];
try {
  for (const repo of [
    "commerce",
    "template-store",
    "inventory",
    "payments",
    "dinkuskit",
  ]) {
    const source = join(root, repo, "source"),
      baseline = join(root, repo, "baseline");
    const path = `records/dinkuskit-${repo}/items/42.md`;
    mkdirSync(join(source, `records/dinkuskit-${repo}/items`), {
      recursive: true,
    });
    mkdirSync(baseline, { recursive: true });
    const content = `---\nrepo: dinkuskit/${repo}\nnumber: 42\nreviewed_at: 2026-09-30T00:00:00Z\n---\n\nSynthetic compatibility proof.\n`;
    writeFileSync(join(source, path), content);
    const baseEnv = {
      CLAWSWEEPER_STATE_DIR: baseline,
      GITHUB_RUN_ID: "controlled-fixture",
      GITHUB_RUN_ATTEMPT: "1",
    };
    const invoke = (env) =>
      publishMainWithStateAppend(
        { message: "fixture", paths: [path] },
        {
          root: source,
          env,
          publishGit: () => {
            gitCalls++;
            throw new Error("Unexpected Git fallback");
          },
        },
      );
    await assert.rejects(
      invoke(baseEnv),
      /canonical record publication is required/,
    );
    const env = {
      ...baseEnv,
      QUEUE_URL: url,
      CLAWSWEEPER_WEBHOOK_SECRET: secret,
    };
    assert.equal(await invoke(env), "appended");
    assert.equal(await invoke(env), "appended");
    await assert.rejects(
      invoke({ ...env, CLAWSWEEPER_WEBHOOK_SECRET: "wrong-fixture-key" }),
      /401/,
    );
    const response = await fetch(
      `${url.replace(/\/$/, "")}/internal/state/records/dinkuskit-${repo}/items/42`,
      {
        headers: {
          "x-clawsweeper-exact-review-signature":
            "sha256=" + createHmac("sha256", secret).update("").digest("hex"),
        },
      },
    );
    assert.equal(response.status, 200);
    const record = await response.json();
    assert.equal(record.content, content);
    assert.equal(
      record.digest,
      createHash("sha256").update(content).digest("hex"),
    );
    assert.equal(record.revision, 1);
    result.push({
      repository: `dinkuskit/${repo}`,
      nativePublication: "accepted",
      nativeRetry: "deduped",
      invalidAuthentication: "rejected",
      durableReadback: "matched",
      revision: record.revision,
    });
  }
  assert.equal(gitCalls, 0);
  console.log(
    JSON.stringify({
      result: "PASS",
      repositories: result,
      gitFallbackCalls: gitCalls,
      limits:
        "Controlled local Worker and synthetic records; no cloud deployment or product publication.",
    }),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
