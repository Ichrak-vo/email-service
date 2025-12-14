import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import dns from 'dns';

dotenv.config();

// ✅ Important: force IPv4 first (souvent nécessaire en cloud)
dns.setDefaultResultOrder('ipv4first');

const app = express();
const appPort = process.env.PORT || 4000;

app.use(
  cors({
    origin: '*', // en prod: mets ton domaine front uniquement
  })
);
app.use(express.json());

// ---- Templates ----
function supportText(d) {
  return `Dear support,

The user ${d.firstName} ${d.lastName} has requested a new demo.
You can contact them via email: ${d.email}${d.phone ? ` or phone: ${d.phone}` : ''}.

More information:
- Company: ${d.companyName}
- Country: ${d.country}
- Industry: ${d.industry}
- Fleet Size: ${d.fleetSize}

Message:
${d.message || '(no message)'}`;
}

function userText(d) {
  return `Hi ${d.firstName},

Vonoy has received your demo request, thank you!
Our team will contact you shortly at ${d.email}${d.phone ? ` or ${d.phone}` : ''}.

Summary:
- Company: ${d.companyName}
- Country: ${d.country}
- Industry: ${d.industry}
- Fleet Size: ${d.fleetSize}

If anything is incorrect, just reply to this email.

— Vonoy Team`;
}

app.get('/', (_req, res) => {
  res.send('Vonoy SMTP email service is running');
});

app.post('/send-email', async (req, res) => {
  const {
    email,
    firstName,
    lastName,
    companyName,
    country,
    fleetSize,
    phone = '',
    industry,
    message = '',
  } = req.body || {};

  // 1) Validation
  const required = { email, firstName, lastName, companyName, country, fleetSize, industry };
  const missing = Object.entries(required)
    .filter(([, v]) => !v || String(v).trim() === '')
    .map(([k]) => k);

  if (missing.length) {
    return res.status(400).json({ ok: false, message: `Missing fields: ${missing.join(', ')}` });
  }

  // 2) Env SMTP
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SUPPORT_INBOX } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SUPPORT_INBOX) {
    return res.status(500).json({ ok: false, message: 'SMTP configuration is missing on the server.' });
  }

  const smtpPort = Number(SMTP_PORT);
  const is465 = smtpPort === 465;

  console.log('[send-email] Creating transporter:', {
    host: SMTP_HOST,
    port: smtpPort,
    secure: is465,
    user: SMTP_USER,
  });

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: smtpPort,
    secure: is465, // 465 = SSL, 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // STARTTLS recommandé pour 587
    requireTLS: smtpPort === 587,
    tls: {
      minVersion: 'TLSv1.2',
      servername: SMTP_HOST,
    },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 20_000,
  });

  const data = {
    email,
    firstName,
    lastName,
    companyName,
    country,
    fleetSize,
    phone,
    industry,
    message,
  };

  try {
    // ✅ Diagnostic avant envoi
    console.log('[send-email] Verifying SMTP connection...');
    await transporter.verify();
    console.log('[send-email] SMTP verify OK');

    console.log('[send-email] Sending support email...');
    const infoSupport = await transporter.sendMail({
      from: `"Vonoy Support" <${SMTP_USER}>`,
      to: SUPPORT_INBOX,
      replyTo: `"${data.firstName} ${data.lastName}" <${data.email}>`,
      subject: `New Demo Request — ${data.firstName} ${data.lastName} (${data.companyName})`,
      text: supportText(data),
    });

    console.log('[send-email] Support email sent, id:', infoSupport.messageId);

    console.log('[send-email] Sending user confirmation email...');
    const infoUser = await transporter.sendMail({
      from: `"Vonoy Team" <${SMTP_USER}>`,
      to: `"${data.firstName} ${data.lastName}" <${data.email}>`,
      replyTo: SUPPORT_INBOX,
      subject: `Thanks ${data.firstName}, we received your demo request`,
      text: userText(data),
    });

    console.log('[send-email] User email sent, id:', infoUser.messageId);

    return res.json({
      ok: true,
      support: { id: infoSupport.messageId },
      user: { id: infoUser.messageId },
    });
  } catch (e) {
    console.error('[send-email] error:', e);
    return res.status(500).json({
      ok: false,
      message: e?.message || 'Email send failed',
      code: e?.code || null,
    });
  }
});

app.listen(appPort, () => {
  console.log(`SMTP email service listening on port ${appPort}`);
});
