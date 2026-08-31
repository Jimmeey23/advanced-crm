// Scheduled email reminders for upcoming / overdue follow-ups.
// Emails a daily digest to each associate (and the studio support inbox)
// summarising which of their leads need attention.
import { config as mailConfig, sendMail } from './mailer.js'
import { save } from './db.js'

export function fmtDate(iso) {
  if (!iso || iso === '-') return '—'
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function buildDigest(db) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayKey = today.toISOString().slice(0, 10)
  const horizon = new Date(today.getTime() + 3 * 86400000).toISOString().slice(0, 10)

  const rows = []
  for (const lead of db.leads) {
    if (lead.status !== 'open') continue
    // Only leads created directly in the app — CSV-imported (historical)
    // leads never generate reminder emails.
    if (lead.createdAtByImport) continue
    const pending = (lead.followUps || [])
      .filter(f => f.date && f.date !== '-' && !f.done)
      .sort((a, b) => a.date.localeCompare(b.date))
    const next = pending[0]
    if (!next) continue
    if (next.date > horizon) continue
    const overdue = next.date < todayKey
    const owner = db.associates.find(a => a.id === lead.associateId)
    rows.push({
      leadId: lead.id,
      leadName: lead.fullName,
      date: next.date,
      overdue,
      dueLabel: overdue ? `overdue ${fmtDate(next.date)}` : next.date === todayKey ? 'due today' : `due ${fmtDate(next.date)}`,
      comments: next.comments && next.comments !== '-' ? next.comments : '',
      owner: owner || null
    })
  }

  rows.sort((a, b) => a.date.localeCompare(b.date))
  return rows
}

function digestHtml(rows) {
  const trs = rows.map(r => {
    const badge = r.overdue
      ? '<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700">overdue</span>'
      : '<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700">upcoming</span>'
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${r.leadName}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;white-space:nowrap">${r.dueLabel} ${badge}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#64748b">${r.comments || '—'}</td>
    </tr>`
  }).join('')
  return `<div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:24px;border-radius:12px">
    <h2 style="margin:0 0 4px;color:#0f172a">Physique 57 — follow-up digest</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:13px">${rows.length} follow-up(s) need attention in the next 3 days.</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <thead><tr style="background:#f1f5f9;text-align:left">
        <th style="padding:8px 12px;font-size:12px">Lead</th>
        <th style="padding:8px 12px;font-size:12px">When</th>
        <th style="padding:8px 12px;font-size:12px">Last note</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table>
    <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Log in to the lead studio to act on these.</p>
  </div>`
}

export async function runReminderDigest(db) {
  // Off by default — both switches must be explicitly turned on in
  // Settings before any reminder email goes out.
  const rem = db.settings.reminders || {}
  if (rem.emailReminders !== true) return { skipped: true, reason: 'reminders disabled' }
  const cfg = db.settings.mailtrap || {}
  if (mailConfig(db).enabled !== true) return { skipped: true, reason: 'email disabled' }

  const todayKey = new Date().toISOString().slice(0, 10)
  if (cfg.lastDigestDate === todayKey) return { skipped: true, reason: 'already sent today' }

  const rows = buildDigest(db)
  if (!rows.length) { cfg.lastDigestDate = todayKey; save(); return { skipped: true, reason: 'nothing due' } }

  const byOwner = new Map()
  for (const r of rows) {
    if (!r.owner) continue
    if (!byOwner.has(r.owner.id)) byOwner.set(r.owner.id, { name: r.owner.name, email: r.owner.email, rows: [] })
    byOwner.get(r.owner.id).rows.push(r)
  }

  const sent = []
  const sendOne = async (to, ownerName, ownerRows) => {
    try {
      await sendMail(db, {
        to,
        subject: `Follow-up digest — ${ownerName} (${ownerRows.length} item${ownerRows.length === 1 ? '' : 's'})`,
        text: ownerRows.map(r => `${r.leadName} — ${r.dueLabel}${r.comments ? ': ' + r.comments : ''}`).join('\n'),
        html: digestHtml(ownerRows)
      })
      sent.push(to)
    } catch (e) {
      console.error('[reminders] send failed', to, e.message)
    }
  }

  // Each associate only receives their own assigned leads — no blanket
  // "everyone's follow-ups" copy to a shared support inbox.
  for (const [, v] of byOwner) {
    if (v.email) await sendOne(v.email, v.name, v.rows)
  }

  cfg.lastDigestDate = todayKey
  save()
  return { ok: true, sent, total: rows.length }
}

export function startReminderScheduler(db) {
  const run = () => {
    runReminderDigest(db).catch(e => console.error('[reminders] scheduler error', e.message))
  }
  setTimeout(run, 45 * 1000)
  setInterval(run, 3600 * 1000)
  console.log('[reminders] scheduler started (hourly check, daily digest)')
}
