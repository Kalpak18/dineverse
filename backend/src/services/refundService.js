const Razorpay = require('razorpay');
const db = require('../config/database');
const logger = require('../utils/logger');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID     || process.env.RAZORPAY_TEST_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET,
});

/**
 * Full refund of a cancelled order's Razorpay payment. Safe to call from any
 * cancel path, any number of times: the row is claimed atomically, so only
 * the first call refunds. Never throws — failures are recorded as
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
    let hasTransfer = false;
    try {
      const t = await razorpay.payments.fetchTransfer(paymentId);
      hasTransfer = (t?.items || []).length > 0;
    } catch { /* no Route on this payment */ }

    const refund = await razorpay.payments.refund(paymentId, {
      amount: Math.round(parseFloat(finalAmount) * 100),
      notes:  { order_id: orderId, reason: String(reason).slice(0, 200) },
      ...(hasTransfer && { reverse_all: 1 }),
    });
    await db.query(
      `UPDATE orders SET refund_id = $1, refund_status = 'processed', refunded_at = NOW() WHERE id = $2`,
      [refund.id, orderId]
    );
    logger.info('Refunded order %s: payment %s refund %s (reverse_all=%s)', orderId, paymentId, refund.id, hasTransfer);
    return refund.id;
  } catch (err) {
    logger.error('Refund FAILED for order %s payment %s: %s — needs manual refund', orderId, paymentId, err.message);
    await db.query(`UPDATE orders SET refund_status = 'failed' WHERE id = $1`, [orderId]).catch(() => {});
    return null;
  }
}

module.exports = { refundPrepaidOrder };
