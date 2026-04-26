import { useNavigate, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import DineLogo from '../components/DineLogo';

// ── Pricing data ──────────────────────────────────────────────
const PRICING = {
  INR: {
    essential: {
      perMonth: ['₹499', '₹449', '₹444'],
      total:    ['₹5,988', '₹10,788', '₹15,999'],
      save:     [null, 'Save ₹1,188', 'Save ₹1,965'],
    },
    pro: {
      perMonth: ['₹999', '₹899', '₹888'],
      total:    ['₹11,988', '₹21,576', '₹31,968'],
      save:     [null, 'Save ₹2,400', 'Save ₹3,996'],
    },
    footer: 'All prices include GST · Razorpay secured · Instant activation',
  },
  USD: {
    essential: {
      perMonth: ['$6', '$5.50', '$5'],
      total:    ['$72', '$132', '$180'],
      save:     [null, 'Save $12', 'Save $36'],
    },
    pro: {
      perMonth: ['$12', '$10.80', '$10'],
      total:    ['$144', '$259', '$360'],
      save:     [null, 'Save $29', 'Save $72'],
    },
    footer: 'Prices include applicable taxes · Secure payment · Instant activation',
  },
};

const DURATION_LABELS = ['1 Year', '2 Years', '3 Years'];
const DURATION_BADGES = [null, '10% OFF', 'BEST VALUE'];

async function detectCurrency() {
  const cached = sessionStorage.getItem('dv_pricing_currency');
  if (cached) return cached;
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
    const { country_code } = await res.json();
    const c = country_code === 'IN' ? 'INR' : 'USD';
    sessionStorage.setItem('dv_pricing_currency', c);
    return c;
  } catch { return 'INR'; }
}

