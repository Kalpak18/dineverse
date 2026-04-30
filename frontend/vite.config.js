import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:5000';

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        injectManifest: {
          injectionPoint: 'self.__WB_MANIFEST',
        },
        manifest: false, // we already have public/site.webmanifest
      }),
    ],
    build: {
      rollupOptions: {
        // Capacitor native plugin — not installed in web/CI builds, only resolved at runtime on device
        external: ['@capacitor-community/barcode-scanner'],
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            // React ecosystem — keep all react-* and router in one chunk to avoid
            // circular refs between react, react-dom, react-router shared internals
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/react-router/') ||
              id.includes('/react-router-dom/') ||
              id.includes('/scheduler/')        // react-dom peer dep
            ) return 'vendor-react';
            // socket.io-client + its deps (engine.io-client, xmlhttprequest-ssl, etc.)
            if (
              id.includes('/socket.io-client/') ||
              id.includes('/engine.io-client/') ||
              id.includes('/xmlhttprequest-ssl/') ||
              id.includes('/@socket.io/')
            ) return 'vendor-socket';
            if (id.includes('/leaflet/')) return 'vendor-leaflet';
            return 'vendor-misc';
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('error', () => {});
          },
        },
        '/socket.io': {
          target: backendUrl,
          ws: true,
          configure: (proxy) => {
            proxy.on('error', () => {});
          },
        },
      },
    },
  };
});
