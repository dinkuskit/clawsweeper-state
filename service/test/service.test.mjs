import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const runtime = ({ durableObjectsPersist, ...options }) =>
  new Miniflare({
    ...convertV4MiniflareOptions(options),
    ...(durableObjectsPersist
      ? { resourcePersistencePath: durableObjectsPersist }
      : {}),
  });
const secret = "synthetic-test-key-only";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const repos = [
  "commerce",
  "template-store",
  "inventory",
  "payments",
  "dinkuskit",
];
const options = {
  name: "canonical-state-test",
  modules: true,
  scriptPath: "dist/index.js",
  compatibilityDate: "2026-09-30",
  compatibilityFlags: ["nodejs_compat"],
  durableObjects: { RECORDS: { className: "RecordTuple", useSQLite: true } },
  bindings: {
    CLAWSWEEPER_WEBHOOK_SECRET: secret,
    ALLOWED_REPOSITORIES: repos.map((r) => "dinkuskit/" + r).join(","),
  },
};
function mutation(
  slug = "commerce",
  number = 42,
  content = "Fixture",
  previous = null,
  id = "first",
) {
  const key = `dinkuskit-${slug}/${number}`;
  return {
    key,
    deliveryId: id,
    operations: ["items", "closed", "plans", "decision-packets"].map(
      (section, i) => ({
        path: `records/dinkuskit-${slug}/${section}/${number}.${i === 3 ? "json" : "md"}`,
        expectedDigest: i === 0 ? previous : null,
        ...(i === 0
          ? { contentBase64: Buffer.from(content).toString("base64") }
          : {}),
      }),
    ),
  };
}
async function request(mf, path, body, signingKey = secret) {
  const raw =
    body === undefined
      ? ""
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  const response = await mf.dispatchFetch("https://state.example" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-clawsweeper-exact-review-signature":
        "sha256=" + createHmac("sha256", signingKey).update(raw).digest("hex"),
    },
    ...(body === undefined ? {} : { body: raw }),
  });
  return { status: response.status, body: await response.json() };
}
const publish = (mf, value, key) =>
  request(mf, "/internal/state/records/tuples", value, key);
