import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { encodeReceipt } from '../utils/escpos';
import { PRINTER_METHODS, getPrinter, savePrinter, sendToPrinter, forgetPrinterConnection } from '../utils/printers';

// This device's receipt printer: how it's connected, paper width, auto-cut —
// then "Connect & test print". Saved on the device (each counter / kitchen
// device can use its own printer).
export default function PrinterSetup({ onClose }) {
  const { cafe } = useAuth();
  const [cfg, setCfg] = useState(getPrinter);
  const [testing, setTesting] = useState(false);
  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

  const save = () => { savePrinter(cfg); toast.success('Printer saved'); onClose(); };

  const test = async () => {
    savePrinter(cfg);
    forgetPrinterConnection();
    setTesting(true);
    try {
      await sendToPrinter(encodeReceipt([
        { text: cafe?.name || 'DineVerse', align: 'center', bold: true, big: true },
        { text: 'Test print', align: 'center' },
        { rule: '-' },
        { qty: 2, name: 'Masala Chai', amount: '40.00' },
        { left: 'TOTAL', right: 'Rs.40.00', bold: true },
        { text: `${cfg.width} mm paper — if this fits, you're set`, align: 'center' },
      ], cfg), { choose: true });
      toast.success('Test print sent');
    } catch (err) {
      if (err?.name !== 'NotFoundError') toast.error(err?.message || 'Could not reach the printer');
    } finally {
      setTesting(false);
    }
  };

  const direct = cfg.method !== 'system';

  return (
    <div className="fixed inset-0 z-[9995] bg-black/60 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Printer setup">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="font-bold">Receipt printer (this device)</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-w-[44px] min-h-[44px] text-2xl text-gray-500">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          <fieldset className="space-y-1">
            <legend className="text-sm font-semibold mb-1">How is the printer connected?</legend>
            {PRINTER_METHODS.map((m) => {
              const ok = !m.supported || m.supported();
              return (
                <label key={m.id} className={`flex items-start gap-3 rounded-xl border p-3 ${cfg.method === m.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200'} ${ok ? '' : 'opacity-50'}`}>
                  <input type="radio" name="printer-method" className="mt-1" disabled={!ok}
                    checked={cfg.method === m.id} onChange={() => set({ method: m.id })} />
                  <span>
                    <span className="block text-sm font-semibold">{m.label}</span>
                    <span className="block text-xs text-gray-500">{ok ? m.hint : 'Not available in this browser — use Chrome'}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {direct && (
            <>
              <fieldset>
                <legend className="text-sm font-semibold mb-1">Paper width</legend>
                <div className="flex gap-2">
                  {[58, 80].map((w) => (
                    <button key={w} type="button" onClick={() => set({ width: w })} aria-pressed={cfg.width === w}
                      className={`flex-1 min-h-[44px] rounded-xl border font-bold ${cfg.width === w ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300'}`}>
                      {w} mm
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center justify-between min-h-[44px] text-sm">
                Cut the paper after each print
                <input type="checkbox" checked={cfg.cut !== false} onChange={(e) => set({ cut: e.target.checked })} />
              </label>
              {cfg.method === 'serial' && (
                <p className="text-xs text-gray-500">Bluetooth classic: first pair the printer in Android Settings → Bluetooth, then choose it after tapping the button below.</p>
              )}
              {cfg.method === 'rawbt' && (
                <p className="text-xs text-gray-500">Install <strong>RawBT</strong> from the Play Store and choose your printer inside it (Bluetooth, USB or network/Wi-Fi).</p>
              )}
            </>
          )}
        </div>
        <div className="p-3 border-t border-gray-100 space-y-2" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          {direct && (
            <button type="button" onClick={test} disabled={testing}
              className="w-full min-h-[48px] rounded-xl border-2 border-gray-900 font-bold disabled:opacity-60">
              {testing ? 'Connecting…' : 'Connect & test print'}
            </button>
          )}
          <button type="button" onClick={save} className="w-full min-h-[48px] rounded-xl bg-gray-900 text-white font-bold">Save</button>
        </div>
      </div>
    </div>
  );
}
