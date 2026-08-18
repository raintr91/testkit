import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
  cpSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { packageRoot, packageVersion, type TestkitType } from '../config/project-root.js'
import type { AgentId } from './agents.js'
import { forgetInstall, recordInstall } from './ledger.js'
import {
  managedRepoStatus,
  removeManagedRepoFiles,
  syncManagedRepoFiles,
  type ManagedRepoFiles,
} from './managed-files.js'

export const INSTALL_MANIFEST_PATH = '.testkit/install-manifest.json'

export const SKILLS_BY_TYPE: Record<TestkitType, string[]> = {
  tests: ['testcase', 'grill-testcase'],
  fe: ['test', 'grill-test'],
}

export interface InstallManifestFile {
  source: string
  sha256: string
  stale?: boolean
}

export interface InstallManifest {
  schemaVersion: 1
  package: '@platform/testkit'
  packageVersion: string
  type: TestkitType
  toolApi: 1
  harnessApi: 1
  targets?: AgentId[]
  files: Record<string, InstallManifestFile>
  managed?: ManagedRepoFiles
}

export interface HarnessCompatibility {
  compatible: boolean
  issues: string[]
}

export interface HarnessStatus {
  manifestPath: string
  installed: boolean
  type?: TestkitType
  packageVersion?: string
  compatibility: HarnessCompatibility
  healthy: string[]
  missing: string[]
  modified: string[]
  stale: string[]
}

export interface PruneHarnessResult {
  dryRun: boolean
  candidates: string[]
  deleted: string[]
  preservedModified: string[]
  preservedProtected: string[]
  missing: string[]
}

export interface UninstallHarnessResult {
  dryRun: boolean
  manifest: string
  wouldDelete: string[]
  deleted: string[]
  preservedModified: string[]
  preservedProtected: string[]
  missing: string[]
  manifestRemoved: boolean
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function walk(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  for (const name of readdirSync(root)) {
    const file = path.join(root, name)
    if (statSync(file).isDirectory()) out.push(...walk(file))
    else out.push(file)
  }
  return out
}

function manifestFile(root: string): string {
  return path.join(root, ...INSTALL_MANIFEST_PATH.split('/'))
}

function loadManifest(root: string): InstallManifest | null {
  const file = manifestFile(root)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as InstallManifest) : null
}

function currentFiles(type: TestkitType, targets: AgentId[] = ['cursor']): InstallManifest['files'] {
  const sourceRoot = path.join(packageRoot(), 'harness', type)
  const files: InstallManifest['files'] = {}
  
  const skillRoots = new Set<string>()
  for (const agent of targets) {
    if (agent === 'cursor') skillRoots.add('.cursor')
    else if (agent === 'gemini' || agent === 'antigravity') skillRoots.add('.agents')
    else if (agent === 'codex') skillRoots.add('.codex')
    else if (agent === 'claude') skillRoots.add('.claude')
    else if (agent === 'hermes') skillRoots.add('.hermes')
    else if (agent === 'opencode') skillRoots.add('.opencode')
    else if (agent === 'kiro') skillRoots.add('.kiro')
    else if (agent === 'kilo') skillRoots.add('.kilocode')
  }
  skillRoots.add('.docskit')

  for (const source of walk(sourceRoot)) {
    const rel = path.relative(sourceRoot, source)
    const content = readFileSync(source, 'utf8')
    const sha256 = hash(content)
    const relSource = path.relative(packageRoot(), source).split(path.sep).join('/')
    for (const root of skillRoots) {
      const targetRel = path.join(root, rel).split(path.sep).join('/')
      files[targetRel] = {
        source: relSource,
        sha256: sha256,
      }
    }
  }
  const schemaSource = path.join(packageRoot(), 'schemas', 'missing-optional-event.schema.json')
  const schemaContent = readFileSync(schemaSource, 'utf8')
  const schemaSha = hash(schemaContent)
  const schemaRelSource = path.relative(packageRoot(), schemaSource).split(path.sep).join('/')
  for (const root of skillRoots) {
    const schemaTarget = path.join(root, 'schemas/testkit/missing-optional-event.schema.json').split(path.sep).join('/')
    files[schemaTarget] = {
      source: schemaRelSource,
      sha256: schemaSha,
    }
  }
  return files
}

