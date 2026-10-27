import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://webfortrades.com',
  integrations: [sitemap()],
  // Hash-based CSP: Astro emits a <meta http-equiv="content-security-policy">
  // per page with hashes for the scripts and styles it renders.
  // frame-ancestors is ignored in <meta>, so public/_headers sends it.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ],
      styleDirective: {
        resources: [
          "'self'",
          'https://fonts.googleapis.com',
          // index.astro uses inline style="" attributes.
          { resource: "'unsafe-inline'", kind: 'attribute' },
        ],
        // The is:inline :root font-variable <style> in Base.astro.
        hashes: ['sha256-fiJzb0lMplrR69jCzZeTs+QB8dPYVFmSZVjpcIBaOgs='],
      },
    },
  },
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
