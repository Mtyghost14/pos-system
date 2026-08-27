import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'better-sqlite3', 'bcryptjs', 'serialport', 'electron-pos-printer',
                // Cargados en runtime desde node_modules (empaquetados por electron-builder).
                // Bundlearlos rompe la interop CJS/ESM de tslib → crash al arrancar.
                'ws', '@supabase/supabase-js', '@supabase/postgrest-js', '@supabase/realtime-js',
                '@supabase/storage-js', '@supabase/functions-js', '@supabase/auth-js', '@supabase/node-fetch',
              ],
            },
          },
        },
      },
      {
        entry: 'src/main/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: [{ find: '@', replacement: resolve(__dirname, 'src') }],
  },
})
