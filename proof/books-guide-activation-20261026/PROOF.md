# Books and Guide canonical enrollment

Owner requested adding both repositories and completing queue activation on 2026-10-26.

Source base: `209cd973b0a858094dcb4bdab627130088bdc749` on `state`.

The configuration adds `dinkuskit/books` and `dinkuskit/dinkus-guide`. It also retains `dinkuskit/live-journeys`, present in authenticated production readiness but absent from the checked-in configuration. No existing subject is removed. No credential or record is changed by this source patch.

Validation: `cd service && npm run check` passed type generation, type checking, Worker dry-run build, and all eight runtime test groups. Output: `check.txt`.

Live deployment and activation evidence pending; this source check is not live proof.
