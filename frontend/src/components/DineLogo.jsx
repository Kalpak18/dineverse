/**
 * DineLogo — renders the DineVerse logo icon + wordmark.
 *
 * Props:
 *   size   — 'sm' | 'md' | 'lg'  (default 'md')
 *   white  — bool, render wordmark in white (for dark backgrounds)
 *   icon   — bool, icon-only mode (no wordmark)
 *
 * Icon source selection by size:
 *   sm  (h-7  ≈ 28px) → favicon-32x32.png
 *   md  (h-9  ≈ 36px) → favicon-64x64.png
 *   lg  (h-12 ≈ 48px) → favicon-128x128.png
 * Falls back to icon-192.svg if the PNG fails to load.
 */

const ICON_SRC = {
  sm:  '/icons/favicon-128x128.png',
  md:  '/icons/favicon-128x128.png',
  lg:  '/icons/favicon-256x256.png',
};
const ICON_FALLBACK = '/icons/favicon-256x256.png';

export default function DineLogo({ size = 'md', white = false, icon = false }) {
  const dims = { sm: 'h-7', md: 'h-9', lg: 'h-12' };
  const text  = { sm: 'text-base', md: 'text-lg', lg: 'text-2xl' };

  return (
    <div className="flex items-center gap-2 select-none">
      <img
        src={ICON_SRC[size]}
        alt="DineVerse"
        className={`${dims[size]} w-auto object-contain flex-shrink-0`}
        onError={(e) => { e.currentTarget.src = ICON_FALLBACK; }}
      />
      {!icon && (
        <span className={`font-black ${text[size]} tracking-tight ${white ? 'text-white' : 'text-gray-900'}`}>
          Dine<span className="text-[#f97316]">Verse</span>
        </span>
      )}
    </div>
  );
}
