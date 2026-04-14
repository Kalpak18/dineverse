/**
 * CustomerTour — a simple step-by-step "how to order" overlay shown
 * the first time a customer visits any café page on DineVerse.
 *
 * Stored in localStorage so it only shows once across all café visits.
 * The owner can never trigger this (it's customer-side only).
 */
import { useState, useEffect } from 'react';

const TOUR_KEY = 'dineverse_customer_tour_done';

const STEPS = [
  {
    icon: '🍽️',
    title: 'Browse the Menu',
    body: 'Scroll through categories and tap any item to see its details. Veg items have a green dot, non-veg have red.',
  },
  {
    icon: '🛒',
    title: 'Add to Cart',
    body: 'Tap + to add items. Your cart total appears at the bottom of the screen — tap it to review before placing.',
  },
  {
    icon: '📋',
    title: 'Place Your Order',
    body: 'Enter your name and table number (or choose Takeaway), then confirm. You\'ll get a live order token.',
  },
  {
    icon: '🔔',
    title: 'Track in Real-Time',
    body: 'Watch your order move from Pending → Preparing → Ready. You\'ll be notified the moment it\'s done.',
  },
  {
    icon: '💬',
    title: 'Chat with the Café',
    body: 'Need to add a special request or ask something? Open the chat on your order page and the café will respond.',
  },
];

export default function CustomerTour() {
  const [show, setShow]   = useState(false);
  const [step, setStep]   = useState(0);

  useEffect(() => {
    if (!localStorage.getItem(TOUR_KEY)) {
      // Small delay so the page content loads first
      const t = setTimeout(() => setShow(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const finish = () => {
    localStorage.setItem(TOUR_KEY, '1');
    setShow(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else finish();
  };

  if (!show) return null;

  const current = STEPS[step];
  const isLast  = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={finish} />

      {/* Card */}
      <div
        className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
        style={{ animation: 'tourSlideUp 0.3s ease-out' }}
      >
        {/* Orange accent bar */}
        <div className="h-1.5 bg-gradient-to-r from-brand-400 to-orange-400" />

        {/* Skip */}
        <button
          onClick={finish}
          className="absolute top-4 right-4 text-xs text-gray-400 hover:text-gray-600 font-medium"
        >
          Skip
        </button>

        {/* Content */}
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center text-4xl mx-auto mb-4">
            {current.icon}
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">{current.title}</h2>
          <p className="text-sm text-gray-500 leading-relaxed">{current.body}</p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 pb-4">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`rounded-full transition-all ${
                i === step
                  ? 'w-5 h-2 bg-brand-500'
                  : 'w-2 h-2 bg-gray-200 hover:bg-gray-300'
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Back
            </button>
          )}
          <button
            onClick={next}
            className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold transition-colors"
          >
            {isLast ? "Let's Order! 🚀" : 'Next →'}
          </button>
        </div>

        {/* Step counter */}
        <p className="text-center text-[11px] text-gray-300 pb-3">
          {step + 1} of {STEPS.length}
        </p>
      </div>

      <style>{`
        @keyframes tourSlideUp {
          from { transform: translateY(40px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
