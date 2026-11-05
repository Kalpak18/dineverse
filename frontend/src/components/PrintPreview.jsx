import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { PRINT_EVENT, printNow, setPreviewMounted } from '../utils/printWindow';
import { encodeReceipt } from '../utils/escpos';
import { getPrinter, sendToPrinter, PRINTER_METHODS } from '../utils/printers';
import PrinterSetup from './PrinterSetup';

// In-app preview for bills, KOTs and serving slips (like Petpooja / Toast):
// staff see the document inside the app and choose Print, WhatsApp, Share or
// Close. The phone's Back button closes the preview and stays in the app.
export default function PrintPreview() {
  const [doc, setDoc] = useState(null); // { html, title, share, receipt }
  const [printing, setPrinting] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [printer, setPrinter] = useState(getPrinter);
  const pushed = useRef(false);

  useEffect(() => {
    setPreviewMounted(true);
    const open = (e) => setDoc(e.detail);
    window.addEventListener(PRINT_EVENT, open);
    return () => { setPreviewMounted(false); window.removeEventListener(PRINT_EVENT, open); };
  }, []);

  // Back button / gesture closes the preview instead of leaving the page
  useEffect(() => {
    if (!doc) return undefined;
    if (!pushed.current) {
      window.history.pushState({ dvPrintPreview: true }, '');
      pushed.current = true;
    }
    const onPop = () => { pushed.current = false; setDoc(null); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey); };
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (pushed.current) { pushed.current = false; window.history.back(); } // popstate clears it
    setDoc(null);
  };

  // Print: straight to this device's receipt printer when one is set up,
  // otherwise (or if it fails) the device's print screen
  const print = async () => {
    const cfg = getPrinter();
    if (cfg.method === 'system' || !doc.receipt) { printNow(doc.html); return; }
    setPrinting(true);
    try {
      await sendToPrinter(encodeReceipt(doc.receipt, cfg), { choose: true });
      toast.success('Sent to the printer');
    } catch (err) {
      toast((t) => (
        <span className="flex items-center gap-3">
          Printer: {err?.message || 'not reachable'}
          <button type="button" className="min-h-[36px] px-3 rounded-lg bg-gray-900 text-white text-sm font-bold"
            onClick={() => { toast.dismiss(t.id); printNow(doc.html); }}>Use print screen</button>
        </span>
      ), { duration: 8000 });
    } finally {
      setPrinting(false);
    }
  };
  const methodLabel = PRINTER_METHODS.find((m) => m.id === printer.method)?.label || 'Device print screen';

  if (!doc) return null;

  const phone = (doc.share?.phone || '').replace(/\D/g, '').replace(/^0+/, '');
  const waNumber = phone.length === 10 ? `91${phone}` : phone;
  const waLink = doc.share?.text && `https://wa.me/${waNumber}?text=${encodeURIComponent(doc.share.text)}`;
  const canShare = !!doc.share?.text && typeof navigator.share === 'function';

  return (
    <div className="fixed inset-0 z-[9990] flex items-end sm:items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label={`${doc.title} preview`}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl flex flex-col max-h-[100dvh] sm:max-h-[90vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">{doc.title}</h2>
          <button type="button" onClick={close} aria-label="Close preview"
            className="min-w-[44px] min-h-[44px] -mr-2 text-2xl leading-none text-gray-500">×</button>
        </div>

        {/* The document exactly as it will print; sandboxed (no scripts) */}
        <div className="flex-1 min-h-0 overflow-auto bg-gray-100 p-3 flex justify-center">
          <iframe title={`${doc.title} document`} sandbox="" srcDoc={doc.html}
            className="bg-white shadow w-[320px] max-w-full h-[60vh] sm:h-[62vh] border-0" />
        </div>

        <div className="p-3 border-t border-gray-100 space-y-2" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <div className="flex gap-2">
            <button type="button" onClick={print} disabled={printing}
              className="flex-1 min-h-[48px] rounded-xl bg-gray-900 text-white font-bold disabled:opacity-60">
              {printing ? 'Printing…' : '🖨️ Print'}
            </button>
            <button type="button" onClick={() => setSetupOpen(true)} aria-label="Printer setup"
              className="min-h-[48px] px-3 rounded-xl border border-gray-300 text-sm font-semibold">⚙️ Printer</button>
          </div>
          <p className="text-[11px] text-center text-gray-500">Printer: {methodLabel}{printer.method !== 'system' ? ` · ${printer.width} mm` : ''}</p>
          {(waLink || canShare) && (
            <div className="grid grid-cols-2 gap-2">
              {waLink && (
                <a href={waLink} target="_blank" rel="noopener noreferrer"
                  className={`min-h-[44px] rounded-xl bg-green-600 text-white font-semibold flex items-center justify-center ${canShare ? '' : 'col-span-2'}`}>
                  💬 WhatsApp
                </a>
              )}
              {canShare && (
                <button type="button" onClick={() => navigator.share({ title: doc.title, text: doc.share.text }).catch(() => {})}
                  className={`min-h-[44px] rounded-xl border border-gray-300 font-semibold ${waLink ? '' : 'col-span-2'}`}>
                  📤 Share
                </button>
              )}
            </div>
          )}
          <button type="button" onClick={close} className="w-full min-h-[44px] rounded-xl border border-gray-300 font-semibold text-gray-700">
            Close
          </button>
          {printer.method === 'system' && (
            <p className="text-[11px] text-center text-gray-400">Print opens your device's print screen — press Back there to return. Set up a receipt printer with ⚙️ to skip it.</p>
          )}
        </div>
      </div>
      {setupOpen && <PrinterSetup onClose={() => { setSetupOpen(false); setPrinter(getPrinter()); }} />}
    </div>
  );
}
