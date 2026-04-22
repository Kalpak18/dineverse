import { useEffect, useState } from 'react';

export default function InstallBanner() {
  const [prompt, setPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isInStandaloneMode, setIsInStandaloneMode] = useState(false);

  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    setIsIos(ios);
    setIsInStandaloneMode(standalone);

    const handler = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Already installed or dismissed this session
  if (isInStandaloneMode || dismissed) return null;
  // Android: wait for the browser event
  if (!isIos && !prompt) return null;

  const handleInstall = async () => {
    if (prompt) {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') setDismissed(true);
    }
  };

  return (
    <>
      {/* ── Desktop (md+): top-right corner card — never blocks content ── */}
      <div className="hidden md:block fixed top-4 right-4 z-50 w-72">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-3 flex items-center gap-3">
          <img src="/icons/header_logo_round_192x192.png" alt="DineVerse" className="w-10 h-10 rounded-xl shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 leading-tight">Install DineVerse</p>
            {isIos ? (
              <p className="text-[11px] text-gray-500 mt-0.5">Tap Share → Add to Home Screen</p>
            ) : (
              <p className="text-[11px] text-gray-500 mt-0.5">Add to desktop for quick access</p>
            )}
          </div>
          {!isIos && (
            <button onClick={handleInstall} className="shrink-0 px-3 py-1.5 bg-brand-500 text-white text-xs font-semibold rounded-lg">
              Install
            </button>
          )}
          <button onClick={() => setDismissed(true)} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 text-sm" aria-label="Dismiss">
            ✕
          </button>
        </div>
      </div>

      {/* ── Mobile: slim bottom strip — keeps content above it via padding ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 shadow-lg px-3 py-2 safe-area-bottom">
        <div className="flex items-center gap-2.5 max-w-lg mx-auto">
          <img src="/icons/header_logo_round_192x192.png" alt="DineVerse" className="w-8 h-8 rounded-lg shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-900 leading-tight">Install DineVerse</p>
            {isIos ? (
              <p className="text-[10px] text-gray-400">Tap Share → Add to Home Screen</p>
            ) : (
              <p className="text-[10px] text-gray-400">Add to home screen for best experience</p>
            )}
          </div>
          {!isIos && (
            <button onClick={handleInstall} className="shrink-0 px-3 py-1.5 bg-brand-500 text-white text-xs font-semibold rounded-lg">
              Install
            </button>
          )}
          <button onClick={() => setDismissed(true)} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 text-sm" aria-label="Dismiss">
            ✕
          </button>
        </div>
      </div>
    </>
  );
}
