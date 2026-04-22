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

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
