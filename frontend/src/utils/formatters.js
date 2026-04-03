export const fmtOrderNum  = (n)   => String(n).padStart(4, '0');
// fmtToken — shows the daily café-specific token number without zero-padding
export const fmtToken     = (n)   => n != null ? String(n) : '–';
export const fmtPrice     = (n)   => parseFloat(n).toFixed(2);
export const fmtCurrency  = (n)   => `₹${fmtPrice(n)}`;
export const fmtTime      = (str) =>
  new Date(str).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
