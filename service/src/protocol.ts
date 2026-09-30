import { createHash } from "node:crypto";

export const sections = [
  "items",
  "closed",
  "plans",
  "decision-packets",
] as const;
export type Section = (typeof sections)[number];
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
export type Operation = {
  section: Section;
  path: string;
  expectedDigest: string | null;
  content: string | null;
  digest: string | null;
};
export type Mutation = {
  key: string;
  deliveryId: string;
  operations: Operation[];
  fingerprint: string;
};
export const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const recordPath = (key: string, section: Section) => {
  const [slug, number] = key.split("/");
  return `records/${slug}/${section}/${number}.${section === "decision-packets" ? "json" : "md"}`;
};
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_object");
  return value as Record<string, unknown>;
}
export function validKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(dinkuskit-[a-z0-9_.-]+)\/([1-9][0-9]*)$/.exec(value);
  return Boolean(match && Number.isSafeInteger(Number(match[2])));
}
export function allowedSlugs(config: string): Set<string> {
  const repos = config.split(",").map((value) => value.trim());
  if (
    !repos.length ||
    repos.some((value) => !/^dinkuskit\/[a-z0-9_.-]+$/.test(value))
  ) {
    throw new Error("invalid_repository_configuration");
  }
  return new Set(repos.map((value) => value.replace("/", "-")));
}
export function validateMutation(input: unknown): Mutation {
  const value = object(input);
  if (
    !validKey(value.key) ||
    typeof value.deliveryId !== "string" ||
    !value.deliveryId.trim() ||
    value.deliveryId.length > 512 ||
    /[\x00\r\n]/.test(value.deliveryId)
  ) {
    throw new Error("invalid_identity");
  }
  if (!Array.isArray(value.operations) || value.operations.length !== 4)
    throw new Error("four_sections_required");
  const key = value.key;
  const operations = sections.map((section) => {
    const path = recordPath(key, section);
    const matches = (value.operations as unknown[])
      .map(object)
      .filter((op) => op.path === path);
    if (matches.length !== 1) throw new Error("invalid_section_paths");
    const op = matches[0]!;
    if (
      op.expectedDigest !== null &&
      (typeof op.expectedDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(op.expectedDigest))
    ) {
      throw new Error("invalid_expected_digest");
    }
    let content: string | null = null;
    if (op.contentBase64 !== undefined) {
      if (
        typeof op.contentBase64 !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          op.contentBase64,
        )
      ) {
        throw new Error("invalid_base64");
      }
      const bytes = Buffer.from(op.contentBase64, "base64");
      if (bytes.length > MAX_FILE_BYTES) throw new Error("record_too_large");
      content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    }
    return {
      section,
      path,
      expectedDigest: op.expectedDigest,
      content,
      digest: content === null ? null : digest(content),
    };
  });
  const item = operations[0]!.content;
  const closed = operations[1]!.content;
  const plan = operations[2]!.content;
  const packet = operations[3]!.content;
  if (item !== null && closed !== null) throw new Error("two_primary_records");
  if (item === null && closed === null && (plan !== null || packet !== null))
    throw new Error("orphan_sidecars");
  if (closed !== null && plan !== null) throw new Error("closed_work_plan");
  validatePacket(
    key,
    item ?? closed,
    packet,
    item !== null ? "items" : "closed",
  );
  const fingerprint = digest(JSON.stringify({ key, operations }));
  return { key, deliveryId: value.deliveryId, operations, fingerprint };
}
function validatePacket(
  key: string,
  primary: string | null,
  packet: string | null,
  section: Section,
) {
  if (primary === null) return;
  const header =
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(primary)?.[1] ?? "";
  const fields = new Map<string, string>();
  for (const line of header.split(/\r?\n/)) {
    const m = /^([a-z][a-z0-9_]*):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    if (fields.has(m[1]!)) throw new Error("duplicate_header");
    fields.set(m[1]!, m[2]!.replace(/^(["'])(.*)\1$/, "$2"));
  }
  const [slug, number] = key.split("/");
  const repository = slug!.replace("dinkuskit-", "dinkuskit/");
  if (
    (fields.has("number") && fields.get("number") !== number) ||
    (fields.has("repo") && fields.get("repo") !== repository) ||
    (fields.has("repository") && fields.get("repository") !== repository)
  ) {
    throw new Error("primary_identity_mismatch");
  }
  const hash = fields.get("decision_packet_sha256");
  const pointer = fields.get("decision_packet_path");
  if (
    (hash === undefined && pointer === undefined) ||
    (hash === "none" && pointer === "none")
  ) {
    if (packet !== null) throw new Error("unreferenced_packet");
    return;
  }
  if (
    packet === null ||
    pointer !== recordPath(key, "decision-packets") ||
    hash !== digest(packet)
  )
    throw new Error("packet_reference_mismatch");
  const p = object(JSON.parse(packet));
  const subject = object(p.subject);
  const source = object(p.source);
  if (
    p.version !== 1 ||
    subject.repo !== slug!.replace("dinkuskit-", "dinkuskit/") ||
    subject.number !== Number(number) ||
    source.reportPath !== recordPath(key, section)
  )
    throw new Error("packet_identity_mismatch");
}
