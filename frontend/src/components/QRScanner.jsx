/**
 * QRScanner — unified QR scanner.
 * On Capacitor (iOS/Android): uses @capacitor-community/barcode-scanner (full-screen native).
 * On web: uses getUserMedia + BarcodeDetector API (Chrome/Edge/Safari TP) with jsQR canvas fallback.
 *
 * Props:
 *   onScan(text: string)  — called when a QR code is read
 *   onClose()             — called when user taps Cancel
 */
import { useEffect, useRef, useState, useCallback } from 'react';

// Detect Capacitor native runtime
const isNative = () =>
  typeof window !== 'undefined' &&
  typeof window.Capacitor !== 'undefined' &&
  window.Capacitor.isNativePlatform?.();

// ── Native (Capacitor) scanner ────────────────────────────────
async function startNativeScanner(onScan, onError) {
  try {
    const { BarcodeScanner } = await import(/* @vite-ignore */ '@capacitor-community/barcode-scanner');
    await BarcodeScanner.checkPermission({ force: true });
    document.body.classList.add('scanner-active'); // make body transparent
    await BarcodeScanner.hideBackground();
    const result = await BarcodeScanner.startScan();
    document.body.classList.remove('scanner-active');
    await BarcodeScanner.showBackground();
    if (result.hasContent) onScan(result.content);
  } catch (err) {
    document.body.classList.remove('scanner-active');
    onError(err);
  }
}

async function stopNativeScanner() {
  try {
    const { BarcodeScanner } = await import(/* @vite-ignore */ '@capacitor-community/barcode-scanner');
    await BarcodeScanner.stopScan();
    await BarcodeScanner.showBackground();
    document.body.classList.remove('scanner-active');
  } catch { /* ignore */ }
}

