import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { getMenuItems, getAreas } from '../services/api';
import toast from 'react-hot-toast';

// Each step: id, icon, title, why, how (bullet hints), action label, action route, doneCheck fn
const STEPS = [
  {
    id: 'profile',
    icon: '🎨',
    title: 'Complete your profile',
    why: 'Your logo and business name appear on every customer-facing page, printed bill, and the DineVerse Explore listing. Customers trust cafés with complete profiles.',
    hints: [
      'Upload a square logo (tap ⚙️ Profile → Basic Info)',
      'Upload a wide cover photo for the Explore listing',
      'Add your café description — tell customers what makes you special',
      'Set GPS coordinates so customers find you on the map',
    ],
    action: 'Open Profile →',
    route: '/owner/profile',
    done: (ctx) => !!ctx.cafe?.logo_url,
    doneLabel: 'Logo uploaded ✓',
  },
  {
    id: 'tax',
    icon: '🧾',
    title: 'Set up tax & billing details',
    why: 'GSTIN is required to print legal GST invoices. Setting your UPI ID and invoice prefix means bills are print-ready from day one.',
    hints: [
      'Go to Profile → Tax & Legal',
      'Enter your 15-digit GSTIN (the app validates it live)',
      'Set GST rate — most restaurants use 5%',
      'Add your UPI ID (shown to cashier at billing)',
      'Set invoice prefix e.g. "INV" → bills become INV-0001',
      'Add FSSAI license number (mandatory for food businesses)',
    ],
    action: 'Open Tax Settings →',
    route: '/owner/profile',
    done: (ctx) => !!ctx.cafe?.gst_number,
    doneLabel: 'GSTIN saved ✓',
  },
  {
    id: 'menu',
    icon: '🍽️',
    title: 'Build your menu',
    why: 'No items = no orders. Add your dishes with prices, veg/non-veg indicators, and photos. Photos increase order rate significantly.',
    hints: [
      '📷 Fastest: use "Import from Photo" — upload a photo of your printed menu and AI extracts everything',
      'Or manually: Menu → Categories → Add items under each',
      'Mark veg 🟢 / non-veg 🔴 for each item',
      'Add dietary tags (Spicy, Vegan, Gluten-Free…) to help allergy-conscious customers',
      'Enable stock tracking per item if you have limited quantities',
    ],
    action: 'Open Menu →',
    route: '/owner/menu',
    done: (ctx) => ctx.hasMenuItems,
    doneLabel: 'Menu items added ✓',
  },
  {
    id: 'tables',
    icon: '🪑',
    title: 'Set up tables & QR codes',
    why: 'Table QR codes let customers scan and order from their seat — no app download needed. When a customer scans T3, the order arrives tagged as Table 3.',
    hints: [
      'Tables → Add Area (e.g. "Ground Floor", "Rooftop", "AC Section")',
      'Add tables with labels (T1, T2, Window Seat, Corner Table…)',
      'Click ▦ QR on any table → download PNG → print → place on table',
      'For takeaway-only: skip this step, customers can still order via your link',
    ],
    action: 'Open Tables →',
    route: '/owner/tables',
    done: (ctx) => ctx.hasTables,
    doneLabel: 'Tables configured ✓',
  },
  {
    id: 'staff',
    icon: '👥',
    title: 'Add staff accounts (optional)',
    why: 'Give your kitchen team and cashiers their own login. Kitchen staff see only the kitchen display. Cashiers handle orders and billing. No shared passwords.',
    hints: [
      'Staff → Add Staff → enter name, email, set a password',
      'Roles: Cashier (orders + billing), Kitchen (KDS only), Manager (everything except billing)',
      'Staff log in at the same /owner/login page with their own email',
      'Disable a staff account anytime — they lose access immediately',
    ],
    action: 'Open Staff →',
    route: '/owner/staff',
    done: () => false, // optional — always show as actionable, never auto-complete
    optional: true,
    doneLabel: 'Staff added',
  },
  {
    id: 'share',
    icon: '📢',
    title: 'Share your link & go live',
    why: 'Your café is invisible until you share the link. Toggle Open on the Dashboard, then share your link on WhatsApp, Instagram, Google Business, and printed materials.',
    hints: [
      'Dashboard → click the Open toggle to start accepting orders',
      'Copy your link: dine-verse.com/cafe/your-slug',
      'WhatsApp your regulars: "We\'re now on DineVerse — order here!"',
      'Tables → download table QR codes → print and place on tables',
      'Post the link on Instagram bio, Google Business, and printed menus',
    ],
    action: 'Go to Dashboard →',
    route: '/owner/dashboard',
    done: (ctx) => !!ctx.cafe?.is_open,
    doneLabel: 'Café is live 🟢',
  },
];

