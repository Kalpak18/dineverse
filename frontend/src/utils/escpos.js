// Receipt lines → ESC/POS bytes, the command language almost every thermal
// receipt printer speaks (58 mm and 80 mm, Bluetooth / USB / network).
//
// A receipt is a list of lines:
//   { text, align: 'left'|'center'|'right', bold, big }   plain text (big = double size)
//   { left, right, bold }                                 two columns, right-aligned amount
//   { qty, name, amount }                                 item line (name wraps)
//   { rule: '-' }                                         divider
//   { feed: n }                                           blank lines
// Printer code pages have no ₹ (or Devanagari), so text is reduced to ASCII.

const ESC = 0x1b;
const GS = 0x1d;

export const charsPerLine = (width) => (Number(width) === 58 ? 32 : 48);

// ₹ → "Rs.", smart quotes/dashes → ASCII, anything else outside ASCII dropped
export function toAscii(text) {
  return String(text ?? '')
    .replace(/₹\s?/g, 'Rs.')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/[·•]/g, '-').replace(/×/g, 'x').replace(/…/g, '...')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e\n]/g, '')
    .replace(/ {2,}/g, ' ');
}

function wrap(text, width) {
  const words = toAscii(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w.slice(0, width);
    else if ((line + ' ' + w).length <= width) line += ' ' + w;
    else { lines.push(line); line = w.slice(0, width); }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

const twoCols = (left, right, width) => {
  const r = toAscii(right);
  const l = toAscii(left).slice(0, Math.max(1, width - r.length - 1));
  return l + ' '.repeat(Math.max(1, width - l.length - r.length)) + r;
};

export function encodeReceipt(lines, { width = 80, cut = true } = {}) {
  const cols = charsPerLine(width);
  const out = [ESC, 0x40]; // initialise
  const push = (...b) => out.push(...b);
  const text = (s) => { for (const ch of toAscii(s)) out.push(ch.charCodeAt(0)); push(0x0a); };
  const align = (a) => push(ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0);
  const bold = (on) => push(ESC, 0x45, on ? 1 : 0);
  const size = (big) => push(GS, 0x21, big ? 0x11 : 0x00);

  for (const ln of lines) {
    if (!ln) continue;
    if (ln.feed) { push(ESC, 0x64, Math.min(ln.feed, 10)); continue; }
    if (ln.rule) { align('left'); bold(false); size(false); text(String(ln.rule).repeat(cols)); continue; }
    if (ln.qty != null) {
      align('left'); bold(!!ln.bold); size(false);
      const qty = `${ln.qty} x `;
      const amount = ln.amount != null ? ` ${toAscii(ln.amount)}` : '';
      const nameWidth = cols - qty.length - amount.length;
      const nameLines = wrap(ln.name, Math.max(8, nameWidth));
      nameLines.forEach((n, i) => {
        if (i === 0) text(qty + n + ' '.repeat(Math.max(0, nameWidth - n.length)) + amount);
        else text(' '.repeat(qty.length) + n);
      });
      if (ln.note) wrap(ln.note, cols - qty.length).forEach((n) => text(' '.repeat(qty.length) + n));
      continue;
    }
    if (ln.left != null) { align('left'); bold(!!ln.bold); size(false); text(twoCols(ln.left, ln.right, cols)); continue; }
    align(ln.align || 'left'); bold(!!ln.bold); size(!!ln.big);
    for (const l of wrap(ln.text, ln.big ? Math.floor(cols / 2) : cols)) text(l);
  }
  size(false); bold(false); align('left');
  push(ESC, 0x64, 4);                 // feed past the tear bar
  if (cut) push(GS, 0x56, 0x42, 0x00); // partial cut (printers without a cutter ignore it)
  return new Uint8Array(out);
}
