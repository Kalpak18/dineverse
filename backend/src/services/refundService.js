const { razorpay } = require('./razorpayClient');
const db = require('../config/database');
const logger = require('../utils/logger');


const toPaise = (rupees) => Math.round(parseFloat(rupees) * 100);

// The Route transfer that paid the café its share, if any: { id, amount (paise) }
async function routeTransfer(paymentId) {
  try {
    const t = await razorpay.payments.fetchTransfer(paymentId);
    const first = (t?.items || [])[0];
    return first ? { id: first.id, amount: Number(first.amount) || 0 } : null;
  } catch {
    return null; // no Route on this payment
  }
}

// Rupees already refunded item-by-item (pending counts — it's in flight)
async function partialRefunded(q, orderId) {
  const r = await q.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM order_refunds WHERE order_id = $1 AND status IN ('pending', 'processed')`,
    [orderId]
  );
  return parseFloat(r.rows[0].total) || 0;
}

/**
 * Refund what is left of a cancelled order's Razorpay payment (the full
 * amount minus any item refunds already made). Safe to call from any cancel
 * path, any number of times: the row is claimed atomically, so only the
 * first call refunds. Never throws — failures are recorded as
 * refund_status='failed' and logged for admin follow-up.
 *
 * Route payments: the café's share was already transferred, so the refund
 * reverses that transfer too (reverse_all) instead of DineVerse eating it.
 */
async function refundPrepaidOrder(orderId, reason = 'Order cancelled') {
  const claim = await db.query(
    `UPDATE orders SET refund_status = 'pending'
     WHERE id = $1 AND payment_verified = true AND payment_id IS NOT NULL
       AND status = 'cancelled' AND refund_status IS NULL
     RETURNING payment_id, final_amount`,
    [orderId]
  ).catch((err) => { logger.error('Refund claim failed for order %s: %s', orderId, err.message); return { rows: [] }; });
  if (claim.rows.length === 0) return null; // not prepaid, not cancelled, or already handled

  const { payment_id: paymentId, final_amount: finalAmount } = claim.rows[0];
  try {
    const remainingPaise = toPaise(finalAmount) - toPaise(await partialRefunded(db, orderId));
    if (remainingPaise <= 0) {
      await db.query(`UPDATE orders SET refund_status = 'processed', refunded_at = NOW() WHERE id = $1`, [orderId]);
      return null; // every item was already refunded individually
    }
    const transfer = await routeTransfer(paymentId);
    const refund = await razorpay.payments.refund(paymentId, {
      amount: remainingPaise,
      notes:  { order_id: orderId, reason: String(reason).slice(0, 200) },
      ...(transfer && { reverse_all: 1 }),
    });
    await db.query(
      `UPDATE orders SET refund_id = $1, refund_status = 'processed', refunded_at = NOW() WHERE id = $2`,
      [refund.id, orderId]
    );
    logger.info('Refunded order %s: payment %s refund %s (%d paise, reverse_all=%s)', orderId, paymentId, refund.id, remainingPaise, !!transfer);
    return refund.id;
  } catch (err) {
    logger.error('Refund FAILED for order %s payment %s: %s — needs manual refund', orderId, paymentId, err.message);
    await db.query(`UPDATE orders SET refund_status = 'failed' WHERE id = $1`, [orderId]).catch(() => {});
    return null;
  }
}

/**
 * Refund one cancelled/rejected item of a prepaid order that otherwise goes
 * ahead. Amount = the item's share of what the customer paid for food
 * (tax, discount and platform fee spread proportionally; tip and delivery
 * fee excluded), capped so total refunds never exceed the order total.
 * Route: the café's transferred share is reversed in the same proportion.
 * Idempotent per item (unique order_id + item_id). Never throws.
 */
async function refundOrderItem(orderId, itemId, reason = 'Item unavailable') {
  const client = await db.pool.connect();
  let row;
  let paymentId;
  let finalPaise;
  try {
    await client.query('BEGIN');
    const o = await client.query(
      `SELECT id, payment_id, payment_verified, final_amount, tip_amount, delivery_fee
       FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = o.rows[0];
    if (!order || !order.payment_verified || !order.payment_id) { await client.query('ROLLBACK'); return null; }

    const items = await client.query('SELECT id, subtotal FROM order_items WHERE order_id = $1', [orderId]);
    const allSubtotal = items.rows.reduce((s, i) => s + parseFloat(i.subtotal || 0), 0);
    const item = items.rows.find((i) => i.id === itemId);
    if (!item || allSubtotal <= 0) { await client.query('ROLLBACK'); return null; }

    const foodPaid = parseFloat(order.final_amount) - parseFloat(order.tip_amount || 0) - parseFloat(order.delivery_fee || 0);
    finalPaise = toPaise(order.final_amount);
    const alreadyPaise = toPaise(await partialRefunded(client, orderId));
    const sharePaise = Math.round((parseFloat(item.subtotal) / allSubtotal) * toPaise(foodPaid));
    const amountPaise = Math.min(sharePaise, finalPaise - alreadyPaise);
    if (amountPaise <= 0) { await client.query('ROLLBACK'); return null; }

    const ins = await client.query(
      `INSERT INTO order_refunds (order_id, item_id, amount, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (order_id, item_id) WHERE item_id IS NOT NULL DO NOTHING
       RETURNING id, amount`,
      [orderId, itemId, amountPaise / 100, String(reason).slice(0, 200)]
    );
    await client.query('COMMIT');
    if (!ins.rows.length) return null; // this item was already refunded
    row = ins.rows[0];
    paymentId = order.payment_id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Item refund claim failed for order %s item %s: %s', orderId, itemId, err.message);
    return null;
  } finally {
    client.release();
  }

  const amountPaise = toPaise(row.amount);
  try {
    const transfer = await routeTransfer(paymentId);
    if (transfer && transfer.amount > 0) {
      // Take back the café's proportional share of this item
      const reversePaise = Math.min(transfer.amount, Math.round(amountPaise * (transfer.amount / finalPaise)));
      if (reversePaise > 0) await razorpay.transfers.reverse(transfer.id, { amount: reversePaise });
    }
    const refund = await razorpay.payments.refund(paymentId, {
      amount: amountPaise,
      notes:  { order_id: orderId, item_id: itemId, reason: String(reason).slice(0, 200) },
    });
    await db.query(`UPDATE order_refunds SET status = 'processed', razorpay_refund_id = $1 WHERE id = $2`, [refund.id, row.id]);
    logger.info('Item refund: order %s item %s %d paise (refund %s)', orderId, itemId, amountPaise, refund.id);
    return refund.id;
  } catch (err) {
    logger.error('Item refund FAILED order %s item %s: %s — needs manual refund', orderId, itemId, err.message);
    await db.query(`UPDATE order_refunds SET status = 'failed' WHERE id = $1`, [row.id]).catch(() => {});
    return null;
  }
}

module.exports = { refundPrepaidOrder, refundOrderItem };
