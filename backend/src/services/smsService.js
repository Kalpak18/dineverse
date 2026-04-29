const logger = require('../utils/logger');

let twilioClient = null;

function getClient() {
  if (!twilioClient) {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
    }
    const twilio = require('twilio');
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

// Normalize Indian / international phone numbers to E.164
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (phone.startsWith('+')) return phone.replace(/[^\d+]/g, '');
  return `+${digits}`;
}

exports.normalizePhone = normalizePhone;

exports.sendWaitlistSms = async (phone, cafeName, tableNumber) => {
  if (!phone) return;
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    logger.warn('[Waitlist SMS] Twilio not configured — skipping SMS to %s', phone);
    return;
  }
  const to = normalizePhone(phone);
  const msg = tableNumber
    ? `${cafeName}: Your table (${tableNumber}) is ready! Please proceed to be seated.`
    : `${cafeName}: Your table is ready! Please come to the counter.`;
  try {
    await getClient().messages.create({ body: msg, from: process.env.TWILIO_PHONE_NUMBER, to });
    logger.info('[Waitlist SMS] Sent to %s', to);
  } catch (err) {
    logger.error('[Waitlist SMS] Failed for %s: %s', to, err.message);
  }
};

exports.sendWaitlistCallingSoonSms = async (phone, cafeName, position) => {
  if (!phone) return;
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    logger.warn('[Waitlist SMS] Twilio not configured — skipping calling-soon SMS to %s', phone);
    return;
  }
  const to = normalizePhone(phone);
  const msg = `${cafeName}: You're ${position <= 1 ? 'next' : `#${position} in line`}! Please make your way to the entrance.`;
  try {
    await getClient().messages.create({ body: msg, from: process.env.TWILIO_PHONE_NUMBER, to });
    logger.info('[Waitlist SMS] Calling-soon sent to %s', to);
  } catch (err) {
    logger.error('[Waitlist SMS] Failed for %s: %s', to, err.message);
  }
};

exports.sendOtpSms = async (phone, otp) => {
  const to = normalizePhone(phone);

  // Dev fallback: if Twilio is not configured just log the OTP
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    logger.warn('Twilio not configured — OTP for %s: %s', to, otp);
    return;
  }

  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error('TWILIO_PHONE_NUMBER not set');

  try {
    await getClient().messages.create({
      body: `Your DineVerse code: ${otp}\nValid 10 min. Do not share.`,
      from,
      to,
    });
    logger.info('OTP SMS sent to %s', to);
  } catch (err) {
    logger.error('Twilio error: %s', err.message);
    throw new Error('Failed to send SMS. Check your phone number and try again.');
  }
};
