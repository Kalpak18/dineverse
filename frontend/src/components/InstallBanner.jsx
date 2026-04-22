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
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 safe-area-bottom">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 flex items-center gap-3 max-w-lg mx-auto">
        <img src="/icons/header_logo_round_192x192.png" alt="DineVerse" className="w-12 h-12 rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">Install DineVerse</p>
          {isIos ? (
            <p className="text-xs text-gray-500 mt-0.5">
              Tap <strong>Share</strong> then <strong>Add to Home Screen</strong>
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-0.5">Add to home screen for the best experience</p>
          )}
        </div>
        {!isIos && (
          <button
            onClick={handleInstall}
            className="shrink-0 px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-xl"
          >
            Install
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 text-lg"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
