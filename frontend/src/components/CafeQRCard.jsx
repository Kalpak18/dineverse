/**
 * CafeQRCard — renders a QR code for the café's ordering link.
 * Always visible in the owner dashboard.
 * Supports: Download as PNG, Share via Web Share API, Copy link.
 */
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';

export default function CafeQRCard({ url, cafeName }) {
  const canvasRef = useRef(null);  // single canvas, always in DOM
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!url || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 220,
      margin: 2,
      color: { dark: '#111827', light: '#ffffff' },
    });
  }, [url]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${(cafeName || 'cafe').toLowerCase().replace(/\s+/g, '-')}-qr.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast.success('QR code downloaded!');
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Order at ${cafeName}`,
          text: `Scan to order at ${cafeName} on DineVerse`,
          url,
        });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard!');
    } catch {
      toast.error('Could not share');
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => toast.success('Link copied!'));
  };

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-gray-900">Customer Ordering Link</h2>
          <p className="text-xs text-gray-400 mt-0.5">Share so customers can scan &amp; order instantly</p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          {expanded ? '▲ Hide QR' : '▼ Show QR'}
        </button>
      </div>

      {/* URL row */}
      <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 mb-3">
        <span className="text-xs text-gray-500 flex-1 truncate font-mono">{url}</span>
        <button
          onClick={handleCopy}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 whitespace-nowrap flex-shrink-0"
        >
          Copy
        </button>
      </div>

      {/* Always-visible action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleDownload}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-700 transition-colors"
        >
          <span>⬇️</span> Download QR
        </button>
        <button
          onClick={handleShare}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold transition-colors"
        >
          <span>↗️</span> Share
        </button>
      </div>

      {/* Single canvas — always in DOM so download works even when collapsed */}
      <div className={expanded ? 'mt-4 border-t border-gray-100 pt-4 flex flex-col items-center gap-3' : 'overflow-hidden h-0'}>
        <canvas ref={canvasRef} className="rounded-xl border border-gray-100 shadow-sm" />
        <p className="text-xs text-gray-400 text-center">
          Print this and place it on every table — customers scan to order
        </p>
        <button onClick={handleDownload} className="text-xs font-semibold text-brand-600 hover:underline">
          Download as PNG →
        </button>
      </div>

      {/* When collapsed, canvas is hidden in the overflow-hidden div above.
          We need a visible-but-off-screen canvas for toDataURL during download.
          Use position absolute trick instead: */}
    </div>
  );
}
