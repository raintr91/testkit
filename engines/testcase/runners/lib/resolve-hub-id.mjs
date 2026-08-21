/**
 * Resolve short hub IDs → filesystem paths (docs hub + tests hub).
 * IDs: W-* | API-* | UI-* | CMP-* | FLOW-* | DEP-* | TC-* | SC-* | suite id (smoke, …)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

function loadJson(file) {
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v)
    } else out[k] = v
  }
  return out
}

export function findPlatformReposDir(startDir) {
  let dir = path.resolve(startDir)
  while (true) {
    const file = path.join(dir, 'platform-repos.json')
    if (existsSync(file)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function loadPlatformRepos(repoRoot) {
  const dir = findPlatformReposDir(repoRoot)
  if (!dir) throw new Error(`Missing platform-repos.json in ${repoRoot} or any parent directories`)
  let doc = loadJson(path.join(dir, 'platform-repos.json'))
  const local = loadJson(path.join(dir, 'platform-repos.local.json'))
  if (local) doc = deepMerge(doc, local)
  return doc
}

export function resolveProjectRoot(repoRoot, projectId) {
  const dir = findPlatformReposDir(repoRoot) || repoRoot
  let doc = loadJson(path.join(dir, 'platform-repos.json'))
  if (!doc) throw new Error(`Missing platform-repos.json in ${repoRoot} or any parent directories`)
  const local = loadJson(path.join(dir, 'platform-repos.local.json'))
  if (local) doc = deepMerge(doc, local)

  const proj = doc.projects?.[projectId]
  if (!proj?.root) throw new Error(`Unknown project "${projectId}" in platform-repos.json`)
  return path.resolve(dir, proj.root)
}

export function loadDocsIndex(docsRoot) {
  const file = path.join(docsRoot, 'registries', 'docs-index.json')
  const idx = loadJson(file)
  if (!idx) throw new Error(`Missing ${file}`)
  return idx
}

export function loadTestsIndex(testsRoot) {
  const file = path.join(testsRoot, 'registries', 'tests-index.json')
  const idx = loadJson(file)
  if (!idx) {
    return buildTestsIndexFallback(testsRoot)
  }
  return idx
}

/** Scan cases/ + suites/ when index missing */
function buildTestsIndexFallback(testsRoot) {
  const codeIds = {}
  const casesDir = path.join(testsRoot, 'cases')
  const suites = {}
  if (existsSync(casesDir)) {
    for (const screen of readdirSync(casesDir, { withFileTypes: true })) {
      if (!screen.isDirectory() || screen.name.startsWith('.')) continue
      const screenPath = path.join(casesDir, screen.name)
      codeIds[screen.name] = path.relative(testsRoot, screenPath).split(path.sep).join('/')
      for (const f of readdirSync(screenPath)) {
        if (/^TC-.*\.ya?ml$/i.test(f)) {
          const id = f.replace(/\.ya?ml$/i, '')
          codeIds[id] = path.relative(testsRoot, path.join(screenPath, f)).split(path.sep).join('/')
        }
      }
    }
  }
  const suitesDir = path.join(testsRoot, 'suites')
  if (existsSync(suitesDir)) {
    for (const f of readdirSync(suitesDir)) {
      if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue
      const raw = readFileSync(path.join(suitesDir, f), 'utf8')
      const idMatch = raw.match(/^id:\s*(\S+)/m)
      const sid = idMatch?.[1] || f.replace(/\.ya?ml$/i, '')
      suites[sid] = path.relative(testsRoot, path.join(suitesDir, f)).split(path.sep).join('/')
    }
  }

  const scenarios = {}
  const scenariosDir = path.join(testsRoot, 'scenarios')
  if (existsSync(scenariosDir)) {
    for (const cmp of readdirSync(scenariosDir, { withFileTypes: true })) {
      if (!cmp.isDirectory() || cmp.name.startsWith('.')) continue
      const cmpPath = path.join(scenariosDir, cmp.name)
      for (const f of readdirSync(cmpPath)) {
        if (!/^SC-.*\.md$/i.test(f)) continue
        const raw = readFileSync(path.join(cmpPath, f), 'utf8')
        
        const idMatch = raw.match(/^id:\s*(\S+)/m)
        const sid = idMatch?.[1] || f.replace(/\.md$/i, '')
        const capabilityMatch = raw.match(/^capability:\s*(\S+)/m)
        const featureMatch = raw.match(/^feature:\s*(\S+)/m)
        const screenMatch = raw.match(/^screen:\s*(\S+)/m)
        
        const caseMatches = [...raw.matchAll(/(TC-[\w-]+)/g)]
        const cases = [...new Set(caseMatches.map(m => m[1]))]

        scenarios[sid] = {
          capability: capabilityMatch?.[1],
          component: featureMatch?.[1] || cmp.name,
          screen: screenMatch?.[1],
          cases
        }
      }
    }
  }

  return { version: 1, codeIds, suites, scenarios }
}

