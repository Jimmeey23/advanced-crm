import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BadgePercent, BrainCircuit, CalendarClock, CheckCircle2, Cloud, CreditCard, Database, FileSpreadsheet, Mail, MessageCircle, Package, RefreshCw, Send, UserRoundCheck, Webhook, X } from 'lucide-react'
import { api } from '../api.js'
import { Spinner } from '../ui.jsx'
import MomenceSchedule from '../pages/MomenceSchedule.jsx'
import Memberships from '../pages/Memberships.jsx'
import DiscountCodes from '../pages/DiscountCodes.jsx'
import Inbox from '../pages/Inbox.jsx'

function StatusPanel({ icon: Icon, title, description, children }) {
  return <div className="leads-integration-status"><span><Icon size={20} /></span><div><h3>{title}</h3><p>{description}</p>{children}</div></div>
}

function MomenceHub({ setTool }) {
  const tools = [
    { id: 'schedule', label: 'Class schedule', detail: 'Sessions, rosters and bookings', icon: CalendarClock },
    { id: 'memberships', label: 'Memberships', detail: 'Subscriptions, packages and purchase links', icon: Package },
    { id: 'discounts', label: 'Discount codes', detail: 'Active codes and approval requests', icon: BadgePercent }
  ]
  return <div className="leads-integration-hub">{tools.map(tool => { const Icon = tool.icon; return <button key={tool.id} onClick={() => setTool(tool.id)}><span><Icon size={17} /></span><div><b>{tool.label}</b><small>{tool.detail}</small></div></button> })}</div>
}

