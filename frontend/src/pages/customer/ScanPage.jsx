/**
 * ScanPage — customer scans a café QR code to enter the ordering flow.
 * The QR code contains a URL like:
 *   https://dine-verse.com/cafe/<slug>?table=3
 * We extract the slug and navigate to /cafe/:slug with the table param.
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import QRScanner from '../../components/QRScanner';
import toast from 'react-hot-toast';

function extractCafeRoute(rawText) {
  try {
    // Try parsing as a full URL
    const url = new URL(rawText.startsWith('http') ? rawText : `https://${rawText}`);
    const match = url.pathname.match(/\/cafe\/([^/?#]+)/);
    if (match) {
      const slug   = match[1];
      const table  = url.searchParams.get('table') || '';
      return `/cafe/${slug}${table ? `?table=${encodeURIComponent(table)}` : ''}`;
    }
  } catch { /* not a URL */ }

  // Plain slug?
  if (/^[a-z0-9-]+$/i.test(rawText.trim())) {
    return `/cafe/${rawText.trim()}`;
  }
  return null;
}

export default function ScanPage() {
  const navigate  = useNavigate();
  const [active, setActive] = useState(false);

  const handleScan = useCallback((text) => {
    setActive(false);
    const route = extractCafeRoute(text);
    if (route) {
      toast.success('Café found!', { duration: 1500 });
      navigate(route);
    } else {
      toast.error('QR code not recognised — is this a DineVerse café?');
    }
  }, [navigate]);

  const handleClose = useCallback(() => setActive(false), []);

  if (active) {
    return <QRScanner onScan={handleScan} onClose={handleClose} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex flex-col items-center justify-center px-6 py-12">
      {/* Card */}
      <div className="bg-white rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
        {/* Icon */}
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
        <h1 className="text-2xl font-extrabold text-gray-900 mb-2">Scan to Order</h1>
        <p className="text-gray-500 text-sm mb-8 leading-relaxed">
          Point your camera at the QR code on your table or café entrance to start ordering instantly.
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

      {/* Tip */}
      <p className="mt-6 text-xs text-gray-400 text-center max-w-xs">
        Make sure your browser has permission to use the camera. QR codes are available at café tables and entrances.
      </p>
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