function managedTarget(root: string, targetRel: string): string | null {
  const target = path.resolve(root, targetRel)
  const relative = path.relative(root, target)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
    ? target
    : null
}

function safeManagedTarget(root: string, targetRel: string): string | null {
  const target = managedTarget(root, targetRel)
  if (!target) return null
  let existing = target
  while (!existsSync(existing) && existing !== root) existing = path.dirname(existing)
  try {
    const realRoot = realpathSync(root)
    const realExisting = realpathSync(existing)
    const relative = path.relative(realRoot, realExisting)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return null
    }
  } catch {
    return null
  }
  return target
}

function isArtifactGraphOwned(targetRel: string): boolean {
  return targetRel
    .toLowerCase()
    .split(/[\\/]/)
    .some((part) => part.includes('artifactgraph'))
}

function targetHash(target: string): string | null {
  try {
    if (!statSync(target).isFile()) return null
    return hash(readFileSync(target, 'utf8'))
  } catch {
    return null
  }
}

function compatibility(manifest: InstallManifest): HarnessCompatibility {
  const issues: string[] = []
  if (manifest.schemaVersion !== 1) issues.push(`unsupported schemaVersion: ${String(manifest.schemaVersion)}`)
  if (manifest.package !== '@platform/testkit') issues.push(`unexpected package: ${String(manifest.package)}`)
  if (manifest.toolApi !== 1) issues.push(`unsupported toolApi: ${String(manifest.toolApi)}`)
  if (manifest.harnessApi !== 1) issues.push(`unsupported harnessApi: ${String(manifest.harnessApi)}`)
  if (!['tests', 'fe'].includes(manifest.type)) issues.push(`unsupported type: ${String(manifest.type)}`)
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    issues.push('invalid files inventory')
  }
  if (
    manifest.managed !== undefined
    && (!manifest.managed || typeof manifest.managed !== 'object' || Array.isArray(manifest.managed))
  ) {
    issues.push('invalid managed repo files inventory')
  }
  for (const [targetRel, metadata] of Object.entries(manifest.files ?? {})) {
    if (!managedTarget('/testkit-project', targetRel)) issues.push(`unsafe managed target: ${targetRel}`)
    if (
      !metadata
      || typeof metadata.source !== 'string'
      || typeof metadata.sha256 !== 'string'
      || (metadata.stale !== undefined && typeof metadata.stale !== 'boolean')
    ) {
      issues.push(`invalid file metadata: ${targetRel}`)
    }
  }
  return { compatible: issues.length === 0, issues }
}

