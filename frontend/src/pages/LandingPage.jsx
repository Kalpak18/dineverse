import { useNavigate, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import DineLogo from '../components/DineLogo';

const PLANS = {
  INR: {
    sym: '₹',
    trial:  { price: '₹0' },
    year1:  { perMonth: '₹499', total: '₹5,988', billed: 'billed yearly',     save: null },
    year2:  { perMonth: '₹449', total: '₹10,788', billed: 'billed for 2 years', save: 'Save ₹1,188 vs. 1-year' },
    year3:  { perMonth: '₹444', total: '₹15,999', billed: 'billed for 3 years', save: 'Save ₹1,965 vs. 1-year' },
    footer: 'All plans include GST · Secure payment via Razorpay · Instant activation',
    hero:   'From ₹499/month after trial',
    year1features: ['Everything in Free Trial', 'Priority support', 'Data never deleted', 'GST invoice for input credit'],
  },
  USD: {
    sym: '$',
    trial:  { price: '$0' },
    year1:  { perMonth: '$6',    total: '$72',  billed: 'billed yearly',     save: null },
    year2:  { perMonth: '$5.50', total: '$130', billed: 'billed for 2 years', save: 'Save $14 vs. 1-year' },
    year3:  { perMonth: '$5',    total: '$180', billed: 'billed for 3 years', save: 'Save $36 vs. 1-year' },
    footer: 'All plans include applicable taxes · Secure payment · Instant activation',
    hero:   'From $6/month after trial',
    year1features: ['Everything in Free Trial', 'Priority support', 'Data never deleted', 'Tax invoice provided'],
  },
};

async function detectPricingCurrency() {
  const cached = sessionStorage.getItem('dv_pricing_currency');
  if (cached) return cached;
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const currency = data.country_code === 'IN' ? 'INR' : 'USD';
    sessionStorage.setItem('dv_pricing_currency', currency);
    return currency;
  } catch {
    return 'INR';
  }
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [pricingCurrency, setPricingCurrency] = useState('INR');

  useEffect(() => {
    detectPricingCurrency().then(setPricingCurrency);
  }, []);

  const plan = PLANS[pricingCurrency] ?? PLANS.INR;

  return (
    <div className="min-h-screen bg-white font-sans">
      {/* ── Navbar ─────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <DineLogo size="sm" />
          <div className="hidden md:flex items-center gap-8 text-sm text-gray-600">
            <a href="#how-it-works" className="hover:text-brand-600 transition-colors">How It Works</a>
            <a href="#features" className="hover:text-brand-600 transition-colors">Features</a>
            <a href="#pricing" className="hover:text-brand-600 transition-colors">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/owner/login')}
              className="text-sm text-gray-600 hover:text-gray-900 font-medium"
            >
              Login
            </button>
            <button
              onClick={() => navigate('/owner/register')}
              className="text-sm bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Start Free
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="relative bg-gradient-to-br from-brand-50 via-orange-50 to-white overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28 flex flex-col md:flex-row items-center gap-12">
          {/* Text */}
          <div className="flex-1 text-center md:text-left">
            <span className="inline-block text-xs font-semibold bg-brand-100 text-brand-700 px-3 py-1 rounded-full mb-5 tracking-wide uppercase">
              India's Smart Café OS
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-gray-900 leading-tight mb-5">
              Your Café,<br />
              <span className="text-brand-500">Running Itself</span>
            </h1>
            <p className="text-lg text-gray-500 mb-8 max-w-md mx-auto md:mx-0">
              QR-based digital ordering, real-time kitchen updates, GST-ready billing —
              all in one platform. No apps needed for customers.
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
            {/* Customer scanner shortcut */}
            <div className="mt-4 flex justify-center md:justify-start">
              <Link
                to="/scan"
                className="inline-flex items-center gap-2 text-sm text-brand-600 font-medium bg-brand-50 border border-brand-200 hover:bg-brand-100 transition-colors px-4 py-2.5 rounded-xl"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none" />
                  <rect x="14" y="3" width="7" height="7" rx="1" /><rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none" />
                  <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none" />
                  <rect x="14" y="14" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" /><rect x="18" y="14" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
                </svg>
                Scan café QR code to order
              </Link>
            </div>
            <p className="text-xs text-gray-400 mt-4">No credit card required · Cancel anytime · {plan.hero}</p>
          </div>

          {/* Mockup */}
          <div className="flex-1 flex justify-center md:justify-end">
            <div className="relative">
              {/* Phone frame */}
              <div className="w-56 bg-gray-900 rounded-[2.5rem] p-3 shadow-2xl shadow-gray-400">
                <div className="bg-white rounded-[2rem] overflow-hidden h-[440px] flex flex-col">
                  {/* Status bar */}
                  <div className="bg-brand-500 px-4 py-3 flex items-center justify-between">
                    <span className="text-white font-bold text-sm">DineVerse</span>
                    <span className="text-white/80 text-xs">9:41</span>
                  </div>
                  {/* Cafe header */}
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="font-semibold text-gray-900 text-sm">The Brew House</p>
                    <p className="text-xs text-gray-400">Table 5 · Dine In</p>
                  </div>
                  {/* Menu items */}
                  <div className="flex-1 px-3 py-2 space-y-2 overflow-hidden">
                    {[
                      { name: 'Cappuccino', price: '₹180', veg: true },
                      { name: 'Croissant', price: '₹120', veg: true },
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
                  </div>
                  {/* Cart bar */}
                  <div className="bg-brand-500 mx-3 mb-3 rounded-xl px-4 py-2.5 flex items-center justify-between">
                    <span className="text-white text-xs font-medium">3 items · ₹520</span>
                    <span className="text-white text-xs font-bold">Place Order →</span>
                  </div>
                </div>
              </div>
              {/* Floating badge */}
              <div className="absolute -top-3 -right-6 bg-white border border-gray-200 shadow-lg rounded-2xl px-4 py-2.5">
                <p className="text-xs font-bold text-gray-900">🔔 New Order!</p>
                <p className="text-xs text-gray-500">Table 5 · ₹520</p>
              </div>
              <div className="absolute -bottom-3 -left-6 bg-white border border-gray-200 shadow-lg rounded-2xl px-4 py-2.5">
                <p className="text-xs font-bold text-green-700">✅ Ready</p>
                <p className="text-xs text-gray-500">Order #0042</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Social Proof Bar ────────────────────────────────────── */}
      <section className="bg-gray-50 border-y border-gray-100 py-8">
        <div className="max-w-4xl mx-auto px-6 flex flex-wrap justify-center gap-8 text-center">
          {[
            { value: '500+', label: 'Cafés & Restaurants' },
            { value: '1L+', label: 'Orders Processed' },
            { value: '4.9★', label: 'Average Rating' },
            { value: '30 days', label: 'Free Trial' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-2xl font-extrabold text-brand-600">{stat.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <span className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Simple & Powerful</span>
            <h2 className="text-3xl font-extrabold text-gray-900 mt-2">How DineVerse Works</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-12">
            {/* Customer flow */}
            <div className="bg-orange-50 rounded-3xl p-8">
              <h3 className="font-bold text-gray-900 text-lg mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-orange-400 flex items-center justify-center text-white text-sm">👤</span>
                For Customers
              </h3>
              <ol className="space-y-5">
                {[
                  ['📱', 'Scan QR code at table', 'No app download required'],
                  ['🍽️', 'Browse menu & add to cart', 'Rich photos, veg/non-veg filters'],
                  ['✅', 'Place order instantly', 'Name + table, that\'s all'],
                  ['🔔', 'Track in real-time', 'Pending → Preparing → Ready → Served'],
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

            {/* Owner flow */}
            <div className="bg-brand-50 rounded-3xl p-8">
              <h3 className="font-bold text-gray-900 text-lg mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-brand-500 flex items-center justify-center text-white text-sm">🏪</span>
                For Owners
              </h3>
              <ol className="space-y-5">
                {[
                  ['🚀', 'Register & set up in minutes', 'Add menu, areas, tables'],
                  ['📋', 'Live orders dashboard', 'New orders ping instantly'],
                  ['🖨️', 'Print GST-ready bill', 'CGST + SGST breakdown, UPI QR'],
                  ['📈', 'Analytics & insights', 'Revenue, top items, daily reports'],
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

      {/* ── Features ────────────────────────────────────────────── */}
      <section id="features" className="py-20 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <span className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Everything You Need</span>
            <h2 className="text-3xl font-extrabold text-gray-900 mt-2">Built for Indian F&B</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: '⚡',
                name: 'DineFlow™',
                color: 'bg-yellow-50 border-yellow-200',
                iconBg: 'bg-yellow-100 text-yellow-700',
                desc: 'Instant QR ordering. Customers order from their phone — no waiter needed for taking orders.',
                points: ['Zero app installs', 'Real-time kitchen updates', 'Multi-table support'],
              },
              {
                icon: '🧑‍🍳',
                name: 'DineServe™',
                color: 'bg-green-50 border-green-200',
                iconBg: 'bg-green-100 text-green-700',
                desc: 'Staff & kitchen management that keeps your team in sync automatically.',
                points: ['Staff roles & login', 'Kitchen display system', 'Area-wise table management'],
              },
              {
                icon: '📊',
                name: 'DineInsights™',
                color: 'bg-blue-50 border-blue-200',
                iconBg: 'bg-blue-100 text-blue-700',
                desc: 'Know your best-sellers, peak hours, and daily revenue at a glance.',
                points: ['Revenue analytics', 'Top items report', 'Expense tracking'],
              },
              {
                icon: '💰',
                name: 'DinePay™',
                color: 'bg-purple-50 border-purple-200',
                iconBg: 'bg-purple-100 text-purple-700',
                desc: 'GST-compliant thermal bills with UPI QR. Accept cash, card, or UPI seamlessly.',
                points: ['TAX INVOICE format', 'CGST + SGST split', 'UPI ID on bill'],
              },
            ].map((feat) => (
              <div key={feat.name} className={`rounded-2xl border p-6 ${feat.color}`}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4 ${feat.iconBg}`}>
                  {feat.icon}
                </div>
                <h3 className="font-bold text-gray-900 mb-2">{feat.name}</h3>
                <p className="text-sm text-gray-600 mb-4">{feat.desc}</p>
                <ul className="space-y-1.5">
                  {feat.points.map((pt) => (
                    <li key={pt} className="text-xs text-gray-600 flex items-center gap-1.5">
                      <span className="text-green-500 font-bold">✓</span> {pt}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────── */}
      <section id="pricing" className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Transparent Pricing</span>
            <h2 className="text-3xl font-extrabold text-gray-900 mt-2">Simple & Affordable</h2>
            <p className="text-gray-500 mt-3 text-sm">Start free. Upgrade when you're ready. No hidden fees.</p>
          </div>

          {/* Free Trial + Pro plans */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">

            {/* Free Trial */}
            <div className="border-2 border-gray-200 rounded-2xl p-6 text-left flex flex-col">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Free Trial</p>
              <p className="text-3xl font-extrabold text-gray-900">{plan.trial.price}</p>
              <p className="text-sm text-gray-400 mt-1 mb-5">30 days · No card</p>
              <ul className="space-y-2 mb-6 flex-1 text-sm text-gray-600">
                {['Full feature access', 'Unlimited orders', 'QR menu + billing', 'Analytics & reports'].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button onClick={() => navigate('/owner/register')} className="w-full py-2.5 rounded-xl border-2 border-brand-500 text-brand-600 font-bold hover:bg-brand-50 transition-colors text-sm">
                Start Free Trial
              </button>
            </div>

            {/* 1 Year */}
            <div className="border-2 border-gray-200 rounded-2xl p-6 text-left flex flex-col">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">1 Year</p>
              <p className="text-3xl font-extrabold text-gray-900">{plan.year1.perMonth}<span className="text-base font-normal text-gray-500">/mo</span></p>
              <p className="text-sm text-gray-400 mt-1 mb-5">{plan.year1.total} {plan.year1.billed}</p>
              <ul className="space-y-2 mb-6 flex-1 text-sm text-gray-600">
                {plan.year1features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button onClick={() => navigate('/owner/register')} className="w-full py-2.5 rounded-xl border-2 border-gray-300 text-gray-700 font-bold hover:border-brand-400 hover:text-brand-600 transition-colors text-sm">
                Get Started
              </button>
            </div>

            {/* 2 Years */}
            <div className="border-2 border-brand-500 rounded-2xl p-6 text-left flex flex-col relative bg-brand-50">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-900 text-[10px] font-extrabold px-3 py-0.5 rounded-full whitespace-nowrap">SAVE 10%</span>
              <p className="text-xs font-bold text-brand-600 uppercase tracking-wide mb-3">2 Years</p>
              <p className="text-3xl font-extrabold text-gray-900">{plan.year2.perMonth}<span className="text-base font-normal text-gray-500">/mo</span></p>
              <p className="text-sm text-gray-500 mt-1 mb-1">{plan.year2.total} {plan.year2.billed}</p>
              <p className="text-xs text-green-600 font-semibold mb-4">{plan.year2.save}</p>
              <ul className="space-y-2 mb-6 flex-1 text-sm text-gray-700">
                {['Everything in 1 Year', 'Multi-outlet management', 'API access (coming soon)', 'Dedicated account manager'].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button onClick={() => navigate('/owner/register')} className="w-full py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold transition-colors text-sm">
                Get Started
              </button>
            </div>

            {/* 3 Years */}
            <div className="border-2 border-gray-200 rounded-2xl p-6 text-left flex flex-col relative">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-500 text-white text-[10px] font-extrabold px-3 py-0.5 rounded-full whitespace-nowrap">BEST VALUE</span>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">3 Years</p>
              <p className="text-3xl font-extrabold text-gray-900">{plan.year3.perMonth}<span className="text-base font-normal text-gray-500">/mo</span></p>
              <p className="text-sm text-gray-400 mt-1 mb-1">{plan.year3.total} {plan.year3.billed}</p>
              <p className="text-xs text-green-600 font-semibold mb-4">{plan.year3.save}</p>
              <ul className="space-y-2 mb-6 flex-1 text-sm text-gray-600">
                {['Everything in 2 Years', 'Lowest per-month cost', 'Price locked for 3 years', 'Early access to new features'].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button onClick={() => navigate('/owner/register')} className="w-full py-2.5 rounded-xl border-2 border-gray-300 text-gray-700 font-bold hover:border-brand-400 hover:text-brand-600 transition-colors text-sm">
                Get Started
              </button>
            </div>

          </div>
          <p className="text-center text-xs text-gray-400 mt-6">{plan.footer}</p>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────── */}
      <section className="py-20 px-6 bg-gradient-to-br from-brand-500 to-orange-500">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">Ready to Transform Your Café?</h2>
          <p className="text-white/80 mb-8">
            Join 500+ restaurants already using DineVerse. Get started in under 5 minutes.
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
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="bg-gray-900 text-gray-400 py-12 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid sm:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="mb-3">
                <DineLogo size="sm" white />
              </div>
              <p className="text-xs leading-relaxed">
                Smart café management platform built for India. QR ordering, real-time kitchen, GST billing.
              </p>
            </div>
            <div>
              <p className="font-semibold text-white text-sm mb-3">Product</p>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#how-it-works" className="hover:text-white transition-colors">How It Works</a></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white text-sm mb-3">For Customers</p>
              <ul className="space-y-2 text-sm">
                <li>
                  <button onClick={() => navigate('/explore')} className="hover:text-white transition-colors">
                    Explore Cafés
                  </button>
                </li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white text-sm mb-3">Contact</p>
              <ul className="space-y-2 text-sm">
                <li><a href="mailto:hello@dine-verse.com" className="hover:text-white transition-colors">hello@dine-verse.com</a></li>
                <li>
                  <button onClick={() => navigate('/owner/login')} className="hover:text-white transition-colors">
                    Owner Login
                  </button>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row justify-between items-center gap-2">
            <p className="text-xs">© 2025 DineVerse. All rights reserved.</p>
            <div className="flex items-center gap-4 text-xs">
              <Link to="/terms" className="hover:text-white transition-colors">Terms & Conditions</Link>
              <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
