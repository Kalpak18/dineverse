import { useState } from 'react';

/**
 * Collapsible "how to use this page" hint banner.
 * Shows automatically on first visit; can be re-opened via the ? button
 * that the parent renders (by passing showButton={true}).
 *
 * Props:
 *   storageKey  – unique localStorage key e.g. "dv_hint_orders"
 *   title       – short page description
 *   items       – array of { icon, text } tip objects
 *   tip         – optional single pro-tip string shown at bottom
 */
export default function PageHint({ storageKey, title, items = [], tip }) {
  const [open, setOpen] = useState(() => !localStorage.getItem(storageKey));

  const dismiss = () => {
    localStorage.setItem(storageKey, '1');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-600 border border-gray-200 hover:border-brand-300 px-2.5 py-1.5 rounded-lg transition-colors"
        title="How to use this page"
      >
        <span className="font-bold">?</span> How it works
      </button>
    );
  }

  return (
    <div className="bg-brand-50 border border-brand-200 rounded-2xl px-4 py-4 mb-2">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-sm font-semibold text-brand-900">{title}</p>
        <button
          onClick={dismiss}
          className="text-brand-400 hover:text-brand-700 text-lg leading-none flex-shrink-0 -mt-0.5"
        >
          ×
        </button>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-brand-800">
            <span className="flex-shrink-0">{item.icon}</span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
      {tip && (
        <p className="mt-3 text-xs text-brand-700 bg-white/60 rounded-xl px-3 py-2 border border-brand-200">
          💡 {tip}
        </p>
      )}
      <button
        onClick={dismiss}
        className="mt-3 text-xs text-brand-500 hover:text-brand-700 font-medium"
      >
        Got it, don't show again
      </button>
    </div>
  );
}
