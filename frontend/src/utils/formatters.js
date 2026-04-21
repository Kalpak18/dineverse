export const fmtOrderNum  = (n)   => String(n).padStart(4, '0');
// fmtToken — the returned string includes the prefix; callers must NOT add '#'.
// dine-in: "#42" | takeaway: "TK 42" | delivery: "D 42"
export const fmtToken = (n, orderType) => {
  if (n == null) return '–';
  const num = String(n).padStart(2, '0');
  if (orderType === 'takeaway') return `TK ${num}`;
  if (orderType === 'delivery') return `D ${num}`;
  return `#${num}`;
};
export const fmtPrice     = (n)   => parseFloat(n).toFixed(2);

const CURRENCY_SYMBOLS = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AUD: 'A$',
  CAD: 'C$', SGD: 'S$', AED: 'د.إ', JPY: '¥', CNY: '¥',
};
export const currencySymbol = (currency = 'INR') =>
  CURRENCY_SYMBOLS[currency] ?? (currency + ' ');

export const fmtCurrency  = (n, currency = 'INR') =>
  `${currencySymbol(currency)}${fmtPrice(n)}`;
export const fmtTime      = (str) =>
  new Date(str).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Shows "Today, 02:30 PM" / "Yesterday, 11:00 AM" / "12 Apr 2025, 02:30 PM"
export const fmtDateTime  = (str) => {
  const d       = new Date(str);
  const today   = new Date().toDateString();
  const yest    = new Date(Date.now() - 86400000).toDateString();
  const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today) return `Today, ${timeStr}`;
  if (d.toDateString() === yest)  return `Yesterday, ${timeStr}`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + timeStr;
};

// Group orders by date — returns array of { label, orders }
export const groupByDate  = (orders) => {
  const today     = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const groups    = {};
  for (const o of orders) {
    const d   = new Date(o.created_at);
    const key = d.toDateString();
    const label = key === today     ? 'Today'
                : key === yesterday ? 'Yesterday'
                : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    if (!groups[key]) groups[key] = { label, ts: d.getTime(), orders: [] };
    groups[key].orders.push(o);
  }
  // Newest group first
  return Object.values(groups).sort((a, b) => b.ts - a.ts);
};
