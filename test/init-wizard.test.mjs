import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const {
  INSTALL_MANIFEST_PATH,
  TESTKIT_PACKAGE_SCRIPTS,
  ensureGitignoreEntries,
  generatedTargets,
  installAgents,
  installHarness,
  statusHarness,
  uninstallAgents,
} = await import('../dist/index.js')

function tempDir(name) {
  return mkdtempSync(path.join(os.tmpdir(), `testkit-init-${name}-`))
}

function runCli(root, ...args) {
  return spawnSync(
    process.execPath,
    [path.resolve('bin/testkit.mjs'), ...args, '--project-root', root],
    {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        TESTKIT_STATE_DIR: tempDir('state'),
      },
    },
  )
}

test('multi-agent local MCP writers and uninstall preserve shared config', () => {
  const root = tempDir('agents')
  writeFileSync(
    path.join(root, '.claude.json'),
    `${JSON.stringify({ mcpServers: { member: { command: 'member' } } }, null, 2)}\n`,
  )
  const targets = [
    'claude',
    'cursor',
    'codex',
    'opencode',
    'hermes',
    'gemini',
    'antigravity',
    'kiro',
    'kilo',
  ]
  const installed = installAgents({ projectRoot: root, type: 'fe', targets })

  assert.equal(installed.targets.length, targets.length)
  for (const relative of [
    '.claude.json',
    '.claude/settings.json',
    '.cursor/mcp.json',
    '.codex/config.toml',
    'opencode.jsonc',
    '.hermes/config.yaml',
    '.gemini/settings.json',
    '.gemini/config/mcp_config.json',
    '.kiro/settings/mcp.json',
    '.kilocode/mcp.json',
  ]) {
    assert.equal(existsSync(path.join(root, relative)), true, relative)
  }
  assert.ok(JSON.parse(readFileSync(path.join(root, '.claude.json'), 'utf8')).mcpServers.member)

  const removed = uninstallAgents({ projectRoot: root, yes: true })
  assert.ok(removed.removed.length >= targets.length)
  const claude = JSON.parse(readFileSync(path.join(root, '.claude.json'), 'utf8'))
  assert.ok(claude.mcpServers.member)
  assert.equal('testkit' in claude.mcpServers, false)
})

test('init is idempotent and deinit removes only Testkit-owned repo changes', () => {
  const root = tempDir('lifecycle')
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      private: true,
      scripts: { member: 'node member.mjs' },
      dependencies: { member: '1.0.0' },
    }, null, 2)}\n`,
  )
  writeFileSync(path.join(root, '.gitignore'), 'member-cache/\n')

  const first = runCli(root, 'init', '--target=cursor', '--type=tests', '--yes')
  assert.equal(first.status, 0, first.stderr)
  const packageAfterFirst = readFileSync(path.join(root, 'package.json'), 'utf8')
  const ignoreAfterFirst = readFileSync(path.join(root, '.gitignore'), 'utf8')
  const packageJson = JSON.parse(packageAfterFirst)
  assert.equal(packageJson.scripts.member, 'node member.mjs')
  assert.equal(packageJson.dependencies.member, '1.0.0')
  for (const [name, command] of Object.entries(TESTKIT_PACKAGE_SCRIPTS.tests)) {
    assert.equal(packageJson.scripts[name], command)
  }
  assert.match(ignoreAfterFirst, /^member-cache\/$/m)
  assert.match(ignoreAfterFirst, /^\.cursor\/$/m)
  assert.match(ignoreAfterFirst, /^\.testkit\/$/m)
  assert.equal(existsSync(path.join(root, 'scripts', 'cases')), false)

  const manifest = JSON.parse(
    readFileSync(path.join(root, INSTALL_MANIFEST_PATH), 'utf8'),
  )
  assert.deepEqual(manifest.managed.packageScripts, TESTKIT_PACKAGE_SCRIPTS.tests)
  assert.deepEqual(manifest.managed.gitignoreLines, [
    '.cursor/',
    '.agents/',
    '.codex/',
    '.claude/',
    '.hermes/',
    '.opencode/',
    '.kiro/',
    '.kilocode/',
    '.testkit/',
    '.docskit/',
  ])

  const second = runCli(root, 'init', '--target=cursor', '--type=tests', '--yes')
  assert.equal(second.status, 0, second.stderr)
  assert.equal(readFileSync(path.join(root, 'package.json'), 'utf8'), packageAfterFirst)
  assert.equal(readFileSync(path.join(root, '.gitignore'), 'utf8'), ignoreAfterFirst)

  const mcpFile = path.join(root, '.cursor', 'mcp.json')
  const mcp = JSON.parse(readFileSync(mcpFile, 'utf8'))
  mcp.mcpServers.artifactgraph = { command: 'artifactgraph' }
  writeFileSync(mcpFile, `${JSON.stringify(mcp, null, 2)}\n`)
  const deinit = runCli(root, 'deinit', '--yes')
  assert.equal(deinit.status, 0, deinit.stderr)

  const packageAfterDeinit = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.deepEqual(packageAfterDeinit.scripts, { member: 'node member.mjs' })
  assert.equal(packageAfterDeinit.dependencies.member, '1.0.0')
  const ignoreAfterDeinit = readFileSync(path.join(root, '.gitignore'), 'utf8')
  assert.match(ignoreAfterDeinit, /^member-cache\/$/m)
  assert.match(ignoreAfterDeinit, /^\.cursor\/$/m)
  assert.match(ignoreAfterDeinit, /^\.testkit\/$/m)
  assert.doesNotMatch(ignoreAfterDeinit, /testkit managed/)
  assert.ok(JSON.parse(readFileSync(mcpFile, 'utf8')).mcpServers.artifactgraph)
  assert.equal(existsSync(path.join(root, INSTALL_MANIFEST_PATH)), false)
})

test('package script conflicts are preserved and never claimed by Testkit', () => {
  const root = tempDir('conflict')
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ scripts: { 'cases:render': 'member-render' } }, null, 2)}\n`,
  )

  const init = runCli(root, 'init', '--target=none', '--type=tests', '--yes')
  assert.equal(init.status, 0, init.stderr)
  assert.match(init.stdout, /conflict: .*package\.json#scripts\.cases:render/)
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(packageJson.scripts['cases:render'], 'member-render')
  const manifest = JSON.parse(readFileSync(path.join(root, INSTALL_MANIFEST_PATH), 'utf8'))
  assert.equal('cases:render' in manifest.managed.packageScripts, false)

  const deinit = runCli(root, 'deinit', '--yes')
  assert.equal(deinit.status, 0, deinit.stderr)
  assert.equal(
    JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts['cases:render'],
    'member-render',
  )
})

