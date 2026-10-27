Status: BLOCKED — Books receiver cannot read private target (HTTP 404).
Owner: current Codex task.
Source: spark-dgx 26143ca44223298dc38b752187d596e8cffe1fd5; canonical deployment source d5a3f7e.
Completed: canonical allowlist deployment, both queue secrets, exact queue Worker deployment, both clean host fast-forward syncs, both publisher probes, both enable flags, private mapping metadata.
Smoke: books#3 closed unmerged; receiver 40345235633 failed admission; Guide smoke not opened.
Next: fix the owned private-repository admission credential route, then repeat the bounded sequential smoke. No fallback authorized.
