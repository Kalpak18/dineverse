import { useNavigate, Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import DineLogo from '../components/DineLogo';


function CheckIcon({ cls = 'text-green-500' }) {
  return (
    <svg className={`w-3.5 h-3.5 flex-shrink-0 ${cls}`} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

// ── Star row helper ───────────────────────────────────────────
function Stars({ rating }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map((i) => (
        <svg key={i} className={`w-3.5 h-3.5 ${i <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'}`} viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
        </svg>
      ))}
    </div>
  );
}

// ── Testimonials section — shows only when real reviews exist ────
function TestimonialsSection() {
  const [reviews, setReviews]   = useState(null);  // null = loading
  const [stats, setStats]       = useState(null);
  const trackRef                = useRef(null);
  const pauseRef                = useRef(false);

  useEffect(() => {
    const base = import.meta.env.VITE_API_URL || '/api';
    fetch(`${base}/testimonials/public`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setReviews(d.reviews || []);
          setStats(d.stats || null);
        } else {
          setReviews([]);
        }
      })
      .catch(() => setReviews([]));
  }, []);

  // Auto-scroll the track: translate X slowly, loop by resetting when halfway
  useEffect(() => {
    if (!reviews?.length || !trackRef.current) return;
    let pos = 0;
    const track = trackRef.current;
    const step = () => {
      if (!pauseRef.current) {
        pos += 0.4;
        const halfWidth = track.scrollWidth / 2;
        if (pos >= halfWidth) pos = 0;
        track.style.transform = `translateX(-${pos}px)`;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    const rafRef = { current: null };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [reviews]);

  // Hidden until data loaded; hidden if no reviews at all
  if (reviews === null) return null;
  if (!reviews.length)  return null;

  const displayReviews = reviews.length >= 3 ? reviews : [...reviews, ...reviews, ...reviews];
  const doubled = [...displayReviews, ...displayReviews]; // duplicate for seamless loop

  const avg  = parseFloat(stats?.avg_rating || 0);
  const total = parseInt(stats?.total || 0, 10);
  const bars  = [
    { label: '5 ★', count: parseInt(stats?.five_star  || 0, 10), color: 'bg-green-500'  },
    { label: '4 ★', count: parseInt(stats?.four_star  || 0, 10), color: 'bg-lime-400'   },
    { label: '3 ★', count: parseInt(stats?.three_star || 0, 10), color: 'bg-yellow-400' },
    { label: '1-2★', count: parseInt(stats?.low_star  || 0, 10), color: 'bg-red-400'    },
  ];

  return (
    <section className="py-20 bg-gray-50 overflow-hidden">
      <div className="max-w-6xl mx-auto px-6">
        {/* Section header */}
        <div className="text-center mb-12">
          <span className="text-xs font-semibold text-brand-600 uppercase tracking-wide">From Our Customers</span>
          <h2 className="text-3xl font-extrabold text-gray-900 mt-2">What restaurant owners say</h2>
          <p className="text-gray-500 text-sm mt-2">Honest reviews from café owners using DineVerse every day.</p>
        </div>

        {/* Grid: 2/3 scrolling cards + 1/3 stats */}
        <div className="grid lg:grid-cols-3 gap-8 items-start">

          {/* ── Scrolling testimonials (2/3) ── */}
          <div className="lg:col-span-2 overflow-hidden relative">
            {/* Left/right fade masks */}
            <div className="absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-gray-50 to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-gray-50 to-transparent z-10 pointer-events-none" />

            <div
              ref={trackRef}
              className="flex gap-4 will-change-transform"
              style={{ width: 'max-content' }}
              onMouseEnter={() => { pauseRef.current = true; }}
              onMouseLeave={() => { pauseRef.current = false; }}
            >
              {doubled.map((review, idx) => (
                <div
                  key={`${review.id}-${idx}`}
                  className="w-72 flex-shrink-0 bg-white border border-gray-100 rounded-2xl p-5 flex flex-col shadow-sm"
                >
                  <Stars rating={review.rating} />
                  {review.title && (
                    <p className="font-semibold text-gray-900 text-sm mt-2 leading-snug">{review.title}</p>
                  )}
                  <p className="text-sm text-gray-600 leading-relaxed mt-2 flex-1 line-clamp-4">
                    "{review.review_text}"
                  </p>
                  <div className="flex items-center gap-2.5 mt-4 pt-3 border-t border-gray-100">
                    <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {review.owner_name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{review.owner_name}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {review.cafe_name}
                        {review.city ? ` · ${review.city}` : ''}
                        {review.state ? `, ${review.state}` : ''}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Stats panel (1/3) ── */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Overall Rating</p>

            {/* Big average */}
            <div className="flex items-end gap-2 mb-2">
              <span className="text-5xl font-black text-gray-900 leading-none">{avg.toFixed(1)}</span>
              <span className="text-gray-400 text-sm mb-1">/ 5</span>
            </div>
            <Stars rating={Math.round(avg)} />
            <p className="text-xs text-gray-400 mt-1">{total} verified review{total !== 1 ? 's' : ''}</p>

            {/* Rating breakdown bars */}
            <div className="mt-5 space-y-2">
              {bars.map(({ label, count }) => {
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={label} className="flex items-center gap-2 text-xs">
                    <span className="w-8 text-gray-500 flex-shrink-0">{label}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-7 text-right text-gray-400">{pct}%</span>
                  </div>
                );
              })}
            </div>

            {/* Trust line */}
            <div className="mt-6 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500 leading-relaxed">
                Reviews come directly from verified café owners on the DineVerse platform.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white font-sans">

      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <DineLogo size="sm" />
          <div className="hidden md:flex items-center gap-8 text-sm text-gray-600">
            <a href="#how-it-works" className="hover:text-brand-600 transition-colors">How It Works</a>
            <a href="#features"     className="hover:text-brand-600 transition-colors">Features</a>
            <a href="#help"         className="hover:text-brand-600 transition-colors">Help</a>
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
              Restaurant Management · Made in India
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-gray-900 leading-tight mb-5">
              Stop losing orders.<br />
              <span className="text-brand-500">Start growing revenue.</span>
            </h1>
            <p className="text-lg text-gray-500 mb-8 max-w-md mx-auto md:mx-0">
              QR ordering, live kitchen display, and GST-ready billing — all in one
              platform. No hardware. No app download for customers. Live in one afternoon.
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
            <p className="text-xs text-gray-400 mt-3">No credit card required · Cancel anytime · From ₹499/month after trial</p>
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
            { value: 'QR-first', label: 'No app download for customers' },
            { value: 'GST-ready', label: 'Legal tax invoices, one tap' },
            { value: '30 days', label: 'Free trial — no card needed' },
            { value: '< 1 hour', label: 'Setup to first live order' },
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

      {/* ── Testimonials (real, from DB) ── */}
      <TestimonialsSection />

      {/* ── Help Desk ── */}
      <section id="help" className="py-16 px-6 bg-white border-t border-gray-100">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Help & Support</h2>
            <p className="text-gray-500 text-sm">Quick answers. Human support when you need it.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            {[
              {
                icon: '📚',
                title: 'Getting Started Guide',
                desc: 'Set up your café in 10 minutes — tables, menu, tax, and your first QR code.',
                action: 'Read guide →',
                href: 'mailto:hello@dine-verse.com?subject=Getting Started Help',
              },
              {
                icon: '🖨️',
                title: 'Printer & KDS Setup',
                desc: 'Connect a Bluetooth or network printer. Set up your Kitchen Display on any screen.',
                action: 'Get setup help →',
                href: 'mailto:hello@dine-verse.com?subject=Printer or KDS Setup',
              },
              {
                icon: '💳',
                title: 'Billing & Payments',
                desc: 'Questions about Razorpay, GST invoices, or subscription billing? We\'ll sort it.',
                action: 'Contact billing →',
                href: 'mailto:hello@dine-verse.com?subject=Billing Question',
              },
              {
                icon: '🔧',
                title: 'Something Not Working?',
                desc: 'Report a bug or unexpected behaviour. We respond within 4 hours on business days.',
                action: 'Report issue →',
                href: 'mailto:hello@dine-verse.com?subject=Bug Report',
              },
            ].map(({ icon, title, desc, action, href }) => (
              <a
                key={title}
                href={href}
                className="group flex gap-4 bg-gray-50 hover:bg-brand-50 border border-gray-200 hover:border-brand-300 rounded-2xl p-5 transition-colors"
              >
                <span className="text-2xl flex-shrink-0">{icon}</span>
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-1">{title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed mb-2">{desc}</p>
                  <span className="text-xs font-semibold text-brand-600 group-hover:underline">{action}</span>
                </div>
              </a>
            ))}
          </div>
          <div className="bg-gradient-to-r from-brand-50 to-orange-50 border border-brand-200 rounded-2xl px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <p className="font-bold text-gray-900 text-sm">Still need help?</p>
              <p className="text-xs text-gray-500 mt-0.5">Email us at <strong>hello@dine-verse.com</strong> — average reply time under 2 hours.</p>
            </div>
            <a
              href="mailto:hello@dine-verse.com"
              className="flex-shrink-0 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              Email Support
            </a>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-20 px-6 bg-gradient-to-br from-brand-500 to-orange-500">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">Your café is losing orders right now.</h2>
          <p className="text-white/80 mb-8">
            Every wrong order, every missed ticket, every manual bill adds up.
            DineVerse fixes all of it — and you'll be live before the dinner rush.
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
