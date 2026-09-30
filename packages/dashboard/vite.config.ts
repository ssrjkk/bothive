import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const enableReactCompiler = process.env.ENABLE_REACT_COMPILER === 'true';

export default defineConfig({
  plugins: [
    react(
      enableReactCompiler
        ? {
            babel: {
              plugins: [['babel-plugin-react-compiler', {}]],
            },
          }
        : {},
    ),
  ],
  resolve: {
    // The monorepo hoists react 18 to the root (prisma studio's radix deps)
    // while the dashboard ships react 19. Without dedupe, some deps resolve
    // one copy and the app the other — "Cannot read properties of null
    // (reading 'useRef')" on every page. Force ONE react for the whole graph.
    dedupe: ['react', 'react-dom'],
  },
  build: {
    // Keep the default and compiler-verification builds separate.
    outDir: enableReactCompiler ? 'dist-compiler' : 'dist',
    chunkSizeWarningLimit: 1000,
    // NOTE: a hand-rolled manualChunks (react/antd/charts split) produced a
    // broken bundle — the runtime chunk imported react before it initialized,
    // crashing every page with "Cannot read properties of null (reading
    // 'useRef')" (react 19 + rolldown-vite). Let the bundler pick the split.
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
