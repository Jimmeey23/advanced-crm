// Mailtrap Email Sending via Nodemailer SMTP. Secrets stay server-side and
// environment variables take precedence over Settings > Integrations.
import crypto from 'node:crypto'
import nodemailer from 'nodemailer'

let transporter = null
let transporterKey = ''

function envBoolean(value) {
  if (value == null || String(value).trim() === '') return null
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

export function config(db) {
  const saved = db?.settings?.mailtrap || {}
  const envEnabled = envBoolean(process.env.USER_MAILTRAP_ENABLED)
  const rawPort = Number(process.env.USER_MAILTRAP_PORT || saved.port || 587)
  return {
    host: (process.env.USER_MAILTRAP_HOST || '').trim() || saved.host?.trim() || 'live.smtp.mailtrap.io',
    port: Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 587,
    user: (process.env.USER_MAILTRAP_USER || '').trim() || saved.user?.trim() || 'api',
    pass: (process.env.USER_MAILTRAP_PASS || '').trim() || saved.pass?.trim() || '',
    fromEmail: (process.env.USER_MAILTRAP_FROM_EMAIL || '').trim() || saved.fromEmail?.trim() || 'hello@physique57india.com',
    fromName: (process.env.USER_MAILTRAP_FROM_NAME || '').trim() || saved.fromName?.trim() || 'Physique 57 India',
    enabled: envEnabled ?? saved.enabled === true
  }
}

export function isConfigured(db) {
  const c = config(db)
  return Boolean(c.host && c.user && c.pass && c.fromEmail)
}

export function transportOptions(c) {
  const secure = Number(c.port) === 465
  return {
    host: c.host,
    port: Number(c.port),
    secure,
    requireTLS: !secure,
    auth: { user: c.user, pass: c.pass },
    tls: { minVersion: 'TLSv1.2' }
  }
}

function getTransporter(db) {
  const c = config(db)
  const nextKey = crypto.createHash('sha256').update(JSON.stringify(transportOptions(c))).digest('hex')
  if (!transporter || transporterKey !== nextKey) {
    transporter = nodemailer.createTransport(transportOptions(c))
    transporterKey = nextKey
  }
  return transporter
}

export async function verifyTransport(db) {
  const c = config(db)
  if (!isConfigured(db)) throw Object.assign(new Error('Mailtrap SMTP token is not configured'), { status: 400 })
  await getTransporter(db).verify()
  return { ok: true, host: c.host, port: c.port, user: c.user, fromEmail: c.fromEmail }
}

export async function sendMail(db, { to, subject, text = '', html }) {
  const c = config(db)
  if (!isConfigured(db)) return { skipped: true, reason: 'Mailtrap not configured' }
  if (!String(to || '').trim()) return { skipped: true, reason: 'No recipient' }
  if (c.enabled === false) return { skipped: true, reason: 'Email disabled in settings' }
  if (!String(subject || '').trim()) throw Object.assign(new Error('Email subject is required'), { status: 400 })

  const info = await getTransporter(db).sendMail({
    from: { name: c.fromName, address: c.fromEmail },
    to: String(to).trim(),
    subject: String(subject).trim(),
    text,
    html: html || String(text).replace(/\n/g, '<br/>')
  })
  return { ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected }
}

export async function testMail(db, toEmail) {
  return sendMail(db, {
    to: toEmail,
    subject: 'Physique 57 India — Mailtrap SMTP test',
    text: 'Mailtrap SMTP is connected to the Physique 57 India CRM backend. If you received this message, outbound email is working.'
  })
}