export default function SetupWizard({ onComplete, initialStep = 0 }) {
  const { cafe } = useAuth();
  const navigate  = useNavigate();
  const [step,    setStep]    = useState(initialStep);
  const [ctx,     setCtx]     = useState({ cafe, hasMenuItems: false, hasTables: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getMenuItems().catch(() => ({ data: { items: [] } })),
      getAreas().catch(()     => ({ data: { areas: [] } })),
    ]).then(([itemsRes, areasRes]) => {
      const tables = (areasRes.data.areas || []).flatMap((a) => a.tables || []);
      setCtx({
        cafe,
        hasMenuItems: (itemsRes.data.items || []).length > 0,
        hasTables:    tables.length > 0,
      });
    }).finally(() => setLoading(false));
  }, [cafe]);

  const current    = STEPS[step];
  const isDone     = current.done(ctx);
  const totalSteps = STEPS.length;
  const doneCount  = STEPS.filter((s) => s.done(ctx)).length;

  const goNext = () => {
    if (step < totalSteps - 1) setStep(step + 1);
    else onComplete?.();
  };

  const handleAction = () => {
    onComplete?.();
    navigate(current.route);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="bg-gradient-to-r from-brand-500 to-orange-500 text-white px-5 py-4 rounded-t-3xl sm:rounded-t-2xl flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{current.icon}</span>
              <span className="font-bold text-lg leading-tight">{current.title}</span>
            </div>
            <button
              onClick={onComplete}
              className="text-white/70 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center"
            >
              ×
            </button>
          </div>

          {/* Step dots */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => {
              const done = s.done(ctx);
              return (
                <button
                  key={s.id}
                  onClick={() => setStep(i)}
                  className={`transition-all rounded-full flex items-center justify-center text-[10px] font-bold
                    ${i === step
                      ? 'w-7 h-7 bg-white text-brand-600 shadow'
                      : done
                        ? 'w-5 h-5 bg-white/40 text-white'
                        : 'w-5 h-5 bg-white/20 text-white/60'
                    }`}
                >
                  {done ? '✓' : i + 1}
                </button>
              );
            })}
            <span className="ml-auto text-white/80 text-xs font-medium">
              {doneCount}/{totalSteps - 1} done
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Status badge */}
              {isDone ? (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-xl px-3 py-2 text-sm font-medium">
                  <span>✅</span> {current.doneLabel}
                </div>
              ) : current.optional ? (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-xl px-3 py-2 text-sm">
                  <span>ℹ️</span> Optional step — skip if you handle orders solo
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-3 py-2 text-sm font-medium">
                  <span>⚠️</span> Not done yet
                </div>
              )}

              {/* Why it matters */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Why this matters</p>
                <p className="text-sm text-gray-700 leading-relaxed">{current.why}</p>
              </div>

              {/* How to do it */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">How to do it</p>
                <ul className="space-y-1.5">
                  {current.hints.map((h, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-600">
                      <span className="text-brand-400 flex-shrink-0 mt-0.5">→</span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-gray-100 px-5 py-4 flex gap-2 flex-shrink-0">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              ← Back
            </button>
          )}

          {!isDone && (
            <button
              onClick={handleAction}
              className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors"
            >
              {current.action}
            </button>
          )}

          {step < totalSteps - 1 ? (
            <button
              onClick={goNext}
              className={`${isDone ? 'flex-1' : ''} px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors whitespace-nowrap`}
            >
              {isDone ? 'Next →' : 'Skip'}
            </button>
          ) : (
            <button
              onClick={onComplete}
              className={`${isDone ? 'flex-1 bg-green-500 hover:bg-green-600 text-white border-0' : ''} px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium transition-colors`}
            >
              {isDone ? 'Done 🎉' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