test('gitignore contract preserves CRLF and recognizes root-anchored equivalents', () => {
  const root = tempDir('gitignore-contract')
  const file = path.join(root, '.gitignore')
  writeFileSync(file, 'member-cache/\r\n/.cursor/\r\n')

  const first = ensureGitignoreEntries(root, ['.cursor/', '.testkit/'])
  assert.equal(first.changed, true)
  assert.equal(
    readFileSync(file, 'utf8'),
    'member-cache/\r\n/.cursor/\r\n.testkit/\r\n',
  )
  const second = ensureGitignoreEntries(root, ['.cursor/', '.testkit/'])
  assert.equal(second.changed, false)
  assert.equal(readFileSync(file, 'utf8').includes('\n.cursor/\n'), false)
})

test('generated targets contain only selected actual local agent paths', () => {
  const root = tempDir('generated-targets')
  const targets = generatedTargets({
    projectRoot: root,
    agentPaths: [
      path.join(root, '.cursor', 'mcp.json'),
      path.join(root, '.codex', 'config.toml'),
      path.join(root, '.gemini', 'settings.json'),
      path.join(root, '..', 'global-agent.json'),
    ],
  })
  assert.deepEqual(targets, [
    '.cursor/',
    '.agents/',
    '.codex/',
    '.claude/',
    '.hermes/',
    '.opencode/',
    '.kiro/',
    '.kilocode/',
    '.testkit/',
    '.docskit/',
    '.gemini/settings.json',
  ])
  assert.equal(targets.some((entry) => entry.includes('claude')), true)
  assert.equal(targets.some((entry) => entry.includes('opencode')), true)
})

