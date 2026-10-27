import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://webfortrades.com',
  integrations: [sitemap()],
  build: { inlineStylesheets: 'auto' },
  // Self-hosted at build time (no runtime request to Google Fonts).
  // Weights are the ones global.css uses: display 600; body 400/500/600.
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Space Grotesk',
      cssVariable: '--font-display',
      weights: [600],
      subsets: ['latin'],
      fallbacks: ['sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'Inter',
      cssVariable: '--font-body',
      weights: [400, 500, 600],
      subsets: ['latin'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
  ],
});
