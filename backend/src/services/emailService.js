const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for others
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

exports.sendOtpEmail = async (toEmail, otp) => {
  const from = process.env.SMTP_FROM || `"DineVerse" <${process.env.SMTP_USER}>`;

  await getTransporter().sendMail({
    from,
    to: toEmail,
    subject: 'Your DineVerse verification code',
    text: `Your verification code is: ${otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#f97316;margin-bottom:8px">Verify your email</h2>
        <p style="color:#374151;margin-bottom:24px">Use the code below to complete your DineVerse café registration.</p>
        <div style="background:#fff7ed;border:2px solid #fdba74;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
          <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#c2410c">${otp}</span>
        </div>
        <p style="color:#6b7280;font-size:13px">This code expires in <strong>10 minutes</strong>. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
};

exports.sendBroadcastEmail = async (toEmail, subject, htmlBody) => {
  const from = process.env.SMTP_FROM || `"DineVerse" <${process.env.SMTP_USER}>`;
  await getTransporter().sendMail({ from, to: toEmail, subject, html: htmlBody });
};

exports.sendPasswordResetEmail = async (toEmail, otp) => {
  const from = process.env.SMTP_FROM || `"DineVerse" <${process.env.SMTP_USER}>`;

  await getTransporter().sendMail({
    from,
    to: toEmail,
    subject: 'Reset your DineVerse password',
    text: `Your password reset code is: ${otp}\n\nThis code expires in 10 minutes. If you did not request a password reset, ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#f97316;margin-bottom:8px">Reset your password</h2>
        <p style="color:#374151;margin-bottom:24px">Use the code below to reset your DineVerse account password. This code is valid for <strong>10 minutes</strong>.</p>
        <div style="background:#fff7ed;border:2px solid #fdba74;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
          <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#c2410c">${otp}</span>
        </div>
        <p style="color:#6b7280;font-size:13px">If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
        <p style="color:#9ca3af;font-size:12px">DineVerse — Café Ordering Platform</p>
      </div>
    `,
  });
};
