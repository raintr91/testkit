import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  installHarness,
  MissingOptionalEventEmitter,
  pruneHarness,
  ReadMeasurement,
  SKILLS_BY_TYPE,
  statusHarness,
  validateMissingOptionalEvent,
} from '../dist/index.js'
import { installCursorMcp } from '../dist/install/cursor-mcp.js'

test('tests profile syncs plan skills only', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'testkit-tests-'))
  installHarness({ projectRoot: root, type: 'tests' })
  for (const skill of SKILLS_BY_TYPE.tests) {
    assert.ok(existsSync(path.join(root, '.cursor', 'skills', skill, 'SKILL.md')))
  }
  assert.equal(existsSync(path.join(root, '.cursor', 'skills', 'test', 'SKILL.md')), false)
  assert.ok(
    existsSync(
      path.join(root, '.cursor', 'schemas', 'testkit', 'missing-optional-event.schema.json'),
    ),
  )
  assert.ok(
    existsSync(path.join(root, '.cursor', 'rules', 'testkit-optional-accelerators.mdc')),
  )
  // Testkit never writes Platform DNA-owned project maps.
  assert.equal(existsSync(path.join(root, 'platform-repos.json')), false)
})

test('fe profile syncs playwright skills only and keeps explicit roots', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'testkit-fe-'))
  installHarness({ projectRoot: root, type: 'fe' })
  const mcp = installCursorMcp({
    projectRoot: root,
    type: 'fe',
    testsRoot: '/tmp/tests-hub',
    docsRoot: '/tmp/docs-hub',
  })
  const cfg = JSON.parse(readFileSync(mcp.path, 'utf8'))
  assert.equal(cfg.mcpServers.testkit.env.TESTKIT_TESTS_ROOT, '/tmp/tests-hub')
  assert.equal(cfg.mcpServers.testkit.env.TESTKIT_DOCS_ROOT, '/tmp/docs-hub')
  assert.ok(existsSync(path.join(root, '.cursor', 'skills', 'test', 'SKILL.md')))
  assert.equal(existsSync(path.join(root, '.cursor', 'skills', 'testcase', 'SKILL.md')), false)
  assert.ok(
    existsSync(
      path.join(root, '.cursor', 'schemas', 'testkit', 'missing-optional-event.schema.json'),
    ),
  )
  assert.ok(
    existsSync(path.join(root, '.cursor', 'rules', 'testkit-optional-accelerators.mdc')),
  )
})

test('shared schema stays current across profile switches and remains hash protected', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'testkit-shared-schema-'))
  const schemaRel = '.cursor/schemas/testkit/missing-optional-event.schema.json'
  const schemaPath = path.join(root, schemaRel)

  installHarness({ projectRoot: root, type: 'tests' })
  const installed = readFileSync(schemaPath, 'utf8')
  const switched = installHarness({ projectRoot: root, type: 'fe' })
  assert.ok(switched.unchanged.includes(schemaPath))
  assert.equal(statusHarness({ projectRoot: root }).stale.includes(schemaRel), false)

  writeFileSync(schemaPath, `${installed}\n`)
  const switchedBack = installHarness({ projectRoot: root, type: 'tests' })
  assert.ok(switchedBack.conflicts.includes(schemaPath))
  assert.equal(readFileSync(schemaPath, 'utf8'), `${installed}\n`)
})

test('status reports healthy, missing, modified, stale, and compatibility buckets', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'testkit-status-'))
  installHarness({ projectRoot: root, type: 'tests' })
  installHarness({ projectRoot: root, type: 'fe' })

  const missing = '.cursor/skills/test/SKILL.md'
  const modified = '.cursor/skills/grill-test/SKILL.md'
  rmSync(path.join(root, missing))
  writeFileSync(path.join(root, modified), '# local edit\n')

  const status = statusHarness({ projectRoot: root })
  assert.equal(status.installed, true)
  assert.equal(status.type, 'fe')
  assert.deepEqual(status.compatibility, { compatible: true, issues: [] })
  assert.ok(status.missing.includes(missing))
  assert.ok(status.modified.includes(modified))
  assert.ok(status.stale.includes('.cursor/skills/testcase/SKILL.md'))
  assert.ok(status.stale.includes('.cursor/skills/grill-testcase/SKILL.md'))

  const manifest = JSON.parse(
    readFileSync(path.join(root, '.testkit', 'install-manifest.json'), 'utf8'),
  )
  assert.equal(manifest.files['.cursor/skills/testcase/SKILL.md'].stale, true)
  assert.equal(manifest.files['.cursor/skills/grill-testcase/SKILL.md'].stale, true)
  assert.equal(manifest.files[missing].stale, undefined)
})

test('prune is dry-run by default and --yes preserves modified stale files', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'testkit-prune-'))
  installHarness({ projectRoot: root, type: 'tests' })
  const unmodified = '.cursor/skills/testcase/SKILL.md'
  const modified = '.cursor/skills/grill-testcase/SKILL.md'
  const unmanaged = '.cursor/skills/testcase/LOCAL.md'
  installHarness({ projectRoot: root, type: 'fe' })
  writeFileSync(path.join(root, modified), '# keep my local version\n')
  writeFileSync(path.join(root, unmanaged), '# not managed by Testkit\n', { flush: true })

  const dryRun = pruneHarness({ projectRoot: root })
  assert.equal(dryRun.dryRun, true)
  assert.ok(dryRun.candidates.includes(unmodified))
  assert.ok(dryRun.preservedModified.includes(modified))
  assert.equal(existsSync(path.join(root, unmodified)), true)
  assert.equal(existsSync(path.join(root, modified)), true)

  const applied = pruneHarness({ projectRoot: root, yes: true })
  assert.equal(applied.dryRun, false)
  assert.ok(applied.deleted.includes(unmodified))
  assert.ok(applied.preservedModified.includes(modified))
  assert.equal(existsSync(path.join(root, unmodified)), false)
  assert.equal(readFileSync(path.join(root, modified), 'utf8'), '# keep my local version\n')
  assert.equal(readFileSync(path.join(root, unmanaged), 'utf8'), '# not managed by Testkit\n')

  const manifest = JSON.parse(
    readFileSync(path.join(root, '.testkit', 'install-manifest.json'), 'utf8'),
  )
  assert.equal(manifest.files[unmodified], undefined)
  assert.equal(manifest.files[modified].stale, true)
})

