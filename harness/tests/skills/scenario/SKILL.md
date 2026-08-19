---
name: scenario
description: /scenario — author cross-flow E2E scenario YAML/MD on the tests hub.
disable-model-invocation: true
---

# /scenario

**Owner:** Testkit (`--type=tests`)

Author cross-flow scenarios (SC) on the current tests hub. Design rules stay on the docs hub.

Scenarios test business flows across multiple screens (W-*) or components. They are typically based on `flow-*` documentation in the docs SSOT.

## Output Rules

- **Rich Business Descriptions:** When generating YAML scenarios, you MUST provide a detailed `description` (or `story`) field. Do not leave them empty or write sparse 1-liners.
- Explain the **Business Context**: Why does this cross-flow exist? What is the real-world process?
- Outline the **Expected Outcome**: Detail what the end-to-end user journey should achieve.
- Include metadata like `priority`, `status`, `module`, and `tags` if available.
- **Valid YAML Syntax:** Do NOT write raw JavaScript expressions directly into YAML values. If you need a long string, wrap the exact code expression entirely in single quotes (e.g. `value: '"a".repeat(256)'`).

## Target / ID Resolution Rule

- Agent MUST use `docskit_route` or `docskit_get_element` (or glob search under `TESTKIT_DOCS_ROOT`) to locate the relevant `flow-*` documentation for the business process.
- **Strict Requirement:** You may ONLY author a scenario if a corresponding `flow-*` file exists for that module/process in the docs. If there is no `flow-*` file, do not invent a scenario.

## Directory Mirroring Rule (Docs SSOT)

Testkit acts as a reflection of the Docs SSOT. When generating YAML scenarios, you MUST mirror the directory structure found in the `docs` repository, but **strip out** the base `product/` or `product/common/` prefix:
- Scenarios MUST be placed in `scenarios/<relative-path>/`.
- Do NOT include `product/` or `product/common/` in the output path. For example, if the flow is at `product/common/auth/flow-checkout.md`, place the scenario in `scenarios/auth/flow-checkout/SC-*.yaml`.

## Accelerators (optional)

```text
if local ArtifactGraph available: taxonomy/coverage/gap hints from this tests hub
else: local deterministic coverage/search from scoped plan + docs evidence
```

ArtifactGraph on the tests hub uses `--type=common,test` and indexes this repo only. Docs-hub design evidence comes through explicit docs references, never through ArtifactGraph.
