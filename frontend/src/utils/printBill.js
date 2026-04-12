/**
 * printBill — opens a GST-compliant 80mm thermal receipt in a new window and prints.
 *
 * Compliant with:
 *  - Indian GST invoice rules (CGST + SGST split, GSTIN, SAC code 996331)
 *  - FSSAI display requirement
 *  - Standard restaurant bill fields
 *
 * @param {object} params
 * @param {object} params.cafe         — cafe from AuthContext
 * @param {object} params.bill         — { isTakeaway, table_number, customerName, orderNumber,
 *                                         aggregatedItems:[{name,qty,total}], total, orders }
 * @param {number|null} params.cashReceived
 * @param {string}      params.paymentMode  — 'cash' | 'upi' | 'card' | 'online' | 'pending'
 * @param {boolean}     params.isPaid       — true → show PAID stamp, false/undefined → show PENDING stamp
 */
export function printBill({ cafe, bill, cashReceived = null, paymentMode = 'cash', isPaid = false }) {
  const prefix     = cafe?.bill_prefix || 'INV';
  // daily_order_number resets each day — preferred for display; fall back to global serial
  const dailyNum   = bill.orderNumber || bill.orders?.[0]?.daily_order_number || bill.orders?.[0]?.order_number || 0;
  const orderNum   = bill.orders?.[0]?.order_number || dailyNum;
  const invoiceNo  = `${prefix}-${String(orderNum).padStart(4, '0')}`;

  const now      = new Date();
  const dateStr  = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr  = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  // ── GST calculation ──────────────────────────────────────────────────────
  const gstRate      = parseInt(cafe?.gst_rate ?? 5);
  const hasGst       = !!(cafe?.gst_number) && gstRate > 0;
  const taxInclusive = cafe?.tax_inclusive !== false; // default true (backward-compat)

  const total        = parseFloat(bill.total) || 0;

  // Use stored tax_amount from order snapshot if available; re-derive otherwise
  const storedTax    = parseFloat(bill.orders?.[0]?.tax_amount ?? -1);
  let totalTax, taxableAmt;

  if (hasGst) {
    if (storedTax >= 0) {
      // Use the recorded tax snapshot (most accurate)
      totalTax   = storedTax * (bill.orders?.length || 1); // sum across orders if aggregated
      taxableAmt = total - totalTax;
    } else if (taxInclusive) {
      // Tax baked into price — extract
      taxableAmt = total / (1 + gstRate / 100);
      totalTax   = total - taxableAmt;
    } else {
      // Tax was added on top — total is gross = base + tax
      taxableAmt = total / (1 + gstRate / 100);
      totalTax   = total - taxableAmt;
    }
  } else {
    taxableAmt = total;
    totalTax   = 0;
  }

  const cgst = totalTax / 2;
  const sgst = totalTax / 2;

  const change      = cashReceived != null ? (parseFloat(cashReceived) - total) : null;

  const customerName = bill.isTakeaway
    ? bill.customerName
    : (bill.orders?.[0]?.customer_name || '');

  // ── Item rows ────────────────────────────────────────────────────────────
  let sno = 0;
  const itemRows = (bill.aggregatedItems || []).map((item) => {
    sno++;
    const lineTotal    = parseFloat(item.total) || 0;
    const lineTaxable  = hasGst ? lineTotal / (1 + gstRate / 100) : lineTotal;
    const unitTaxable  = item.qty > 0 ? lineTaxable / item.qty : 0;
    return `
      <tr>
        <td class="center">${sno}</td>
        <td class="item-name">${escHtml(item.name)}</td>
        <td class="center">${item.qty}</td>
        <td class="right">${fmt(unitTaxable)}</td>
        <td class="right">${fmt(lineTotal)}</td>
      </tr>`;
  }).join('');

  // ── Payment mode label ───────────────────────────────────────────────────
  const modeLabel = { cash: 'Cash', upi: 'UPI', card: 'Card / POS', online: 'Online', pending: 'Pending' }[paymentMode] || paymentMode;
  const isOnline   = paymentMode === 'online';
  const isPending  = paymentMode === 'pending' || !isPaid;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escHtml(invoiceNo)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11.5px;
      color: #000;
      background: #fff;
      width: 80mm;
      margin: 0 auto;
      padding: 5mm 3mm 12mm;
    }
    p { line-height: 1.5; }

    /* ── Header ── */
    .cafe-name {
      font-size: 15px;
      font-weight: bold;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .sub { font-size: 10px; text-align: center; line-height: 1.6; }
    .bill-title {
      text-align: center;
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 2px;
      margin: 4px 0 2px;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 2px 0;
    }

    /* ── Dashes ── */
    .sep { border: none; border-top: 1px dashed #555; margin: 4px 0; }
    .sep-solid { border: none; border-top: 1px solid #000; margin: 4px 0; }

    /* ── Meta ── */
    .meta { font-size: 10px; line-height: 1.7; }
    .meta .row { display: flex; justify-content: space-between; }

    /* ── Items table ── */
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    thead th {
      font-size: 9.5px; font-weight: bold; text-transform: uppercase;
      padding: 2px 1px; border-bottom: 1px solid #000;
    }
    thead th.right { text-align: right; }
    thead th.center { text-align: center; }
    tbody td { padding: 2px 1px; vertical-align: top; }
    td.sno { text-align: center; width: 6%; }
    td.item-name { width: 38%; }
    td.center { text-align: center; width: 8%; }
    td.right { text-align: right; }

    /* ── Totals ── */
    .totals { width: 100%; font-size: 11px; }
    .totals td { padding: 1.5px 0; }
    .totals .lbl { width: 65%; }
    .totals .val { text-align: right; font-weight: bold; }
    .totals .indent { padding-left: 8px; font-size: 10px; color: #333; }
    .grand-total td {
      font-size: 13px; font-weight: bold;
      border-top: 1px solid #000; padding-top: 3px;
    }

    /* ── Payment ── */
    .payment { font-size: 10.5px; line-height: 1.7; }
    .footer { text-align: center; font-size: 10px; color: #444; line-height: 1.7; margin-top: 5px; }

    /* ── Paid / Pending stamp ── */
    .stamp {
      display: block;
      width: fit-content;
      margin: 6px auto 2px;
      padding: 3px 12px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 900;
      letter-spacing: 3px;
      text-transform: uppercase;
      border-width: 2px;
      border-style: solid;
    }
    .stamp-paid    { color: #15803d; border-color: #15803d; }
    .stamp-pending { color: #b45309; border-color: #b45309; }

    @media print {
      body { width: 80mm; margin: 0; padding: 0 3mm 12mm; }
      @page { margin: 0; size: 80mm auto; }
    }
  </style>
</head>
<body>

  <!-- ── Café Header ── -->
  <p class="cafe-name">${escHtml(cafe?.name || 'Café')}</p>
  <div class="sub">
    ${cafe?.address  ? `<p>${escHtml(cafe.address)}</p>`            : ''}
    ${cafe?.phone    ? `<p>Ph: ${escHtml(cafe.phone)}</p>`          : ''}
    ${cafe?.email    ? `<p>${escHtml(cafe.email)}</p>`              : ''}
    ${cafe?.gst_number
      ? `<p>GSTIN: ${escHtml(cafe.gst_number.toUpperCase())}</p>`   : ''}
    ${cafe?.pan_number
      ? `<p>PAN: ${escHtml(cafe.pan_number.toUpperCase())}</p>`      : ''}
    ${cafe?.fssai_number
      ? `<p>FSSAI No: ${escHtml(cafe.fssai_number)}</p>`            : ''}
  </div>

  <!-- ── Order Number Token (large, prominent) ── -->
  <div style="border:2px solid #000;border-radius:6px;text-align:center;padding:6px 4px;margin:6px 0;">
    <div style="font-size:9px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#555;margin-bottom:2px;">
      ORDER TOKEN
    </div>
    <div style="font-size:36px;font-weight:900;letter-spacing:2px;line-height:1;">
      #${dailyNum}
    </div>
    <div style="font-size:9px;color:#777;margin-top:2px;">
      ${bill.isTakeaway ? '🥡 TAKEAWAY' : `🍽️ TABLE ${escHtml(String(bill.table_number || ''))}`}
    </div>
  </div>

  <!-- ── Title ── -->
  <div class="bill-title">${hasGst ? 'TAX INVOICE' : 'RECEIPT'}</div>

  <!-- ── Invoice Meta ── -->
  <div class="meta">
    <div class="row"><span>Invoice No</span><span>${escHtml(invoiceNo)}</span></div>
    <div class="row"><span>Date</span><span>${dateStr}</span></div>
    <div class="row"><span>Time</span><span>${timeStr}</span></div>
    <div class="row">
      <span>Type</span>
      <span>${bill.isTakeaway ? 'Takeaway' : `Dine-In · Table ${escHtml(String(bill.table_number))}`}</span>
    </div>
    ${customerName ? `<div class="row"><span>Customer</span><span>${escHtml(customerName)}</span></div>` : ''}
    ${hasGst ? `<div class="row"><span>SAC Code</span><span>996331</span></div>` : ''}
  </div>

  <hr class="sep" />

  <!-- ── Items ── -->
  <table>
    <thead>
      <tr>
        <th class="center">#</th>
        <th style="text-align:left">Item</th>
        <th class="center">Qty</th>
        <th class="right">Rate</th>
        <th class="right">Amt</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <hr class="sep-solid" />

  <!-- ── Totals ── -->
  <table class="totals">
    ${hasGst ? `
    <tr>
      <td class="lbl">Taxable Amount</td>
      <td class="val">&#8377;${fmt(taxableAmt)}</td>
    </tr>
    <tr>
      <td class="lbl indent">CGST @ ${gstRate / 2}%</td>
      <td class="val">&#8377;${fmt(cgst)}</td>
    </tr>
    <tr>
      <td class="lbl indent">SGST @ ${gstRate / 2}%</td>
      <td class="val">&#8377;${fmt(sgst)}</td>
    </tr>
    ` : ''}
    <tr class="grand-total">
      <td>TOTAL</td>
      <td class="val">&#8377;${fmt(total)}</td>
    </tr>
    ${cashReceived != null ? `
    <tr>
      <td class="lbl">Cash Received</td>
      <td class="val">&#8377;${fmt(cashReceived)}</td>
    </tr>
    <tr>
      <td class="lbl">Change Returned</td>
      <td class="val">&#8377;${fmt(change)}</td>
    </tr>
    ` : ''}
  </table>

  <hr class="sep" />

  <!-- ── Payment ── -->
  <div class="payment">
    <div style="display:flex;justify-content:space-between;">
      <span>Payment Mode</span><strong>${escHtml(modeLabel)}</strong>
    </div>
    ${cafe?.upi_id && (paymentMode === 'upi' || paymentMode === 'pending' || isOnline)
      ? `<div style="display:flex;justify-content:space-between;">
           <span>UPI ID</span><span>${escHtml(cafe.upi_id)}</span>
         </div>`
      : ''}
  </div>

  <!-- ── Paid / Pending stamp ── -->
  <div style="text-align:center;margin:6px 0 2px;">
    <span class="stamp ${isPending ? 'stamp-pending' : 'stamp-paid'}">
      ${isPending ? 'PENDING' : 'PAID'}
    </span>
  </div>

  <hr class="sep" />

  <!-- ── Footer ── -->
  <div class="footer">
    <p>${escHtml(cafe?.bill_footer || 'Thank you for your visit! See you again.')}</p>
    ${hasGst
      ? `<p style="margin-top:3px;font-size:9px;">*All prices are GST ${taxInclusive ? 'inclusive' : 'exclusive'} (${gstRate}%)</p>`
      : ''}
    <p style="margin-top:4px;color:#999;font-size:9px;">Powered by DineVerse</p>
  </div>

  <script>
    window.onload = function () {
      window.print();
      window.onafterprint = function () { window.close(); };
    };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=420,height=750,toolbar=0,menubar=0,scrollbars=1');
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this site to print bills.');
    return;
  }
  win.document.write(html);
  win.document.close();
}

function fmt(n) {
  return parseFloat(n || 0).toFixed(2);
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
