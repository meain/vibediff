import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    title: 'VibeDiff',
    description: 'A local Git/Jujutsu diff viewer for reviewing AI-written code',
    base: '/vibediff/',
    cleanUrls: true,
    lastUpdated: true,
    vite: {
      // mermaid pulls in CJS-only deps that the dev server must pre-bundle
      optimizeDeps: {
        include: ['mermaid', 'mermaid > fastdom', 'mermaid > fastdom/extensions/fastdom-promised'],
      },
    },
    themeConfig: {
      sidebar: [
        { text: 'Installation', link: '/installation' },
        { text: 'Workflows', link: '/workflows' },
        { text: 'Usage', link: '/usage' },
        { text: 'Agent integration', link: '/agent-integration' },
        { text: 'Development', link: '/development' },
      ],
      socialLinks: [{ icon: 'github', link: 'https://github.com/meain/vibediff' }],
      search: { provider: 'local' },
      editLink: {
        pattern: 'https://github.com/meain/vibediff/edit/master/docs/:path',
      },
    },
  }),
)