export function installHarness(opts: {
  projectRoot: string
  type: TestkitType
  targets?: AgentId[]
  force?: boolean
  ignoreEntries?: string[]
}): { written: string[]; unchanged: string[]; conflicts: string[]; skipped: string[] } {
  const root = path.resolve(opts.projectRoot)
  const previous = loadManifest(root)
  if (previous) {
    const check = compatibility(previous)
    if (!check.compatible) throw new Error(`Incompatible Testkit install manifest: ${check.issues.join('; ')}`)
  }
  const result = { written: [] as string[], unchanged: [] as string[], conflicts: [] as string[], skipped: [] as string[] }
  const files = currentFiles(opts.type, opts.targets ?? previous?.targets ?? ['cursor'])
  for (const [targetRel, metadata] of Object.entries(files)) {
    const source = path.join(packageRoot(), metadata.source)
    const target = path.join(root, targetRel)
    const content = readFileSync(source, 'utf8')
    if (existsSync(target)) {
      const current = readFileSync(target, 'utf8')
      if (current === content) {
        result.unchanged.push(target)
        continue
      }
      // Shared config skills can overlap across toolkits; skip instead of conflict if already present
      if (
        targetRel.includes('configure-repo-maps') ||
        targetRel.includes('legacy-platform') ||
        targetRel.includes('configure-legacy-')
      ) {
        result.skipped.push(target)
        continue
      }
      
      const safe = previous?.files[targetRel]?.sha256 === hash(current)
      if (!opts.force && !safe) {
        result.conflicts.push(target)
        continue
      }
    }
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
    result.written.push(target)
  }
  for (const [targetRel, metadata] of Object.entries(previous?.files ?? {})) {
    if (!files[targetRel]) files[targetRel] = { ...metadata, stale: true }
  }
  const repoFiles = syncManagedRepoFiles({
    projectRoot: root,
    type: opts.type,
    previous: previous?.managed,
    ignoreEntries: opts.ignoreEntries,
  })
  result.written.push(...repoFiles.written)
  result.unchanged.push(...repoFiles.unchanged)
  result.conflicts.push(...repoFiles.conflicts)
  
  if (opts.type === 'tests') {
    injectVitepressScripts(root)
  }

  mkdirSync(path.dirname(manifestFile(root)), { recursive: true })
  writeFileSync(
    manifestFile(root),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        package: '@platform/testkit',
        packageVersion: packageVersion(),
        type: opts.type,
        toolApi: 1,
        harnessApi: 1,
        targets: opts.targets ?? previous?.targets ?? ['cursor'],
        files,
        managed: repoFiles.managed,
      } satisfies InstallManifest,
      null,
      2,
    )}\n`,
  )
  recordInstall(root)
  return result
}

export function statusHarness(opts: { projectRoot: string }): HarnessStatus {
  const root = path.resolve(opts.projectRoot)
  const manifestPath = manifestFile(root)
  const manifest = loadManifest(root)
  const result: HarnessStatus = {
    manifestPath,
    installed: manifest !== null,
    compatibility: manifest
      ? compatibility(manifest)
      : { compatible: false, issues: ['install manifest not found'] },
    healthy: [],
    missing: [],
    modified: [],
    stale: [],
  }
  if (!manifest) return result
  result.type = manifest.type
  result.packageVersion = manifest.packageVersion
  const currentTargets = ['tests', 'fe'].includes(manifest.type)
    ? new Set(Object.keys(currentFiles(manifest.type, manifest.targets ?? ['cursor'])))
    : new Set<string>()
  for (const [targetRel, metadata] of Object.entries(manifest.files ?? {})) {
    const target = managedTarget(root, targetRel)
    if (!currentTargets.has(targetRel)) {
      result.stale.push(targetRel)
    } else if (!target || !existsSync(target)) {
      result.missing.push(targetRel)
    } else if (targetHash(target) !== metadata.sha256) {
      result.modified.push(targetRel)
    } else {
      result.healthy.push(targetRel)
    }
  }
  const repoFiles = managedRepoStatus(root, manifest.managed)
  result.healthy.push(...repoFiles.healthy)
  result.missing.push(...repoFiles.missing)
  result.modified.push(...repoFiles.modified)
  return result
}

export function pruneHarness(opts: { projectRoot: string; yes?: boolean }): PruneHarnessResult {
  const root = path.resolve(opts.projectRoot)
  const manifest = loadManifest(root)
  if (!manifest) throw new Error(`Testkit install manifest not found: ${manifestFile(root)}`)
  const check = compatibility(manifest)
  if (!check.compatible) throw new Error(`Incompatible Testkit install manifest: ${check.issues.join('; ')}`)
  const currentTargets = new Set(Object.keys(currentFiles(manifest.type, manifest.targets ?? ['cursor'])))
  const result: PruneHarnessResult = {
    dryRun: !opts.yes,
    candidates: [],
    deleted: [],
    preservedModified: [],
    preservedProtected: [],
    missing: [],
  }
  for (const [targetRel, metadata] of Object.entries(manifest.files)) {
    if (!metadata.stale || currentTargets.has(targetRel)) continue
    if (isArtifactGraphOwned(targetRel)) {
      result.preservedProtected.push(targetRel)
      continue
    }
    const target = safeManagedTarget(root, targetRel)
    if (!target || !existsSync(target)) {
      result.missing.push(targetRel)
      continue
    }
    if (targetHash(target) !== metadata.sha256) {
      result.preservedModified.push(targetRel)
      continue
    }
    result.candidates.push(targetRel)
    if (opts.yes) {
      rmSync(target)
      delete manifest.files[targetRel]
      result.deleted.push(targetRel)
    }
  }
  if (opts.yes && result.deleted.length > 0) {
    writeFileSync(manifestFile(root), `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return result
}

