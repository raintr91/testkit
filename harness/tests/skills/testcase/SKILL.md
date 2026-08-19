---
name: testcase
description: /testcase — author E2E plan YAML/MD on the tests hub (not Playwright).
disable-model-invocation: true
---

# /testcase

**Owner:** Testkit (`--type=tests`)

Author TC/suites on the current tests hub. Design rules stay on the docs hub.
Playwright generation is FE `/test`.

Route cross-repo evidence by owner: Functions/W-* through Docskit, plan/docs
through `TESTKIT_TESTS_ROOT` / `TESTKIT_DOCS_ROOT`, and symbols for repo X
through its Platform DNA-wired `codegraph-<repo-key>` server. Never query one
workspace-wide graph or ask the member to hand-edit MCP config.

```bash
testkit cases:render -- …
testkit cases:check -- …
```

## Output Rules

- **Rich Business Descriptions:** When generating YAML testcases, you MUST provide a detailed `description` (or `story`) field. Do not leave them empty or write sparse 1-liners.
- Explain the **Business Context**: Why does this case exist? What is the real-world scenario?
- Outline the **Expected Outcome**: Detail what should happen from the user's perspective, not just the code execution.
- Include metadata like `priority`, `status`, `module`, and `tags` if available to make the final generated Markdown robust and human-friendly.
- **Valid YAML Syntax:** Do NOT write raw JavaScript expressions (like `"a".repeat(256)`) directly into YAML values. YAML is not JS. If you need a long string for test data, generate the actual long string, or wrap the exact code expression entirely in single quotes (e.g. `value: '"a".repeat(256)'`) so the YAML parser does not crash.
- **Concise Naming Convention:** The `id` must be short (e.g., `TC-AUTH-01`). The `title` MUST be extremely short and concise (limit 15-20 characters, e.g., `Valid Login`, `Empty Email`, `SQLi Check`). This ensures the Vitepress left menu remains neat and readable. Put all long explanations into the `description` field, not the `title` or `id`.

## Target / ID Resolution Rule

- User prompt MAY specify a screen ID, module ID, or short slug (e.g. `W-AD-AUTH-001`, `CMP-ADM-000`, `login`).
- Agent MUST use `docskit_route` or `docskit_get_element` (or glob search under `TESTKIT_DOCS_ROOT` / `product/surfaces/...`) to resolve target paths.
- Do NOT demand full surface/module filesystem paths from the user if an ID or short slug is given.

## Directory Mirroring Rule (Docs SSOT)

Testkit acts as a reflection of the Docs SSOT. When generating YAML test plans, you MUST mirror the directory structure found in the `docs` repository, but **strip out** the base `product/surfaces` or `product/common` prefix:
- **Cases:** Test cases for specific screens (`W-*`) or components (`CMP-*`) MUST be placed in `cases/<relative-path>/`. 
  - For example, if a screen is documented at `product/surfaces/admin/auth/W-AD-AUTH-001.md`, the test cases go into `cases/admin/auth/W-AD-AUTH-001/TC-*.yaml`. Do NOT include `product/surfaces/` in the output path.
- Always create the YAML files exactly in the mapped path. Do NOT output a flat structure.

## Accelerators (optional)

```text
if local ArtifactGraph available: taxonomy/coverage/gap hints from this tests hub
else: local deterministic coverage/search from scoped plan + docs evidence
```

ArtifactGraph on the tests hub uses `--type=common,test` (installs the testcase
taxonomy) and indexes this repo only. Docs-hub design evidence comes through
explicit docs references, never through ArtifactGraph.

At run start, assign one stable `runId`. If ArtifactGraph is missing, complete
the local fallback, count successful file reads and exact raw bytes read into
context, then emit exactly one `testkit.missing-optional` JSON event for the
`runId` + `artifactgraph` pair. Deduplicate retries. Use
`.cursor/schemas/testkit/missing-optional-event.schema.json`; report only actual
`fileReads` and `contextBytes`, never estimated token or savings claims.
