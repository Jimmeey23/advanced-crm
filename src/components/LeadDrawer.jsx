import React, { useEffect, useMemo, useState } from 'react'
import {
  X, Phone, Mail, MapPin, Sparkles, CalendarPlus, RefreshCw, Link2,
  CheckCircle2, Send, Clock, Lightbulb, TrendingUp, Tags, Receipt,
  Award, MessageSquare, Bot, MessageCircle, Loader2, Inbox,
  BarChart3, IndianRupee, UserPlus, Lock, UserCog, Check, XCircle, Pin, PinOff,
  LayoutGrid, Activity
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { Avatar, ScorePill, Spinner } from '../ui.jsx'
import { fmtDate, fmtDateTime, timeAgo, stageClass, stageBadgeStyle, riskClass, money } from '../lib.js'
import ComposeModal from './ComposeModal.jsx'
import Tip from './Tip.jsx'
import RespondioTemplateModal from './RespondioTemplateModal.jsx'

const R_CHANNELS = { whatsapp: '#34d399', sms: '#fbbf24', email: '#a78bfa', call: '#38bdf8' }
const MIN_DRAWER_WIDTH = 560
const followUpText = value => {
  const text = String(value ?? '').trim()
  return text === '-' || text === '—' ? '' : text
}

// Momence custom fields have no fixed key name across studios — match
// loosely by substring so "Fitness Goals", "fitnessGoal", etc. all resolve.
function momenceCustomField(momence, needle) {
  const fields = momence?.member?.customFields || momence?.customFields || {}
  const hit = Object.keys(fields).find(k => k.toLowerCase().includes(needle))
  if (!hit) return null
  const value = fields[hit]
  if (value === null || value === undefined || value === '') return null
  return Array.isArray(value) ? value.join(', ') : (typeof value === 'object' ? JSON.stringify(value) : String(value))
}

export default function LeadDrawer() {
  const { boot, lookup, drawerLeadId, closeLead, refreshData, toast, dataVersion, role } = useApp()
  const [ownerRequestOpen, setOwnerRequestOpen] = useState(false)
  const [ownerRequestPick, setOwnerRequestPick] = useState('')
  const [ownerRequestSending, setOwnerRequestSending] = useState(false)
  const [ownerDeciding, setOwnerDeciding] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [candidates, setCandidates] = useState(null)
  const [manualLink, setManualLink] = useState(false)
  const [manualMemberId, setManualMemberId] = useState('')
  const [remarkDraft, setRemarkDraft] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [replyDrafts, setReplyDrafts] = useState({})
  const [replySending, setReplySending] = useState({})
  const [replyError, setReplyError] = useState({})
  const [enriching, setEnriching] = useState(false)
  const [autoSyncLeadId, setAutoSyncLeadId] = useState('')
  const [momenceProfileOpen, setMomenceProfileOpen] = useState(false)
  const [createMemberOpen, setCreateMemberOpen] = useState(false)
  const [creatingMember, setCreatingMember] = useState(false)
  const [memberDraft, setMemberDraft] = useState({ firstName: '', lastName: '', email: '', phoneNumber: '' })
  const [tab, setTab] = useState('overview')
  const [drawerWidth, setDrawerWidth] = useState(() => Number(localStorage.getItem('p57_lead_drawer_width')) || MIN_DRAWER_WIDTH)
  // Pinned keeps the drawer open when the backdrop is clicked — a persistent
  // side panel instead of a one-off overlay. Only the close button dismisses it then.
  const [pinned, setPinned] = useState(() => localStorage.getItem('p57_lead_drawer_pinned') === '1')
  const drawerRef = React.useRef(null)
  const childModalOpenRef = React.useRef(false)
  childModalOpenRef.current = composeOpen || templateOpen || createMemberOpen
  const togglePinned = () => setPinned(v => {
    const next = !v
    try { localStorage.setItem('p57_lead_drawer_pinned', next ? '1' : '0') } catch (e) { /* ignore */ }
    return next
  })
  const setPresetWidth = (w) => {
    const next = Math.min(w, window.innerWidth - 24)
    setDrawerWidth(next)
    try { localStorage.setItem('p57_lead_drawer_width', String(next)) } catch (e) { /* ignore */ }
  }
  const commentsRef = React.useRef(null)

  useEffect(() => {
    if (!drawerLeadId) return undefined
    const previousFocus = document.activeElement
    const onKeyDown = event => {
      if (event.key === 'Escape' && !childModalOpenRef.current) closeLead()
    }
    document.addEventListener('keydown', onKeyDown)
    const focusTimer = window.setTimeout(() => drawerRef.current?.focus(), 40)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(focusTimer)
      previousFocus?.focus?.()
    }
  }, [drawerLeadId, closeLead])

  const fillSuggestion = (s) => {
    if (commentsRef.current) commentsRef.current.value = s.text
    commentsRef.current?.focus()
  }

  const { data, reload } = useFetch(
    () => drawerLeadId ? api.get(`/api/leads/${drawerLeadId}`) : Promise.resolve(null),
    [drawerLeadId, dataVersion]
  )
  const lead = data

  const { data: conv, reload: reloadConv } = useFetch(
    () => drawerLeadId ? api.get(`/api/respondio/conversations/${drawerLeadId}`) : Promise.resolve(null),
    [drawerLeadId, dataVersion]
  )

  useEffect(() => { if (lead) setRemarkDraft(lead.remarks || '') }, [lead?.id])
  useEffect(() => {
    setSyncError(''); setCandidates(null); setManualLink(false); setManualMemberId(''); setAutoSyncLeadId(''); setCreateMemberOpen(false); setTab('overview')
  }, [drawerLeadId])
  useEffect(() => {
    if (!lead) return
    const nameParts = String(lead.fullName || '').trim().split(/\s+/).filter(Boolean)
    setMemberDraft({
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' '),
      email: lead.email || '',
      phoneNumber: lead.phone || ''
    })
  }, [lead?.id])

  const doEnrich = async () => {
    setEnriching(true)
    try {
      await api.post(`/api/leads/${lead.id}/enrich`)
      toast('GPT intelligence updated')
      refreshData(); reload()
    } catch (e) { toast(e.message, 'error') }
    finally { setEnriching(false) }
  }

  // Quick same-channel reply straight from the conversation thread — the
  // point of showing history in-app is being able to act on it without a
  // trip to Respond.io. WhatsApp's first-contact-must-be-a-template rule
  // still applies server-side; this just surfaces that error inline rather
  // than requiring the separate template picker for every reply.
  const sendInlineReply = async (c) => {
    const text = (replyDrafts[c.id] || '').trim()
    if (!text) return
    setReplySending(s => ({ ...s, [c.id]: true }))
    setReplyError(e => ({ ...e, [c.id]: '' }))
    try {
      await api.post('/api/respondio/send', { leadId: lead.id, channel: c.channel, message: text, logFollowUp: true })
      setReplyDrafts(d => ({ ...d, [c.id]: '' }))
      reloadConv()
      refreshData()
    } catch (err) {
      setReplyError(e => ({ ...e, [c.id]: err.message }))
    } finally {
      setReplySending(s => ({ ...s, [c.id]: false }))
    }
  }

  const loc = lead ? lookup.locById[lead.locationId] : null
  const owner = lead ? lookup.asnById[lead.associateId] : null
  const ownerOptions = useMemo(() =>
    (boot?.associates || []).filter(a => (!lead || (a.locationIds || [a.locationId]).includes(lead.locationId)) && a.active !== false),
    [boot, lead]
  )

  useEffect(() => {
    if (!lead || !boot?.integrations?.momence || lead.momence || syncing || candidates || autoSyncLeadId === lead.id) return
    if (!lead.email && !lead.phone && !lead.memberId) return
    setAutoSyncLeadId(lead.id)
    // Let the drawer paint first — this sync is a background enrichment,
    // not something the initial open should ever wait on.
    const t = setTimeout(() => doSync({ silent: true }), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id, lead?.momence, boot?.integrations?.momence])

  if (!drawerLeadId) return null

  const clampDrawerWidth = value => Math.max(MIN_DRAWER_WIDTH, Math.min(Math.round(value), window.innerWidth - 24))

  const commitDrawerWidth = value => {
    const next = clampDrawerWidth(value)
    setDrawerWidth(next)
    try { localStorage.setItem('p57_lead_drawer_width', String(next)) } catch (err) { /* ignore */ }
  }

  const startDrawerResize = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = drawerWidth
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const onMove = (ev) => {
      commitDrawerWidth(startWidth + startX - ev.clientX)
    }
    const onUp = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const resizeDrawerWithKeyboard = e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    if (e.key === 'Home') return commitDrawerWidth(MIN_DRAWER_WIDTH)
    if (e.key === 'End') return commitDrawerWidth(window.innerWidth - 24)
    const step = e.shiftKey ? 80 : 24
    commitDrawerWidth(drawerWidth + (e.key === 'ArrowLeft' ? step : -step))
  }

  if (!lead) {
    return (
      <div className="fixed inset-0 z-[80] flex justify-end ld-overlay">
        <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] ld-backdrop" onClick={closeLead} />
        <aside className="lead-drawer ld-shell relative w-full max-w-[680px] h-full flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Spinner size={26} />
            <span className="text-[12px] text-slate-500">Loading lead…</span>
          </div>
        </aside>
      </div>
    )
  }

  const patch = async (body, msg) => {
    try {
      await api.patch(`/api/leads/${lead.id}`, body)
      if (msg) toast(msg)
      refreshData()
      reload()
    } catch (e) { toast(e.message, 'error') }
  }

  // Agents can edit name/phone/email/status/source, but changing a lead's
  // core intake data is easy to do by accident — confirm before it lands,
  // same as any other destructive-ish edit would get in this app.
  const patchWithAgentConfirm = (fieldLabel, body, msg) => {
    if (role === 'agent' && !window.confirm(`Change ${fieldLabel} for ${lead.fullName}? This updates the lead's record.`)) return
    patch(body, msg)
  }

  const sendOwnerRequest = async () => {
    if (!ownerRequestPick) return
    setOwnerRequestSending(true)
    try {
      await api.post(`/api/leads/${lead.id}/owner-change-request`, { associateId: ownerRequestPick })
      toast('Owner change request sent to admin')
      setOwnerRequestOpen(false); setOwnerRequestPick('')
      reload()
    } catch (e) { toast(e.message, 'error') }
    finally { setOwnerRequestSending(false) }
  }

  const decideOwnerRequest = async (action) => {
    if (!lead.pendingOwnerChangeRequest) return
    setOwnerDeciding(true)
    try {
      await api.post(`/api/owner-change-requests/${lead.pendingOwnerChangeRequest.id}/decide`, { action })
      toast(action === 'approve' ? 'Owner change approved' : 'Owner change denied')
      refreshData(); reload()
    } catch (e) { toast(e.message, 'error') }
    finally { setOwnerDeciding(false) }
  }

  const addFollowUp = async (e) => {
    e.preventDefault()
    const date = e.target.date.value
    const comments = e.target.comments.value.trim()
    if (!comments) return
    try {
      await api.post(`/api/leads/${lead.id}/followups`, { date, comments })
      toast('Follow-up logged')
      refreshData(); reload()
      e.target.comments.value = ''
    } catch (err) { toast(err.message, 'error') }
  }

  // Auto-lookup by the lead's email/phone — no manual member ID required.
  // The server searches Momence's member directory itself; this only
  // surfaces a pick-list when more than one member matches.
  const doSync = async ({ silent = false } = {}) => {
    setSyncing(true); setSyncError(''); setCandidates(null)
    try {
      await api.post(`/api/momence/sync/${lead.id}`)
      if (!silent) toast('Momence profile synced')
      // A silent background sync only needs to refresh this one lead —
      // bumping the app-wide dataVersion (refreshData) would refetch every
      // other open view for a sync the user didn't even ask for.
      if (!silent) refreshData()
      reload()
    } catch (e) {
      if (e.status === 300 && e.data?.candidates) {
        setCandidates(e.data.candidates)
      } else {
        if (!silent) {
          setSyncError(humanMomenceError(e.message))
          toast(humanMomenceError(e.message), 'error')
        }
      }
    }
    finally { setSyncing(false) }
  }

  const doLink = async (memberId) => {
    setSyncing(true); setSyncError('')
    try {
      await api.post(`/api/momence/link/${lead.id}`, { memberId })
      toast('Momence profile linked and synced')
      setCandidates(null); setManualLink(false); setManualMemberId('')
      refreshData(); reload()
    } catch (e) { const msg = humanMomenceError(e.message); setSyncError(msg); toast(msg, 'error') }
    finally { setSyncing(false) }
  }

  const createMomenceMember = async (e) => {
    e.preventDefault()
    setCreatingMember(true); setSyncError('')
    try {
      const result = await api.post(`/api/momence/create/${lead.id}`, memberDraft)
      toast(result.warning || `Momence member #${result.memberId} created and linked`)
      setCreateMemberOpen(false)
      refreshData(); reload()
    } catch (e) {
      const msg = humanMomenceError(e.message)
      setSyncError(msg); toast(msg, 'error')
    } finally { setCreatingMember(false) }
  }

  const m = lead.momence
  const deepDiveSentiment = lead.gpt?.sentiment && lead.gpt.sentiment !== 'unknown' ? lead.gpt.sentiment : lead.ai.sentiment
  const classesAttended = m?.classHistory?.filter(c => c.checkedIn).length || 0
  const classesCancelled = m?.classHistory?.filter(c => !c.checkedIn && /cancel/i.test(c.status || '')).length || 0
  const classesOther = Math.max(0, (m?.classHistory?.length || 0) - classesAttended - classesCancelled)
  const attendanceRate = classesAttended + classesCancelled > 0 ? Math.round((classesAttended / (classesAttended + classesCancelled)) * 100) : 0
  const lifetimeSales = (m?.salesHistory || []).reduce((sum, sale) => sum + (Number(sale.totalInCurrency ?? sale.total ?? sale.amount) || 0), 0)

  // A follow-up slot with neither a real date nor a comment is a blank
  // placeholder row (common in imported data with a fixed number of
  // follow-up columns, most left empty) — nothing happened on it, so it
  // shouldn't render as a timeline entry at all, let alone as "done".
  const realFollowUps = (lead.followUps || []).filter(f => followUpText(f.date) || followUpText(f.comments))

  const cadence = boot?.settings?.cadence || {}
  const outreachDays = cadence.outreachDays || 7
  const nextFu = lead.followUps?.find(f => f.date && f.done === false && f.date !== '-')
  const todayStr = new Date().toISOString().slice(0, 10)
  const dueIn = nextFu ? Math.round((new Date(nextFu.date) - new Date(todayStr)) / 86400000) : null
  const overdueFu = dueIn !== null && dueIn < 0
  const idleDays = lead.status === 'open' ? (lead.fu?.lastOutreachDays || 0) : 0
  const idleBeyond = lead.status === 'open' && idleDays > outreachDays
  const missedCount = lead.fu?.missedCount || 0
  const hasCadenceIssue = overdueFu || idleBeyond || missedCount > 0

  const convCount = conv?.conversations?.length || 0
  const drawerTabs = [
    { key: 'overview', label: 'Overview', icon: LayoutGrid },
    { key: 'conversations', label: 'Chats', icon: MessageCircle, count: convCount },
    { key: 'momence', label: 'Momence', icon: Link2, synced: !!m },
    { key: 'activity', label: 'Activity', icon: Activity, count: realFollowUps.length }
  ]

  return (
    <>
      <div className="fixed inset-0 z-[80] flex justify-end ld-overlay">
        <button type="button" className={`absolute inset-0 backdrop-blur-[2px] ld-backdrop ${pinned ? 'bg-black/20' : 'bg-black/55'}`} onClick={() => !pinned && closeLead()} aria-label={pinned ? 'Lead details are pinned' : 'Close lead details'} tabIndex={pinned ? -1 : 0} />
        <aside ref={drawerRef} className="lead-drawer ld-shell relative w-full h-full flex flex-col" style={{ maxWidth: 'calc(100vw - 16px)', width: drawerWidth }} role="dialog" aria-modal="true" aria-labelledby="lead-drawer-title" tabIndex={-1}>
          <button
            type="button"
            className="lead-drawer-resizer"
            onPointerDown={startDrawerResize}
            onKeyDown={resizeDrawerWithKeyboard}
            title="Drag to resize. Use arrow keys for precise adjustment."
            aria-label="Resize lead details drawer"
            aria-valuemin={MIN_DRAWER_WIDTH}
            aria-valuemax={Math.max(MIN_DRAWER_WIDTH, window.innerWidth - 24)}
            aria-valuenow={drawerWidth}
            role="slider"
          ><span aria-hidden="true" /></button>

          {/* ── Profile hero ─────────────────────────────────────────── */}
          <header className="ld-hero">
            <div className="ld-hero-top">
              <div className="ld-hero-avatar">
                <Avatar name={lead.fullName} color={owner?.color} size={36} />
                <span className={`ld-hero-presence ${lead.status === 'won' ? 'is-won' : lead.status === 'lost' ? 'is-lost' : 'is-open'}`} />
              </div>
              <div className="ld-hero-idblock">
                <EditableHeaderField
                  as="h2" id="lead-drawer-title" className="ld-hero-name"
                  value={lead.fullName} placeholder="Full name"
                  onSave={v => patchWithAgentConfirm('name', { fullName: v }, 'Name updated')}
                />
                <div className="ld-hero-sub">
                  <span>#{String(lead.id).slice(-6)}</span>
                  <i />
                  <span className="ld-hero-sub-item"><MapPin size={11} /> {loc?.name || lead.center || '—'}</span>
                  <i />
                  <span className={lead.memberId ? 'text-emerald-400/90' : ''}>{lead.memberId ? `Momence #${lead.memberId}` : 'No member link'}</span>
                </div>
              </div>
              <div className="ld-hero-actions">
                <Tip content={<span className="text-[11px]">Send message</span>}>
                  <button className="btn btn-primary !p-2" onClick={() => setComposeOpen(true)} aria-label="Send message"><MessageCircle size={15} /></button>
                </Tip>
                <Tip content={<span className="text-[11px]">WhatsApp template</span>}>
                  <button className="btn btn-soft !p-2" onClick={() => setTemplateOpen(true)} aria-label="WhatsApp template"><Sparkles size={15} /></button>
                </Tip>
                <Tip content={<span className="text-[11px]">Compact / Default / Wide / Full width</span>}>
                  <div className="ld-width-presets">
                    {[['S', 560], ['M', 720], ['L', 960], ['XL', window.innerWidth - 24]].map(([label, w]) => (
                      <button key={label} type="button" className={`ld-width-preset-btn ${Math.abs(drawerWidth - w) < 8 ? 'is-active' : ''}`} onClick={() => setPresetWidth(w)}>{label}</button>
                    ))}
                  </div>
                </Tip>
                <button className={`btn btn-ghost !p-2 ${pinned ? 'text-rose-400' : ''}`} onClick={togglePinned} aria-label={pinned ? 'Unpin drawer' : 'Pin drawer open'} title={pinned ? 'Pinned — click outside won\'t close it' : 'Pin drawer open'}>
                  {pinned ? <Pin size={16} className="fill-current" /> : <PinOff size={16} />}
                </button>
                <button className="btn btn-ghost !p-2 modal-close" onClick={closeLead} aria-label="Close lead details"><X size={18} /></button>
              </div>
            </div>

            <div className="ld-field-grid">
              <div className="ld-field">
                <span className="ld-field-label">Stage</span>
                <select className={`input ld-chip-select ${stageClass(lead.stage)}`} style={stageBadgeStyle(lead.stage)} value={lead.stage} onChange={e => patch({ stage: e.target.value }, `Moved to ${e.target.value}`)}>
                  {(boot?.stages || []).map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="ld-field">
                <span className="ld-field-label">Status</span>
                <select className="input ld-chip-select capitalize" value={lead.status || 'open'} onChange={e => patchWithAgentConfirm('status', { status: e.target.value }, `Status set to ${e.target.value}`)}>
                  <option value="open">Open</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
              </div>
              <div className="ld-field">
                <span className="ld-field-label">Risk</span>
                <span className={`chip ld-risk-chip ${riskClass(lead.ai.risk)}`}>{lead.ai.risk} risk</span>
              </div>
              <div className="ld-field">
                <span className="ld-field-label">Phone</span>
                <span className="ld-field-value"><Phone size={11} /><EditableHeaderField value={lead.phone} placeholder="No phone" onSave={v => patchWithAgentConfirm('phone', { phone: v }, 'Phone updated')} /></span>
              </div>
              <div className="ld-field">
                <span className="ld-field-label">Email</span>
                <span className="ld-field-value"><Mail size={11} /><EditableHeaderField value={lead.email} placeholder="No email" onSave={v => patchWithAgentConfirm('email', { email: v }, 'Email updated')} /></span>
              </div>
              <div className="ld-field">
                <span className="ld-field-label">Owner</span>
                {role === 'admin' ? (
                  <select className="input ld-chip-select" value={lead.associateId || ''} onChange={e => patch({ associateId: e.target.value }, e.target.value ? 'Owner updated' : 'Owner cleared')}>
                    <option value="">Unassigned</option>
                    {ownerOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                ) : (
                  <div className="ld-owner-locked">
                    <Lock size={11} /> {owner?.name || 'Unassigned'}
                    {lead.pendingOwnerChangeRequest ? (
                      <span className="chip !px-2 !py-0.5 text-[10px] bg-amber-500/10 border border-amber-400/25 text-amber-300 ml-auto whitespace-nowrap">Pending</span>
                    ) : (
                      <button type="button" className="btn btn-ghost !p-1 ml-auto" title="Request owner change" onClick={() => setOwnerRequestOpen(o => !o)}><UserCog size={12} /></button>
                    )}
                  </div>
                )}
              </div>
              <div className="ld-field">
                <span className="ld-field-label">Intent</span>
                <span className="ld-field-static">{lead.ai.score}<small>/100</small></span>
              </div>
              <div className="ld-field">
                <span className="ld-field-label">Next touchpoint</span>
                <span className="ld-field-static">{nextFu ? fmtDate(nextFu.date) : 'Not set'}</span>
              </div>
              <div className="ld-field">
                <span className="ld-field-label">Touchpoints</span>
                <span className="ld-field-static">{realFollowUps.length}</span>
              </div>
              <div className="ld-field">
                <span className="ld-field-label">Member value</span>
                <span className="ld-field-static">{m ? money(lifetimeSales) : 'Not linked'}</span>
              </div>
            </div>

            {role !== 'admin' && ownerRequestOpen && !lead.pendingOwnerChangeRequest && (
              <div className="ld-hero-owner-request">
                <select className="input ld-chip-select" value={ownerRequestPick} onChange={e => setOwnerRequestPick(e.target.value)}>
                  <option value="">Pick new owner…</option>
                  {ownerOptions.filter(a => a.id !== lead.associateId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button type="button" className="btn btn-primary !py-1.5 !text-[11.5px]" disabled={!ownerRequestPick || ownerRequestSending} onClick={sendOwnerRequest}>Send request</button>
              </div>
            )}
            {role === 'admin' && lead.pendingOwnerChangeRequest && (
              <div className="ld-hero-owner-pending">
                <UserCog size={13} className="text-amber-300 shrink-0" />
                <span className="flex-1">{lead.pendingOwnerChangeRequest.requestedByName} wants to reassign to <b>{lead.pendingOwnerChangeRequest.requestedAssociateName}</b></span>
                <button type="button" className="btn btn-ghost !p-1.5 !text-emerald-400" title="Approve" disabled={ownerDeciding} onClick={() => decideOwnerRequest('approve')}><Check size={14} /></button>
                <button type="button" className="btn btn-ghost !p-1.5 !text-rose-400" title="Deny" disabled={ownerDeciding} onClick={() => decideOwnerRequest('deny')}><XCircle size={14} /></button>
              </div>
            )}

            {hasCadenceIssue && (
              <div className="ld-cadence-alert">
                <span className="ld-cadence-alert-title"><Clock size={13} /> Cadence deviation</span>
                {overdueFu && <span className="chip !px-2 !py-0.5 text-[10px] bg-rose-500/20 text-rose-300">next follow-up overdue {Math.abs(dueIn)}d</span>}
                {missedCount > 0 && <span className="chip !px-2 !py-0.5 text-[10px] bg-amber-500/15 text-amber-300 border border-amber-400/20">{missedCount} missed follow-up{missedCount > 1 ? 's' : ''}</span>}
                {idleBeyond && <span className="chip !px-2 !py-0.5 text-[10px] bg-amber-500/15 text-amber-300 border border-amber-400/20">no outreach in {idleDays}d (cadence {outreachDays}d)</span>}
              </div>
            )}
          </header>

          {/* ── Tab bar ──────────────────────────────────────────────── */}
          <nav className="ld-tabs" role="tablist" aria-label="Lead detail sections">
            {drawerTabs.map(t => {
              const Icon = t.icon
              return (
                <button
                  key={t.key}
                  role="tab"
                  id={`lead-tab-${t.key}`}
                  aria-controls="lead-tab-panel"
                  aria-selected={tab === t.key}
                  tabIndex={tab === t.key ? 0 : -1}
                  className={`ld-tab ${tab === t.key ? 'is-active' : ''}`}
                  onClick={() => setTab(t.key)}
                  onKeyDown={event => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    const index = drawerTabs.findIndex(item => item.key === t.key)
                    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? drawerTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + drawerTabs.length) % drawerTabs.length
                    setTab(drawerTabs[nextIndex].key)
                    requestAnimationFrame(() => document.getElementById(`lead-tab-${drawerTabs[nextIndex].key}`)?.focus())
                  }}
                >
                  <Icon size={13} />
                  <span>{t.label}</span>
                  {typeof t.count === 'number' && t.count > 0 && <em className="ld-tab-count">{t.count}</em>}
                  {t.synced && <em className="ld-tab-dot" title="Synced" />}
                </button>
              )
            })}
          </nav>

          {/* ── Tab panels ───────────────────────────────────────────── */}
          <div className="ld-panels flex-1 overflow-y-auto scrollbar-thin">
            <div key={tab} id="lead-tab-panel" className="ld-tab-panel" role="tabpanel" aria-labelledby={`lead-tab-${tab}`}>

              {tab === 'overview' && (
                <>
                  {/* AI lead intelligence */}
                  <section className="ld-card ld-reveal" style={{ '--i': 0 }}>
                    <div className="ld-card-head">
                      <span className="ld-card-icon ld-card-icon-accent"><Sparkles size={13} /></span>
                      <div className="ld-card-titles">
                        <h3>AI lead intelligence</h3>
                        <small>Score, sentiment and recommended next move</small>
                      </div>
                      <span className="chip ml-auto bg-white/5 border border-white/10 text-slate-400">auto</span>
                    </div>
                    <div className="ld-ai-score-row">
                      <div className="text-center">
                        <ScorePill score={lead.ai.score} size="lg" />
                        <div className="text-[10px] text-slate-500 mt-1">intent score</div>
                      </div>
                      <div className="ld-ai-facts">
                        <div><TrendingUp size={12} className="text-emerald-400" /> Sentiment <b className="text-slate-200 capitalize">{lead.ai.sentiment}</b></div>
                        <div><Clock size={12} className="text-amber-400" /> Best time <b className="text-slate-200">{lead.ai.bestContactTime}</b></div>
                        <div><Send size={12} className="lead-accent-icon" /> Next move <b className="text-slate-200">{lead.ai.nextAction.label}</b></div>
                      </div>
                    </div>
                    <div className="ld-note-box">
                      <div className="ld-note-box-title lead-accent"><Lightbulb size={12} /> Brief overview</div>
                      <p>{lead.ai.summary}</p>
                      <p className="ld-note-box-sub"><b>Recommended next step:</b> {lead.ai.nextAction.text}</p>
                    </div>
                    {(lead.ai?.insights || []).length > 0 && (
                      <div className="ld-insight-grid">
                        {lead.ai.insights.map((ins, i) => (
                          <div key={i} className="ld-insight"><span className="lead-accent">•</span>{ins}</div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* GPT deep-dive */}
                  <section className="ld-card ld-reveal" style={{ '--i': 1 }}>
                    <div className="ld-card-head">
                      <span className="ld-card-icon ld-card-icon-accent"><Bot size={13} /></span>
                      <div className="ld-card-titles">
                        <h3>GPT deep-dive</h3>
                        <small>Analysis and suggested messaging</small>
                      </div>
                      {lead.gpt?.generatedAt && <span className="chip ml-auto bg-white/5 border border-white/10 text-slate-400">{timeAgo(lead.gpt.generatedAt)}</span>}
                    </div>
                    {lead.gpt ? (
                      <div className="space-y-2.5">
                        <div className="ld-note-box">
                          <div className="ld-note-box-title lead-accent"><Lightbulb size={12} /> GPT summary</div>
                          <p>{lead.gpt.summary}</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <span className={`chip capitalize ${deepDiveSentiment === 'positive' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-400/20' : deepDiveSentiment === 'negative' ? 'bg-rose-500/10 text-rose-300 border border-rose-400/20' : 'bg-white/5 border border-white/10 text-slate-300'}`}>
                            <TrendingUp size={10} /> sentiment: {deepDiveSentiment}
                          </span>
                          <span className="chip bg-white/5 border border-white/10 text-slate-300"><Clock size={10} /> best time: {lead.gpt.bestContactTime || '—'}</span>
                          {lead.gpt.nextAction && <span className="chip lead-accent-chip"><Send size={10} /> {lead.gpt.nextAction.label}</span>}
                        </div>
                        {lead.gpt.nextAction?.text && <p className="text-[12px] text-slate-300 leading-relaxed">{lead.gpt.nextAction.text}</p>}
                        {(lead.gpt.insights || []).length > 0 && (
                          <div className="ld-insight-grid">
                            {lead.gpt.insights.map((ins, i) => (
                              <div key={i} className="ld-insight"><span className="lead-accent">•</span>{ins}</div>
                            ))}
                          </div>
                        )}
                        {(lead.gpt.followupSuggestions || []).length > 0 && (
                          <details className="drawer-suggestion-fold">
                            <summary><Sparkles size={11} /> GPT suggested messages <span>{lead.gpt.followupSuggestions.length}</span></summary>
                            <div className="space-y-1.5">
                              {lead.gpt.followupSuggestions.map((s, i) => (
                                <button key={i} className="w-full text-left modern-card !rounded-xl px-3 py-2.5 hover:scale-[1.01] transition-transform" onClick={() => { setComposeOpen(true) }}>
                                  <span className="chip !px-1.5 !py-0.5 text-[9.5px] uppercase" style={{ background: `${R_CHANNELS[s.channel] || '#888'}1c`, color: R_CHANNELS[s.channel] || '#fff', border: `1px solid ${(R_CHANNELS[s.channel] || '#888')}33` }}>{s.label || s.channel}</span>
                                  <span className="block text-[11.5px] text-slate-300 mt-1 leading-relaxed">“{s.text}”</span>
                                </button>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    ) : (
                      <div className="ld-empty-cta">
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] text-slate-300">Let the OpenAI model produce a richer summary, next-step and message suggestions for this lead.</div>
                          {!boot?.integrations?.gpt && !boot?.settings?.gpt?.apiKey && (
                            <div className="text-[11px] text-slate-500 mt-1">Add an OpenAI key in Settings → Integrations to enable.</div>
                          )}
                        </div>
                        <button className="btn btn-soft !py-1.5 !text-[12px] shrink-0" onClick={doEnrich} disabled={enriching}>
                          {enriching ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Enrich
                        </button>
                      </div>
                    )}
                  </section>

                  {/* Remarks */}
                  <section className="ld-card ld-reveal" style={{ '--i': 2 }}>
                    <div className="ld-card-head">
                      <span className="ld-card-icon"><MessageSquare size={13} /></span>
                      <div className="ld-card-titles">
                        <h3>Remarks</h3>
                        <small>{lead.remarks ? 'Saved lead notes' : 'Add a lead note'}</small>
                      </div>
                    </div>
                    <textarea className="input resize-none" rows={3} value={remarkDraft} onChange={e => setRemarkDraft(e.target.value)} placeholder="Notes from conversations…" />
                    <div className="flex justify-end mt-2">
                      <button className="btn btn-soft !py-1.5 !text-[12px]" disabled={remarkDraft === (lead.remarks || '')} onClick={() => patch({ remarks: remarkDraft }, 'Remarks updated')}>Save remarks</button>
                    </div>
                  </section>
                </>
              )}

              {tab === 'conversations' && (
                <section className="ld-card ld-reveal" style={{ '--i': 0 }}>
                  <div className="ld-card-head">
                    <span className={`ld-card-icon ${boot?.integrations?.respondio ? 'ld-card-icon-emerald' : ''}`}><MessageCircle size={13} /></span>
                    <div className="ld-card-titles">
                      <h3>Respond.io conversations</h3>
                      <small>Member message history</small>
                    </div>
                    {boot?.integrations?.respondio && <span className="chip ml-auto bg-white/5 border border-white/10 text-slate-400">{convCount} threads</span>}
                  </div>
                  {!boot?.integrations?.respondio ? (
                    <div className="text-[12.5px] text-slate-400 flex items-center gap-2"><span>Connect Respond.io in Settings → Integrations to view and send messages.</span></div>
                  ) : conv?.error ? (
                    <p className="text-[12px] text-rose-400">{conv.error}</p>
                  ) : !conv || !conv.conversations?.length ? (
                    <div className="ld-empty-state"><Inbox size={18} /><p>No conversations found for this lead yet.</p></div>
                  ) : (
                    <div className="space-y-3">
                      {conv.conversations.map(c => (
                        <div key={c.id} className="ld-thread">
                          <div className="ld-thread-head">
                            <span className="chip !py-0.5 !px-2 text-[9.5px] uppercase" style={{ background: `${R_CHANNELS[c.channel] || '#888'}1c`, color: R_CHANNELS[c.channel] || '#fff', border: `1px solid ${(R_CHANNELS[c.channel] || '#888')}33` }}>{c.channel}</span>
                            <span className="text-[10.5px] text-slate-500">{c.status || ''}</span>
                            <button className="ml-auto btn btn-ghost !p-1.5 !text-[11px]" onClick={() => setComposeOpen(true)} title="Open full composer (switch channel, use AI suggestions)"><Send size={11} /> More</button>
                          </div>
                          <div className="ld-thread-messages max-h-[240px] overflow-y-auto scrollbar-thin">
                            {(c.messages || []).slice().reverse().map(msg => (
                              <div key={msg.id} className={`ld-bubble ${msg.direction === 'inbound' ? 'is-inbound' : 'is-outbound'}`}>
                                <div className="ld-bubble-meta">{msg.direction === 'inbound' ? 'incoming' : 'you'} · {fmtDateTime(msg.sentAt)}</div>
                                {msg.content || msg.text}
                              </div>
                            ))}
                            {!c.messages?.length && <p className="text-[11px] text-slate-600 text-center py-2">No messages in this thread.</p>}
                          </div>
                          <div className="ld-thread-reply">
                            <input
                              className="input !py-1.5 !text-[12px] flex-1"
                              placeholder={`Reply via ${c.channel}…`}
                              value={replyDrafts[c.id] || ''}
                              onChange={e => setReplyDrafts(d => ({ ...d, [c.id]: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendInlineReply(c)}
                            />
                            <button className="btn btn-primary !p-2" onClick={() => sendInlineReply(c)} disabled={replySending[c.id] || !(replyDrafts[c.id] || '').trim()}>
                              {replySending[c.id] ? <Spinner size={12} /> : <Send size={12} />}
                            </button>
                          </div>
                          {replyError[c.id] && <p className="text-[10.5px] text-rose-400 px-2.5 pb-2">{replyError[c.id]}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {tab === 'momence' && (
                <section className="ld-card ld-reveal" style={{ '--i': 0 }}>
                  <div className="ld-card-head">
                    <span className="ld-card-icon ld-card-icon-emerald"><Link2 size={13} /></span>
                    <div className="ld-card-titles">
                      <h3>Momence profile &amp; activity</h3>
                      <small>Connected member intelligence</small>
                    </div>
                    {m && <span className="ld-synced-pill"><span /> Synced</span>}
                  </div>
                  {!boot?.integrations?.momence ? (
                    <div className="text-[12.5px] text-slate-400 flex items-center gap-2"><span>Connect Momence in Settings to pull sales and class history automatically.</span></div>
                  ) : !m ? (
                    <div>
                      {!candidates ? (
                        <div>
                          {syncing && (
                            <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/20 px-3 py-2 mb-2 text-[12px] text-emerald-300 flex items-center gap-2">
                              <Spinner size={13} /> Enriching this profile from Momence…
                            </div>
                          )}
                          <div className="flex items-center gap-2 mb-2">
                            <button className="btn btn-soft !py-2 flex-1" onClick={doSync} disabled={syncing}>
                              {syncing ? <Spinner size={14} /> : <RefreshCw size={14} />} Find &amp; sync from Momence
                            </button>
                            <button className="btn btn-primary !py-2" onClick={() => setCreateMemberOpen(v => !v)} disabled={syncing || creatingMember}>
                              <UserPlus size={14} /> Create member
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-500">Looks up this member on Momence by {lead.email ? 'email' : ''}{lead.email && lead.phone ? ' or ' : ''}{lead.phone ? 'phone' : ''} — no member ID needed.</p>
                          {createMemberOpen && (
                            <form className="momence-create-member" onSubmit={createMomenceMember}>
                              <div className="momence-create-heading">
                                <span><span className="momence-subsection-kicker">New Momence profile</span>Confirm member details</span>
                                <button type="button" className="modal-close" aria-label="Cancel member creation" onClick={() => setCreateMemberOpen(false)}><X size={14} /></button>
                              </div>
                              <div className="momence-create-grid">
                                <label><span>First name</span><input className="input" value={memberDraft.firstName} maxLength={100} onChange={e => setMemberDraft(d => ({ ...d, firstName: e.target.value }))} required /></label>
                                <label><span>Last name</span><input className="input" value={memberDraft.lastName} maxLength={100} onChange={e => setMemberDraft(d => ({ ...d, lastName: e.target.value }))} required /></label>
                                <label className="is-wide"><span>Email</span><input className="input" type="email" value={memberDraft.email} maxLength={100} onChange={e => setMemberDraft(d => ({ ...d, email: e.target.value }))} required /></label>
                                <label className="is-wide"><span>Phone <em>optional</em></span><input className="input" type="tel" value={memberDraft.phoneNumber} onChange={e => setMemberDraft(d => ({ ...d, phoneNumber: e.target.value }))} /></label>
                              </div>
                              <div className="momence-create-actions">
                                <p>This creates a real customer record in Momence and links it to this lead.</p>
                                <button className="btn btn-primary !py-2" type="submit" disabled={creatingMember || !memberDraft.firstName.trim() || !memberDraft.lastName.trim() || !memberDraft.email.trim()}>
                                  {creatingMember ? <Spinner size={14} /> : <UserPlus size={14} />} {creatingMember ? 'Creating…' : 'Create & link profile'}
                                </button>
                              </div>
                            </form>
                          )}
                          {lead.memberId && <p className="text-[11.5px] text-slate-500 mt-1">Already linked to member #{lead.memberId}.</p>}
                          {syncError && <p className="text-[11.5px] text-rose-400 mt-1">{syncError}</p>}
                          <button className="text-[11px] text-slate-500 hover:text-slate-300 underline mt-2" onClick={() => setManualLink(v => !v)}>
                            {manualLink ? 'Cancel manual link' : "Can't find it? Link a member ID manually"}
                          </button>
                          {manualLink && (
                            <div className="flex items-center gap-2 mt-2">
                              <input className="input !py-1.5" placeholder="Momence member ID (e.g. 15875720)" value={manualMemberId} onChange={e => setManualMemberId(e.target.value)} />
                              <button className="btn btn-ghost !py-2" onClick={() => manualMemberId.trim() && doLink(manualMemberId.trim())} disabled={syncing || !manualMemberId.trim()}>Link</button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p className="text-[12px] text-slate-300 mb-2">Multiple Momence members match — pick the right one:</p>
                          <div className="space-y-1.5">
                            {candidates.map(c => (
                              <button key={c.id} className="w-full text-left card !rounded-xl px-3 py-2 hover:bg-white/5 transition-colors flex items-center justify-between gap-2" onClick={() => doLink(c.id)} disabled={syncing}>
                                <span>
                                  <span className="block text-[12.5px] font-semibold text-slate-200">{c.firstName} {c.lastName}</span>
                                  <span className="block text-[11px] text-slate-500">{c.email}{c.phoneNumber ? ` · ${c.phoneNumber}` : ''}</span>
                                </span>
                                <span className="text-[10.5px] text-slate-500 mono shrink-0">#{c.id}</span>
                              </button>
                            ))}
                          </div>
                          <button className="text-[11px] text-slate-500 hover:text-slate-300 underline mt-2" onClick={() => setCandidates(null)}>Cancel</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      {m.member && (
                        <div className="momence-metric-grid">
                          <MomenceMetric icon={IndianRupee} label="Lifetime sales" value={money(lifetimeSales)} detail={`${m.salesHistory?.length || 0} transactions`} tone="emerald" />
                          <MomenceMetric icon={Award} label="Completed" value={classesAttended} detail={`${attendanceRate}% attendance`} tone="blue" />
                          <MomenceMetric icon={CalendarPlus} label="Active plans" value={m.memberships?.length || 0} detail={`${m.appointments?.length || 0} appointments`} tone="violet" />
                          <MomenceMetric icon={Clock} label="Last visit" value={fmtDate(m.member?.visits?.lastVisit || m.member?.lastSeen || m.member?.lastVisit)} detail={`First seen ${fmtDate(m.member.firstSeen)}`} tone="amber" />
                        </div>
                      )}

                      <div className="momence-overview-grid">
                        <ActivityChart attended={classesAttended} cancelled={classesCancelled} other={classesOther} />
                        <div className="momence-profile-card">
                          <button className="momence-subsection-heading" onClick={() => setMomenceProfileOpen(v => !v)} aria-expanded={momenceProfileOpen}>
                            <span><span className="momence-subsection-kicker">Member record</span>Profile details</span>
                            <ChevronIcon open={momenceProfileOpen} />
                          </button>
                          {momenceProfileOpen && <div className="momence-profile-grid">
                            <InfoTile label="Momence member" value={[m.member?.firstName, m.member?.lastName].filter(Boolean).join(' ') || lead.fullName} sub={`#${lead.memberId || m.member?.id || '—'}`} />
                            <InfoTile label="Contact" value={m.member?.email || lead.email || '—'} sub={m.member?.phoneNumber || m.member?.phone || lead.phone || '—'} />
                            <InfoTile label="Home location" value={m.member?.homeLocationName || m.member?.homeLocation || m.member?.locationName || loc?.name?.split(',')[0] || '—'} sub={`${m.member?.visits?.total ?? classesAttended} total visits`} />
                            <InfoTile label="Current plan" value={(m.memberships || []).find(p => !p.isFrozen)?.name || 'No active plan'} sub={`${m.memberships?.length || 0} linked plan records`} />
                          </div>}
                        </div>
                      </div>
                      <div className="momence-profile-grid mb-3">
                        <InfoTile label="Member ID" value={String(lead.memberId || m.member?.id || '—')} />
                        <InfoTile label="Total bookings" value={String(m.classHistory?.length ?? '—')} sub={`${m.member?.visits?.total ?? classesAttended} total visits`} />
                        <InfoTile label="First seen" value={fmtDate(m.member?.firstSeen)} />
                        <InfoTile label="Last seen" value={fmtDate(m.member?.visits?.lastVisit || m.member?.lastSeen)} />
                        <InfoTile label="Trial completion" value={lead.trialDate ? fmtDate(lead.trialDate) : '—'} />
                        <InfoTile label="First purchase" value={lead.firstPurchaseDate ? fmtDate(lead.firstPurchaseDate) : '—'} />
                        <InfoTile label="Fitness goals" value={momenceCustomField(m, 'fitness') || '—'} />
                        <InfoTile label="Medical history" value={momenceCustomField(m, 'medical') || '—'} />
                      </div>
                      <div className="momence-custom-fields rounded-xl bg-white/[0.03] border border-white/8 p-3 mb-3">
                        <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Custom fields</div>
                        {m.customFields && Object.keys(m.customFields).length > 0 ? (
                          <div className="momence-custom-grid grid gap-2">
                            {Object.entries(m.customFields).map(([key, value]) => <InfoTile key={key} label={key} value={String(value ?? '') || '—'} />)}
                          </div>
                        ) : <EmptyNote text="No custom fields on this member's Momence profile." />}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mb-3">
                        {m.tags && m.tags.length > 0
                          ? m.tags.map((t, i) => <span key={i} className="chip bg-emerald-400/10 text-emerald-300 border border-emerald-400/20"><Tags size={10} />{t}</span>)
                          : <span className="text-[11.5px] text-slate-600">No tags on this member.</span>}
                      </div>

                      <div className="momence-data-panel">
                        <Tabbed
                          tabs={[
                            { key: 'sales', label: `Sales (${m.salesHistory?.length || 0})`, icon: Receipt },
                            { key: 'classes', label: `Classes (${m.classHistory?.length || 0})`, icon: Award },
                            { key: 'plans', label: `Plans (${m.memberships?.length || 0})`, icon: CalendarPlus },
                            { key: 'appointments', label: `Appointments (${m.appointments?.length || 0})`, icon: Clock },
                            { key: 'notes', label: `Notes (${m.notes?.length || 0})`, icon: MessageSquare }
                          ]}>
                          <div key="sales">
                            {(m?.salesHistory || []).slice(0, 8).map((s, i) => (
                              <Row key={i} icon={<Receipt size={13} className="text-emerald-400" />} title={s.itemName} sub={s.itemType} right={money(s.totalInCurrency)} meta={fmtDate(s.saleDate)} />
                            ))}
                            {!m.salesHistory?.length && <EmptyNote text="No sales records found for this member." />}
                          </div>
                          <div key="classes">
                            {(m?.classHistory || []).slice(0, 16).map((c, i) => (
                              <Row key={i} icon={<Award size={13} className={c.checkedIn ? 'text-emerald-400' : 'text-slate-500'} />} title={c.name || c.className || 'Class'} sub={[c.type, c.teacher || c.instructorName, c.locationName || c.roomName].filter(Boolean).join(' · ')} right={c.checkedIn ? 'Attended' : (c.status || 'Booked')} meta={fmtDateTime(c.startsAt || c.date)} />
                            ))}
                            {!m.classHistory?.length && <EmptyNote text="No class history for this member yet." />}
                          </div>
                          <div key="plans">
                            {(m?.memberships || []).map((p, i) => (
                              <Row key={i} icon={<CalendarPlus size={13} className={p.isFrozen ? 'text-amber-400' : 'lead-accent-icon'} />} title={p.name} sub={[String(p.type || '').replace(/-/g, ' '), p.locationName].filter(Boolean).join(' · ')} right={p.isFrozen ? 'Frozen' : (p.endDate ? `until ${fmtDate(p.endDate)}` : 'active')} meta={`${p.eventCreditsLeft ?? p.remainingCredits ?? '—'} left · ${p.usedSessions ?? '—'} used`} />
                            ))}
                            {!m.memberships?.length && <EmptyNote text="No active memberships." />}
                          </div>
                          <div key="appointments">
                            {(m?.appointments || []).slice(0, 8).map((a, i) => (
                              <Row key={i} icon={<Clock size={13} className={a.status === 'cancelled' ? 'text-slate-500' : 'lead-accent-icon'} />} title={a.name} sub={a.staff} right={a.status === 'cancelled' ? 'Cancelled' : 'Booked'} meta={fmtDateTime(a.startsAt)} />
                            ))}
                            {!m.appointments?.length && <EmptyNote text="No appointments found for this member." />}
                          </div>
                          <div key="notes">
                            {(m?.notes || []).slice(0, 8).map((n, i) => (
                              <Row key={i} icon={<MessageSquare size={13} className="text-slate-400" />} title={(n.note || 'Note').replace(/<[^>]+>/g, ' ').trim()} sub="" right="" meta={fmtDateTime(n.createdAt)} />
                            ))}
                            {!m.notes?.length && <EmptyNote text="No notes recorded on this member's Momence profile." />}
                          </div>
                        </Tabbed>
                      </div>
                      <p className="text-[10.5px] text-slate-600 mt-2 flex items-center gap-1"><RefreshCw size={10} /> Synced {timeAgo(lead.momenceSyncedAt)}</p>
                    </div>
                  )}
                </section>
              )}

              {tab === 'activity' && (
                <>
                  {/* cadence snapshot */}
                  <section className="ld-card ld-reveal" style={{ '--i': 0 }}>
                    <div className="ld-card-head">
                      <span className="ld-card-icon ld-card-icon-amber"><Clock size={13} /></span>
                      <div className="ld-card-titles">
                        <h3>Cadence snapshot</h3>
                        <small>Outreach pacing vs the {outreachDays}d cadence</small>
                      </div>
                    </div>
                    <div className="ld-cadence-grid">
                      <div className={`ld-cadence-stat ${overdueFu ? 'is-bad' : 'is-good'}`}>
                        <div className="ld-cadence-value">{nextFu ? fmtDate(nextFu.date) : '—'}</div>
                        <div className="ld-cadence-label">Next follow-up {overdueFu ? `· ${Math.abs(dueIn)}d overdue` : dueIn !== null ? `· in ${dueIn}d` : ''}</div>
                      </div>
                      <div className={`ld-cadence-stat ${idleBeyond ? 'is-warn' : 'is-good'}`}>
                        <div className="ld-cadence-value">{lead.status === 'open' ? `${idleDays}d` : '—'}</div>
                        <div className="ld-cadence-label">Since last outreach</div>
                      </div>
                      <div className={`ld-cadence-stat ${missedCount > 0 ? 'is-warn' : 'is-good'}`}>
                        <div className="ld-cadence-value">{missedCount}</div>
                        <div className="ld-cadence-label">Missed follow-ups</div>
                      </div>
                    </div>
                  </section>

                  {/* follow-up timeline */}
                  <section className="ld-card ld-reveal" style={{ '--i': 1 }}>
                    <div className="ld-card-head">
                      <span className="ld-card-icon ld-card-icon-amber"><Activity size={13} /></span>
                      <div className="ld-card-titles">
                        <h3>Follow-up timeline</h3>
                        <small>Activity and next touchpoint</small>
                      </div>
                      <span className="chip ml-auto bg-white/5 border border-white/10 text-slate-400">{realFollowUps.length}</span>
                    </div>
                    <div className="ld-timeline">
                      {realFollowUps.slice().reverse().map((f, i) => (
                        <div key={f.id || i} className="ld-timeline-item">
                          <span className={`ld-timeline-node ${f.done && followUpText(f.comments) ? 'is-done' : 'is-pending'}`} />
                          <div className="ld-timeline-meta">
                            <span className="mono">{fmtDate(f.date)}</span>
                            {f.done && followUpText(f.comments) && <span className="flex items-center gap-0.5 text-emerald-400"><CheckCircle2 size={11} /> done</span>}
                            {!f.done && f.date && f.date < todayStr && <span className="chip !px-1.5 !py-0.5 text-[9px] bg-rose-500/20 text-rose-300">overdue</span>}
                          </div>
                          {followUpText(f.comments) && <p className="ld-timeline-text">{followUpText(f.comments)}</p>}
                        </div>
                      ))}
                      {!realFollowUps.length && <p className="text-[12px] text-slate-500 mb-3">No follow-ups logged yet.</p>}
                    </div>
                    <form onSubmit={addFollowUp} className="ld-followup-form">
                      <div className="flex gap-2">
                        <input className="input !py-1.5" type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} />
                        <input className="input !py-1.5" name="comments" ref={commentsRef} placeholder="Add a follow-up note…" />
                      </div>
                      <button className="btn btn-primary !py-1.5 !text-[12px] w-full" type="submit"><CalendarPlus size={14} /> Log follow-up</button>
                    </form>
                    {lead.ai?.followupSuggestions?.length > 0 && (
                      <details className="drawer-suggestion-fold mt-3">
                        <summary><Sparkles size={11} /> AI suggested messages <span>{lead.ai.followupSuggestions.length}</span></summary>
                        <div className="space-y-1.5">
                          {lead.ai.followupSuggestions.map((s, i) => (
                            <button key={i} className="w-full text-left card !rounded-xl px-2.5 py-2 hover:bg-white/5 transition-colors" onClick={() => fillSuggestion(s)}>
                              <span className="chip !px-1.5 !py-0.5 text-[9.5px] uppercase bg-white/5 border border-white/10 text-slate-400">{s.label}</span>
                              <span className="block text-[11.5px] text-slate-300 mt-1 leading-relaxed">“{s.text}”</span>
                            </button>
                          ))}
                        </div>
                      </details>
                    )}
                  </section>
                </>
              )}

            </div>
          </div>
        </aside>
      </div>
      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} lead={lead} />
      <RespondioTemplateModal open={templateOpen} onClose={() => setTemplateOpen(false)} lead={lead} />
    </>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s ease', flexShrink: 0 }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function EditableHeaderField({ value, placeholder, onSave, as: Tag = 'span', className = '', id }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  React.useEffect(() => { if (!editing) setDraft(value || '') }, [value, editing])
  const save = () => {
    setEditing(false)
    const next = draft.trim()
    if (next !== (value || '')) onSave(next)
  }
  if (editing) {
    return (
      <input
        autoFocus
        className="input !text-[12px] !py-0.5 !px-1.5 !w-auto inline-editable-field-input"
        value={draft}
        onClick={e => e.stopPropagation()}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Escape') { setDraft(value || ''); setEditing(false) }; if (e.key === 'Enter') save() }}
      />
    )
  }
  return (
    <Tag id={id} className={`${className} inline-editable-field`} role="button" tabIndex={0} onClick={e => { e.stopPropagation(); setEditing(true) }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true) } }} title="Click to edit">
      {value || placeholder}
    </Tag>
  )
}

function MomenceMetric({ icon: Icon, label, value, detail, tone }) {
  return (
    <div className={`momence-metric tone-${tone}`}>
      <span className="momence-metric-icon"><Icon size={15} /></span>
      <div className="momence-metric-label">{label}</div>
      <div className="momence-metric-value">{value}</div>
      <div className="momence-metric-detail">{detail}</div>
    </div>
  )
}

function ActivityChart({ attended, cancelled, other }) {
  const rows = [
    { label: 'Attended', value: attended, tone: 'emerald' },
    { label: 'Cancelled', value: cancelled, tone: 'rose' },
    { label: 'Other bookings', value: other, tone: 'slate' }
  ]
  const max = Math.max(1, ...rows.map(row => row.value))
  return (
    <div className="momence-chart-card">
      <div className="momence-card-heading"><span><span>Session activity</span><small>Synced class history</small></span><BarChart3 size={16} /></div>
      <div className="momence-bars">
        {rows.map(row => (
          <div className="momence-bar-row" key={row.label}>
            <span>{row.label}</span>
            <div><i className={`tone-${row.tone}`} style={{ width: `${Math.max(row.value ? 8 : 0, (row.value / max) * 100)}%` }} /></div>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function InfoTile({ label, value, sub }) {
  return (
    <div className="rounded-xl bg-white/[0.035] border border-white/8 px-3 py-2 min-w-0">
      <div className="text-[9.5px] uppercase tracking-wider text-slate-500 font-semibold truncate">{label}</div>
      <div className="text-[12.5px] text-slate-200 font-semibold truncate mt-0.5">{value || '—'}</div>
      {sub && <div className="text-[11px] text-slate-500 truncate mt-0.5">{sub}</div>}
    </div>
  )
}

function Row({ icon, title, sub, right, meta }) {
  return (
    <div className="momence-table-row">
      <span className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold text-slate-200 truncate">{title}</div>
        <div className="text-[11px] text-slate-500 truncate">{sub}{meta ? ` · ${meta}` : ''}</div>
      </div>
      <span className="text-[11.5px] text-slate-300 shrink-0 mono">{right}</span>
    </div>
  )
}

function EmptyNote({ text }) {
  return <p className="text-[12px] text-slate-500 py-2">{text}</p>
}

function humanMomenceError(message) {
  const text = String(message || '')
  if (/member ID is missing|not linked to a valid|members\/-/i.test(text)) return 'This lead is not linked to a valid Momence member yet. Use Find & sync or link the member ID manually.'
  if (/No Momence member found/i.test(text)) return text
  if (/Multiple Momence members/i.test(text)) return text
  if (/Momence API 404/i.test(text)) return 'Momence could not find that member record for this host. Relink the member or sync by email/phone.'
  if (/Momence is not configured/i.test(text)) return 'Momence is not configured. Add credentials in Settings first.'
  return text || 'Momence sync failed. Please try again.'
}

function Tabbed({ tabs, children }) {
  const [active, setActive] = React.useState(tabs[0].key)
  const activeTab = tabs.find(t => t.key === active)
  const childList = React.Children.toArray(children)
  const activeChild = childList.find(c => String(c.key || '').replace(/^\.\$/, '').replace(/^\./, '') === activeTab.key) || childList[tabs.findIndex(t => t.key === activeTab.key)]
  return (
    <div className="momence-tabs">
      <div className="momence-tab-list">
        {tabs.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key} className={active === t.key ? 'is-active' : ''} onClick={() => setActive(t.key)}>
              <Icon size={12} /> {t.label}
            </button>
          )
        })}
      </div>
      <div className="momence-table-head"><span>Record</span><span>Value / status</span></div>
      <div className="momence-table-body">{activeChild}</div>
    </div>
  )
}
