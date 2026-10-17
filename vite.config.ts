/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Base path for static hosting under a sub-path (GitHub Pages). Hash routing means
// only asset URLs depend on this.
const base = process.env.VITE_BASE ?? '/';

/**
 * Content Security Policy for optional cloud sync: when a Supabase project is configured
 * at build time, allow requests to that one origin (and nothing else). Without it the
 * policy stays connect-src 'self', and the app makes no network requests.
 */
function cspConnectSrc(origin: string | null): Plugin {
  const widen = (text: string) =>
    origin ? text.replace("connect-src 'self'", `connect-src 'self' ${origin}`) : text;
  return {
    name: 'csp-connect-src',
    transformIndexHtml: (html) => widen(html),
    writeBundle(options) {
      const headers = join(options.dir ?? 'dist', '_headers');
      if (origin && existsSync(headers)) writeFileSync(headers, widen(readFileSync(headers, 'utf8')));
    },
  };
}

function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

export default defineConfig(({ mode }) => ({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    cspConnectSrc(originOf({ ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }.VITE_SUPABASE_URL)),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'],
      manifest: {
        name: 'Binocular Vision Explorer',
        short_name: 'BinoVision',
        description:
          'For personal and educational use: explore how your two eyes work together with anaglyph glasses. Not a medical device; does not diagnose or treat.',
        display: 'standalone',
        start_url: base,
        scope: base,
        theme_color: '#111318',
        background_color: '#111318',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Vendor code in stable chunks that stay cached across app updates. A function (not
        // a name list) so sub-path imports such as react-dom/client land in the right chunk.
        // Module ids use forward slashes on every platform.
        manualChunks(id) {
          const pkg = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id)?.[1];
          if (!pkg) return undefined;
          if (['react', 'react-dom', 'scheduler', 'react-router', 'react-router-dom'].includes(pkg))
            return 'react';
          if (['dexie', 'zod', 'zustand'].includes(pkg)) return 'data';
          if (['i18next', 'react-i18next'].includes(pkg)) return 'i18n';
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.tsx', 'src/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // `npm run test:coverage` (CI) fails if coverage drops below these floors. Safety logic
    // and the stimulus engine carry stricter floors than UI code; the canvas-driven parts
    // (TrainingCanvas, WebGL, the wizard's drawing) are covered by the Playwright suite.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts', 'src/**/types.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
      // Vitest 4 maps v8 coverage onto the AST, which counts branches more strictly than
      // Vitest 3 did (the same tests went from 82% to 62% branches), so the branch floors
      // were reset to the new baseline when upgrading.
      thresholds: {
        statements: 68,
        branches: 60,
        functions: 64,
        lines: 68,
        'src/safety/{caps,gating,symptomRules,sessionMachine,session}.ts': {
          statements: 95,
          branches: 80,
          functions: 95,
          lines: 95,
        },
        'src/engine/*.ts': { statements: 90, branches: 80, functions: 85, lines: 90 },
        'src/data/**': { statements: 80, branches: 70, functions: 65, lines: 80 },
      },
    },
  },
}));
