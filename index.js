import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(
  cors({
    origin: '*', // en prod : ['https://vonoy.co', 'https://ton-site.vercel.app']
  })
);
app.use(express.json());

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ---- Templates simples (tu peux remettre tes versions HTML si tu veux) ----
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

// Petite route test
app.get('/', (_req, res) => {
  res.send('Vonoy SMTP email service is running ✅');
});

// Route principale
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

  // 1) Validation des champs
  const required = { email, firstName, lastName, companyName, country, fleetSize, industry };
  const missing = Object.entries(required)
    .filter(([, v]) => !v || String(v).trim() === '')
    .map(([k]) => k);

  if (missing.length) {
    console.warn('[send-email] Missing fields:', missing);
    return res.status(400).json({ ok: false, message: `Missing fields: ${missing.join(', ')}` });
  }

  // 2) Vérifier la config SMTP
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SUPPORT_INBOX } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SUPPORT_INBOX) {
    console.error('[send-email] Missing SMTP config env vars');
    return res.status(500).json({
      ok: false,
      message: 'SMTP configuration is missing on the server.',
    });
  }

  const port = Number(SMTP_PORT);
  const secure = port === 465; // en général 465 = SSL, 587 = STARTTLS

  console.log('[send-email] Creating transporter:', {
    host: SMTP_HOST,
    port,
    secure,
    user: SMTP_USER,
  });

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
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
    // 3) Email vers le support
    console.log('[send-email] Sending support email...');
    const infoSupport = await transporter.sendMail({
      from: `"Vonoy Support" <${SMTP_USER}>`, // adresse d’envoi = ton SMTP_USER
      to: SUPPORT_INBOX, // destination support
      replyTo: `"${data.firstName} ${data.lastName}" <${data.email}>`,
      subject: `New Demo Request — ${data.firstName} ${data.lastName} (${data.companyName})`,
      text: supportText(data),
      // html: supportHtml(data), // si tu veux ajouter ta version HTML
    });

    console.log('[send-email] Support email sent, id:', infoSupport.messageId);

    // 4) Email de confirmation à l’utilisateur
    console.log('[send-email] Sending user confirmation email...');
    const infoUser = await transporter.sendMail({
      from: `"Vonoy Team" <${SMTP_USER}>`,
      to: `"${data.firstName} ${data.lastName}" <${data.email}>`,
      replyTo: SUPPORT_INBOX,
      subject: `Thanks ${data.firstName}, we received your demo request`,
      text: userText(data),
      // html: userHtml(data),
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

app.listen(port, () => {
  console.log(`SMTP email service listening on port ${port}`);
});
