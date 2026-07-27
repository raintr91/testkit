import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { stringify } from 'yaml'

const repoRoot = path.resolve('.')
const checker = path.join(repoRoot, 'engines', 'cases', 'check-plans.mjs')
const canonicalSchema = path.join(repoRoot, 'schemas', 'testcase.schema.json')

function validCase(refs = { component: 'CMP-ORDERS' }) {
  return {
    id: 'TC-ORDERS-CREATE',
    title: 'Create an order',
    coverage: ['happy'],
    refs: {
      capability: 'CAP-ORDERS',
      screen: 'W-ORDER-CREATE',
      scenario: 'SC-CREATE',
      target: 'portal',
      ...refs,
    },
    genType: 'e2e',
    feature: 'orders',
    route: { path: '/orders/create' },
    testIds: { required: ['order-submit'] },
  }
}

function runCheck(t, testcase, { schemaPath } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'testkit-check-plans-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'cases'), { recursive: true })
  writeFileSync(path.join(root, 'cases', 'TC-ORDERS-CREATE.yaml'), stringify(testcase))
  const env = { ...process.env }
  if (schemaPath) env.TESTKIT_TESTCASE_SCHEMA = schemaPath
  return spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8', env })
}

test('check-plans accepts a valid testcase fixture', (t) => {
  const result = runCheck(t, validCase())
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /check:plans OK \(1 case\(s\)\)/)
})

test('check-plans accepts missing refs.capability', (t) => {
  const testcase = validCase()
  delete testcase.refs.capability
  const result = runCheck(t, testcase)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /check:plans OK \(1 case\(s\)\)/)
})

test('check-plans rejects the removed type field', (t) => {
  const result = runCheck(t, { ...validCase(), type: 'e2e' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /cases\/TC-ORDERS-CREATE\.yaml: type: must NOT be valid/)
})

test('check-plans requires a11y for accessibility coverage', (t) => {
  const result = runCheck(t, { ...validCase(), coverage: ['accessibility'] })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /cases\/TC-ORDERS-CREATE\.yaml: a11y required/)
})

test('check-plans accepts either refs.component or refs.feature', (t) => {
  for (const refs of [{ component: 'CMP-ORDERS' }, { feature: 'orders' }]) {
    const result = runCheck(t, validCase(refs))
    assert.equal(result.status, 0, result.stderr)
  }
})

test('check-plans loads required fields from the package schema by default', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'testkit-check-plans-noschema-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'cases'), { recursive: true })
  writeFileSync(path.join(root, 'cases', 'TC-ORDERS-CREATE.yaml'), stringify(validCase()))
  // Destination has no schemas/ — package SSOT must still validate.
  const result = spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /check:plans OK \(1 case\(s\)\)/)
})

test('check-plans honors TESTKIT_TESTCASE_SCHEMA override for schema-driven rules', (t) => {
  const overrideDir = mkdtempSync(path.join(os.tmpdir(), 'testkit-check-plans-schema-'))
  t.after(() => rmSync(overrideDir, { recursive: true, force: true }))
  const schemaPath = path.join(overrideDir, 'testcase.schema.json')
  const schema = JSON.parse(readFileSync(canonicalSchema, 'utf8'))
  schema.required.push('schemaDrivenField')
  writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`)

  const result = runCheck(t, validCase(), { schemaPath })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /cases\/TC-ORDERS-CREATE\.yaml: schemaDrivenField required/)
})