test("five enrolled repositories publish, read and retry independently", async () => {
  const mf = runtime(options);
  try {
    for (const repo of repos) {
      const value = mutation(repo);
      assert.equal((await publish(mf, value)).status, 202);
      const retry = await publish(mf, value);
      assert.equal(retry.body.deduped, true);
      assert.equal(retry.body.revision, 1);
      const row = await request(
        mf,
        `/internal/state/records/dinkuskit-${repo}/items/42`,
      );
      assert.equal(row.status, 200);
      assert.equal(
        row.body.digest,
        hash(Buffer.from(value.operations[0].contentBase64, "base64")),
      );
      const atomic = await request(
        mf,
        `/internal/state/tuples/dinkuskit-${repo}/42`,
      );
      assert.equal(atomic.body.current.operations.length, 4);
    }
  } finally {
    await mf.dispose();
  }
});
test("wrong signing key, changed signed payload, unconfigured service and foreign repo fail closed", async () => {
  const mf = runtime(options);
  const missing = runtime({
    ...options,
    bindings: { ALLOWED_REPOSITORIES: options.bindings.ALLOWED_REPOSITORIES },
  });
  try {
    assert.equal(
      (await publish(mf, mutation(), "bad-fixture-key")).status,
      401,
    );
    assert.equal((await publish(missing, mutation())).status, 503);
    assert.equal((await publish(mf, mutation("not-enrolled"))).status, 403);
    assert.equal(
      (
        await request(
          mf,
          "/internal/state/records/dinkuskit-not-enrolled/items/42",
        )
      ).status,
      403,
    );
    assert.equal(
      (await request(mf, "/internal/state/records/dinkuskit-commerce/items/42"))
        .status,
      404,
    );
    const response = await mf.dispatchFetch(
      "https://state.example/internal/state/records/tuples",
      {
        method: "POST",
        body: JSON.stringify(mutation()),
        headers: {
          "x-clawsweeper-exact-review-signature":
            "sha256=" + createHmac("sha256", secret).update("{}").digest("hex"),
        },
      },
    );
    assert.equal(response.status, 401);
  } finally {
    await mf.dispose();
    await missing.dispose();
  }
});
test("concurrent competing updates accept one writer and return current tuple to the loser", async () => {
  const mf = runtime(options);
  try {
    const first = mutation();
    await publish(mf, first);
    const previous = hash(
      Buffer.from(first.operations[0].contentBase64, "base64"),
    );
    const results = await Promise.all([
      publish(mf, mutation("commerce", 42, "winner A", previous, "a")),
      publish(mf, mutation("commerce", 42, "winner B", previous, "b")),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [202, 409]);
    const conflict = results.find((r) => r.status === 409);
    assert.equal(conflict.body.error, "canonical_record_tuple_conflict");
    assert.equal(conflict.body.current.revision, 2);
    assert.equal(
      (
        await publish(
          mf,
          mutation("commerce", 42, "changed payload", null, "first"),
        )
      ).status,
      409,
    );
    const retry = await publish(mf, first);
    assert.equal(retry.body.deduped, true);
    assert.equal(retry.body.revision, 1);
    assert.equal(
      (await request(mf, "/internal/state/records/dinkuskit-commerce/items/42"))
        .body.revision,
      2,
    );
  } finally {
    await mf.dispose();
  }
});
test("invalid paths, duplicate sections, bad content and orphan sidecars never partially write", async () => {
  const mf = runtime(options);
  try {
    for (const change of [
      (v) => {
        v.operations[0].contentBase64 = Buffer.from(
          "---\nrepo: dinkuskit/payments\nnumber: 42\n---\nWrong repository",
        ).toString("base64");
      },
      (v) => (v.operations[1].path = v.operations[0].path),
      (v) => (v.operations[0].path = "records/dinkuskit-payments/items/42.md"),
      (v) => (v.operations[0].expectedDigest = "not-a-digest"),
      (v) => (v.operations[0].contentBase64 = "?"),
      (v) => (v.operations[0].contentBase64 = "/w=="),
      (v) =>
        (v.operations[1].contentBase64 =
          Buffer.from("also closed").toString("base64")),
      (v) => {
        delete v.operations[0].contentBase64;
        v.operations[2].contentBase64 =
          Buffer.from("orphan").toString("base64");
      },
      (v) =>
        (v.operations[3].contentBase64 = Buffer.from("{}").toString("base64")),
    ]) {
      const value = mutation();
      change(value);
      assert.equal((await publish(mf, value)).status, 400);
    }
    assert.equal(
      (await request(mf, "/internal/state/records/dinkuskit-commerce/items/42"))
        .status,
      404,
    );
  } finally {
    await mf.dispose();
  }
});
test("open-to-closed move is atomic and deletion retains a tombstone", async () => {
  const mf = runtime(options);
  try {
    const first = mutation();
    await publish(mf, first);
    const moved = structuredClone(first);
    moved.deliveryId = "closed";
    moved.operations[0].expectedDigest = hash(
      Buffer.from(first.operations[0].contentBase64, "base64"),
    );
    delete moved.operations[0].contentBase64;
    moved.operations[1].contentBase64 =
      Buffer.from("closed report").toString("base64");
    assert.equal((await publish(mf, moved)).status, 202);
    const open = await request(
      mf,
      "/internal/state/records/dinkuskit-commerce/items/42",
    );
    assert.equal(open.status, 404);
    assert.equal(open.body.deleted, true);
    assert.equal(
      (
        await request(
          mf,
          "/internal/state/records/dinkuskit-commerce/closed/42",
        )
      ).body.content,
      "closed report",
    );
    const deleted = structuredClone(moved);
    deleted.deliveryId = "deleted";
    deleted.operations[0].expectedDigest = null;
    deleted.operations[1].expectedDigest = hash("closed report");
    delete deleted.operations[1].contentBase64;
    assert.equal((await publish(mf, deleted)).status, 202);
    assert.equal(
      (
        await request(
          mf,
          "/internal/state/records/dinkuskit-commerce/closed/42",
        )
      ).body.revision,
      3,
    );
    assert.equal(
      (await publish(mf, { ...first, deliveryId: "stale" })).status,
      202,
    ); // Digest CAS permits an explicitly empty baseline.
  } finally {
    await mf.dispose();
  }
});
test("chunked Unicode report and receipts survive runtime restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dinkuskit-canonical-state-"));
  let mf = runtime({ ...options, durableObjectsPersist: dir });
  try {
    const content = "x".repeat(16383) + "🦀".repeat(180000);
    const value = mutation("commerce", 42, content);
    assert.equal((await publish(mf, value)).status, 202);
    await mf.dispose();
    mf = runtime({ ...options, durableObjectsPersist: dir });
    const persisted = await request(
      mf,
      "/internal/state/records/dinkuskit-commerce/items/42",
    );
    assert.equal(persisted.status, 200);
    assert.equal(hash(persisted.body.content), hash(content));
    assert.equal((await publish(mf, value)).body.deduped, true);
  } finally {
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
test("authenticated readiness and bounded payload rejection", async () => {
  const mf = runtime(options);
  try {
    const ready = await request(mf, "/internal/state/health", {});
    assert.equal(ready.status, 200);
    assert.equal(ready.body.repositories.length, 5);
    const large = mutation("commerce", 42, "x".repeat(2 * 1024 * 1024 + 1));
    assert.equal((await publish(mf, large)).status, 400);
    assert.equal(
      (
        await request(
          mf,
          "/internal/state/records/tuples",
          "x".repeat(12 * 1024 * 1024 + 1),
        )
      ).status,
      413,
    );
  } finally {
    await mf.dispose();
  }
});
