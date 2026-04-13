/**
 * DineLogo — renders the DineVerse logo icon + wordmark.
 *
 * Props:
 *   size   — 'sm' | 'md' | 'lg' | 'xl'  (default 'md')
 *   white  — bool, render wordmark in white (for dark backgrounds)
 *   icon   — bool, icon-only mode (no wordmark)
 *
 * Size reference:
 *   sm  (h-9  ≈ 36px)  → navbar / sidebar
 *   md  (h-12 ≈ 48px)  → general use
 *   lg  (h-20 ≈ 80px)  → login / register pages
 *   xl  (h-28 ≈ 112px) → hero / splash screens
 */

const ICON_SRC = {
  sm:  '/icons/favicon-96x96.png',
  md:  '/icons/favicon-128x128.png',
  lg:  '/icons/favicon-256x256.png',
  xl:  '/icons/favicon-256x256.png',
};
const ICON_FALLBACK = '/icons/favicon-256x256.png';

export default function DineLogo({ size = 'md', white = false, icon = false }) {
  const dims = { sm: 'h-9', md: 'h-12', lg: 'h-20', xl: 'h-28' };
  const text  = { sm: 'text-lg', md: 'text-xl', lg: 'text-3xl', xl: 'text-4xl' };
  const gap   = { sm: 'gap-2', md: 'gap-2.5', lg: 'gap-3', xl: 'gap-4' };

  return (
    <div className={`flex items-center ${gap[size]} select-none`}>
      <img
        src={ICON_SRC[size]}
        alt="DineVerse"
        className={`${dims[size]} w-auto object-contain flex-shrink-0`}
        onError={(e) => { e.currentTarget.src = ICON_FALLBACK; }}
      />
      {!icon && (
        <span
          className={`${text[size]} tracking-tight`}
          style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 900 }}
        >
          <span className="text-[#f97316]">Dine</span>
          <span className={white ? 'text-white' : 'text-[#0f1535]'}>Verse</span>
        </span>
      )}
    </div>
  );
}
