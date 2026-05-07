/**
 * Bill display helpers — detect tax mode from order data so every receipt /
 * confirmation / history view renders the breakdown so it visually adds up.
 *
 * Why heuristic, not a stored flag?
 *   - Backend sets `total_amount = items_gross_with_tax` for inclusive mode
 *     and `total_amount = items + tax_amount` for exclusive mode.
 *   - Sum of order_items.subtotal is always the gross items value used at
 *     order creation.
 *   - So: inclusive ⇔ total_amount ≈ Σ item subtotals
 *         exclusive ⇔ total_amount ≈ Σ item subtotals + tax_amount
 */

export function isInclusiveTax(order) {
  if (!order) return false;
  const tax = parseFloat(order.tax_amount || 0);
  if (tax <= 0) return false; // no tax — distinction doesn't matter
  const items = order.items || [];
  if (items.length === 0) return false;
  const itemsSum = items.reduce((s, i) => s + parseFloat(i.subtotal || 0), 0);
  // Tolerance ₹0.5 for rounding
  return Math.abs(parseFloat(order.total_amount || 0) - itemsSum) < 0.5;
}

/**
 * Returns the breakdown rows that visually sum to final_amount.
 * Caller renders them with their own JSX styling.
 *
 * Each row: { label, amount, kind: 'add' | 'subtract' | 'info' | 'total' }
 *   - 'add' / 'subtract' → contributes to total
 *   - 'info' → informational (e.g. "GST included") doesn't contribute
 */
export function buildBillRows(order) {
  if (!order) return [];
  const taxAmount   = parseFloat(order.tax_amount || 0);
  const taxRate     = parseFloat(order.tax_rate || 0);
  const total       = parseFloat(order.total_amount || 0);
  const discount    = parseFloat(order.discount_amount || 0);
  const tip         = parseFloat(order.tip_amount || 0);
  const delivery    = parseFloat(order.delivery_fee || 0);
  const platformFee = parseFloat(order.platform_fee || 0);
  const platformRate = parseFloat(order.platform_fee_rate || 0);
  const finalAmt    = parseFloat(order.final_amount || total);
  const inclusive   = isInclusiveTax(order);

  const rows = [];

  if (inclusive) {
    // total_amount already includes tax. Show single subtotal line + a muted
    // "GST included" line that DOES NOT add to the total (kind: 'info').
    rows.push({ label: 'Order subtotal', amount: total, kind: 'add' });
    if (taxAmount > 0) {
      const half = taxAmount / 2;
      rows.push({ label: `CGST (${(taxRate / 2).toFixed(1)}%) — included`, amount: half, kind: 'info' });
      rows.push({ label: `SGST (${(taxRate / 2).toFixed(1)}%) — included`, amount: half, kind: 'info' });
    }
  } else {
    // Non-inclusive: show items pre-tax + CGST + SGST as separate adding lines.
    rows.push({ label: 'Order subtotal',                                     amount: total - taxAmount, kind: 'add' });
    if (taxAmount > 0) {
      rows.push({ label: `CGST (${(taxRate / 2).toFixed(1)}%)`,             amount: taxAmount / 2,     kind: 'add' });
      rows.push({ label: `SGST (${(taxRate / 2).toFixed(1)}%)`,             amount: taxAmount / 2,     kind: 'add' });
    }
  }

  if (discount > 0) rows.push({ label: 'Discount',                  amount: discount,    kind: 'subtract' });
  if (tip > 0)      rows.push({ label: 'Tip',                       amount: tip,         kind: 'add' });
  if (delivery > 0) rows.push({ label: 'Delivery fee',              amount: delivery,    kind: 'add' });
  if (platformFee > 0) rows.push({ label: `Platform charge (${platformRate}%)`, amount: platformFee, kind: 'add' });

  rows.push({ label: 'Total', amount: finalAmt, kind: 'total' });
  return rows;
}
