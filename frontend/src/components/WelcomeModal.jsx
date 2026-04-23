import { useEffect } from 'react';
import DineLogo from './DineLogo';

const STEPS = [
  {
    icon: '🍽️',
    title: 'Add your menu',
    desc: 'Upload your dishes, categories, and prices. Customers will browse and order from this.',
    color: 'bg-orange-50 border-orange-100',
    iconBg: 'bg-orange-100',
  },
  {
    icon: '🪑',
    title: 'Set up tables & QR',
    desc: 'Create your table layout and generate QR codes. Customers scan to view your menu instantly.',
    color: 'bg-blue-50 border-blue-100',
    iconBg: 'bg-blue-100',
  },
  {
    icon: '🟢',
    title: 'Go live',
    desc: 'Toggle your café Open and share your menu link. You\'re ready to accept orders.',
    color: 'bg-green-50 border-green-100',
    iconBg: 'bg-green-100',
  },
];

/**
 * WelcomeModal — shown once per account after first registration.
 * Stored in localStorage as `dv_welcomed_${cafeId}`.
 *
 * Props:
 *   cafeName   string
 *   cafeId     string
 *   onSetup    fn()   opens the setup wizard
 *   onDismiss  fn()
 */
export default function WelcomeModal({ cafeName, cafeId, onSetup, onDismiss }) {
  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleSetup = () => {
    localStorage.setItem(`dv_welcomed_${cafeId}`, '1');
    onSetup?.();
  };

  const handleDismiss = () => {
    localStorage.setItem(`dv_welcomed_${cafeId}`, '1');
    onDismiss?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in">

        {/* Header */}
        <div className="bg-gradient-to-br from-brand-500 to-orange-500 px-8 pt-8 pb-6 text-center text-white">
          <div className="flex justify-center mb-4">
            <DineLogo size="lg" white />
          </div>
          <h2 className="text-2xl font-bold">Welcome to DineVerse!</h2>
          <p className="text-orange-100 text-sm mt-1">
            {cafeName ? `${cafeName} is almost ready.` : 'Your café is almost ready.'} Here's how to get started:
          </p>
        </div>

        {/* Steps */}
        <div className="px-6 py-5 space-y-3">
          {STEPS.map((step, i) => (
            <div key={i} className={`flex items-start gap-4 rounded-2xl border p-4 ${step.color}`}>
              <div className={`w-10 h-10 rounded-xl ${step.iconBg} flex items-center justify-center text-xl flex-shrink-0`}>
                {step.icon}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 text-sm">
                  <span className="text-gray-400 mr-1">{i + 1}.</span> {step.title}
                </p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 space-y-2">
          <button
            onClick={handleSetup}
            className="btn-primary w-full py-3 text-base font-bold"
          >
            Open Setup Guide →
          </button>
          <button
            onClick={handleDismiss}
            className="w-full text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors"
          >
            Skip for now — I'll explore on my own
          </button>
        </div>
      </div>
    </div>
  );
}
