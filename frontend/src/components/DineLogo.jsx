/**
 * DineLogo — renders the DineVerse logo.
 * Uses /logo.png if available, falls back to the SVG icon + wordmark.
 *
 * Props:
 *   size   — 'sm' | 'md' | 'lg'  (default 'md')
 *   white  — bool, render text in white (for dark backgrounds)
 *   icon   — bool, icon-only mode (no wordmark)
 */
export default function DineLogo({ size = 'md', white = false, icon = false }) {
  const dims = { sm: 'h-7', md: 'h-9', lg: 'h-12' };
  const text  = { sm: 'text-base', md: 'text-lg', lg: 'text-2xl' };

  return (
    <div className="flex items-center gap-2 select-none">
      <img
        src="/logo.png"
        alt="DineVerse"
        className={`${dims[size]} w-auto object-contain`}
        onError={(e) => {
          // Fallback to inline SVG icon if logo.png not found
          e.currentTarget.style.display = 'none';
          e.currentTarget.nextSibling.style.display = 'flex';
        }}
      />
      {/* Fallback icon — hidden by default, shown if logo.png fails */}
      <div
        className={`${dims[size]} aspect-square rounded-xl bg-[#0f1535] items-center justify-center flex-shrink-0`}
        style={{ display: 'none' }}
      >
        <svg viewBox="0 0 32 32" className="w-full h-full p-1">
          <ellipse cx="16" cy="23" rx="11" ry="2.2" fill="#e2e8f0"/>
          <ellipse cx="16" cy="22.6" rx="10.5" ry="2" fill="#f8fafc"/>
          <path d="M6.5 22.5 Q6.5 12.5 16 12.5 Q25.5 12.5 25.5 22.5 Z" fill="#f97316"/>
          <path d="M10.5 19.5 Q11 15 16 15 Q21 15 21.5 19.5" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.4" strokeLinecap="round"/>
          <line x1="16" y1="14" x2="16" y2="12.5" stroke="#f97316" strokeWidth="1.5"/>
          <circle cx="16" cy="12" r="1.6" fill="#f97316"/>
          <circle cx="16" cy="12" r="0.7" fill="#0f1535"/>
          <path d="M17.3 9.8 Q19.5 8.2 20.5 9.5 Q19 11.2 17.3 9.8Z" fill="#4ade80"/>
        </svg>
      </div>

      {!icon && (
        <span className={`font-black ${text[size]} tracking-tight ${white ? 'text-white' : 'text-gray-900'}`}>
          Dine<span className="text-[#f97316]">Verse</span>
        </span>
      )}
    </div>
  );
}
