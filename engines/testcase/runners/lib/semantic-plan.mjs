import {
  bundleIdsFromTags,
  loadE2eTestRegistry,
  resolveBundleMatchers,
  skipMatchersFromTags
} from './e2e-registry.mjs'

const SECTION_KEYS = ['level1', 'layout', 'accessibility', 'designToken']

/**
 * @param {string} root
 * @param {Record<string, unknown>} testcase
 */
export async function resolveSemanticPlan(root, testcase) {
  const { registry } = await loadE2eTestRegistry(root)
  const tags = testcase.tags ?? []
  const semantic = testcase.assertions?.semantic ?? {}
  const warnings = []

  const skipMatchers = skipMatchersFromTags(tags, registry)
  const bundleIds = bundleIdsFromTags(tags, registry)
  const bundles = registry.bundles ?? {}
  const matcherMeta = registry.matchers ?? {}

  /** @type {string[]} */
  const ordered = []

  for (const bundleId of bundleIds) {
    ordered.push(...resolveBundleMatchers(bundleId, bundles))
  }

  for (const key of SECTION_KEYS) {
    const list = semantic[key]
    if (Array.isArray(list)) {
      ordered.push(...list.map(String))
    }
  }

  const seen = new Set()
  /** @type {string[]} */
  const matchers = []
  for (const name of ordered) {
    if (skipMatchers.has(name)) continue
    if (seen.has(name)) continue
    const meta = matcherMeta[name]
    if (!meta) {
      warnings.push(`unknown semantic matcher "${name}" — add to registries/e2e-test.registry.json`)
      continue
    }
    if (meta.status === 'planned') {
      warnings.push(`semantic matcher "${name}" is planned — skipped in codegen`)
      continue
    }
    seen.add(name)
    matchers.push(name)
  }

  const semanticReady = semantic.ready ?? null
  const rootTestId = semanticReady?.rootTestId ?? semantic.rootTestId ?? null
  const tableTestId =
    semantic.tableTestId ??
    semanticReady?.waitForTestIds?.find((id) => String(id).includes('table')) ??
    null

  const layoutOptions = semantic.layoutOptions ?? {}
  const skipOverlap = layoutOptions.skipOverlap === true
  const a11y = testcase.a11y && typeof testcase.a11y === 'object' ? testcase.a11y : null

  const matchersNeedingRoot = new Set([
    'toHaveNoTextOverflow',
    'toHaveNoElementOverlap',
    'toHaveValidTableLayout',
    'toMatchShadcnTableToken',
  ])
  if (matchers.some((name) => matchersNeedingRoot.has(name)) && !rootTestId) {
    warnings.push(
      'layout/table semantic matchers require assertions.semantic.ready.rootTestId (or semantic.rootTestId)',
    )
  }

  if (matchers.includes('toHaveValidTableLayout') && !tableTestId) {
    warnings.push('toHaveValidTableLayout requires semantic.tableTestId or waitForTestIds containing "table"')
  }

  const needsConsoleErrors = matchers.some(
    (name) => matcherMeta[name]?.needsConsoleErrors === true
  )
  const useSemanticFixture = matchers.length > 0

  const codegenLines = matchers
    .map((name) => codegenMatcher(name, { rootTestId, tableTestId, skipOverlap, a11y }))
    .filter(Boolean)

  return {
    semanticReady,
    useSemanticFixture,
    needsConsoleErrors,
    semanticCodegenLines: codegenLines,
    semanticMatchers: matchers,
    rootTestId,
    a11y,
    warnings
  }
}

/**
 * @param {string} matcher
 * @param {{
 *   rootTestId: string | null,
 *   tableTestId: string | null,
 *   skipOverlap: boolean,
 *   a11y?: Record<string, unknown> | null
 * }} ctx
 */
function codegenMatcher(matcher, ctx) {
  const { rootTestId, tableTestId, skipOverlap, a11y } = ctx
  const a11yOptsLiteral = formatA11yOpts(a11y, rootTestId)
  const include = rootTestId ? `[data-testid="${rootTestId}"]` : undefined
  const rootLoc = rootTestId ? `page.getByTestId('${rootTestId}')` : 'page.locator("body")'
  const scrollOpts = include ? `{ rootSelector: '${include}' }` : '{}'
  const overflowOpts = `{ allowTruncate: true }`

  switch (matcher) {
    case 'toHaveNoConsoleErrors':
      return 'await expect(page).toHaveNoConsoleErrors(consoleErrors)'
    case 'toHaveNoHorizontalScroll':
      return `await expect(page).toHaveNoHorizontalScroll(${scrollOpts})`
    case 'toHaveNoBrokenImages':
      return 'await expect(page).toHaveNoBrokenImages()'
    case 'toHaveNoTextOverflow':
      return `await expect(${rootLoc}).toHaveNoTextOverflow(${overflowOpts})`
    case 'toHaveNoElementOverlap':
      if (skipOverlap) return null
      return `await expect(${rootLoc}).toHaveNoElementOverlap()`
    case 'toHaveValidTableLayout':
      if (!tableTestId) return null
      return `await expect(page.getByTestId('${tableTestId}')).toHaveValidTableLayout()`
    case 'toHaveNoA11yViolations':
      return `await expect(page).toHaveNoA11yViolations(${a11yOptsLiteral})`
    case 'toHaveValidAccessibleNames':
      return `await expect(page).toHaveValidAccessibleNames(${a11yOptsLiteral})`
    case 'toHaveValidAria':
      return `await expect(page).toHaveValidAria(${a11yOptsLiteral})`
    case 'toHaveAccessibleMedia':
      return `await expect(page).toHaveAccessibleMedia(${a11yOptsLiteral})`
    case 'toHaveReadableContrast':
      return `await expect(page).toHaveReadableContrast(${a11yOptsLiteral})`
    case 'toHaveValidDocumentSemantics':
      return `await expect(page).toHaveValidDocumentSemantics(${a11yOptsLiteral})`
    case 'toMatchShadcnTableToken':
      if (!tableTestId) return null
      return `await expect(page.getByTestId('${tableTestId}')).toMatchShadcnTableToken()`
    default:
      return null
  }
}

/**
 * Build Playwright expect a11y options from hub `a11y:` block.
 * @param {Record<string, unknown> | null | undefined} a11y
 * @param {string | null} rootTestId
 */
function formatA11yOpts(a11y, rootTestId) {
  /** @type {Record<string, unknown>} */
  const opts = {}
  if (a11y?.include?.length) {
    opts.include = Array.isArray(a11y.include) ? a11y.include[0] : a11y.include
  } else if (rootTestId) {
    opts.include = `[data-testid="${rootTestId}"]`
  }
  if (Array.isArray(a11y?.exclude) && a11y.exclude.length) opts.exclude = a11y.exclude
  if (Array.isArray(a11y?.tags) && a11y.tags.length) opts.tags = a11y.tags
  if (Array.isArray(a11y?.disableRules) && a11y.disableRules.length) {
    opts.disableRules = a11y.disableRules
  }
  if (!Object.keys(opts).length) return '{}'
  return JSON.stringify(opts)
}
