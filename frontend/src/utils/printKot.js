/**
 * printKot — prints a Kitchen Order Ticket for a single item.
 * 80mm thermal receipt format, no prices (kitchen doesn't need them).
 *
 * @param {object} params
 * @param {object} params.cafe       — cafe from AuthContext
 * @param {object} params.item       — { item_name, quantity }
 * @param {string} params.orderToken — formatted token e.g. "D-05" or "TK-3"
 * @param {string} params.tableNumber
 * @param {string} params.orderType  — 'dine-in' | 'takeaway' | 'delivery'
 */
export function printKot({ cafe, item, orderToken, tableNumber, orderType }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const tableLabel = orderType === 'takeaway'
    ? '🥡 TAKEAWAY'
    : `TABLE: ${escHtml(String(tableNumber || ''))}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>KOT ${escHtml(orderToken)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      color: #000;
      background: #fff;
      width: 80mm;
      margin: 0 auto;
      padding: 4mm 3mm 10mm;
    }
    .center { text-align: center; }
    .cafe-name { font-size: 14px; font-weight: bold; text-align: center; text-transform: uppercase; letter-spacing: 1px; }
    .kot-title {
      text-align: center;
      font-size: 18px;
      font-weight: 900;
      letter-spacing: 4px;
      border-top: 2px solid #000;
      border-bottom: 2px solid #000;
      padding: 4px 0;
      margin: 5px 0;
    }
    .meta { font-size: 11px; line-height: 1.8; }
    .meta .row { display: flex; justify-content: space-between; }
    .table-box {
      border: 2px solid #000;
      border-radius: 4px;
      text-align: center;
      padding: 6px 4px;
      margin: 6px 0;
    }
    .table-label { font-size: 10px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; color: #555; }
    .table-value { font-size: 28px; font-weight: 900; letter-spacing: 1px; line-height: 1.1; }
    .item-box {
      border: 2px solid #000;
      border-radius: 4px;
      padding: 8px 6px;
      margin: 6px 0;
    }
    .item-name { font-size: 16px; font-weight: 900; word-break: break-word; }
    .item-qty { font-size: 13px; font-weight: bold; margin-top: 4px; }
    .sep { border: none; border-top: 1px dashed #555; margin: 4px 0; }
    .footer { text-align: center; font-size: 10px; color: #444; line-height: 1.7; margin-top: 6px; }
    @media print {
      body { width: 80mm; margin: 0; padding: 0 3mm 10mm; }
      @page { margin: 0; size: 80mm auto; }
    }
  </style>
</head>
<body>
  <p class="cafe-name">${escHtml(cafe?.name || 'Kitchen')}</p>
  <div class="kot-title">KOT</div>

  <div class="meta">
    <div class="row"><span>Token</span><span><strong>${escHtml(orderToken)}</strong></span></div>
    <div class="row"><span>Date</span><span>${dateStr}</span></div>
    <div class="row"><span>Time</span><span>${timeStr}</span></div>
  </div>

  <div class="table-box">
    <div class="table-label">${orderType === 'takeaway' ? 'Order Type' : 'Table'}</div>
    <div class="table-value">${tableLabel}</div>
  </div>

  <hr class="sep" />

  <div class="item-box">
    <div class="item-name">${escHtml(item.item_name)}</div>
    <div class="item-qty">Qty: ${item.quantity}</div>
  </div>

  <hr class="sep" />

  <div class="footer">
    <p>— KITCHEN COPY —</p>
    <p style="font-size:9px;color:#999;margin-top:4px;">Powered by DineVerse</p>
  </div>

  <script>
    window.onload = function () {
      window.print();
      window.onafterprint = function () { window.close(); };
    };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=380,height=500,toolbar=0,menubar=0,scrollbars=1');
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups to print KOT.');
    return;
  }
  win.document.write(html);
  win.document.close();
}

/**
 * printFullKot — prints a full Kitchen Order Ticket for a whole order.
 * Uses the `kot` object returned by POST /orders/:id/kot.
 * 80mm thermal format, no prices (kitchen copy).
 *
 * @param {object} kot      — { slip_number, table_number, customer_name, items: [{item_name, quantity}] }
 * @param {string} cafeName — café display name
 */
export function printFullKot(kot, cafeName) {
  const items = Array.isArray(kot.items) ? kot.items : [];
  const isTakeaway = !kot.table_number;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  const itemRows = items.map((i) =>
    `<tr><td class="qty">${i.quantity}</td><td class="name">${escHtml(i.item_name)}</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>KOT #${kot.slip_number}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Courier New',monospace; width:80mm; margin:0 auto; padding:5mm 4mm 10mm; background:#fff; color:#000; }
    .cafe { text-align:center; font-size:11px; font-weight:bold; text-transform:uppercase; letter-spacing:1px; margin-bottom:3px; }
    .cafe-sub { text-align:center; font-size:9px; color:#555; letter-spacing:1px; text-transform:uppercase; margin-bottom:5px; }
    .kot-title { background:#000; color:#fff; text-align:center; font-size:11px; font-weight:900;
                 letter-spacing:3px; text-transform:uppercase; padding:3px 0; margin-bottom:5px; }
    .order-id { text-align:center; font-size:22px; font-weight:900; letter-spacing:1px; line-height:1.1; }
    .order-type { text-align:center; font-size:11px; font-weight:bold; margin-bottom:4px; }
    .info-row { display:flex; justify-content:space-between; font-size:10px; color:#555; margin-bottom:4px; }
    .sep { border:none; border-top:1px dashed #aaa; margin:4px 0; }
    table { width:100%; border-collapse:collapse; margin:4px 0; }
    .qty { width:28px; font-size:18px; font-weight:900; vertical-align:middle; padding:2px 4px 2px 0; }
    .name { font-size:14px; font-weight:bold; vertical-align:middle; padding:2px 0; }
    @media print { @page { size:80mm auto; margin:0; } body { padding:3mm 3mm 10mm; } }
  </style>
</head>
<body>
  <div class="cafe">${escHtml(cafeName || 'Kitchen')}</div>
  <div class="cafe-sub">Kitchen Order Ticket</div>
  <div class="kot-title">KOT — SLIP #${kot.slip_number}</div>
  <div class="order-id">${isTakeaway ? 'TAKEAWAY' : `TABLE ${escHtml(String(kot.table_number))}`}</div>
  ${kot.customer_name ? `<div class="order-type">${escHtml(kot.customer_name)}</div>` : ''}
  <div class="info-row"><span>${dateStr}</span><span>${timeStr}</span></div>
  <hr class="sep"/>
  <table><tbody>${itemRows}</tbody></table>
  <hr class="sep"/>
  <div style="text-align:center;margin-top:8px;">
    <button onclick="window.print();window.onafterprint=function(){window.close()};"
      style="font-family:'Courier New',monospace;font-size:12px;font-weight:bold;padding:7px 24px;
             border:2px solid #000;border-radius:4px;background:#000;color:#fff;cursor:pointer;letter-spacing:1px;">
      PRINT KOT
    </button>
  </div>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=380,height=520,toolbar=0,menubar=0,scrollbars=1');
  if (w) { w.document.write(html); w.document.close(); }
  else alert('Pop-up blocked. Allow pop-ups to print KOT.');
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
