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

  // Shared card — positioned top-right on desktop, bottom-right on mobile
  // bottom-20 on mobile keeps it above floating cart/FAB buttons (which sit at bottom-4)
  return (
    <div className="fixed z-50 bottom-20 right-3 md:bottom-6 md:right-6 w-72 max-w-[calc(100vw-1.5rem)]">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-3 flex items-center gap-3">
        <img src="/icons/header_logo_round_192x192.png" alt="DineVerse" className="w-10 h-10 rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-tight">Install DineVerse</p>
          {isIos ? (
            <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">Tap Share → Add to Home Screen</p>
          ) : (
            <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">Add to home screen for the best experience</p>
          )}
        </div>
        {!isIos && (
          <button onClick={handleInstall} className="shrink-0 px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold rounded-lg transition-colors">
            Install
          </button>
        )}
        <button onClick={() => setDismissed(true)} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 transition-colors" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}
