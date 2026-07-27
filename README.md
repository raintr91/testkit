# Testkit

Independent MCP/harness for:

- `--type=tests`: `/testcase` `/grill-testcase` + `cases:render|check|coverage`
- `--type=fe`: `/test` `/grill-test` + Playwright `testcase:gen*`

## `/testcase` vs `/test` Contract

- **`/testcase` (tests hub)**: Focused on designing, authoring, and managing test plans (`TC-*.yaml` and `SC-*.md`). Rules and acceptance criteria are sourced from the docs hub. No automation code lives here.
- **`/test` (FE project)**: Focused on generating and maintaining executable Playwright automation (`tests/e2e/`). Consumes plans from the tests hub as read-only SSOT. Test plans are never authored here.

Installers default to immutable release tag `v0.3.0` and enforce the committed
lockfile (`pnpm --frozen-lockfile` or `npm ci`). Set `TESTKIT_REF` /
PowerShell `-Ref` only for an explicit alternate release.

```bash
testkit init               # wizard: agents → tests|fe → local MCP + harness
testkit status
testkit prune             # dry-run; changes nothing
testkit prune --yes       # delete only unmodified stale managed files
testkit deinit            # preview current repo harness + local MCP removal
testkit uninstall         # preview global removal: all repos + MCP + CLI
```

For CI/non-interactive setup, keep the explicit flags:

```bash
testkit init --target=cursor --type=tests --yes
testkit init --target=cursor,claude --type=fe \
  --tests-root=/path/to/tests-hub --docs-root=/path/to/docs-hub --yes
```

`init` always writes project-local agent configuration under the current repo
(or `--project-root`). Supported targets are Claude Code, Cursor, Codex,
opencode, Hermes, Gemini, Antigravity, Kiro, and Kilo.
When Cursor is selected and Platform DNA is initialized in the destination,
Testkit delegates cross-repo CodeGraph wiring to the idempotent
`platform-dna codegraph:wire` command. Use `--codegraph-repos=key,…` to filter
or `--no-codegraph` to skip; Testkit never reads project maps or owns those MCP
servers itself.

Switching between `tests` and `fe` keeps targets from the previous profile in
`.testkit/install-manifest.json` as stale. `status` reports compatible,
healthy, missing, modified, and stale state. `prune` only considers paths
recorded in that manifest and always preserves locally modified stale files.
The Testkit-owned optional-event schema is shared by both profiles at
`.cursor/schemas/testkit/missing-optional-event.schema.json`, so profile
switches keep it current rather than marking it stale.
See [Managed harness lifecycle](docs/LIFECYCLE.md).

`init` records each destination in the Testkit install ledger at
`$XDG_STATE_HOME/testkit/installs.json` (or
`~/.local/state/testkit/installs.json`). This lets `testkit uninstall` run from
any directory and remove every tracked harness, all local agent MCP wiring,
legacy global Cursor MCP wiring, and the CLI. Both removal commands preview and prompt
in a TTY, and otherwise remain dry-run unless `--yes` is passed. For installs
created before the ledger existed, use:

```bash
testkit uninstall --discover ~/workspace --yes
```

Uninstall deletes only files whose hashes still match the compatible install
manifest. Modified files are preserved and reported. Shared MCP configuration
is unmerged by deleting only Testkit-owned entries; other entries—including
ArtifactGraph—are retained. ArtifactGraph-owned assets are never removed.

The `tests` lane also merges `cases:render`, `check:plans`, and
`check:coverage` aliases into `package.json`. Local generated configuration is
merged into `.gitignore` from the exact harness/state and selected-agent paths
written by that init. Equivalent root-anchored patterns are reused. The
manifest records those entries for `status`; `deinit` retains ignore entries
because paths such as `.cursor/` may still be used by another toolkit. Package
scripts are removed only while they still match Testkit's installed values.

Configure non-local hubs explicitly with `TESTKIT_TESTS_ROOT` and
`TESTKIT_DOCS_ROOT` (or the matching CLI options).

`testcase:gen*` preflights every generated output (dry-run included) and only
writes regular files lexically beneath `<projectRoot>/tests/e2e` — absolute
paths, `..` traversal, sibling prefixes, and symlinked path components are
rejected before anything is written, and a rejected batch writes nothing. See
[engines/testcase/runners](engines/testcase/runners/README.md).

ArtifactGraph is optional for coverage/gap acceleration only, and local-only:
on the tests hub install it with `--type=common,test`; it never follows
`TESTKIT_DOCS_ROOT` / `TESTKIT_TESTS_ROOT` (cross-repo evidence flows through
the Testkit pointers). Missing ArtifactGraph always continues through
deterministic local coverage/search and uses the
[missing-optional event contract](docs/OPTIONAL-ACCELERATORS.md).
