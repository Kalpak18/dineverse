-- Migration 085: Counter-only payments + platform-fee remittance details.
-- online_order_payments: customers pay for food online (Razorpay Route) only
--   when enabled. Off: they pay at the counter and the café remits
--   DineVerse's platform fee (commission_status = 'cash_due').
-- remittance: where cafés send the platform fee (UPI / bank), shown on the
--   owner's Billing page. Admin fills it in under Settings.
INSERT INTO platform_settings (key, value, label, description, is_public) VALUES
  ('online_order_payments', '{"enabled": false}', 'Online payments for customers',
   'When off, customers pay at the counter and cafés remit the platform fee', false),
  ('remittance', '{"upi_id": "", "payee_name": "DineVerse", "bank_name": "", "account_name": "", "account_number": "", "ifsc": "", "note": ""}',
   'Platform fee remittance details', 'Where cafés pay DineVerse its platform fee', false)
ON CONFLICT (key) DO NOTHING;
