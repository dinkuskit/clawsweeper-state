// Local-only synthetic fixture. Never use this signing key for a deployment.
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const mf = new Miniflare({
  ...convertV4MiniflareOptions({
    name: "canonical-fixture",
    modules: true,
    scriptPath: "dist/index.js",
    compatibilityDate: "2026-09-30",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { RECORDS: { className: "RecordTuple", useSQLite: true } },
    bindings: {
      CLAWSWEEPER_WEBHOOK_SECRET: "local-fixture-only-not-a-credential",
      ALLOWED_REPOSITORIES:
        "dinkuskit/commerce,dinkuskit/template-store,dinkuskit/inventory,dinkuskit/payments,dinkuskit/dinkuskit",
    },
  }),
  host: "127.0.0.1",
  port: 0,
});
console.log(String(await mf.ready));
process.on("SIGINT", async () => {
  await mf.dispose();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await mf.dispose();
  process.exit(0);
});
