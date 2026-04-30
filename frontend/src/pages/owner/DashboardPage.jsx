import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getDashboardStats, getPublicSetting, toggleCafeOpen, submitTestimonial, getMyTestimonial } from '../../services/api';
import CafeQRCard from '../../components/CafeQRCard';
import { Link, useNavigate } from 'react-router-dom';
import { STATUS_CONFIG } from '../../constants/statusConfig';
import { fmtToken, fmtCurrency } from '../../utils/formatters';
import toast from 'react-hot-toast';


// Onboarding steps — shown inline on dashboard until dismissed
const ONBOARDING = [
  { id: 'menu',    icon: '🍽️', label: 'Add your menu items',         route: '/owner/menu',    check: (s) => s.total_items > 0 },
  { id: 'tables',  icon: '🪑', label: 'Set up tables & QR codes',    route: '/owner/tables',  check: (s) => s.total_tables > 0 },
  { id: 'profile', icon: '🎨', label: 'Upload logo & fill profile',  route: '/owner/profile', check: (_, cafe) => !!cafe?.logo_url },
  { id: 'live',    icon: '🟢', label: 'Toggle café Open to go live', route: null,             check: (s) => s.cafe_is_open },
];

export default function DashboardPage() {
  const { cafe, updateCafe } = useAuth();
  const c = (n) => fmtCurrency(n, cafe?.currency);
  const navigate  = useNavigate();

  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [announcement, setAnnouncement] = useState(null);
  const [isOpen,   setIsOpen]   = useState(cafe?.is_open ?? true);
  const [togglingOpen, setTogglingOpen] = useState(false);
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState(
    () => localStorage.getItem('dineverse_announcement_dismissed') || ''
  );
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => !!localStorage.getItem(`dv_ob_done_${cafe?.id}`)
  );

  const loadDashboard = useCallback(async () => {
    try {
      const [statsRes, annRes] = await Promise.all([
        getDashboardStats(),
        getPublicSetting('announcement').catch(() => null),
      ]);

      setStats(statsRes.data);
      setIsOpen(statsRes.data?.cafe_is_open ?? true);

      if (annRes?.data?.value?.active && annRes.data.value.text) {
        setAnnouncement(annRes.data.value);
      }
    } catch {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  // cafe?.id ensures this re-runs if the owner switches outlet, but nothing else
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cafe?.id]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const handleToggleOpen = async () => {
    setTogglingOpen(true);
    try {
      const res = await toggleCafeOpen();
      setIsOpen(res.data.is_open);
      updateCafe({ is_open: res.data.is_open });
      toast.success(res.data.is_open ? 'Café is now Open 🟢' : 'Café is now Closed 🔴');
    } catch {
      toast.error('Failed to update status');
    } finally {
      setTogglingOpen(false);
    }
  };

  if (loading) return <DashboardSkeleton />;

  const cafeUrl = `${window.location.origin}/cafe/${cafe?.slug}`;

  return (
    <>
      <div className="space-y-6 max-w-4xl">

        {/* Platform announcement */}
        {announcement && dismissedAnnouncement !== announcement.text && (
          <div className={`rounded-xl px-4 py-3 flex items-start gap-3 text-sm border ${
            announcement.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' :
            announcement.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
                                              'bg-blue-50 border-blue-200 text-blue-800'
          }`}>
            <span className="text-base flex-shrink-0 mt-0.5">
              {announcement.type === 'warning' ? '⚠️' : announcement.type === 'success' ? '✅' : 'ℹ️'}
            </span>
            <span className="flex-1">{announcement.text}</span>
            <button
              onClick={() => {
                localStorage.setItem('dineverse_announcement_dismissed', announcement.text);
                setDismissedAnnouncement(announcement.text);
              }}
              className="flex-shrink-0 opacity-60 hover:opacity-100 font-bold text-lg leading-none"
            >×</button>
          </div>
        )}

        {/* Subscription warning */}
        {cafe?.plan_expiry_date && (() => {
          const daysLeft = Math.ceil(
            (new Date(cafe.plan_expiry_date) - new Date()) / (1000 * 60 * 60 * 24)
          );
          if (daysLeft > 7) return null;
          const expired = daysLeft <= 0;
          return (
            <div className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-sm font-medium ${
              expired
                ? 'bg-red-50 border border-red-200 text-red-800'
                : 'bg-amber-50 border border-amber-200 text-amber-800'
            }`}>
              <span>
                {expired
                  ? '🔴 Your subscription has expired. Renew now to keep accepting orders.'
                  : `⚠️ Your ${cafe.plan_type === 'free_trial' ? 'free trial' : 'plan'} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}. Renew to avoid any interruption.`
                }
              </span>
              <Link to="/owner/billing" className="flex-shrink-0 underline font-semibold whitespace-nowrap">{expired ? 'Renew Now →' : 'Renew →'}</Link>
            </div>
          );
        })()}

        {/* ── Onboarding checklist (new accounts only, dismissible) ── */}
        {!onboardingDismissed && stats && (() => {
          const steps = ONBOARDING.map((s) => ({ ...s, done: s.check(stats, cafe) }));
          const doneCount = steps.filter((s) => s.done).length;
          const allDone   = doneCount === steps.length;
          if (allDone) {
            // auto-dismiss once everything is done
            localStorage.setItem(`dv_ob_done_${cafe?.id}`, '1');
            return null;
          }
          return (
            <div className="bg-brand-50 border border-brand-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-brand-500 flex items-center justify-center text-white text-sm flex-shrink-0">🚀</div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">Complete your café setup</p>
                    <p className="text-xs text-gray-500">{doneCount} of {steps.length} done — almost there!</p>
                  </div>
                </div>
                <button
                  onClick={() => { localStorage.setItem(`dv_ob_done_${cafe?.id}`, '1'); setOnboardingDismissed(true); }}
                  className="text-gray-400 hover:text-gray-600 text-lg leading-none flex-shrink-0"
                  title="Dismiss"
                >✕</button>
              </div>
              <div className="h-1 bg-brand-100">
                <div className="h-1 bg-brand-500 transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
              </div>
              <div className="divide-y divide-brand-100">
                {steps.map((step) => (
                  <div key={step.id} className={`flex items-center gap-3 px-5 py-3 ${step.done ? 'opacity-40' : ''}`}>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${step.done ? 'bg-brand-500 border-brand-500' : 'border-gray-300 bg-white'}`}>
                      {step.done && <span className="text-white text-[10px] font-bold">✓</span>}
                    </div>
                    <span className="text-sm flex-1 text-gray-700">{step.icon} {step.label}</span>
                    {!step.done && (
                      step.route
                        ? <button onClick={() => navigate(step.route)} className="text-xs font-semibold text-brand-600 hover:underline flex-shrink-0">Go →</button>
                        : <button onClick={handleToggleOpen} disabled={togglingOpen} className="text-xs font-semibold text-green-600 hover:underline flex-shrink-0">{togglingOpen ? '...' : 'Open now →'}</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Profile header card */}
        <div className="card flex items-center gap-4">
          {cafe?.logo_url ? (
            <img
              src={cafe.logo_url}
              alt={cafe.name}
              className="w-16 h-16 rounded-xl object-cover border border-gray-200 flex-shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-brand-500 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
              {cafe?.name?.charAt(0) || 'C'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900 truncate">{cafe?.name}</h1>
            <p className="text-xs text-gray-400 mt-0.5">/{cafe?.slug}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {(() => {
                const isTrial   = cafe?.plan_type === 'free_trial';
                const isPremium = cafe?.plan_tier === 'premium';
                const label = isTrial ? '🧪 Free Trial' : isPremium ? '✅ Kitchen Pro' : '✅ Essential';
                const cls   = isTrial ? 'bg-blue-100 text-blue-700' : isPremium ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700';
                return <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
              })()}
              {cafe?.city && (
                <span className="text-xs text-gray-500">📍 {cafe.city}{cafe.state ? `, ${cafe.state}` : ''}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <Link
              to="/owner/profile"
              className="text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              Edit Profile
            </Link>
            <button
              onClick={handleToggleOpen}
              disabled={togglingOpen}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                isOpen
                  ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                  : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
              }`}
            >
              {togglingOpen ? '...' : isOpen ? '🟢 Open' : '🔴 Closed'}
            </button>
          </div>
        </div>

        {/* Welcome */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Today's Overview</h2>
            <p className="text-gray-500 text-sm mt-0.5">Live stats for {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}.</p>
          </div>
          <button
            onClick={() => { localStorage.removeItem(`dv_ob_done_${cafe?.id}`); setOnboardingDismissed(false); }}
            className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-600 border border-gray-200 hover:border-brand-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            <span>📖</span> Setup Guide
          </button>
        </div>

        {/* QR / Link share */}
        <CafeQRCard url={cafeUrl} cafeName={cafe?.name} />

        {/* Today stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Today's Orders" value={stats?.today?.total_orders || 0} icon="📋" color="blue" sub="placed today" />
          <StatCard label="Collected Revenue" value={c(stats?.today?.total_revenue || 0)} icon="💰" color="green" sub="from paid orders" />
          <StatCard
            label="Pending"
            value={stats?.statusBreakdown?.find((s) => s.status === 'pending')?.count || 0}
            icon="⏳"
            color={(stats?.statusBreakdown?.find((s) => s.status === 'pending')?.count || 0) > 0 ? 'red' : 'yellow'}
            href="/owner/orders"
            pulse={(stats?.statusBreakdown?.find((s) => s.status === 'pending')?.count || 0) > 0}
          />
          <StatCard
            label="Preparing"
            value={stats?.statusBreakdown?.find((s) => s.status === 'preparing')?.count || 0}
            icon="👨‍🍳"
            color="orange"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Recent orders */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Recent Orders</h2>
              <Link to="/owner/orders" className="text-xs text-brand-600 hover:underline">View all</Link>
            </div>
            {stats?.recentOrders?.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-3xl mb-2">📋</p>
                <p className="text-gray-400 text-sm">No orders yet today</p>
                <p className="text-xs text-gray-400 mt-1">Share your café QR code or link to start receiving orders.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {stats?.recentOrders?.map((order) => (
                  <div key={order.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <span className="font-medium text-gray-800">{fmtToken(order.daily_order_number || order.order_number, order.order_type)}</span>
                      <span className="text-gray-400 ml-2">{order.customer_name} · {order.table_number}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c(order.final_amount || order.total_amount)}</span>
                      <span className={`badge ${STATUS_CONFIG[order.status]?.color}`}>{order.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top items */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4">Top Items (This Week)</h2>
            {stats?.topItems?.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-3xl mb-2">🍽️</p>
                <p className="text-gray-400 text-sm">No sales data yet.</p>
                <Link to="/owner/menu" className="text-xs text-brand-600 hover:underline mt-1 block">Add menu items →</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {stats?.topItems?.map((item, i) => (
                  <div key={item.item_name} className="flex items-center gap-3 text-sm">
                    <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="flex-1 font-medium text-gray-800 truncate">{item.item_name}</span>
                    <span className="text-gray-400">{item.total_qty} sold</span>
                    <span className="font-medium text-gray-900">{c(item.total_revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Testimonial widget */}
        <TestimonialWidget />

      </div>
    </>
  );
}

// ── Leave a review for DineVerse ─────────────────────────────────
function TestimonialWidget() {
  const { cafe } = useAuth();
  const [existing, setExisting]   = useState(undefined); // undefined = loading
  const [rating, setRating]       = useState(0);
  const [hovered, setHovered]     = useState(0);
  const [ownerName, setOwnerName] = useState('');
  const [title, setTitle]         = useState('');
  const [text, setText]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    getMyTestimonial()
      .then((r) => {
        const rev = r.data.review;
        setExisting(rev);
        if (rev) {
          setRating(rev.rating);
          setOwnerName(rev.owner_name || '');
          setTitle(rev.title || '');
          setText(rev.review_text || '');
        }
      })
      .catch(() => setExisting(null));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!rating) { toast.error('Please select a star rating'); return; }
    if (text.trim().length < 10) { toast.error('Please write at least 10 characters'); return; }
    setSubmitting(true);
    try {
      const res = await submitTestimonial({ rating, owner_name: ownerName.trim() || undefined, title: title.trim(), review_text: text.trim() });
      setExisting(res.data.review);
      setSubmitted(true);
      toast.success('Thank you! Your review is now on our homepage.');
    } catch {
      toast.error('Failed to save review — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  // Still loading
  if (existing === undefined) return null;

  return (
    <div className="card border border-brand-100 bg-gradient-to-br from-brand-50 to-orange-50">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-gray-900 text-sm">How's DineVerse working for you?</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {existing
              ? 'Your review is live on our homepage — edit it anytime.'
              : 'Your experience helps other restaurant owners discover us.'}
          </p>
        </div>
        <span className="text-2xl">⭐</span>
      </div>

      {submitted && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800 font-medium mb-4">
          ✓ Review saved and published on the DineVerse homepage!
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Star rating */}
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              onMouseEnter={() => setHovered(s)}
              onMouseLeave={() => setHovered(0)}
              onClick={() => setRating(s)}
              className="text-2xl leading-none transition-transform hover:scale-110"
            >
              <span className={(hovered || rating) >= s ? 'text-amber-400' : 'text-gray-200'}>★</span>
            </button>
          ))}
          {(hovered || rating) > 0 && (
            <span className="text-xs text-gray-500 ml-1">
              {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent!'][(hovered || rating)]}
            </span>
          )}
        </div>

        <input
          className="input text-sm"
          placeholder={`Your name (default: ${cafe?.name || 'your café name'})`}
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          maxLength={60}
        />

        <input
          className="input text-sm"
          placeholder="Short headline (optional) — e.g. 'Saved us an hour every night'"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
        />

        <textarea
          className="input resize-none text-sm"
          rows={3}
          placeholder="Tell other owners what you love about DineVerse — or what we can improve…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={600}
          required
        />

        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">{text.length}/600</span>
          <button
            type="submit"
            disabled={submitting || !rating || text.trim().length < 10}
            className="btn-primary text-sm px-5 py-2 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : existing ? 'Update Review' : 'Publish Review'}
          </button>
        </div>
      </form>
    </div>
  );
}

function StatCard({ label, value, icon, color, href, pulse, sub }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    orange: 'bg-orange-50 text-orange-600',
    red:    'bg-red-50 text-red-600',
  };
  const inner = (
    <>
      <div className={`w-10 h-10 rounded-lg ${colors[color] || colors.blue} flex items-center justify-center text-xl mb-3 relative`}>
        {icon}
        {pulse && <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />}
      </div>
      <p className={`text-2xl font-bold ${color === 'red' ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
      {href && pulse && <p className="text-xs text-red-500 font-medium mt-1">Needs action →</p>}
    </>
  );
  if (href) return <Link to={href} className="card hover:shadow-md transition-shadow">{inner}</Link>;
  return <div className="card">{inner}</div>;
}

function Shimmer({ className = '' }) {
  return <div className={`animate-pulse bg-gray-200 rounded-lg ${className}`} />;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 max-w-4xl">
      {/* Profile card */}
      <div className="card flex items-center gap-4">
        <Shimmer className="w-16 h-16 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Shimmer className="h-5 w-40" />
          <Shimmer className="h-3 w-24" />
          <Shimmer className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex flex-col items-end gap-2">
          <Shimmer className="h-7 w-24 rounded-lg" />
          <Shimmer className="h-7 w-20 rounded-lg" />
        </div>
      </div>

      {/* "Good day!" heading */}
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Shimmer className="h-6 w-32" />
          <Shimmer className="h-4 w-48" />
        </div>
        <Shimmer className="hidden sm:block h-8 w-28 rounded-lg" />
      </div>

      {/* QR card placeholder */}
      <Shimmer className="h-24 rounded-2xl" />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3">
            <Shimmer className="w-10 h-10 rounded-lg" />
            <Shimmer className="h-7 w-12" />
            <Shimmer className="h-3 w-24" />
          </div>
        ))}
      </div>

      {/* Two-col grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {[0, 1].map((i) => (
          <div key={i} className="card space-y-3">
            <Shimmer className="h-5 w-32" />
            {[0, 1, 2].map((j) => (
              <div key={j} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                <Shimmer className="h-4 w-40" />
                <Shimmer className="h-4 w-16" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
