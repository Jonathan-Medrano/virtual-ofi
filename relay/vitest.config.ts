import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-plugin'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: { bindings: { RELAY_KEY: 'clave-de-prueba' } },
    }),
  ],
  test: { include: ['test/**/*.test.ts'] },
})
