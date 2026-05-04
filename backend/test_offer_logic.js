require('dotenv').config();
const db = require('./src/config/database');
const { applyBestOffer, applyCoupon } = require('./src/controllers/offerController');

async function run() {
  const cafeRes = await db.query('SELECT id, slug FROM cafes WHERE is_active = true LIMIT 1');
  if (cafeRes.rows.length === 0) {
    console.error('No active cafe found in database.');
    process.exit(1);
  }
  const cafeId = cafeRes.rows[0].id;
  const slug = cafeRes.rows[0].slug;

  const menuRes = await db.query(
    `SELECT id, price, name
     FROM menu_items
     WHERE cafe_id = $1 AND is_available = true
     ORDER BY created_at ASC
     LIMIT 5`,
    [cafeId]
  );
  if (menuRes.rows.length < 2) {
    console.error('Need at least 2 available menu items for combo test.');
    process.exit(1);
  }

  const item1 = menuRes.rows[0];
  const item2 = menuRes.rows[1];
  const item3 = menuRes.rows[2] || item1;

  const offerIds = [];
  try {
    const result1 = await db.query(
      `INSERT INTO offers (cafe_id, name, description, offer_type, discount_value, min_order_amount, is_active, active_days)
       VALUES ($1, $2, $3, 'percentage', 20, 0, true, NULL)
       RETURNING id`,
      [cafeId, '20% Off Test', 'Test percentage offer', 20]
    );
    offerIds.push(result1.rows[0].id);

    const result2 = await db.query(
      `INSERT INTO offers (cafe_id, name, description, offer_type, discount_value, min_order_amount, is_active, active_days)
       VALUES ($1, $2, $3, 'fixed', 50, 100, true, NULL)
       RETURNING id`,
      [cafeId, '₹50 Off 100+', 'Test fixed offer', 50]
    );
    offerIds.push(result2.rows[0].id);

    const comboItems = [{ menu_item_id: item1.id, quantity: 1 }, { menu_item_id: item2.id, quantity: 1 }];
    const normalComboTotal = parseFloat(item1.price) + parseFloat(item2.price);
    const comboPrice = Math.max(1, normalComboTotal - 40);
    const result3 = await db.query(
      `INSERT INTO offers (cafe_id, name, description, offer_type, discount_value, combo_items, combo_price, min_order_amount, is_active, active_days)
       VALUES ($1, $2, $3, 'combo', 0, $4::jsonb, $5, 0, true, NULL)
       RETURNING id`,
      [cafeId, 'Combo Test', 'Test combo offer', JSON.stringify(comboItems), comboPrice]
    );
    offerIds.push(result3.rows[0].id);

    const result4 = await db.query(
      `INSERT INTO offers (cafe_id, name, description, offer_type, discount_value, min_order_amount, coupon_code, is_active, active_days)
       VALUES ($1, $2, $3, 'fixed', $4, 0, $5, true, NULL)
       RETURNING id`,
      [cafeId, 'Coupon Test', 'Test coupon offer', 30, 'TESTCOUPON']
    );
    offerIds.push(result4.rows[0].id);

    const cartItems = [
      { menu_item_id: item1.id, quantity: 1 },
      { menu_item_id: item2.id, quantity: 1 },
      { menu_item_id: item3.id, quantity: 1 },
    ];
    const total = parseFloat(item1.price) + parseFloat(item2.price) + parseFloat(item3.price);

    console.log('Cafe slug:', slug);
    console.log('Cart total:', total);
    console.log('Cart items:', cartItems.map((i) => ({ id: i.menu_item_id, qty: i.quantity })));

    const best = await applyBestOffer(cafeId, cartItems, total);
    console.log('applyBestOffer result:', best);

    const coupon = await applyCoupon(cafeId, 'TESTCOUPON', cartItems, total);
    console.log('applyCoupon result:', coupon);

    if (!best.offerId || best.discountAmount <= 0) {
      throw new Error('applyBestOffer did not apply any discount');
    }
    if (!coupon.offerId || coupon.discountAmount <= 0) {
      throw new Error('applyCoupon did not apply expected coupon discount');
    }

    console.log('Offer logic test passed successfully.');
  } catch (err) {
    console.error('Offer logic test failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (offerIds.length) {
      await db.query('DELETE FROM offers WHERE id = ANY($1)', [offerIds]);
    }
    await db.pool.end();
  }
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
