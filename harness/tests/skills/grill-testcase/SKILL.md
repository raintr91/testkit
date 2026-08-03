---
name: grill-testcase
description: /grill-testcase — audit E2E plan YAML/MD on the tests hub.
disable-model-invocation: true
---

# /grill-testcase

**Owner:** Testkit (`--type=tests`)

Audit plans only. Spec holes hand off to docs-hub `/update-spec` (Docskit), never invent acceptance.

Route Functions/W-* evidence through Docskit and symbol/call-graph evidence
for repo X through its Platform DNA-wired `codegraph-<repo-key>` server. Use
`TESTKIT_DOCS_ROOT` / `TESTKIT_TESTS_ROOT` for pointer evidence; never build or
query a workspace-parent graph.

## Target / ID Resolution Rule

- User prompt MAY specify a screen ID, module ID, or short slug (e.g. `W-AD-AUTH-001`, `CMP-ADM-000`, `login`).
- Agent MUST use `docskit_route` or `docskit_get_element` (or glob search under `TESTKIT_DOCS_ROOT` / `product/surfaces/...`) to resolve target paths.
- Do NOT demand full surface/module filesystem paths from the user if an ID or short slug is given.

## Accelerators (optional)

```text
if local ArtifactGraph available: taxonomy/coverage/gap slice from this tests hub
else: local deterministic coverage/search over targeted plan/docs evidence
```

ArtifactGraph indexes this tests hub only; spec-hole handoffs go to docs-hub
`/update-spec` (Docskit), not through ArtifactGraph.

Use one stable `runId` per run. When ArtifactGraph is missing, finish the local
fallback before emitting exactly one `testkit.missing-optional` event for that
`runId` + `artifactgraph`; retries must not emit again. Conform to
`.cursor/schemas/testkit/missing-optional-event.schema.json` and include only
actual successful `fileReads` and exact raw `contextBytes`, never estimates.
