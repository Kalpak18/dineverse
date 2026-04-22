import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import QRScanner from '../../components/QRScanner';
import toast from 'react-hot-toast';

const DINEVERSE_HOSTS = ['dine-verse.com', 'www.dine-verse.com', 'dineverse.vercel.app'];

function extractCafeRoute(rawText) {
  try {
    const url = new URL(rawText.startsWith('http') ? rawText : `https://${rawText}`);
    const match = url.pathname.match(/\/cafe\/([^/?#]+)/);
    if (match) {
      const slug  = match[1];
      const table = url.searchParams.get('table') || '';
      return `/cafe/${slug}${table ? `?table=${encodeURIComponent(table)}` : ''}`;
    }
  } catch { /* not a URL */ }
  return null;
}

function isDineVerse(rawText) {
  try {
    const url = new URL(rawText.startsWith('http') ? rawText : `https://${rawText}`);
    return DINEVERSE_HOSTS.includes(url.hostname) || url.hostname === window.location.hostname;
  } catch { return false; }
}

function isUrl(text) {
  try { new URL(text.startsWith('http') ? text : `https://${text}`); return true; } catch { return false; }
}

export default function ScanPage() {
  const navigate  = useNavigate();
  const [active, setActive] = useState(false);
  const [scanned, setScanned] = useState(null); // { text, isLink } for non-DineVerse results

  const handleScan = useCallback((text) => {
    setActive(false);
    const cafeRoute = extractCafeRoute(text);
    if (cafeRoute && isDineVerse(text)) {
      toast.success('Café found!', { duration: 1500 });
      navigate(cafeRoute);
      return;
    }
    if (isUrl(text)) {
      window.location.href = text.startsWith('http') ? text : `https://${text}`;
      return;
    }
    // Plain text — show it with copy option
    setScanned(text);
  }, [navigate]);

  const handleClose = useCallback(() => setActive(false), []);

  if (active) {
    return <QRScanner onScan={handleScan} onClose={handleClose} />;
  }

  if (scanned) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex flex-col items-center justify-center px-6 py-12">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
          <p className="text-3xl mb-3">✅</p>
          <p className="text-base font-semibold text-gray-900 mb-2">QR Code Scanned</p>
          <p className="text-sm text-gray-500 mb-5 break-all">{scanned}</p>
          <div className="flex gap-3">
            <button
              onClick={() => { navigator.clipboard?.writeText(scanned); toast.success('Copied!'); }}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-700"
            >
              Copy Text
            </button>
            <button
              onClick={() => { setScanned(null); setActive(true); }}
              className="flex-1 px-4 py-2.5 rounded-xl bg-brand-500 text-white text-sm font-semibold"
            >
              Scan Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex flex-col items-center justify-center px-6 py-12">
      <div className="bg-white rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
        <div className="w-20 h-20 rounded-2xl bg-brand-50 flex items-center justify-center mx-auto mb-5 text-brand-500">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none" />
            <rect x="14" y="14" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
            <rect x="18" y="14" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
            <rect x="14" y="18" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
            <rect x="18" y="18" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
            <rect x="16" y="16" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold text-gray-900 mb-2">QR Scanner</h1>
        <p className="text-gray-500 text-sm mb-8 leading-relaxed">
          Scan any QR code — opens links instantly, or orders from a DineVerse café table.
        </p>

        <button
          onClick={() => setActive(true)}
          className="w-full py-4 rounded-2xl bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-bold text-base transition-all shadow-md shadow-brand-200"
        >
          Open Scanner
        </button>

        <div className="mt-6 border-t border-gray-100 pt-5">
          <p className="text-xs text-gray-400 mb-3">Or enter the café code manually</p>
          <ManualEntry onSubmit={handleScan} />
        </div>
      </div>
    </div>
  );
}

function ManualEntry({ onSubmit }) {
  const [slug, setSlug] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const clean = slug.trim().toLowerCase().replace(/\s+/g, '-');
    if (clean) onSubmit(clean);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        placeholder="cafe-slug"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 bg-gray-50"
      />
      <button
        type="submit"
        disabled={!slug.trim()}
        className="px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-40 hover:bg-gray-700 transition"
      >
        Go
      </button>
    </form>
  );
}
