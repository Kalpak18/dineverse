// Socket.io server URL.
// In production with split hosting (Vercel + Render), set VITE_BACKEND_URL
// to your Render backend URL (e.g. https://dineverse-backend.onrender.com).
// Falls back to same origin for unified hosting and local dev.
const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || window.location.origin;

if (!import.meta.env.VITE_BACKEND_URL && import.meta.env.PROD) {
  console.warn('VITE_BACKEND_URL is not set — real-time features may fail in split-hosted deployments (Vercel + Render). Set it to your backend URL.');
}

export default SOCKET_URL;
