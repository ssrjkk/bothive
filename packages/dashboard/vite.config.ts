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
  build: {
    // Keep the default and compiler-verification builds separate.
    outDir: enableReactCompiler ? 'dist-compiler' : 'dist',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (id.includes('recharts')) return 'charts';
          if (id.includes('antd') || id.includes('@ant-design')) return 'antd';
          if (id.includes('react') || id.includes('react-router')) return 'react';
        },
      },
    },
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
