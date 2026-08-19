import { withMermaid } from 'vitepress-plugin-mermaid'
import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()

function buildRecursiveSidebar(dirPath: string, urlPrefix: string): any[] {
  if (!fs.existsSync(dirPath)) return []
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const items: any[] = []

    // Read files first (excluding index.md)
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md') {
        const filePath = path.join(dirPath, entry.name)
        const nameWithoutExt = entry.name.replace(/\.md$/, '')
        let title = nameWithoutExt.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        try {
          const content = fs.readFileSync(filePath, 'utf8')
          const titleMatch = content.match(/^#\s+(.+)$/m)
          if (titleMatch) title = titleMatch[1].trim()
        } catch {}
        items.push({
          text: title,
          link: `${urlPrefix}${nameWithoutExt}`
        })
      }
    }

    // Read directories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (['code', 'ir', 'node_modules', '.git'].includes(entry.name)) continue
        const subDirPath = path.join(dirPath, entry.name)
        const indexPath = path.join(subDirPath, 'index.md')
        let title = entry.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        let link = undefined

        if (fs.existsSync(indexPath)) {
          try {
            const content = fs.readFileSync(indexPath, 'utf8')
            const titleMatch = content.match(/^#\s+(.+)$/m)
            if (titleMatch) title = titleMatch[1].trim()
          } catch {}
          link = `${urlPrefix}${entry.name}/`
        }

        const subItems = buildRecursiveSidebar(subDirPath, `${urlPrefix}${entry.name}/`)
        
        if (!link && subItems.length > 0) {
          const firstLinkedItem = subItems.find((s: any) => s.link)
          if (firstLinkedItem) {
            link = firstLinkedItem.link
          }
        }

        const item: any = { text: title }
        if (link) item.link = link
        if (subItems.length > 0) {
          item.items = subItems
          item.collapsed = true
        }
        
        if (link || subItems.length > 0) {
          items.push(item)
        }
      }
    }

    return items
  } catch (e) {
    return []
  }
}

function getCasesSidebar(root: string) {
  const casesDir = path.join(root, 'cases')
  return buildRecursiveSidebar(casesDir, '/cases/')
}

function getScenariosSidebar(root: string) {
  const scenariosDir = path.join(root, 'scenarios')
  return buildRecursiveSidebar(scenariosDir, '/scenarios/')
}

function getPlansSidebar(root: string) {
  const plansDir = path.join(root, 'plans')
  return buildRecursiveSidebar(plansDir, '/plans/')
}

export default withMermaid(
  defineConfig({
    title: 'Test Plans & Cases',
    description: 'Test hub documentation',
    cleanUrls: true,
    ignoreDeadLinks: true,
    srcExclude: [
      '**/node_modules/**',
      '**/scripts/**',
      '**/.cursor/**',
      '**/package.json'
    ],
    mermaid: {
      themeVariables: {
        fontSize: '18px',
      },
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        padding: 16,
        nodeSpacing: 50,
        rankSpacing: 60,
      },
      sequence: {
        useMaxWidth: true,
        diagramMarginX: 40,
        diagramMarginY: 20,
        actorMargin: 50,
        boxMargin: 12,
      },
    },
    vite: {
      resolve: {
        dedupe: ['vue', 'vitepress', 'vitepress-plugin-mermaid', 'vitepress-mermaid-renderer'],
      },
      optimizeDeps: {
        include: [
          'mermaid',
          'dayjs',
          'debug',
          'cytoscape',
          'cytoscape-cose-bilkent',
          '@braintree/sanitize-url',
        ],
      },
    },
    themeConfig: {
      nav: [
        { text: 'Home', link: '/' },
        { text: 'Scenarios', link: '/scenarios/' },
        { text: 'Cases', link: '/cases/' },
        { text: 'Plans', link: '/plans/' },
      ],
      sidebar: {
        '/scenarios/': [
          {
            text: 'Scenarios',
            items: getScenariosSidebar(projectRoot),
          }
        ],
        '/cases/': [
          {
            text: 'Cases',
            items: getCasesSidebar(projectRoot),
          }
        ],
        '/plans/': [
          {
            text: 'Plans',
            items: getPlansSidebar(projectRoot),
          }
        ]
      },
    },
  }),
)
