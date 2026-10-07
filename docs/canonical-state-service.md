# DinkusKit canonical review state

`clawsweeper-state` already contains Git-backed review reports. The service in
`service/` prepares the canonical HTTP record store required by current
ClawSweeper. Existing reports remain untouched. Adding this code does not switch
writers, deploy a Worker, import history, or activate review receivers.

## Contract

The initial allowlist contains `dinkuskit/commerce`, `dinkuskit/template-store`,
`dinkuskit/inventory`, `dinkuskit/payments`, and `dinkuskit/dinkuskit`. Each PR key
has its own SQLite-backed Durable Object. A transaction compares all four
expected content digests, writes all four sections and the delivery receipt,
and increments the tuple revision. Conflicts return the current tuple to the
publisher. Identical delivery retries return the original revision without
rewriting current state. Reusing a delivery ID with different contents fails.

The service implements the pinned publisher's record protocol:

| Endpoint                                             | Purpose                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /internal/state/records/tuples`                | Publish a four-section tuple; `202` accepted/deduped, `409` conflict               |
| `GET /internal/state/records/:slug/:section/:number` | Read content, digest, revision and timestamp; deleted/missing records return `404` |
| `GET /internal/state/tuples/:slug/:number`           | DinkusKit extension: read the complete atomic baseline                             |
| `POST /internal/state/health`                        | Authenticated service/protocol/allowlist readiness                                 |
| `GET /health`                                        | Public liveness only; never publication readiness                                  |

Every internal request uses `x-clawsweeper-exact-review-signature` containing
`sha256=` plus the HMAC-SHA256 of the exact body with
`CLAWSWEEPER_WEBHOOK_SECRET`. GET requests sign the empty body, matching the
publisher's current read contract. Production must use HTTPS. This capability
allows writing all enrolled review records, not calling GitHub, launching
reviews, changing source, or authorizing merges. Its value must be provisioned
through the approved protected host consumer and Cloudflare secret mechanism;
never commit or put it in a command argument.

Tuple sections are `items`, `closed`, `plans`, and `decision-packets`. Every
mutation supplies each exact path once. A missing `contentBase64` deletes that
section. There can be only one primary report and no orphan sidecars or closed
work plan. Packet references must match their content digest and subject.
Each file is limited to 2 MiB; each request to 12 MiB. UTF-8 reports are chunked
into small SQLite values. Receipt retention is 30 days, with bounded pruning
on successful publication. Digest-based compare-and-swap deliberately matches
the upstream contract: it does not impose a monotonic PR-head order or reject
an empty-to-empty digest cycle. The trusted publisher must revalidate the live
PR before publishing, including after a long-running review.

This is an exact-PR record service. It does not implement upstream queues,
background scheduling, commit-review records, whole-repository list/export,
R2 assets, or dashboard orchestration. Those are not prerequisites for this
bounded DinkusKit PR lane. No ClawSweeper code or private reports were copied.
The protocol was inspected at engine commit
`0bc99d1eb62737fbeed0c7d5cd4261bb20e16b7d`; implementation is independent.

## Development

Use Node 24 or later:

```sh
cd service
npm ci --ignore-scripts
npm run check
```

Tests execute the built Worker in workerd/Miniflare and use only synthetic
records and fixture signing keys. `npm run build` is a deployment dry run.
Wrangler generates the binding types; no cloud account is needed for checks.
The fixture server and native-publisher proof in `service/test/` allow the
actual installed publisher to exercise the service over loopback. Those fixture
keys must never be used in a deployment.

## Cutover sequence requiring owner approval

1. Review and merge the service source into this repository's current default
   branch, `state`. Code remains under `service/`; do not change the repository
   default branch or overwrite existing `records/`.
2. Select the owner-approved Cloudflare account and HTTPS route. The prepared
   Worker name is `dinkuskit-canonical-state`; one new `RecordTuple` Durable
   Object class uses the `v1` SQLite migration. The checked-in configuration
   intentionally has no account, public route or production secret.
3. Provision a dedicated signing capability on the Worker and the protected
   Spark consumer. Preserve the existing GitHub App publisher identity. No
   GitHub App permission expansion is needed for this service.
4. Quiesce only the approved DinkusKit writers. Inventory the existing public
   Git reports and classify current records versus stale history. Import only
   reviewed tuples through the service API, preserving bytes/digests; do not
   replay pending records blindly or treat historical Git reports as newly
   qualified reviews. Record accepted receipts and readback before switching.
5. Update the Spark native lane to check authenticated service readiness before
   comment mutation and to hydrate the exact atomic baseline from this service.
   Bind `QUEUE_URL` to the approved HTTPS URL. Keep the signing capability out of
   the model sandbox. Publish only the reviewed PR tuple, not a broad `records/`
   directory that could accidentally delete untouched records. Operational Git
   results remain a separate concern.
6. Qualify the full native route on one unchanged eligible PR per priority repo:
   event pickup, exact tuple admission, review, comment, canonical receipt and
   readback. Re-review the same head and verify retry behavior without duplicate
   live generations. Only then enable the approved default receivers.

Rollback means disabling the affected receiver and preserving all receipts and
records while repairing the binding. Do not resume the obsolete Git record
writer or delete the Durable Object namespace. Cloudflare SQLite point-in-time
recovery supports operational recovery; an export/backup policy beyond that
needs a separate bounded design before broad historical migration.

The service does not project new data into OpenClaw Bay. Bay remains an observer;
no public dashboard or browser mutation capability is introduced.


## Deployed endpoint

The service uses its dedicated `dinkuskit-canonical-state` Workers hostname.
Internal routes require the signing capability; only `/health` is public.
`workers_dev` is enabled and preview URLs remain disabled. The production
allowlist covers all 13 enrolled public DinkusKit repositories. The five
priority repositories lead activation; the two private repositories remain
outside this public state service. The protected Spark client and
Worker secret are provisioned together; credentials are never stored here.
