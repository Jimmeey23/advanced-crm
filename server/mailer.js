// Mailtrap email sending (nodemailer over SMTP).
// Credentials come from the MAILTRAP_* env vars or Settings > Integrations.
import nodemailer from 'nodemailer'

let transporter = null

export function config(db) {
  return {
    host: (process.env.USER_MAILTRAP_HOST || '').trim() || db?.settings?.mailtrap?.host?.trim() || '',
    port: Number(process.env.USER_MAILTRAP_PORT || db?.settings?.mailtrap?.port || 2525),
    user: (process.env.USER_MAILTRAP_USER || '').trim() || db?.settings?.mailtrap?.user?.trim() || '',
    pass: (process.env.USER_MAILTRAP_PASS || '').trim() || db?.settings?.mailtrap?.pass?.trim() || '',
    fromEmail: (process.env.USER_MAILTRAP_FROM_EMAIL || '').trim() || db?.settings?.mailtrap?.fromEmail?.trim() || 'studio@physique57.in',
    fromName: (process.env.USER_MAILTRAP_FROM_NAME || '').trim() || db?.settings?.mailtrap?.fromName?.trim() || 'Physique 57 Lead Studio',
    // Off by default — outbound email only fires once explicitly enabled in
    // Settings, never just because credentials happen to be configured.
    enabled: db?.settings?.mailtrap?.enabled === true
  }
}

export function isConfigured(db) {
  const c = config(db)
  return Boolean(c.host && c.user && c.pass)
}

function getTransporter(db) {
  const c = config(db)
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: Number(c.port) === 465,
      auth: { user: c.user, pass: c.pass }
    })
  }
  return transporter
}

export async function sendMail(db, { to, subject, text, html }) {
  const c = config(db)
  if (!isConfigured(db)) return { skipped: true, reason: 'Mailtrap not configured' }
  if (!to) return { skipped: true, reason: 'No recipient' }
  if (c.enabled === false) return { skipped: true, reason: 'Email disabled in settings' }

  const info = await getTransporter(db).sendMail({
    from: { name: c.fromName, address: c.fromEmail },
    to,
    subject,
    text,
    html: html || text.replace(/\n/g, '<br/>')
  })
  return { ok: true, messageId: info.messageId, accepted: info.accepted }
}

export async function testMail(db, toEmail) {
  const r = await sendMail(db, {
    to: toEmail,
    subject: 'Physique 57 — test email',
    text: 'This is a test email from your Physique 57 Lead Studio. If you can read this, Mailtrap is wired up correctly.'
  })
  return r
}
