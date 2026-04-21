/**
 * DineLogo — renders the DineVerse logo icon + wordmark.
 *
 * Props:
 *   size  — 'sm' | 'md' | 'lg' | 'xl'  (default 'md')
 *   white — bool, render "Verse" in white (for dark backgrounds)
 *   icon  — bool, icon-only mode (no wordmark)
 *
 * Size reference:
 *   sm  (h-9  ≈ 36px)  → navbar / sidebar
 *   md  (h-12 ≈ 48px)  → general use
 *   lg  (h-20 ≈ 80px)  → standalone display
 *   xl  (h-28 ≈ 112px) → login / hero
 */

const ICON_SRC = {
  sm:  '/icons/header_logo_round_192x192.png',
  md:  '/icons/header_logo_round_192x192.png',
  lg:  '/icons/header_logo_round_512x512.png',
  xl:  '/icons/header_logo_round_512x512.png',
};
const ICON_FALLBACK = '/icons/header_logo_round_192x192.png';

// Accent sizes for the orange V notch (relative to font size)
const NOTCH_SIZE = { sm: '0.38em', md: '0.38em', lg: '0.36em', xl: '0.35em' };

export default function DineLogo({ size = 'md', white = false, icon = false }) {
  const dims = { sm: 'h-9',  md: 'h-12',  lg: 'h-20',  xl: 'h-28'  };
  const text = { sm: 'text-lg', md: 'text-xl', lg: 'text-3xl', xl: 'text-4xl' };
  const gap  = { sm: 'gap-2',   md: 'gap-2.5', lg: 'gap-3',   xl: 'gap-4'    };

  const verseColor = white ? '#ffffff' : '#0f1535';

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
          className={`${text[size]} tracking-tight leading-none`}
          style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 900 }}
        >
          <span style={{ color: '#f97316' }}>Dine</span>
          <span style={{ color: verseColor }}>
            {/* V with orange accent notch at the base */}
            <span style={{ position: 'relative', display: 'inline-block' }}>
              V
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  bottom: '0.05em',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  display: 'block',
                  width: NOTCH_SIZE[size],
                  height: NOTCH_SIZE[size],
                  background: '#f97316',
                  borderRadius: '50%',
                  opacity: 0.92,
                }}
              />
            </span>
            erse
          </span>
        </span>
      )}
    </div>
  );
}