function CheckIcon({ cls = 'text-green-500' }) {
  return (
    <svg className={`w-3.5 h-3.5 flex-shrink-0 ${cls}`} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [currency, setCurrency] = useState('INR');
  const [durIdx, setDurIdx]     = useState(1); // default: 2 years (most popular billing)

  useEffect(() => { detectCurrency().then(setCurrency); }, []);

  const p = PRICING[currency] ?? PRICING.INR;

  return (
    <div className="min-h-screen bg-white font-sans">

      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <DineLogo size="sm" />
          <div className="hidden md:flex items-center gap-8 text-sm text-gray-600">
            <a href="#how-it-works" className="hover:text-brand-600 transition-colors">How It Works</a>
            <a href="#features"     className="hover:text-brand-600 transition-colors">Features</a>
            <a href="#pricing"      className="hover:text-brand-600 transition-colors">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/owner/login')} className="text-sm text-gray-600 hover:text-gray-900 font-medium">
              Login
            </button>
            <button onClick={() => navigate('/owner/register')} className="text-sm bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 rounded-lg font-medium transition-colors">
              Start Free
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative bg-gradient-to-br from-brand-50 via-orange-50 to-white overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28 flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1 text-center md:text-left">
            <span className="inline-block text-xs font-semibold bg-brand-100 text-brand-700 px-3 py-1 rounded-full mb-5 tracking-wide uppercase">
              Built for Indian Restaurants & Cafés
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-gray-900 leading-tight mb-5">
              Stop losing orders.<br />
              <span className="text-brand-500">Start growing revenue.</span>
            </h1>
            <p className="text-lg text-gray-500 mb-8 max-w-md mx-auto md:mx-0">
              QR ordering, live kitchen display, and GST-ready billing — one platform
              that pays for itself in the first week. No hardware. No app downloads.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
              <button
                onClick={() => navigate('/owner/register')}
                className="px-7 py-3.5 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-xl text-base transition-colors shadow-lg shadow-brand-200"
              >
                Start 30-Day Free Trial
              </button>
              <button
                onClick={() => navigate('/explore')}
                className="px-7 py-3.5 bg-white hover:bg-gray-50 text-gray-800 font-bold rounded-xl text-base transition-colors border border-gray-200 shadow-sm"
              >
                Explore Cafés →
              </button>
            </div>
            <div className="mt-4 flex justify-center md:justify-start">
              <Link to="/scan" className="inline-flex items-center gap-2 text-sm text-brand-600 font-medium bg-brand-50 border border-brand-200 hover:bg-brand-100 transition-colors px-4 py-2.5 rounded-xl">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none" />
                  <rect x="14" y="3" width="7" height="7" rx="1" /><rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none" />
                  <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none" />
                  <rect x="14" y="14" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" /><rect x="18" y="14" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
                </svg>
                Scan café QR code to order
              </Link>
            </div>
            <div className="mt-5 flex flex-wrap justify-center md:justify-start gap-3">
              {[
                { icon: '🔒', label: 'Secured by Razorpay' },
                { icon: '🇮🇳', label: 'GST-ready billing' },
                { icon: '📱', label: 'Works on any phone' },
                { icon: '⚡', label: 'Live in one afternoon' },
              ].map(({ icon, label }) => (
                <span key={label} className="inline-flex items-center gap-1.5 text-xs text-gray-500 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-sm">
                  <span>{icon}</span> {label}
                </span>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">No credit card required · Cancel anytime · From {p.essential.perMonth[0]}/month after trial</p>
          </div>

          {/* Phone mockup */}
          <div className="flex-1 flex justify-center md:justify-end">
            <div className="relative">
              <div className="w-56 bg-gray-900 rounded-[2.5rem] p-3 shadow-2xl shadow-gray-400">
                <div className="bg-white rounded-[2rem] overflow-hidden h-[440px] flex flex-col">
                  <div className="bg-brand-500 px-4 py-3 flex items-center justify-between">
                    <span className="text-white font-bold text-sm">The Brew House</span>
                    <span className="text-white/80 text-xs">Table 5</span>
                  </div>
                  <div className="flex-1 px-3 py-2 space-y-2 overflow-hidden">
                    {[
                      { name: 'Cappuccino', price: '₹180', veg: true },
                      { name: 'Croissant',  price: '₹120', veg: true },
                      { name: 'Club Sandwich', price: '₹220', veg: false },
                    ].map((item) => (
                      <div key={item.name} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`w-3 h-3 rounded-sm border flex-shrink-0 ${item.veg ? 'border-green-500' : 'border-red-500'}`}>
                            <span className={`block w-1.5 h-1.5 rounded-full m-0.5 ${item.veg ? 'bg-green-500' : 'bg-red-500'}`} />
                          </span>
                          <span className="text-xs font-medium text-gray-800">{item.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{item.price}</span>
                          <button className="w-5 h-5 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center font-bold">+</button>
                        </div>
                      </div>
                    ))}
                    <div className="mt-3 px-1">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Kitchen Status</p>
                      {[
                        { name: 'Cappuccino', status: 'Ready ✅', cls: 'bg-green-50 text-green-700' },
                        { name: 'Croissant',  status: 'Preparing 🔥', cls: 'bg-orange-50 text-orange-700' },
                      ].map(item => (
                        <div key={item.name} className={`flex justify-between text-[10px] font-medium rounded-lg px-2 py-1 mb-1 ${item.cls}`}>
                          <span>{item.name}</span><span>{item.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-brand-500 mx-3 mb-3 rounded-xl px-4 py-2.5 flex items-center justify-between">
                    <span className="text-white text-xs font-medium">3 items · ₹520</span>
                    <span className="text-white text-xs font-bold">Place Order →</span>
                  </div>
                </div>
              </div>
              <div className="absolute -top-3 -right-6 bg-white border border-gray-200 shadow-lg rounded-2xl px-4 py-2.5">
                <p className="text-xs font-bold text-gray-900">🔔 New Order!</p>
                <p className="text-xs text-gray-500">Table 5 · ₹520</p>
              </div>
              <div className="absolute -bottom-3 -left-6 bg-white border border-gray-200 shadow-lg rounded-2xl px-4 py-2.5">
                <p className="text-xs font-bold text-green-700">✅ Bill Printed</p>
                <p className="text-xs text-gray-500">GST invoice · ₹520</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Social Proof Bar ── */}
      <section className="bg-gray-50 border-y border-gray-100 py-8">
        <div className="max-w-4xl mx-auto px-6 flex flex-wrap justify-center gap-8 text-center">
          {[
            { value: '500+', label: 'Cafés & Restaurants' },
            { value: '1L+',  label: 'Orders Processed' },
            { value: '4.9★', label: 'Average Rating' },
            { value: '30 days', label: 'Free Trial — No Card' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-2xl font-extrabold text-brand-600">{stat.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Problem Section ── */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">Sound familiar?</span>
            <h2 className="text-3xl font-extrabold text-gray-900 mt-2">Every café owner hits these walls</h2>
            <p className="text-gray-500 mt-3 max-w-xl mx-auto text-sm">
              Missed orders, manual billing, and zero visibility cost you money every single day.
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6 mb-12">
            {[
              { icon: '😤', title: 'Orders get lost or wrong', desc: 'Waiters mishear, kitchen misreads handwriting. Customers complain. Food gets remade. Revenue walks out.' },
              { icon: '🧾', title: 'Billing eats up your evening', desc: 'Calculating GST by hand, writing receipts, chasing UPI confirmations — your staff\'s time has a cost.' },
              { icon: '📉', title: 'You\'re flying blind', desc: 'You don\'t know your bestseller, your peak hour, or which table drives the most revenue. Decisions are guesswork.' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="bg-red-50 border border-red-100 rounded-2xl p-6">
                <p className="text-3xl mb-3">{icon}</p>
                <p className="font-bold text-gray-900 text-sm mb-1">{title}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <div className="bg-brand-500 rounded-3xl px-8 py-6 text-center">
            <p className="text-white font-bold text-lg">DineVerse fixes all three — and you're live in one afternoon.</p>
            <p className="text-orange-100 text-sm mt-1">QR ordering, live kitchen display, one-tap GST billing. No hardware required.</p>
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <span className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Zero Friction</span>
            <h2 className="text-3xl font-extrabold text-gray-900 mt-2">From table to kitchen to bill — automated</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-12">
            <div className="bg-orange-50 rounded-3xl p-8">
              <h3 className="font-bold text-gray-900 text-lg mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-orange-400 flex items-center justify-center text-white text-sm">👤</span>
                Customer experience
              </h3>
              <ol className="space-y-5">
                {[
                  ['📱', 'Scan QR code at the table',   'No app download, no login, no friction'],
                  ['🍽️', 'Browse & add to cart',        'Photos, veg/non-veg tags, dietary filters'],
                  ['✅', 'Place order in seconds',       'Just their name — order fires to kitchen'],
                  ['🔔', 'Watch it come to life',        'Pending → Preparing → Ready → Served'],
                ].map(([icon, title, sub]) => (
                  <li key={title} className="flex items-start gap-4">
                    <span className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-lg flex-shrink-0">{icon}</span>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="bg-brand-50 rounded-3xl p-8">
              <h3 className="font-bold text-gray-900 text-lg mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-brand-500 flex items-center justify-center text-white text-sm">🏪</span>
                Your team's experience
              </h3>
              <ol className="space-y-5">
                {[
                  ['🚀', 'Set up in one afternoon',      'Add menu, tables, QR codes — done'],
                  ['📋', 'Orders arrive instantly',       'Kitchen display shows every new ticket live'],
                  ['🖨️', 'Print GST bill in one tap',    'CGST + SGST breakdown, UPI QR on receipt'],
                  ['📈', 'Revenue insights every day',   'Bestsellers, peak hours, daily totals'],
                ].map(([icon, title, sub]) => (
                  <li key={title} className="flex items-start gap-4">
                    <span className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-lg flex-shrink-0">{icon}</span>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-20 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <span className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Everything Included</span>
            <h2 className="text-3xl font-extrabold text-gray-900 mt-2">One platform. No patchwork tools.</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: '⚡',
                name: 'QR Ordering',
                color: 'bg-yellow-50 border-yellow-200',
                iconBg: 'bg-yellow-100 text-yellow-700',
                desc: 'Customers scan, browse, and order from their own phone. No waiter needed for order taking.',
                points: ['No app download for customers', 'Real-time kitchen notification', 'Multi-table, multi-order support'],
              },
              {
                icon: '🧑‍🍳',
                name: 'Kitchen Display',
                color: 'bg-green-50 border-green-200',
                iconBg: 'bg-green-100 text-green-700',
                desc: 'Your kitchen sees every order the moment it\'s placed. Print KOTs, track status, stay in sync.',
                points: ['Live order queue on any screen', 'KOT printing per ticket', 'Ready → Served workflow'],
              },
              {
                icon: '📊',
                name: 'Revenue Analytics',
                color: 'bg-blue-50 border-blue-200',
                iconBg: 'bg-blue-100 text-blue-700',
                desc: 'Know exactly which items make you money, when your rush hits, and how revenue trends over time.',
                points: ['Daily & weekly revenue totals', 'Bestseller & slowest-mover report', 'Email reports automatically'],
              },
              {
                icon: '💰',
                name: 'GST Billing',
                color: 'bg-purple-50 border-purple-200',
                iconBg: 'bg-purple-100 text-purple-700',
                desc: 'Print legal Tax Invoices in one click. CGST + SGST split, UPI QR, and your branding on every bill.',
                points: ['TAX INVOICE format', 'CGST + SGST auto-calculated', 'UPI ID & FSSAI on receipt'],
              },
            ].map((feat) => (
              <div key={feat.name} className={`rounded-2xl border p-6 ${feat.color}`}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4 ${feat.iconBg}`}>{feat.icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{feat.name}</h3>
                <p className="text-sm text-gray-600 mb-4">{feat.desc}</p>
                <ul className="space-y-1.5">
                  {feat.points.map((pt) => (
                    <li key={pt} className="text-xs text-gray-600 flex items-center gap-1.5">
                      <CheckIcon /> {pt}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Real Owners, Real Results</span>
            <h2 className="text-3xl font-extrabold text-gray-900 mt-2">They switched. Here's what happened.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                name: 'Priya Nair', role: 'Owner · Spice Garden Café', city: 'Kochi, Kerala', avatar: 'PN', color: 'bg-orange-100 text-orange-700',
                text: 'We used to lose 2–3 orders daily to kitchen confusion. Now every order hits the screen instantly. Rush hour is actually manageable.',
              },
              {
                name: 'Rahul Sharma', role: 'Manager · The Brew Bar', city: 'Pune, Maharashtra', avatar: 'RS', color: 'bg-blue-100 text-blue-700',
                text: 'Customers love the QR ordering — no waiting, no wrong orders. The GST billing alone saves us 20 minutes every night. Genuinely worth it.',
              },
              {
                name: 'Anita Mehta', role: 'Owner · Chai & Chat', city: 'Ahmedabad, Gujarat', avatar: 'AM', color: 'bg-green-100 text-green-700',
                text: 'Setup took one afternoon. We went live that evening. We haven\'t missed an order since. The analytics showed us our real bestseller — it wasn\'t what I expected.',
              },
            ].map((t) => (
              <div key={t.name} className="bg-gray-50 border border-gray-100 rounded-2xl p-6 flex flex-col">
                <div className="flex gap-1 mb-4">
                  {[1,2,3,4,5].map((i) => (
                    <svg key={i} className="w-4 h-4 text-amber-400 fill-amber-400" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <p className="text-sm text-gray-700 leading-relaxed flex-1">"{t.text}"</p>
                <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-200">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${t.color}`}>{t.avatar}</div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                    <p className="text-xs text-gray-400">{t.role}</p>
                    <p className="text-xs text-gray-400">{t.city}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-20 px-6 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <span className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Simple, Honest Pricing</span>
            <h2 className="text-3xl font-extrabold text-gray-900 mt-2">One price. Everything included. No surprises.</h2>
            <p className="text-gray-500 mt-3 text-sm">30-day free trial on every plan — full access, no card needed.</p>
          </div>

          {/* Billing period toggle */}
          <div className="flex justify-center mb-10">
            <div className="inline-flex bg-white border border-gray-200 rounded-xl p-1 gap-1">
              {DURATION_LABELS.map((label, i) => (
                <button
                  key={label}
                  onClick={() => setDurIdx(i)}
                  className={`relative px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    durIdx === i ? 'bg-brand-500 text-white shadow' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {label}
                  {DURATION_BADGES[i] && (
                    <span className={`absolute -top-2.5 -right-1 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                      i === 2 ? 'bg-green-500 text-white' : 'bg-amber-400 text-amber-900'
                    }`}>
                      {DURATION_BADGES[i]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">

            {/* Free Trial */}
            <div className="bg-white border-2 border-gray-200 rounded-2xl p-6 flex flex-col">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Free Trial</p>
              <p className="text-xs text-gray-400 mb-3">Try before you commit</p>
              <p className="text-4xl font-extrabold text-gray-900">₹0</p>
              <p className="text-sm text-gray-400 mt-1 mb-2">30 days · No card required</p>
              <div className="inline-flex items-center gap-1.5 bg-gray-100 rounded-lg px-2.5 py-1.5 mb-5 self-start">
                <span className="text-xs text-gray-500 font-medium">☕ Any size café</span>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1 text-sm text-gray-600">
                {[
                  'Full access to every feature',
                  'Unlimited orders & menu items',
                  'QR ordering, KDS, GST billing',
                  'Analytics, staff accounts, multi-branch',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2"><CheckIcon /> {f}</li>
                ))}
              </ul>
              <button onClick={() => navigate('/owner/register')} className="w-full py-3 rounded-xl border-2 border-brand-500 text-brand-600 font-bold hover:bg-brand-50 transition-colors text-sm">
                Start Free — No Card
              </button>
            </div>

            {/* Essential */}
            <div className="relative bg-white border-2 border-brand-500 rounded-2xl p-6 flex flex-col shadow-lg">
              <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-brand-500 text-white text-[10px] font-extrabold px-4 py-1 rounded-full whitespace-nowrap">
                🔥 MOST POPULAR
              </span>
              <p className="text-xs font-bold text-brand-600 uppercase tracking-wide mb-1">Essential</p>
              <p className="text-xs text-gray-400 mb-3">Everything a small café needs to run smoothly</p>
              <div className="flex items-baseline gap-1 mb-1">
                <p className="text-4xl font-extrabold text-gray-900">{p.essential.perMonth[durIdx]}</p>
                <span className="text-base text-gray-400">/mo</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{p.essential.total[durIdx]} billed {DURATION_LABELS[durIdx].toLowerCase()}</p>
              {p.essential.save[durIdx] && (
                <p className="text-xs font-semibold text-green-600 mt-0.5">{p.essential.save[durIdx]}</p>
              )}
              <div className="inline-flex items-center gap-1.5 bg-brand-50 border border-brand-200 rounded-lg px-2.5 py-1.5 mt-3 mb-4 self-start">
                <span className="text-xs text-brand-700 font-medium">☕ Solo cafés · Food stalls · Small restaurants</span>
              </div>
              <ul className="space-y-2.5 mb-2 flex-1 text-sm text-gray-700">
                {[
                  ['Customers order themselves via QR', 'Zero waiter back-and-forth, zero wrong orders'],
                  ['Live kitchen display — orders appear instantly', 'No shouting, no slips, no missed tickets'],
                  ['GST tax invoice in one tap', 'CGST + SGST auto-split, UPI QR on every bill'],
                  ['Unlimited orders, items & categories', 'No caps, ever — grow without paying more'],
                  ['Daily revenue & bestseller reports', 'Know your numbers every single evening'],
                  ['Staff accounts + role-based access', 'Separate logins for counter, kitchen, manager'],
                  ['Delivery, takeaway & dine-in modes', 'Handle every order type from one dashboard'],
                  ['Discount & offer management', 'Run happy-hour deals, combo offers automatically'],
                ].map(([title, sub]) => (
                  <li key={title} className="flex items-start gap-2">
                    <CheckIcon cls="text-brand-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="font-medium text-gray-800">{title}</span>
                      <span className="block text-xs text-gray-400 mt-0.5">{sub}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-brand-600 font-semibold mt-3 mb-5 bg-brand-50 rounded-lg px-3 py-2">
                💡 Pays for itself with just 2–3 extra covers a day — less time on billing = more time serving.
              </p>
              <button onClick={() => navigate('/owner/register')} className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold transition-colors text-sm shadow-md shadow-brand-200">
                Get Essential →
              </button>
            </div>

            {/* Pro */}
            <div className="relative bg-white border-2 border-purple-400 rounded-2xl p-6 flex flex-col">
              <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-purple-600 text-white text-[10px] font-extrabold px-4 py-1 rounded-full whitespace-nowrap">
                🚀 FOR GROWING RESTAURANTS
              </span>
              <p className="text-xs font-bold text-purple-600 uppercase tracking-wide mb-1">Pro</p>
              <p className="text-xs text-gray-400 mb-3">Built for busy kitchens and multi-staff operations</p>
              <div className="flex items-baseline gap-1 mb-1">
                <p className="text-4xl font-extrabold text-gray-900">{p.pro.perMonth[durIdx]}</p>
                <span className="text-base text-gray-400">/mo</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{p.pro.total[durIdx]} billed {DURATION_LABELS[durIdx].toLowerCase()}</p>
              {p.pro.save[durIdx] && (
                <p className="text-xs font-semibold text-green-600 mt-0.5">{p.pro.save[durIdx]}</p>
              )}
              <div className="inline-flex items-center gap-1.5 bg-purple-50 border border-purple-200 rounded-lg px-2.5 py-1.5 mt-3 mb-4 self-start">
                <span className="text-xs text-purple-700 font-medium">🍽️ Medium restaurants · High-volume dine-in · Chains</span>
              </div>
              <p className="text-xs font-semibold text-gray-400 mb-3">Everything in Essential, plus:</p>
              <ul className="space-y-2.5 mb-2 flex-1 text-sm text-gray-700">
                {[
                  ['Item-level kitchen tracking', 'Each dish tracked: Preparing → Ready → Served. Chef owns every ticket.'],
                  ['Customers see live dish progress', 'Fewer "where's my food?" questions — transparency = happier tables.'],
                  ['Course sequencing', 'Starters fire first, mains hold until the table is ready. Zero cold plates.'],
                  ['Cancel individual items mid-order', 'Remove a dish, customer gets notified instantly — no awkward conversations.'],
                  ['Advanced KDS with category filters', 'Separate hot, cold, beverage queues. Each station sees only their work.'],
                  ['Full KOT reprint history', 'Reprint any ticket from any past order. Accountability end to end.'],
                ].map(([title, sub]) => (
                  <li key={title} className="flex items-start gap-2">
                    <CheckIcon cls="text-purple-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="font-medium text-gray-800">{title}</span>
                      <span className="block text-xs text-gray-400 mt-0.5">{sub}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-purple-700 font-semibold mt-3 mb-5 bg-purple-50 rounded-lg px-3 py-2">
                💡 At 50+ covers/day, one avoided remake or wrong order covers the monthly cost.
              </p>
              <button onClick={() => navigate('/owner/register')} className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold transition-colors text-sm">
                Get Pro →
              </button>
            </div>

          </div>
          <p className="text-center text-xs text-gray-400 mt-6">{p.footer}</p>

          {/* Quick compare */}
          <div className="mt-10 bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <p className="font-semibold text-gray-900 text-sm">Full feature comparison</p>
              <span className="text-xs text-gray-400">All plans include 30-day free trial</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Feature</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Trial</th>
                    <th className="px-4 py-3 text-xs font-semibold text-brand-600 uppercase text-center">Essential</th>
                    <th className="px-4 py-3 text-xs font-semibold text-purple-600 uppercase text-center">Pro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    { label: 'QR menu & self-ordering',             trial: true,  ess: true,  pro: true  },
                    { label: 'Unlimited orders & menu items',       trial: true,  ess: true,  pro: true  },
                    { label: 'Live kitchen display (KDS)',          trial: true,  ess: true,  pro: true  },
                    { label: 'GST tax invoices & thermal printing', trial: true,  ess: true,  pro: true  },
                    { label: 'Delivery, takeaway & dine-in',        trial: true,  ess: true,  pro: true  },
                    { label: 'Revenue analytics & reports',         trial: true,  ess: true,  pro: true  },
                    { label: 'Staff accounts & role access',        trial: true,  ess: true,  pro: true  },
                    { label: 'Multi-branch management',             trial: true,  ess: true,  pro: true  },
                    { label: 'Offers & discount management',        trial: true,  ess: true,  pro: true  },
                    { label: 'KOT printing per ticket',             trial: true,  ess: true,  pro: true  },
                    { label: 'Per-item status tracking in kitchen', trial: false, ess: false, pro: true  },
                    { label: 'Customer sees live dish progress',    trial: false, ess: false, pro: true  },
                    { label: 'Course sequencing (starters → mains)',trial: false, ess: false, pro: true  },
                    { label: 'Cancel items mid-order & notify',     trial: false, ess: false, pro: true  },
                    { label: 'Category-filtered KDS stations',      trial: false, ess: false, pro: true  },
                    { label: 'Full KOT reprint history',            trial: false, ess: false, pro: true  },
                  ].map((row) => (
                    <tr key={row.label} className="hover:bg-gray-50">
                      <td className="px-6 py-2.5 text-gray-700">{row.label}</td>
                      {[row.trial, row.ess, row.pro].map((val, i) => (
                        <td key={i} className="px-4 py-2.5 text-center">
                          {val
                            ? <span className={`font-bold ${i === 1 ? 'text-brand-500' : i === 2 ? 'text-purple-500' : 'text-green-500'}`}>✓</span>
                            : <span className="text-gray-200 font-bold">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* FAQ-style objection busters */}
          <div className="mt-10 grid sm:grid-cols-3 gap-4">
            {[
              { q: 'Do I need any hardware?', a: 'No. Works on any smartphone, tablet, or laptop. Your kitchen display runs on a cheap Android tablet or an old phone propped up in the kitchen.' },
              { q: 'What if I need to cancel mid-trial?', a: 'Just stop — no card was charged, nothing to cancel. If you upgrade and later want to stop, we refund the unused months, no questions asked.' },
              { q: 'Can I switch plans later?', a: 'Yes, anytime. Upgrade from Essential to Pro in one click. Downgrade too — your data stays safe regardless.' },
            ].map(({ q, a }) => (
              <div key={q} className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-gray-800 mb-1.5">{q}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-20 px-6 bg-gradient-to-br from-brand-500 to-orange-500">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">Your café is losing orders right now.</h2>
          <p className="text-white/80 mb-8">
            Every wrong order, every missed ticket, every manual bill — it adds up.
            Join 500+ restaurants who fixed it in an afternoon.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate('/owner/register')}
              className="px-8 py-4 bg-white hover:bg-gray-50 text-brand-600 font-bold rounded-xl transition-colors shadow-lg"
            >
              Start Free Trial — No Card Needed
            </button>
            <a
              href="mailto:hello@dine-verse.com"
              className="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-colors border border-white/30"
            >
              Book a Demo
            </a>
          </div>
          <p className="text-white/60 text-xs mt-4">30-day free trial · Full access · No credit card · Cancel anytime</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-gray-900 text-gray-400 py-12 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid sm:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="mb-3"><DineLogo size="sm" white /></div>
              <p className="text-xs leading-relaxed">Restaurant management platform built for India. QR ordering, live kitchen, GST billing — all in one.</p>
            </div>
            <div>
              <p className="font-semibold text-white text-sm mb-3">Product</p>
              <ul className="space-y-2 text-sm">
                <li><a href="#features"     className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing"      className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#how-it-works" className="hover:text-white transition-colors">How It Works</a></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white text-sm mb-3">For Customers</p>
              <ul className="space-y-2 text-sm">
                <li><button onClick={() => navigate('/explore')} className="hover:text-white transition-colors">Explore Cafés</button></li>
                <li><Link to="/scan" className="hover:text-white transition-colors">Scan & Order</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white text-sm mb-3">Contact</p>
              <ul className="space-y-2 text-sm">
                <li><a href="mailto:hello@dine-verse.com" className="hover:text-white transition-colors">hello@dine-verse.com</a></li>
                <li><button onClick={() => navigate('/owner/login')} className="hover:text-white transition-colors">Owner Login</button></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row justify-between items-center gap-2">
            <p className="text-xs">© 2025 DineVerse. All rights reserved.</p>
            <div className="flex items-center gap-4 text-xs">
              <Link to="/terms"   className="hover:text-white transition-colors">Terms</Link>
              <Link to="/privacy" className="hover:text-white transition-colors">Privacy</Link>
              <Link to="/refund"  className="hover:text-white transition-colors">Refund Policy</Link>
              <Link to="/contact" className="hover:text-white transition-colors">Contact</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
