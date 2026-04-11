export const fmtOrderNum  = (n)   => String(n).padStart(4, '0');
// fmtToken — dine-in: "T-12", takeaway: "TK-07"
export const fmtToken     = (n, orderType) => {
  if (n == null) return '–';
  const num = String(n).padStart(2, '0');
  return orderType === 'takeaway' ? `TK-${num}` : `T-${num}`;
};
export const fmtPrice     = (n)   => parseFloat(n).toFixed(2);
export const fmtCurrency  = (n)   => `₹${fmtPrice(n)}`;
export const fmtTime      = (str) =>
  new Date(str).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
