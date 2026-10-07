# Canonical delivery receipt retention

An exact delayed retry could resurrect a deleted record after its receipt was
pruned. The built-Worker regression advances the clock by 31 days between
publications: create, delete, then retry the original delivery. Before the fix,
the retry is accepted as new. After the fix it is deduplicated and the deleted
tuple remains revision 2 with every section absent.

`before.log` records the expected failure; `after.log` records `npm run check`
with all eight real Worker tests passing. Only synthetic records and signing
fixtures were used. Logs have trailing whitespace trimmed. Source and artifact
hashes are in manifest.json. No deployment or live-record mutation is claimed.

Delivery identities now remain for the tuple lifetime. Receipt storage grows
with accepted deliveries; this prevents unsafe expiry without changing the
upstream digest-based compare-and-swap protocol.
