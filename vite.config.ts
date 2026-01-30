import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import hono from '@hono/vite-dev-server'
import { bunAdapter } from '@hono/vite-dev-server/bun'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  plugins: [solid(), hono({
    entry: './backend/index.ts',
    adapter: bunAdapter(),
  }), tailwind()],
  server: {
    allowedHosts: true
  }
})
