# Canonical state preparation proof

Claim: the service persists an exact PR's four-path review tuple atomically,
returns durable idempotent receipts, and interoperates with the existing
ClawSweeper publisher without Git record writes.

Surface: built Worker running under workerd/Miniflare with SQLite-backed
Durable Objects. Fixtures contain no real reviews or credentials.

`cd service && npm run check` passed type generation, TypeScript checking,
deployment dry run, and seven runtime test groups. These cover all five
repositories, signatures, allowlist and subject mismatch, path/structure
validation, concurrent compare-and-swap, idempotent retries, open/closed moves,
tombstones, chunked Unicode content, restart persistence, and bounded payloads.

The actual `dist/repair/publish-main.js` from engine
`0bc99d1eb62737fbeed0c7d5cd4261bb20e16b7d` executed
`service/test/native-publisher-proof.mjs` against the local Worker over a
loopback-only SSH tunnel. Each priority repository passed native publication,
retry and exact content/digest readback. Invalid authentication failed. No Git
fallback call occurred. See `native-publisher.json`.

Reproduce the native integration with `node test/serve-fixture.mjs` after
building, then run `node test/native-publisher-proof.mjs
<absolute-built-publisher-module> <loopback-fixture-url>` on the host with the
pinned publisher. When hosts differ, forward only the fixture loopback port.
The script refuses non-loopback URLs. Stop the task-owned server/tunnel after
proof. `source-hashes.json` binds the production source/configuration tested.

Review dispositions: accepted subject-identity ambiguity was repaired with
primary-header identity checks; wrong-repository content is now rejected.
The restart fixture initially failed because Miniflare 5's compatibility
converter omitted the old persistence option; explicit persistence-root
configuration fixed the harness, and the restart/readback proof passed.
No finding has been deferred to justify a success claim.

Limits: this is controlled behavior proof, not a deployment, secret binding,
Git-to-service migration, Spark lane cutover, live review qualification, or
merge authorization. The current native lane still needs the integration
steps in `docs/canonical-state-service.md`. Git review records were not changed.
