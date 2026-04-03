// Socket.io server URL.
// In production with split hosting (Vercel + Render), set VITE_BACKEND_URL
// to your Render backend URL (e.g. https://dineverse-backend.onrender.com).
// Falls back to same origin for unified hosting and local dev.
const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || window.location.origin;

export default SOCKET_URL;