export default function LeadsIntegrationRail({ boot, leads, refreshData, toast }) {
  const [tool, setTool] = useState('')
  const [busy, setBusy] = useState('')
  const integrations = boot?.integrations || {}
  const active = useMemo(() => [
    integrations.momence && { id: 'momence', label: 'Momence', icon: CalendarClock },
    integrations.respondio && { id: 'respondio', label: 'Respond.io', icon: MessageCircle },
    integrations.stripe && { id: 'stripe', label: 'Stripe', icon: CreditCard },
    integrations.gpt && { id: 'gpt', label: 'AI intelligence', icon: BrainCircuit },
    integrations.mailtrap && { id: 'mailtrap', label: 'Mailtrap', icon: Mail },
    integrations.googleSheets && { id: 'sheets', label: 'Google Sheets', icon: FileSpreadsheet },
    integrations.zohoPeople && { id: 'zoho', label: 'Zoho People', icon: UserRoundCheck },
    boot?.webhookIntegrations?.length > 0 && { id: 'webhooks', label: 'Lead webhooks', icon: Webhook },
    integrations.supabase && { id: 'supabase', label: 'Supabase', icon: Database }
  ].filter(Boolean), [integrations, boot?.webhookIntegrations?.length])

  useEffect(() => {
    if (!tool) return
    const close = event => { if (event.key === 'Escape') setTool('') }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [tool])

  const run = async (id, action, success) => {
    setBusy(id)
    try { await action(); toast(success) } catch (error) { toast(error.message, 'error') }
    finally { setBusy('') }
  }

  if (!active.length) return null
  const panelTitle = { momence: 'Momence', schedule: 'Momence class schedule', memberships: 'Memberships & packages', discounts: 'Discount codes', respondio: 'Respond.io inbox', stripe: 'Stripe payments', gpt: 'AI lead intelligence', mailtrap: 'Mailtrap email', sheets: 'Google Sheets', zoho: 'Zoho People', webhooks: 'Lead webhooks', supabase: 'Supabase sync' }[tool]

  return <>
    <aside className="leads-integration-rail" aria-label="Active integrations">
      <span className="leads-integration-rail-label">Apps</span>
      {active.map(item => { const Icon = item.icon; const selected = tool === item.id || (item.id === 'momence' && ['schedule', 'memberships', 'discounts'].includes(tool)); return <button key={item.id} className={selected ? 'is-active' : ''} onClick={() => setTool(current => current === item.id ? '' : item.id)} aria-label={item.label} title={item.label} aria-pressed={selected}><Icon size={17} /><span className="integration-live-dot" /></button> })}
    </aside>

    {tool && createPortal(<div className="leads-integration-overlay" data-overlay-root="true">
      <button className="leads-integration-scrim" onClick={() => setTool('')} aria-label="Close integration panel" />
      <section className={`leads-integration-panel ${['schedule', 'memberships', 'discounts', 'respondio'].includes(tool) ? 'is-workspace' : ''}`} data-overlay-panel="true" role="dialog" aria-modal="true" aria-label={panelTitle}>
        <header><div><span>Active integration</span><h2>{panelTitle}</h2></div><button onClick={() => setTool('')} aria-label="Close"><X size={18} /></button></header>
        <div className="leads-integration-panel-body">
          {tool === 'momence' && <MomenceHub setTool={setTool} />}
          {tool === 'schedule' && <MomenceSchedule />}
          {tool === 'memberships' && <Memberships />}
          {tool === 'discounts' && <DiscountCodes />}
          {tool === 'respondio' && <Inbox />}
          {tool === 'stripe' && <StatusPanel icon={CreditCard} title="Stripe is connected" description="Payment links remain lead-specific. Open any lead’s Actions menu and choose Pay to create or inspect a checkout link without leaving this workspace."><div className="integration-status-chip"><CheckCircle2 size={13} /> Ready for payments</div></StatusPanel>}
          {tool === 'gpt' && <StatusPanel icon={BrainCircuit} title={`${leads.length} visible leads analyzed`} description={`AI scoring, summaries and risk signals are active through ${integrations.gptModel || 'the configured model'}. Use AI alerts in the Leads toolbar or open a lead for its detailed intelligence.`}><div className="integration-mini-stats"><span><b>{leads.filter(lead => Number(lead.score) >= 80).length}</b>High-score</span><span><b>{leads.filter(lead => lead.risk === 'hot' || lead.ai?.risk === 'hot').length}</b>High-risk</span></div></StatusPanel>}
          {tool === 'mailtrap' && <StatusPanel icon={Mail} title="Mailtrap is configured" description="Approval decisions and enabled reminder digests are sent by the backend. Admins can trigger the current follow-up digest here.">{boot?.authUser?.role === 'admin' && <button className="btn btn-primary" disabled={busy === 'digest'} onClick={() => run('digest', () => api.post('/api/mailtrap/reminders', {}), 'Reminder digest processed')}>{busy === 'digest' ? <Spinner size={13} /> : <Send size={13} />} Send digest now</button>}</StatusPanel>}
          {tool === 'sheets' && <StatusPanel icon={FileSpreadsheet} title="Google Sheets is connected" description="Lead-sheet synchronization is active. Admins can trigger a safe incremental sync while remaining in the Leads workspace.">{boot?.authUser?.role === 'admin' && <button className="btn btn-primary" disabled={busy === 'sheets'} onClick={() => run('sheets', () => api.post('/api/google-sheets/sync-now', {}), 'Google Sheets sync completed')}>{busy === 'sheets' ? <Spinner size={13} /> : <RefreshCw size={13} />} Sync now</button>}</StatusPanel>}
          {tool === 'zoho' && <StatusPanel icon={UserRoundCheck} title="Zoho People is active" description="Shift-aware assignment is using Zoho People attendance data. Admins can refresh the current on-duty roster here.">{boot?.authUser?.role === 'admin' && <button className="btn btn-primary" disabled={busy === 'zoho'} onClick={() => run('zoho', () => api.post('/api/zoho-people/refresh-now', {}), 'Zoho People shifts refreshed')}>{busy === 'zoho' ? <Spinner size={13} /> : <RefreshCw size={13} />} Refresh shifts</button>}</StatusPanel>}
          {tool === 'webhooks' && <StatusPanel icon={Webhook} title={`${boot.webhookIntegrations.length} lead webhook${boot.webhookIntegrations.length === 1 ? '' : 's'} active`} description="Inbound lead integrations are accepting records through their keyed URLs. Manage mappings and rotate keys from Settings when needed."><div className="integration-mini-list">{boot.webhookIntegrations.slice(0, 8).map(webhook => <span key={webhook.id}><i />{webhook.name}</span>)}</div></StatusPanel>}
          {tool === 'supabase' && <StatusPanel icon={Cloud} title="Cloud sync is active" description="Lead data is backed by Supabase. Refresh this workspace to pull the latest server-backed state."><button className="btn btn-primary" disabled={busy === 'refresh'} onClick={() => run('refresh', refreshData, 'Lead workspace refreshed')}>{busy === 'refresh' ? <Spinner size={13} /> : <RefreshCw size={13} />} Refresh leads</button></StatusPanel>}
        </div>
      </section>
    </div>, document.body)}
  </>
}
