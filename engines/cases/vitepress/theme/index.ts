import { h, nextTick, watch } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import { createMermaidRenderer } from 'vitepress-mermaid-renderer'
import 'vitepress-mermaid-renderer/css'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () => {
    const { isDark } = useData()

    const initMermaid = () => {
      createMermaidRenderer({
        theme: isDark.value ? 'dark' : 'default',
        // Expand diagram to content width (default compact SVG was ~½ column)
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
        themeVariables: {
          fontSize: '18px',
        },
      })
    }

    nextTick(() => initMermaid())
    watch(
      () => isDark.value,
      () => initMermaid(),
    )

    return h(DefaultTheme.Layout)
  },
} satisfies Theme