function absUnder(root, rel) {
  if (!rel) return null
  const abs = path.resolve(root, rel)
  if (!existsSync(abs)) return null
  return abs
}

/** Prefer spec.yaml directly or ir/spec.yaml under a Code folder for codegen */
export function preferGenSpec(codeDir) {
  if (!codeDir || !existsSync(codeDir)) return null
  const direct = path.join(codeDir, 'spec.yaml')
  if (existsSync(direct)) return direct
  const ir = path.join(codeDir, 'ir', 'spec.yaml')
  return existsSync(ir) ? ir : null
}

/**
 * @param {string} repoRoot FE/BE code project
 * @param {string} id
 * @param {'codegen'|'testcase'} mode
 * @returns {{ kind: string, id: string, paths: string[], notes: string[] }}
 */
export function resolveHubId(repoRoot, id, mode = 'testcase') {
  if (!id || typeof id !== 'string') throw new Error('Missing --id')
  const notes = []
  let docs
  let tests
  const getDocs = () => {
    if (!docs) {
      const root = process.env.TESTKIT_DOCS_ROOT || process.env.CODEGENKIT_DOCS_ROOT
        ? path.resolve(process.env.TESTKIT_DOCS_ROOT || process.env.CODEGENKIT_DOCS_ROOT)
        : resolveProjectRoot(repoRoot, 'docs')
      docs = { root, index: loadDocsIndex(root) }
    }
    return docs
  }
  const getTests = () => {
    if (!tests) {
      const root = process.env.TESTKIT_TESTS_ROOT
        ? path.resolve(process.env.TESTKIT_TESTS_ROOT)
        : resolveProjectRoot(repoRoot, 'tests')
      tests = { root, index: loadTestsIndex(root) }
    }
    return tests
  }

  // Suite
  const testcaseHub = mode === 'testcase' ? getTests() : null
  if (testcaseHub?.index.suites?.[id]) {
    const { root: testsRoot, index: testsIdx } = testcaseHub
    const suitePath = absUnder(testsRoot, testsIdx.suites[id])
    const raw = readFileSync(suitePath, 'utf8')
    const caseIds = [...raw.matchAll(/^\s*-\s+(TC-[\w-]+)/gm)].map((m) => m[1])
    const paths = []
    for (const cid of caseIds) {
      const rel = testsIdx.codeIds?.[cid]
      const p = absUnder(testsRoot, rel)
      if (p) paths.push(p)
      else notes.push(`suite ${id}: missing case ${cid}`)
    }
    return { kind: 'suite', id, paths, notes, suitePath }
  }

  // TC-* file
  if (/^TC-/i.test(id)) {
    const { root: testsRoot, index: testsIdx } = getTests()
    const rel = testsIdx.codeIds?.[id]
    const p = absUnder(testsRoot, rel)
    if (!p) throw new Error(`Unknown testcase id ${id} — update the tests hub registries/tests-index.json`)
    return { kind: 'testcase', id, paths: [p], notes }
  }

  // Screen / API / UI code folder on docs
  if (/^(W|API|UI)-/i.test(id) || /^[a-z]+-[a-z]+-\d{3}(-\d{2,3})+$/i.test(id)) {
    if (mode === 'testcase') {
      const { root: testsRoot, index: testsIdx } = getTests()
      const screenRel = testsIdx.codeIds?.[id] || `cases/${id}`
      const screenDir = absUnder(testsRoot, screenRel)
      if (!screenDir) throw new Error(`No cases folder for ${id} in the tests hub`)
      const paths = readdirSync(screenDir)
        .filter((f) => /^TC-.*\.ya?ml$/i.test(f))
        .map((f) => path.join(screenDir, f))
        .sort()
      if (!paths.length) throw new Error(`No TC-*.yaml under ${screenDir}`)
      return { kind: 'screen-cases', id, paths, notes }
    }
    // codegen
    const { root: docsRoot, index: docsIdx } = getDocs()
    const rel = docsIdx.codeIds?.[id]
    if (!rel) throw new Error(`Unknown code id ${id} in the docs hub registries/docs-index.json`)
    const codeDir = absUnder(docsRoot, rel)
    const spec = preferGenSpec(codeDir)
    if (!spec) throw new Error(`No spec.yaml or ir/spec.yaml under ${rel}`)
    notes.push(`codegen input: ${path.relative(repoRoot, spec)}`)
    return { kind: 'code', id, paths: [spec], notes, codeDir }
  }

  // Module (e.g. CMP-ADM-001) → all code children
  if (/^[A-Z]+-[A-Z]+-\d{3}$/i.test(id)) {
    const { index: docsIdx } = getDocs()
    const cmp = (docsIdx.modules || []).find(
      (c) => c.id === id || c.id.startsWith(id) || (c.slug && id.toLowerCase().includes(c.slug)),
    )
    if (!cmp) throw new Error(`Unknown module ${id}`)
    const paths = []
    if (mode === 'testcase') {
      for (const screen of cmp.screens || []) {
        const sub = resolveHubId(repoRoot, screen, 'testcase')
        paths.push(...sub.paths)
        notes.push(...sub.notes)
      }
      return { kind: 'component-cases', id, paths, notes }
    }
    for (const screen of cmp.screens || []) {
      try {
        const sub = resolveHubId(repoRoot, screen, 'codegen')
        paths.push(...sub.paths)
        notes.push(...sub.notes)
      } catch (e) {
        notes.push(String(e.message || e))
      }
    }
    for (const api of cmp.apis || []) {
      notes.push(`skip API ${api} for FE codegen; design lives in docs hub`)
    }
    if (!paths.length) {
      throw new Error(`CMP ${id}: no gen-ready W-* specs (need spec.yaml or ir/spec.yaml after /dev-grill-docs)`)
    }
    return { kind: 'component-code', id, paths, notes }
  }



  // SC-* scenario → cases listed in tests index
  if (/^SC-/i.test(id)) {
    const testsIdx = getTests().index
    const sc = testsIdx.scenarios?.[id]
    if (!sc?.cases?.length) {
      throw new Error(`Unknown scenario ${id} — add scenarios.${id}.cases in tests-index.json`)
    }
    const paths = []
    for (const cid of sc.cases) {
      const sub = resolveHubId(repoRoot, cid, 'testcase')
      paths.push(...sub.paths)
    }
    return { kind: 'scenario', id, paths, notes }
  }

  // FLOW-* / DEP-* -> Code folder on docs
  if (/^(FLOW|DEP)-/i.test(id)) {
    const { root: docsRoot, index: docsIdx } = getDocs()
    const rel = docsIdx.codeIds?.[id]
    if (!rel) throw new Error(`Unknown code id ${id} in the docs hub registries/docs-index.json`)
    const codeDir = absUnder(docsRoot, rel)
    const spec = preferGenSpec(codeDir)
    if (!spec) throw new Error(`No spec.yaml or ir/spec.yaml under ${rel}`)
    notes.push(`codegen input: ${path.relative(repoRoot, spec)}`)
    return { kind: 'code', id, paths: [spec], notes, codeDir }
  }

  throw new Error(
    `Unrecognized id "${id}". Use W-|API-|UI-|FLOW-|DEP-|TC-|SC-* or hierarchical ID (e.g. cmp-adm-001-01-01), or module ID (CMP-ADM-001), or suite id (smoke, regression-auth).`,
  )
}