// ── Web scanner ───────────────────────────────────────────────
function WebScanner({ onScan, onClose }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef    = useRef(null);
  const [error, setError]         = useState(null);
  const [permDenied, setPermDenied] = useState(false);
  const [torch, setTorch]         = useState(false);
  const [ready, setReady]         = useState(false);
  const [scanning, setScanning]   = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const stopStream = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [stopStream, onClose]);

  const detect = useCallback(async (detector) => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(() => detect(detector));
      return;
    }
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0);

    try {
      let barcodes = [];
      if (detector) {
        barcodes = await detector.detect(canvas);
      } else {
        // jsQR fallback
        const { default: jsQR } = await import(/* @vite-ignore */ 'jsqr');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) barcodes = [{ rawValue: code.data }];
      }

      if (barcodes.length > 0) {
        stopStream();
        onScan(barcodes[0].rawValue);
        return;
      }
    } catch { /* continue scanning */ }

    rafRef.current = requestAnimationFrame(() => detect(detector));
  }, [onScan, stopStream]);

  useEffect(() => {
    let detector = null;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if ('BarcodeDetector' in window) {
          detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        }

        setReady(true);
        setScanning(true);
        detect(detector);
      } catch (err) {
        if (err.name === 'NotAllowedError') {
          setPermDenied(true);
        } else {
          setError('Could not access camera: ' + err.message);
        }
      }
    })();

    return () => { cancelled = true; stopStream(); };
  }, [detect, stopStream, retryCount]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const newVal = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: newVal }] });
      setTorch(newVal);
    } catch { /* torch not supported */ }
  }, [torch]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Video feed */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Scanning frame overlay */}
        {ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative w-64 h-64">
              {/* Corner brackets */}
              {[
                'top-0 left-0 border-t-4 border-l-4 rounded-tl-lg',
                'top-0 right-0 border-t-4 border-r-4 rounded-tr-lg',
                'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-lg',
                'bottom-0 right-0 border-b-4 border-r-4 rounded-br-lg',
              ].map((cls, i) => (
                <div key={i} className={`absolute w-10 h-10 border-brand-400 ${cls}`} />
              ))}
              {/* Scan line */}
              {scanning && (
                <div className="absolute inset-x-0 top-0 h-0.5 bg-brand-400 animate-scan-line" />
              )}
            </div>
          </div>
        )}

        {/* Camera permission denied */}
        {permDenied && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="bg-white rounded-2xl p-6 text-center max-w-sm w-full">
              <p className="text-3xl mb-3">📵</p>
              <p className="text-base font-semibold text-gray-900 mb-2">Camera access blocked</p>
              <p className="text-sm text-gray-600 mb-4">
                To use the scanner, allow camera access in your browser:
              </p>
              <ol className="text-left text-sm text-gray-700 space-y-2 mb-5">
                <li className="flex gap-2">
                  <span className="font-bold text-brand-500 shrink-0">1.</span>
                  <span>Tap the <strong>lock / info icon</strong> in the address bar at the top of your browser.</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-brand-500 shrink-0">2.</span>
                  <span>Find <strong>Camera</strong> and change it to <strong>Allow</strong>.</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-brand-500 shrink-0">3.</span>
                  <span>Come back here and tap <strong>Try Again</strong>.</span>
                </li>
              </ol>
              <div className="flex gap-3">
                <button
                  onClick={handleClose}
                  className="flex-1 px-4 py-2 rounded-xl border border-gray-300 text-sm font-medium text-gray-700"
                >
                  Go Back
                </button>
                <button
                  onClick={() => { setPermDenied(false); setRetryCount((c) => c + 1); }}
                  className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-xl text-sm font-semibold"
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Generic error */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="bg-white rounded-2xl p-6 text-center max-w-sm">
              <p className="text-2xl mb-3">⚠️</p>
              <p className="text-sm text-gray-700 font-medium">{error}</p>
              <button onClick={handleClose} className="mt-4 px-5 py-2 bg-brand-500 text-white rounded-xl text-sm font-semibold">
                Go Back
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="bg-black/80 backdrop-blur px-6 py-5 flex items-center justify-between safe-area-bottom">
        <button onClick={handleClose} className="text-white font-medium text-sm px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition">
          ✕ Cancel
        </button>
        <p className="text-white/70 text-xs text-center">
          Point camera at<br />café QR code
        </p>
        <button
          onClick={toggleTorch}
          className={`text-sm px-4 py-2 rounded-xl transition ${
            torch ? 'bg-yellow-400 text-black' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          {torch ? '🔦 On' : '🔦 Off'}
        </button>
      </div>
    </div>
  );
}

// ── Native wrapper ────────────────────────────────────────────
function NativeScanner({ onScan, onClose }) {
  const [error, setError] = useState(null);

  useEffect(() => {
    startNativeScanner(
      (text) => { onScan(text); },
      (err)  => { setError(err?.message || 'Scanner error'); }
    );
    return () => { stopNativeScanner(); };
  }, [onScan]);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center p-8">
        <div className="bg-white rounded-2xl p-6 text-center max-w-sm">
          <p className="text-2xl mb-3">📵</p>
          <p className="text-sm text-gray-700 font-medium">{error}</p>
          <button onClick={onClose} className="mt-4 px-5 py-2 bg-brand-500 text-white rounded-xl text-sm font-semibold">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // The native scanner renders its own full-screen UI; show a minimal overlay
  return (
    <div className="fixed inset-0 z-50 bg-transparent flex flex-col pointer-events-none">
      <div className="mt-auto mb-12 flex justify-center pointer-events-auto">
        <button
          onClick={() => { stopNativeScanner(); onClose(); }}
          className="px-6 py-3 bg-white/90 text-gray-900 rounded-2xl font-semibold text-sm shadow-lg"
        >
          ✕ Cancel
        </button>
      </div>
    </div>
  );
}

// ── Public export ─────────────────────────────────────────────
export default function QRScanner({ onScan, onClose }) {
  return isNative()
    ? <NativeScanner onScan={onScan} onClose={onClose} />
    : <WebScanner    onScan={onScan} onClose={onClose} />;
}
