/**
 * @param {string} id e.g. chain-hotel-list
 */
export function toPageClassName(id) {
  const base = id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  return `${base}Page`
}

/**
 * @param {Record<string, unknown>} testcase
 * @param {Record<string, unknown> | null} spec
 * @param {string} testcaseFile
 */
export function buildTestcaseContext(testcase, spec, testcaseFile) {
  const module =
    spec?.ui?.testIds?.module ??
    spec?.codegen?.module ??
    testcase.feature ??
    'feature'

  const pageClassName = toPageClassName(testcase.id)
  const routePath = testcase.route?.path ?? '/'
  const session = testcase.setup?.session ?? null
  const mocks = testcase.setup?.mocks ?? []
  const steps = testcase.steps ?? []
  const clickSteps = steps.filter((step) => step.action === 'click')
  const setupSteps = steps
    .filter((step) => step.action !== 'click')
    .map((step) => {
      if (step.action !== 'waitFor' || !step.role) return step
      const rawName = step.name ?? step.namePattern ?? ''
      const nameExpr =
        typeof rawName === 'string' && rawName.startsWith('/') && rawName.endsWith('/')
          ? rawName
          : rawName
            ? `'${String(rawName).replace(/'/g, "\\'")}'`
            : null
      return { ...step, roleNameExpr: nameExpr }
    })
  const uiVisibility = (testcase.assertions?.ui ?? []).filter((item) => item.testId !== undefined)
  const uiActions = (testcase.assertions?.ui ?? [])
    .filter((item) => item.action)
    .map((item) => {
      if (item.action !== 'newTabOpened') return item
      const pattern = testcase.testIds?.patterns?.[0]
      const clickTemplate =
        typeof pattern === 'string'
          ? pattern
          : 'chain-hotels-cell-managers-login-as-{{manager_id}}'
      return { ...item, clickTemplate }
    })
  const networkAssertions = testcase.assertions?.network ?? []
  const semanticReady = testcase.assertions?.semantic?.ready ?? null
  const data = testcase.data ?? testcase.testData ?? {}
  const hasNewTabAction = uiActions.some((item) => item.action === 'newTabOpened')

  // Inject Common Scenarios based on #pattern
  const tags = spec?.tags ?? []
  const hasDeleteFlow = tags.includes('#pattern: delete-flow')
  const hasConfirmDialog = tags.includes('#pattern: confirm-dialog')

  if (hasDeleteFlow) {
    uiVisibility.push({ testId: 'delete-button', expected: 'visible' })
    uiVisibility.push({ testId: 'confirm-dialog', expected: 'hidden' })
    clickSteps.push({ action: 'click', testId: 'delete-button' })
    uiVisibility.push({ testId: 'confirm-dialog', expected: 'visible' })
  }

  if (hasConfirmDialog) {
    uiVisibility.push({ testId: 'confirm-button', expected: 'visible' })
    uiVisibility.push({ testId: 'cancel-button', expected: 'visible' })
    clickSteps.push({ action: 'click', testId: 'cancel-button' })
    uiVisibility.push({ testId: 'confirm-dialog', expected: 'hidden' })
  }

  const specRequired = spec?.ui?.testIds?.required ?? []
  const testcaseRequired = testcase.testIds?.required ?? []
  const missingInSpec = testcaseRequired.filter((id) => !specRequired.includes(id))
  const missingInTestcase = specRequired.filter((id) => !testcaseRequired.includes(id))

  return {
    testcaseId: testcase.id,
    testcaseTitle: testcase.title ?? testcase.id,
    coverage: testcase.coverage ?? testcase._coverage ?? [],
    a11y: testcase.a11y ?? null,
    module,
    pageClassName,
    routePath,
    session,
    mocks,
    steps,
    setupSteps,
    clickSteps,
    uiVisibility,
    uiActions,
    networkAssertions,
    semanticReady,
    data,
    hasData: Object.keys(data).length > 0,
    hasNewTabAction,
    primaryNetwork: networkAssertions[0] ?? null,
    testcaseFile,
    specFile: null,
    warnings: [
      ...missingInSpec.map((id) => `testcase testIds.required "${id}" not in spec.ui.testIds.required`),
      ...missingInTestcase.map((id) => `spec.ui.testIds.required "${id}" missing from testcase`)
    ],
    outputs: {
      pageObject: `tests/e2e/pages/${module}/${pageClassName}.ts`,
      spec: `tests/e2e/${module}/${testcase.id}.spec.ts`
    }
  }
}