test('gitignore contract migrates the legacy broad Testkit block', () => {
  const root = tempDir('gitignore-migration')
  const file = path.join(root, '.gitignore')
  writeFileSync(
    file,
    'member/\n\n# testkit managed start\n.cursor/\n.claude/\n.codex/\n# testkit managed end\n',
  )
  ensureGitignoreEntries(root, ['.cursor/', '.testkit/'])
  const content = readFileSync(file, 'utf8')
  assert.match(content, /^member\/$/m)
  assert.match(content, /^\.cursor\/$/m)
  assert.match(content, /^\.testkit\/$/m)
  assert.doesNotMatch(content, /testkit managed|\.claude\/|\.codex\//)
})

test('multi-agent init records exact targets and status detects missing equivalents', () => {
  const root = tempDir('multi-agent-ignore')
  const init = runCli(root, 'init', '--target=codex,gemini', '--type=fe', '--yes')
  assert.equal(init.status, 0, init.stderr)
  const manifest = JSON.parse(readFileSync(path.join(root, INSTALL_MANIFEST_PATH), 'utf8'))
  assert.deepEqual(manifest.managed.gitignoreLines, [
    '.cursor/',
    '.agents/',
    '.codex/',
    '.claude/',
    '.hermes/',
    '.opencode/',
    '.kiro/',
    '.kilocode/',
    '.testkit/',
    '.docskit/',
    '.gemini/settings.json',
  ])
  assert.equal(manifest.managed.gitignoreLines.includes('.claude.json'), false)

  const ignoreFile = path.join(root, '.gitignore')
  writeFileSync(
    ignoreFile,
    readFileSync(ignoreFile, 'utf8').replace('.gemini/settings.json\n', ''),
  )
  assert.ok(statusHarness({ projectRoot: root }).missing.includes('.gitignore#.gemini/settings.json'))
})

test('deinit keeps shared Cursor ignore and another toolkit asset', () => {
  const root = tempDir('shared-cursor')
  const shared = path.join(root, '.cursor', 'shared-toolkit.json')
  writeFileSync(path.join(root, '.gitignore'), '/.cursor/\n')
  const init = runCli(root, 'init', '--target=cursor', '--type=fe', '--yes')
  assert.equal(init.status, 0, init.stderr)
  writeFileSync(shared, '{"owner":"other-toolkit"}\n')

  const deinit = runCli(root, 'deinit', '--yes')
  assert.equal(deinit.status, 0, deinit.stderr)
  assert.equal(readFileSync(path.join(root, '.gitignore'), 'utf8').includes('/.cursor/'), true)
  assert.equal(readFileSync(shared, 'utf8'), '{"owner":"other-toolkit"}\n')
})

test('both lanes install per-repo cross-index routing rules', () => {
  for (const type of ['tests', 'fe']) {
    const root = tempDir(`routing-${type}`)
    installHarness({ projectRoot: root, type })
    const rule = readFileSync(
      path.join(root, '.cursor', 'rules', 'cross-repo-index-routing.mdc'),
      'utf8',
    )
    assert.match(rule, /architecture IDs and Functions\/W-\* paths belong to Docskit/i)
    assert.match(rule, /codegraph-<repo-key>/)
    assert.match(rule, /platform-repos\.local\.json/)
    assert.match(rule, /cd <root> && codegraph init/)
    assert.match(rule, /Never initialize or scan a workspace parent/)
    assert.match(rule, /ArtifactGraph remains local/)
  }
})

test('Cursor init delegates filtered CodeGraph auto-wire to Platform DNA', () => {
  const root = tempDir('platform-dna-wire')
  mkdirSync(path.join(root, '.platform-dna'), { recursive: true })
  writeFileSync(path.join(root, '.platform-dna', 'install-manifest.json'), '{}\n')
  const fakeCli = path.join(tempDir('platform-dna-cli'), 'platform-dna.mjs')
  const log = path.join(root, 'wire-args.json')
  writeFileSync(
    fakeCli,
    '#!/usr/bin/env node\n'
      + 'import { writeFileSync } from "node:fs";\n'
      + 'writeFileSync(process.env.TESTKIT_DNA_LOG, JSON.stringify(process.argv.slice(2)));\n',
  )
  chmodSync(fakeCli, 0o755)
  const previousCommand = process.env.PLATFORM_DNA_COMMAND
  const previousLog = process.env.TESTKIT_DNA_LOG
  process.env.PLATFORM_DNA_COMMAND = fakeCli
  process.env.TESTKIT_DNA_LOG = log
  try {
    const init = runCli(
      root,
      'init',
      '--target=cursor',
      '--type=fe',
      '--codegraph-repos=api,portal',
      '--yes',
    )
    assert.equal(init.status, 0, init.stderr)
    assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')), [
      'codegraph:wire',
      '--project-root',
      root,
      '--yes',
      '--codegraph-repos=api,portal',
    ])
  } finally {
    if (previousCommand === undefined) delete process.env.PLATFORM_DNA_COMMAND
    else process.env.PLATFORM_DNA_COMMAND = previousCommand
    if (previousLog === undefined) delete process.env.TESTKIT_DNA_LOG
    else process.env.TESTKIT_DNA_LOG = previousLog
  }
})

test('CodeGraph delegation skips safely without Platform DNA init', () => {
  const root = tempDir('platform-dna-skip')
  const init = runCli(root, 'init', '--target=cursor', '--type=fe', '--yes')
  assert.equal(init.status, 0, init.stderr)
  assert.match(init.stdout, /codegraph: skipped — run `platform-dna init`/)
})

test('managed package aliases keep CLI flags out of engine arguments', () => {
  const root = tempDir('aliases')
  cpSync('test/fixtures/cases', root, { recursive: true })
  const result = spawnSync(
    process.execPath,
    [path.resolve('bin/testkit.mjs'), 'cases:render', '--project-root=.', '--'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /cases:render: OK \(2 file\(s\)\)/)
})

test('testcase coverage condition declares its array type for AJV strict mode', () => {
  const schema = JSON.parse(readFileSync('schemas/testcase.schema.json', 'utf8'))
  assert.equal(schema.if.properties.coverage.type, 'array')
})
