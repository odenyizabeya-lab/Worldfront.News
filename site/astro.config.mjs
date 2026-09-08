import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Server-rendered output running on the Cloudflare Workers runtime (Pages
// free plan). Only /news/[slug] and / do DB work (Turso via libSQL); no
// client-side JavaScript is emitted on these pages.
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: {
      enabled: true
    }
  })
});