function pruneEmptyDirs(root: string, files: string[]): void {
  const directories = new Set<string>()
  for (const file of files) {
    let directory = path.dirname(file)
    while (directory !== root && managedTarget(root, path.relative(root, directory))) {
      directories.add(directory)
      directory = path.dirname(directory)
    }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    try {
      if (existsSync(directory) && readdirSync(directory).length === 0) rmdirSync(directory)
    } catch {
      // Leave non-empty or busy directories.
    }
  }
}

/**
 * Remove only Testkit assets recorded by a compatible manifest. Modified files
 * and any path that could belong to ArtifactGraph are always preserved.
 */
export function uninstallHarness(opts: {
  projectRoot: string
  yes?: boolean
}): UninstallHarnessResult {
  const root = path.resolve(opts.projectRoot)
  const manifestPath = manifestFile(root)
  const manifest = loadManifest(root)
  const result: UninstallHarnessResult = {
    dryRun: !opts.yes,
    manifest: manifestPath,
    wouldDelete: [],
    deleted: [],
    preservedModified: [],
    preservedProtected: [],
    missing: [],
    manifestRemoved: false,
  }
  if (!manifest) return result
  const check = compatibility(manifest)
  if (!check.compatible) {
    throw new Error(`Incompatible Testkit install manifest: ${check.issues.join('; ')}`)
  }

  for (const [targetRel, metadata] of Object.entries(manifest.files)) {
    if (isArtifactGraphOwned(targetRel)) {
      result.preservedProtected.push(targetRel)
      continue
    }
    const target = safeManagedTarget(root, targetRel)
    if (!target || !existsSync(target)) {
      result.missing.push(targetRel)
      continue
    }
    if (targetHash(target) !== metadata.sha256) {
      result.preservedModified.push(targetRel)
      continue
    }
    if (result.dryRun) result.wouldDelete.push(targetRel)
    else {
      rmSync(target)
      result.deleted.push(targetRel)
    }
  }
  const repoFiles = removeManagedRepoFiles({
    projectRoot: root,
    managed: manifest.managed,
    yes: opts.yes,
  })
  result.wouldDelete.push(...repoFiles.wouldDelete)
  result.deleted.push(...repoFiles.deleted)
  result.preservedModified.push(...repoFiles.preservedModified)
  result.missing.push(...repoFiles.missing)

  if (result.dryRun) {
    result.wouldDelete.push(INSTALL_MANIFEST_PATH)
    return result
  }
  if (existsSync(manifestPath)) {
    rmSync(manifestPath)
    result.manifestRemoved = true
  }
  forgetInstall(root)
  pruneEmptyDirs(
    root,
    [...result.deleted, INSTALL_MANIFEST_PATH].map((relative) => path.join(root, relative)),
  )
  return result
}

function injectVitepressScripts(root: string) {
  const pkgPath = path.join(root, 'package.json')
  if (!existsSync(pkgPath)) return
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, any>
    let changed = false

    if (!pkg.devDependencies) pkg.devDependencies = {}

    const requiredDeps = {
      '@braintree/sanitize-url': '^7.1.2',
      'cytoscape': '^3.34.0',
      'cytoscape-cose-bilkent': '^4.1.0',
      'dayjs': '^1.11.21',
      'debug': '^4.4.3',
      'mermaid': '^11.16.0',
      'vitepress': 'latest',
      'vitepress-mermaid-renderer': '^1.1.28',
      'vitepress-plugin-mermaid': '^2.0.17'
    }

    for (const [dep, version] of Object.entries(requiredDeps)) {
      if (!pkg.devDependencies[dep]) {
        pkg.devDependencies[dep] = version
        changed = true
      }
    }

    if (changed) {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    }
  } catch (e) {
    // Ignore invalid package.json
  }

  const vitepressDir = path.join(root, '.vitepress')
  if (!existsSync(vitepressDir)) mkdirSync(vitepressDir, { recursive: true })

  const sourceVitepressDir = path.join(packageRoot(), 'engines', 'cases', 'vitepress')
  if (existsSync(sourceVitepressDir)) {
    cpSync(sourceVitepressDir, vitepressDir, { recursive: true, force: true })
  }

  const vitepressGitignorePath = path.join(vitepressDir, '.gitignore')
  writeFileSync(vitepressGitignorePath, 'cache\ndist\n')
}
