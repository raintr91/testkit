import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Handlebars from 'handlebars'

import { listFeatureTestcases, readTestcaseFile } from './lib/read-testcase.mjs'
import { buildTestcaseContext } from './lib/plan.mjs'
import { renderTemplate } from './lib/render.mjs'
import { resolveSemanticPlan } from './lib/semantic-plan.mjs'
import { writeOutputs } from './lib/write-files.mjs'
import { resolveHubId, resolveProjectRoot, loadTestsIndex } from './lib/resolve-hub-id.mjs'

const root = path.resolve(process.env.TESTKIT_ROOT || process.cwd())

Handlebars.registerHelper('eq', (a, b) => a === b)
Handlebars.registerHelper('and', (a, b) => a && b)
Handlebars.registerHelper('not', (a) => !a)
Handlebars.registerHelper('or', (a, b) => a || b)
Handlebars.registerHelper('startsWith', (value, prefix) => String(value).startsWith(prefix))
Handlebars.registerHelper('includes', (value, fragment) => String(value).includes(fragment))
Handlebars.registerHelper('json', (value) => JSON.stringify(value, null, 2))

function parseArgs(argv) {
  const options = { dryRun: false, force: false, testcase: null, feature: null, id: null, all: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run' || arg === '--dry') options.dryRun = true
    else if (arg === '--force') options.force = true
    else if (arg === '--all') options.all = true
    else if (arg === '--testcase') options.testcase = argv[++i]
    else if (arg === '--feature') options.feature = argv[++i]
    else if (arg === '--id') options.id = argv[++i]
    else if (!arg.startsWith('-') && !options.testcase && !options.feature && !options.id && !options.all) {
      options.testcase = arg
    }
  }

  if (!options.testcase && !options.feature && !options.id && !options.all) {
    throw new Error(
      'Usage: pnpm testcase:gen --id W-AD-AUTH-001|TC-LOGIN-VALID|smoke|CMP-01|SC-LOGIN\n' +
        '       pnpm testcase:gen --testcase <path> | --feature W-AD-AUTH-001  (screen under tests hub cases/)\n' +
        '       pnpm testcase:gen --all',
    )
  }

  return options
}

async function generateOne(testcasePath, options) {
  const { testcase, spec, testcaseFile, specFile } = await readTestcaseFile(testcasePath, { repoRoot: root })
  const ctx = buildTestcaseContext(testcase, spec, testcaseFile)
  ctx.specFile = specFile

  const semantic = await resolveSemanticPlan(root, testcase)
  ctx.useSemanticFixture = semantic.useSemanticFixture
  ctx.needsConsoleErrors = semantic.needsConsoleErrors
  ctx.semanticCodegenLines = semantic.semanticCodegenLines
  ctx.semanticReady = semantic.semanticReady ?? ctx.semanticReady
  ctx.hasLegacyLayoutOnly = Boolean(ctx.semanticReady) && !semantic.useSemanticFixture
  ctx.warnings.push(...semantic.warnings)

  const pageContent = await renderTemplate('page.ts.hbs', ctx)
  const specContent = await renderTemplate('spec.ts.hbs', ctx)

  const outputs = [
    { relativePath: ctx.outputs.pageObject, content: pageContent },
    { relativePath: ctx.outputs.spec, content: specContent }
  ]

  const { written, skipped } = await writeOutputs(root, outputs, {
    dryRun: options.dryRun,
    force: options.force
  })

  console.log(`testcase-gen: id=${ctx.testcaseId} module=${ctx.module}`)
  console.log(`  testcase: ${testcaseFile}`)
  if (specFile) console.log(`  spec: ${specFile}`)
  if (ctx.warnings.length) {
    for (const warning of ctx.warnings) console.warn(`  warn: ${warning}`)
  }
  for (const item of written) {
    console.log(`  ${options.dryRun ? 'would write' : 'write'}: ${item.relativePath}`)
  }
  for (const item of skipped) {
    console.log(`  skip: ${item.relativePath} (${item.reason})`)
  }

  return { ctx, written, skipped }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.all) {
    const testsRoot = process.env.TESTKIT_TESTS_ROOT
      ? path.resolve(process.env.TESTKIT_TESTS_ROOT)
      : resolveProjectRoot(root, 'tests')
    const index = loadTestsIndex(testsRoot)
    const paths = []
    for (const [id, rel] of Object.entries(index.codeIds || {})) {
      if (id.startsWith('TC-')) {
        const abs = path.resolve(testsRoot, rel)
        paths.push(abs)
      }
    }
    if (!paths.length) {
      throw new Error('No TC-*.yaml testcase files resolved under the tests hub')
    }
    console.log(`testcase-gen: --all → ${paths.length} file(s)`)
    for (const testcasePath of paths) {
      await generateOne(testcasePath, options)
    }
    return
  }

  if (options.id) {
    const resolved = resolveHubId(root, options.id, 'testcase')
    for (const n of resolved.notes) console.warn(`  note: ${n}`)
    if (!resolved.paths.length) throw new Error(`--id ${options.id}: no testcase paths`)
    console.log(`testcase-gen: --id ${options.id} → ${resolved.paths.length} file(s) (${resolved.kind})`)
    for (const testcasePath of resolved.paths) {
      await generateOne(testcasePath, options)
    }
    return
  }

  if (options.feature) {
    const paths = await listFeatureTestcases(root, options.feature)
    if (!paths.length) {
      throw new Error(
        `No TC-*.yaml under tests hub cases/${options.feature}. Prefer: pnpm testcase:gen --id <W-|TC-|suite>`,
      )
    }
    for (const testcasePath of paths) {
      await generateOne(testcasePath, options)
    }
    return
  }

  await generateOne(options.testcase, options)
}

main().catch((error) => {
  console.error(error.message ?? error)
  process.exit(1)
})
