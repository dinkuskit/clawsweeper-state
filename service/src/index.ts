import { DurableObject } from "cloudflare:workers";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  allowedSlugs,
  MAX_REQUEST_BYTES,
  recordPath,
  sections,
  validKey,
  validateMutation,
  type Mutation,
  type Section,
} from "./protocol";

// Binding types come from Wrangler; the secret is provisioned only at deployment.
type RuntimeEnv = Env & { CLAWSWEEPER_WEBHOOK_SECRET?: string };
type Stored = {
  section: Section;
  digest: string | null;
  content: string | null;
};
type Meta = { revision: number; delivery_id: string; updated_at: number };
type Current = {
  key: string;
  revision: number;
  deliveryId: string;
  operations: {
    path: string;
    expectedDigest: string | null;
    contentBase64?: string;
  }[];
};
type Result = {
  status: number;
  body: {
    error?: string;
    ok?: boolean;
    accepted?: boolean;
    deduped?: boolean;
    revision?: number;
    current?: Current | null;
    content?: string;
    digest?: string | null;
    updatedAt?: string;
    deleted?: boolean;
  };
};

export class RecordTuple extends DurableObject<RuntimeEnv> {
  constructor(ctx: DurableObjectState, env: RuntimeEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, delivery_id TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS records (section TEXT PRIMARY KEY, digest TEXT);
      CREATE TABLE IF NOT EXISTS chunks (section TEXT NOT NULL, ordinal INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(section,ordinal));
      CREATE TABLE IF NOT EXISTS receipts (delivery_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL, received_at INTEGER NOT NULL);
    `);
  }
  private meta(): Meta | undefined {
    return this.ctx.storage.sql
      .exec<Meta>("SELECT revision,delivery_id,updated_at FROM meta WHERE id=1")
      .toArray()[0];
  }
  private records(): Stored[] {
    return sections.map((section) => {
      const row = this.ctx.storage.sql
        .exec<{ digest: string | null }>(
          "SELECT digest FROM records WHERE section=?",
          section,
        )
        .toArray()[0];
      const content =
        row?.digest == null
          ? null
          : this.ctx.storage.sql
              .exec<{ content: string }>(
                "SELECT content FROM chunks WHERE section=? ORDER BY ordinal",
                section,
              )
              .toArray()
              .map((chunk) => chunk.content)
              .join("");
      return { section, digest: row?.digest ?? null, content };
    });
  }
  private current(key: string) {
    const meta = this.meta();
    if (!meta) return null;
    return {
      key,
      revision: meta.revision,
      deliveryId: meta.delivery_id,
      operations: this.records().map((row) => ({
        path: recordPath(key, row.section),
        expectedDigest: row.digest,
        ...(row.content === null
          ? {}
          : { contentBase64: Buffer.from(row.content).toString("base64") }),
      })),
    };
  }
  read(key: string, section?: Section): Result {
    if (!section)
      return { status: 200, body: { ok: true, current: this.current(key) } };
    const meta = this.meta();
    const record = this.records().find((row) => row.section === section)!;
    if (record.content === null)
      return {
        status: 404,
        body: {
          error: "record_not_found",
          ...(meta
            ? {
                digest: null,
                revision: meta.revision,
                updatedAt: new Date(meta.updated_at).toISOString(),
                deleted: true,
              }
            : {}),
        },
      };
    return {
      status: 200,
      body: {
        content: record.content,
        digest: record.digest,
        revision: meta!.revision,
        updatedAt: new Date(meta!.updated_at).toISOString(),
      },
    };
  }
  publish(mutation: Mutation): Result {
    // No await between compare-and-swap and receipt persistence.
    return this.ctx.storage.transactionSync((): Result => {
      const receipt = this.ctx.storage.sql
        .exec<{ fingerprint: string; revision: number }>(
          "SELECT fingerprint,revision FROM receipts WHERE delivery_id=?",
          mutation.deliveryId,
        )
        .toArray()[0];
      if (receipt) {
        if (receipt.fingerprint !== mutation.fingerprint)
          return {
            status: 409,
            body: { error: "canonical_record_tuple_conflict" },
          };
        return {
          status: 202,
          body: {
            ok: true,
            accepted: false,
            deduped: true,
            revision: receipt.revision,
          },
        };
      }
      const records = this.records();
      if (
        mutation.operations.some(
          (op) =>
            records.find((row) => row.section === op.section)!.digest !==
            op.expectedDigest,
        )
      ) {
        return {
          status: 409,
          body: {
            error: "canonical_record_tuple_conflict",
            current: this.current(mutation.key),
          },
        };
      }
      const revision = (this.meta()?.revision ?? 0) + 1;
      const now = Date.now();
      for (const op of mutation.operations) {
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO records(section,digest) VALUES (?,?)",
          op.section,
          op.digest,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM chunks WHERE section=?",
          op.section,
        );
        // Small UTF-16 slices keep each SQLite value well below row limits.
        if (op.content !== null) {
          for (
            let offset = 0, ordinal = 0;
            offset < op.content.length;
            ordinal++
          ) {
            let end = Math.min(offset + 16384, op.content.length);
            if (
              end < op.content.length &&
              /[\uD800-\uDBFF]/.test(op.content[end - 1]!)
            )
              end--;
            this.ctx.storage.sql.exec(
              "INSERT INTO chunks(section,ordinal,content) VALUES (?,?,?)",
              op.section,
              ordinal,
              op.content.slice(offset, end),
            );
            offset = end;
          }
        }
      }
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO meta(id,revision,delivery_id,updated_at) VALUES (1,?,?,?)",
        revision,
        mutation.deliveryId,
        now,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO receipts(delivery_id,fingerprint,revision,received_at) VALUES (?,?,?,?)",
        mutation.deliveryId,
        mutation.fingerprint,
        revision,
        now,
      );
      // Retain delivery identities for this tuple's lifetime. Expiring one can
      // let its original empty-baseline mutation resurrect a deleted record.
      return {
        status: 202,
        body: { ok: true, accepted: true, deduped: false, revision },
      };
    });
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
async function boundedBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES)
    throw new Error("body_too_large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}
export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET")
      return json({ ok: true, service: "dinkuskit-canonical-state" });
    if (!env.CLAWSWEEPER_WEBHOOK_SECRET)
      return json({ error: "webhook_not_configured" }, 503);
    let slugs: Set<string>;
    try {
      slugs = allowedSlugs(env.ALLOWED_REPOSITORIES);
    } catch {
      return json({ error: "repositories_not_configured" }, 503);
    }
    let body: string;
    try {
      body = await boundedBody(request);
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error && error.message === "body_too_large"
              ? "request_too_large"
              : "invalid_body",
        },
        error instanceof Error && error.message === "body_too_large"
          ? 413
          : 400,
      );
    }
    const signature =
      request.headers.get("x-clawsweeper-exact-review-signature") ?? "";
    const expected = createHmac("sha256", env.CLAWSWEEPER_WEBHOOK_SECRET)
      .update(body)
      .digest();
    if (
      !/^sha256=[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"))
    )
      return json({ error: "invalid_signature" }, 401);
    if (url.search) return json({ error: "query_not_supported" }, 400);
    if (
      url.pathname === "/internal/state/health" &&
      request.method === "POST"
    ) {
      return json({
        ok: true,
        service: "dinkuskit-canonical-state",
        protocol: "canonical-record-tuples-v1",
        repositories: [...slugs],
      });
    }
    if (
      url.pathname === "/internal/state/records/tuples" &&
      request.method === "POST"
    ) {
      let mutation: Mutation;
      try {
        mutation = validateMutation(JSON.parse(body));
      } catch {
        return json({ error: "invalid_canonical_record_tuple" }, 400);
      }
      if (!slugs.has(mutation.key.split("/")[0]!))
        return json({ error: "repository_not_allowed" }, 403);
      const result = await env.RECORDS.getByName(mutation.key).publish(
        mutation,
      );
      return json(result.body, result.status);
    }
    const match =
      /^\/internal\/state\/records\/([^/]+)\/(items|closed|plans|decision-packets)\/([1-9][0-9]*)$/.exec(
        url.pathname,
      );
    const tuple = /^\/internal\/state\/tuples\/([^/]+)\/([1-9][0-9]*)$/.exec(
      url.pathname,
    );
    if (request.method === "GET" && (match || tuple)) {
      const key = match
        ? `${match[1]}/${match[3]}`
        : `${tuple![1]}/${tuple![2]}`;
      if (!validKey(key))
        return json({ error: "invalid_canonical_record_identity" }, 400);
      if (!slugs.has(key.split("/")[0]!))
        return json({ error: "repository_not_allowed" }, 403);
      const result = await env.RECORDS.getByName(key).read(
        key,
        match?.[2] as Section | undefined,
      );
      return json(result.body, result.status);
    }
    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<RuntimeEnv>;