test('incompatible manifests are reported and block prune writes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'testkit-incompatible-'))
  installHarness({ projectRoot: root, type: 'tests' })
  installHarness({ projectRoot: root, type: 'fe' })
  const manifestPath = path.join(root, '.testkit', 'install-manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.toolApi = 2
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const stale = path.join(root, '.cursor', 'skills', 'testcase', 'SKILL.md')

  const status = statusHarness({ projectRoot: root })
  assert.equal(status.compatibility.compatible, false)
  assert.match(status.compatibility.issues.join('\n'), /unsupported toolApi: 2/)
  assert.throws(
    () => pruneHarness({ projectRoot: root, yes: true }),
    /Incompatible Testkit install manifest/,
  )
  assert.equal(existsSync(stale), true)
})

test('CLI status and prune expose lifecycle behavior', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'testkit-cli-'))
  installHarness({ projectRoot: root, type: 'tests' })
  installHarness({ projectRoot: root, type: 'fe' })

  const status = spawnSync(
    process.execPath,
    ['bin/testkit.mjs', 'status', '--project-root', root],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  )
  assert.equal(status.status, 1)
  assert.match(status.stdout, /compatibility: compatible/)
  assert.match(status.stdout, /stale: [1-9]\d*/)

  const prune = spawnSync(
    process.execPath,
    ['bin/testkit.mjs', 'prune', '--project-root', root],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  )
  assert.equal(prune.status, 0)
  assert.match(prune.stdout, /mode: dry-run/)
  assert.match(prune.stdout, /Run again with --yes/)
  assert.equal(existsSync(path.join(root, '.cursor', 'skills', 'testcase', 'SKILL.md')), true)

  const applied = spawnSync(
    process.execPath,
    ['bin/testkit.mjs', 'prune', '--project-root', root, '--yes'],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  )
  assert.equal(applied.status, 0)
  assert.match(applied.stdout, /mode: apply/)
  assert.match(applied.stdout, /deleted:/)
  assert.equal(existsSync(path.join(root, '.cursor', 'skills', 'testcase', 'SKILL.md')), false)
})

test('testcase engine uses its package-owned generator path', () => {
  const gen = readFileSync('engines/testcase/runners/generate.mjs', 'utf8')
  assert.match(gen, /TESTKIT_ROOT/)
  assert.doesNotMatch(gen, /\.\.\/\.\.\/codegen\//)
})

test('missing optional event schema and emitter enforce exact deduplicated events', () => {
  const schema = JSON.parse(
    readFileSync('schemas/missing-optional-event.schema.json', 'utf8'),
  )
  assert.equal(schema.additionalProperties, false)
  assert.equal(schema.properties.event.const, 'testkit.missing-optional')
  assert.equal(schema.properties.package.const, '@platform/testkit')
  assert.deepEqual(schema.required, [
    'schemaVersion',
    'event',
    'package',
    'runId',
    'optional',
    'reason',
    'fallback',
    'metrics',
  ])

  const root = mkdtempSync(path.join(os.tmpdir(), 'testkit-metrics-'))
  const evidence = path.join(root, 'evidence.txt')
  writeFileSync(evidence, 'coverage: ✓\n')
  const measurement = new ReadMeasurement()
  measurement.readText(evidence)
  const metrics = measurement.snapshot()
  assert.deepEqual(metrics, {
    fileReads: 1,
    contextBytes: Buffer.byteLength('coverage: ✓\n'),
  })

  const emitter = new MissingOptionalEventEmitter()
  const input = {
    runId: 'testkit-run-1',
    optional: 'artifactgraph',
    reason: 'unavailable',
    fallback: 'local-deterministic-coverage',
    metrics,
  }
  const event = emitter.emit(input)
  assert.deepEqual(event, {
    schemaVersion: '1.0.0',
    event: 'testkit.missing-optional',
    package: '@platform/testkit',
    ...input,
  })
  assert.deepEqual(validateMissingOptionalEvent(event), { ok: true, errors: [] })
  assert.equal(emitter.emit({ ...input, reason: 'invocation-failed' }), null)
  assert.ok(emitter.emit({ ...input, optional: 'another-optional' }))
  assert.throws(
    () => emitter.emit({ ...input, runId: 'invalid-metrics', metrics: { fileReads: 1.5, contextBytes: 1 } }),
    /metrics\.fileReads must be a non-negative integer/,
  )
})

test('installers pin the released tag and enforce lockfiles', () => {
  const shell = readFileSync('install.sh', 'utf8')
  const powershell = readFileSync('install.ps1', 'utf8')
  for (const script of [shell, powershell]) {
    assert.match(script, /TESTKIT_REF/)
    assert.match(script, /pnpm install --frozen-lockfile/)
    assert.match(script, /npm ci/)
    assert.doesNotMatch(script, /(?:REF:-main|Ref = "main")/)
  }
})
