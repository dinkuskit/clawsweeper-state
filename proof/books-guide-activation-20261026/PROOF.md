# Books and Guide canonical enrollment

Owner requested adding both repositories and completing queue activation on 2026-10-26.

Source base: `209cd973b0a858094dcb4bdab627130088bdc749` on `state`.

The configuration adds `dinkuskit/books` and `dinkuskit/dinkus-guide`. It also retains `dinkuskit/live-journeys`, present in authenticated production readiness but absent from the checked-in configuration. No existing subject is removed. No credential or record is changed by this source patch.

Validation: `cd service && npm run check` passed type generation, type checking, Worker dry-run build, and all eight runtime test groups. Output: `check.txt`.

Live deployment and activation evidence pending; this source check is not live proof.

## Activation progress

- Canonical Worker deployed from source `d5a3f7e`, version `d9137068-50a7-4360-b9a3-a2fa2bf10937`; authenticated readiness returned both `dinkuskit-books` and `dinkuskit-dinkus-guide`, retaining all 13 prior subjects.
- Queue Worker deployed from `26143ca44223298dc38b752187d596e8cffe1fd5`; version `4597fade-8fc5-4dae-8d56-ff26f23f50f0`. `GET https://queue.ztoned.com/health` returned `{"ok":true,"mode":"primary"}`.
- Both `/home/smoky/Developer/queue-dispatcher` checkouts were clean and fast-forwarded to that source. Both fixed publisher `--probe` calls returned `ok:true` for App 4731481, installation 156850359. The source registry has exactly 17 DinkusKit targets.
- Both repository queue secrets installed via the exact owner-approved 1Password field, attended desktop mode, fixed target stdin consumers. No values saved or printed. Names/timestamps verified: books 2026-10-26T14:59:49Z; dinkus-guide 2026-10-26T14:59:50Z.
- Both `CLAWSWEEPER_SPARK_ENABLED` variables are `true`, updated 2026-10-26T15:00:53Z.
- Books disposable smoke PR: https://github.com/dinkuskit/books/pull/3 ; exact head `f17502fd0dba2b94c23c10b3a234660f777faa37`; sender run 40345153001. Verdict pending. Guide smoke has not started.

## Smoke blocker — stopped as requested

Books sender [40345153001](https://github.com/dinkuskit/books/actions/runs/40345153001) completed successfully. Spark-2 dispatcher logged `native:40345153001:1 -> clawsweeper_native_pr_spark2 (dinkuskit/books#3)`.

Receiver [40345235633](https://github.com/saari-co/spark-dgx/actions/runs/40345235633) failed during `Admit and deduplicate the exact request`, before review or canonical publication. Bounded diagnostic: `gh: Not Found (HTTP 404)` for `repos/dinkuskit/books`. The operator can read this private repo; the receiver's admission credential cannot. No fallback or credential/permission repair was attempted.

Smoke [books#3](https://github.com/dinkuskit/books/pull/3) closed unmerged. No completed queue item or exact-head verdict is claimed. Guide smoke was not opened. Both enable flags remain true from the authorized activation sequence; this run made no subsequent change to them.

The two dispatch labels were retained only in the operator's private local mapping store, mode 0600; no mappings or secret values are recorded here.

Result: steps 1–6 complete, sequential smoke blocked at first repo admission. Canonical source PR [clawsweeper-state#8](https://github.com/dinkuskit/clawsweeper-state/pull/8) remains unmerged; the owner-authorized deployment used its tested source directly. No merge is claimed.
