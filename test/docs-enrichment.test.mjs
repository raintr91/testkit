import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { readTestcaseFile } from '../engines/testcase/runners/lib/read-testcase.mjs'
import { preferGenSpec } from '../engines/testcase/runners/lib/resolve-hub-id.mjs'

const repoRoot = path.resolve('.')
const fixture = path.join(repoRoot, 'test', 'fixtures', 'TC-PORTABLE-LOGIN.yaml')

test('bundle-only docs input warns and continues without enrichment', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'testkit-bundle-only-project-'))
  const docsRoot = mkdtempSync(path.join(os.tmpdir(), 'testkit-bundle-only-docs-'))
  const codeDir = path.join(docsRoot, 'product', 'surfaces', 'admin', 'modules', 'CMP-01', 'auth', 'code', 'W-AUTH-001')
  mkdirSync(path.join(docsRoot, 'registries'), { recursive: true })
  mkdirSync(codeDir, { recursive: true })
  writeFileSync(
    path.join(docsRoot, 'registries', 'docs-index.json'),
    `${JSON.stringify({ codeIds: { 'W-AUTH-001': 'product/surfaces/admin/modules/CMP-01/auth/code/W-AUTH-001' } }, null, 2)}\n`,
  )
  writeFileSync(path.join(codeDir, 'auth.bundle.yaml'), 'id: W-AUTH-001\n')


  assert.equal(preferGenSpec(codeDir), null)

  const previousDocsRoot = process.env.TESTKIT_DOCS_ROOT
  const warnings = []
  const originalWarn = console.warn
  process.env.TESTKIT_DOCS_ROOT = docsRoot
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    const result = await readTestcaseFile(fixture, { repoRoot: projectRoot })
    assert.equal(result.spec, null)
    assert.equal(result.specFile, null)
    assert.equal(result.testcase.id, 'TC-PORTABLE-LOGIN')
  } finally {
    console.warn = originalWarn
    if (previousDocsRoot === undefined) delete process.env.TESTKIT_DOCS_ROOT
    else process.env.TESTKIT_DOCS_ROOT = previousDocsRoot
  }

  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /optional docs enrichment unavailable/)
  assert.match(warnings[0], /No spec\.yaml or ir\/spec\.yaml under product\/surfaces\/admin\/modules\/CMP-01\/auth\/code\/W-AUTH-001/)
  assert.match(warnings[0], /generation continues/)
})
