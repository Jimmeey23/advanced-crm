import React, { useEffect, useMemo, useState } from 'react'
import {
  X, Phone, Mail, MapPin, Sparkles, CalendarPlus, RefreshCw, Link2,
  CheckCircle2, Send, Clock, Lightbulb, TrendingUp, Tags, Receipt,
  Award, MessageSquare, Bot, MessageCircle, Loader2, Inbox
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { Avatar, ScorePill, Spinner } from '../ui.jsx'
import { fmtDate, fmtDateTime, timeAgo, stageClass, riskClass, money } from '../lib.js'
import ComposeModal from './ComposeModal.jsx'
import RespondioTemplateModal from './RespondioTemplateModal.jsx'

const R_CHANNELS = { whatsapp: '#34d399', sms: '#fbbf24', email: '#a78bfa', call: '#38bdf8' }
const MIN_DRAWER_WIDTH = 560

export default function LeadDrawer() {
  const { boot, lookup, drawerLeadId, closeLead, refreshData, toast, dataVersion } = useApp()
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
  const [drawerWidth, setDrawerWidth] = useState(() => Number(localStorage.getItem('p57_lead_drawer_width')) || MIN_DRAWER_WIDTH)
  const commentsRef = React.useRef(null)

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
  useEffect(() => { setSyncError(''); setCandidates(null); setManualLink(false); setManualMemberId(''); setAutoSyncLeadId('') }, [drawerLeadId])

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
    doSync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id, lead?.momence, boot?.integrations?.momence])

  if (!drawerLeadId) return null

  const startDrawerResize = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = drawerWidth
    const onMove = (ev) => {
      const next = Math.max(MIN_DRAWER_WIDTH, Math.min(Math.round(startWidth + startX - ev.clientX), Math.min(1100, window.innerWidth - 24)))
      setDrawerWidth(next)
      try { localStorage.setItem('p57_lead_drawer_width', String(next)) } catch (err) { /* ignore */ }
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (!lead) {
    return (
      <div className="fixed inset-0 z-[80] flex justify-end">
        <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={closeLead} />
        <aside className="lead-drawer relative w-full max-w-[680px] h-full bg-[linear-gradient(180deg,rgba(15,18,32,0.98),rgba(9,12,22,0.98))] border-l border-white/10 flex items-center justify-center">
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
  const doSync = async () => {
    setSyncing(true); setSyncError(''); setCandidates(null)
    try {
      await api.post(`/api/momence/sync/${lead.id}`)
      toast('Momence profile synced')
      refreshData(); reload()
    } catch (e) {
      if (e.status === 300 && e.data?.candidates) {
        setCandidates(e.data.candidates)
      } else {
        setSyncError(humanMomenceError(e.message)); toast(humanMomenceError(e.message), 'error')
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

  const m = lead.momence
  const classesAttended = m?.classHistory?.filter(c => c.checkedIn).length || 0
  const classesCancelled = m?.classHistory?.filter(c => !c.checkedIn && /cancel/i.test(c.status || '')).length || 0

  // A follow-up slot with neither a real date nor a comment is a blank
  // placeholder row (common in imported data with a fixed number of
  // follow-up columns, most left empty) — nothing happened on it, so it
  // shouldn't render as a timeline entry at all, let alone as "done".
  const realFollowUps = (lead.followUps || []).filter(f => (f.date && f.date !== '-') || (f.comments && f.comments !== '-'))

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

  return (
    <>
      <div className="fixed inset-0 z-[80] flex justify-end">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={closeLead} />
      <aside className="lead-drawer lead-detail-panel relative w-full h-full border-l border-white/10 flex flex-col shadow-2xl" style={{ maxWidth: 'calc(100vw - 16px)', width: drawerWidth, animation: 'slideIn .2s ease' }}>
        <button className="lead-drawer-resizer" onMouseDown={startDrawerResize} title="Drag to resize detail drawer" />
        {/* header */}
        <div className="lead-detail-header px-6 pt-5 pb-4 border-b border-white/8 bg-white/[0.02] backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <Avatar name={lead.fullName} color={owner?.color} size={46} />
            <div className="flex-1 min-w-0">
              <h2 className="font-display text-[18px] font-bold text-white truncate">{lead.fullName}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[12px] text-slate-400">
                <span className="flex items-center gap-1"><Phone size={11} />{lead.phone || '—'}</span>
                <span className="flex items-center gap-1 truncate"><Mail size={11} />{lead.email}</span>
              </div>
            </div>
            <button className="btn btn-ghost !p-2 modal-close" onClick={closeLead}><X size={16} /></button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <select className="input !w-auto !py-1.5 !text-[12px]" value={lead.stage} onChange={e => patch({ stage: e.target.value }, `Moved to ${e.target.value}`)}>
              {(boot?.stages || []).map(s => <option key={s}>{s}</option>)}
            </select>
            <select className="input !w-auto !py-1.5 !text-[12px]" value={lead.associateId || ''} onChange={e => patch({ associateId: e.target.value }, e.target.value ? 'Owner updated' : 'Owner cleared')}>
              <option value="">Unassigned</option>
              {ownerOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <span className={`chip ${stageClass(lead.stage)}`}>{lead.stage}</span>
            <span className={`chip ${riskClass(lead.ai.risk)}`}>{lead.ai.risk}</span>
            <span className="chip bg-white/5 border border-white/10 text-slate-300">{lead.status}</span>
          </div>

          <div className="flex items-center gap-3 mt-3 text-[11.5px] text-slate-500">
            <span className="flex items-center gap-1"><MapPin size={11} />{loc?.name || lead.center || '—'}</span>
            {owner && <span className="flex items-center gap-1"><Avatar name={owner.name} color={owner.color} photoUrl={owner.photoUrl} photoZoom={owner.photoZoom} photoPosX={owner.photoPosX} photoPosY={owner.photoPosY} size={14} /> {owner.name}</span>}
            <span className="ml-auto">{lead.memberId ? `Momence #${lead.memberId}` : 'No member link'}</span>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button
              className="btn btn-primary !py-2 !text-[12px] flex-1"
              onClick={() => setComposeOpen(true)}
            >
              <MessageCircle size={13} /> Send message
            </button>
            <button
              className="btn btn-soft !py-2 !text-[12px] flex-1"
              onClick={() => setTemplateOpen(true)}
            >
              <Sparkles size={13} /> Send WhatsApp template
            </button>
          </div>
        </div>

        {/* cadence deviation banner */}
        {hasCadenceIssue && (
          <div className="px-6 py-3 border-b border-white/8 bg-rose-500/[0.06]">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-semibold text-rose-300 flex items-center gap-1.5"><Clock size={13} /> Cadence deviation</span>
              {overdueFu && <span className="chip !px-2 !py-0.5 text-[10px] bg-rose-500/20 text-rose-300">next follow-up overdue {Math.abs(dueIn)}d</span>}
              {missedCount > 0 && <span className="chip !px-2 !py-0.5 text-[10px] bg-amber-500/15 text-amber-300 border border-amber-400/20">{missedCount} missed follow-up{missedCount > 1 ? 's' : ''}</span>}
              {idleBeyond && <span className="chip !px-2 !py-0.5 text-[10px] bg-amber-500/15 text-amber-300 border border-amber-400/20">no outreach in {idleDays}d (cadence {outreachDays}d)</span>}
            </div>
          </div>
        )}

        {/* body */}
        <div className="lead-detail-body flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
        <div className="modern-card !rounded-2xl lead-detail-consolidated">
          {/* AI panel */}
          <section className="lead-section ai-panel">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={14} className="lead-section-icon" />
              <h3 className="font-display font-semibold text-white text-[13px]">AI lead intelligence</h3>
              <span className="chip ml-auto bg-white/5 border border-white/10 text-slate-400">auto</span>
            </div>
            <div className="flex items-center gap-5 mb-3">
              <div className="text-center">
                <ScorePill score={lead.ai.score} size="lg" />
                <div className="text-[10px] text-slate-500 mt-1">intent score</div>
              </div>
              <div className="flex-1 space-y-1.5 text-[12px]">
                <div className="flex items-center gap-2"><TrendingUp size={12} className="text-emerald-400" /> Sentiment: <b className="text-slate-200 capitalize">{lead.ai.sentiment}</b></div>
                <div className="flex items-center gap-2"><Clock size={12} className="text-amber-400" /> Best time: <b className="text-slate-200">{lead.ai.bestContactTime}</b></div>
                <div className="flex items-center gap-2"><Send size={12} className="lead-accent-icon" /> Next move: <b className="text-slate-200">{lead.ai.nextAction.label}</b></div>
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3">
              <div className="text-[11px] font-semibold lead-accent mb-1 flex items-center gap-1.5"><Lightbulb size={12} /> Suggested action</div>
              <p className="text-[12.5px] text-slate-200 leading-relaxed">{lead.ai.nextAction.text}</p>
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {(lead.ai?.insights || []).map((ins, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11.5px] text-slate-400"><span className="lead-accent mt-0.5">•</span>{ins}</div>
              ))}
            </div>
          </section>

          {/* summary */}
          <section className="lead-section">
            <h3 className="font-display font-semibold text-white text-[13px] mb-2">AI summary</h3>
            <p className="text-[12.5px] text-slate-300 leading-relaxed">{lead.ai.summary}</p>
          </section>

          {/* GPT enrichment */}
          <section className="lead-section gpt-panel">
            <div className="flex items-center gap-2 mb-3">
              <Bot size={14} className="lead-accent-icon" />
              <h3 className="font-display font-semibold text-white text-[13px]">GPT deep-dive</h3>
              {lead.gpt?.generatedAt && <span className="chip ml-auto bg-white/5 border border-white/10 text-slate-400">{timeAgo(lead.gpt.generatedAt)}</span>}
            </div>

            {lead.gpt ? (
              <div className="space-y-2.5">
                <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3">
                  <div className="text-[11px] font-semibold lead-accent mb-1 flex items-center gap-1.5"><Lightbulb size={12} /> GPT summary</div>
                  <p className="text-[12.5px] text-slate-200 leading-relaxed">{lead.gpt.summary}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={`chip capitalize ${lead.gpt.sentiment === 'positive' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-400/20' : lead.gpt.sentiment === 'negative' ? 'bg-rose-500/10 text-rose-300 border border-rose-400/20' : 'bg-white/5 border border-white/10 text-slate-300'}`}>
                    <TrendingUp size={10} /> sentiment: {lead.gpt.sentiment}
                  </span>
                  <span className="chip bg-white/5 border border-white/10 text-slate-300"><Clock size={10} /> best time: {lead.gpt.bestContactTime || '—'}</span>
                  {lead.gpt.nextAction && <span className="chip lead-accent-chip"><Send size={10} /> {lead.gpt.nextAction.label}</span>}
                </div>
                {lead.gpt.nextAction?.text && <p className="text-[12px] text-slate-300 leading-relaxed">{lead.gpt.nextAction.text}</p>}
                {(lead.gpt.insights || []).length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {(lead.gpt.insights || []).map((ins, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[11.5px] text-slate-400"><span className="lead-accent mt-0.5">•</span>{ins}</div>
                    ))}
                  </div>
                )}
                {(lead.gpt.followupSuggestions || []).length > 0 && (
                  <div>
                    <div className="text-[10.5px] uppercase tracking-wider lead-accent font-semibold mb-1.5 flex items-center gap-1"><Sparkles size={10} /> GPT suggested messages</div>
                    <div className="space-y-1.5">
                      {lead.gpt.followupSuggestions.map((s, i) => (
                        <button key={i} className="w-full text-left modern-card !rounded-xl px-3 py-2.5 hover:scale-[1.01] transition-transform" onClick={() => { setComposeOpen(true) }}>
                          <span className="chip !px-1.5 !py-0.5 text-[9.5px] uppercase" style={{ background: `${R_CHANNELS[s.channel] || '#888'}1c`, color: R_CHANNELS[s.channel] || '#fff', border: `1px solid ${(R_CHANNELS[s.channel] || '#888')}33` }}>{s.label || s.channel}</span>
                          <span className="block text-[11.5px] text-slate-300 mt-1 leading-relaxed">“{s.text}”</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl bg-white/[0.03] border border-white/8 px-3.5 py-3 flex items-center gap-3">
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

          {/* Respond.io conversations */}
          <section className="lead-section">
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle size={14} className={boot?.integrations?.respondio ? 'text-emerald-400' : 'text-slate-500'} />
              <h3 className="font-display font-semibold text-white text-[13px]">Respond.io conversation</h3>
              {boot?.integrations?.respondio && <span className="chip ml-auto bg-white/5 border border-white/10 text-slate-400">{conv?.conversations?.length || 0} threads</span>}
            </div>

            {!boot?.integrations?.respondio ? (
              <div className="text-[12.5px] text-slate-400 flex items-center gap-2"><span>Connect Respond.io in Settings → Integrations to view and send messages.</span></div>
            ) : conv?.error ? (
              <p className="text-[12px] text-rose-400">{conv.error}</p>
            ) : !conv || !conv.conversations?.length ? (
              <div className="text-[12px] text-slate-500 flex items-center gap-2"><Inbox size={14} /> No conversations found for this lead yet.</div>
            ) : (
              <div className="space-y-3">
                {conv.conversations.map(c => (
                  <div key={c.id} className="rounded-xl bg-white/[0.03] border border-white/8 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/6 bg-white/[0.03]">
                      <span className="chip !py-0.5 !px-2 text-[9.5px] uppercase" style={{ background: `${R_CHANNELS[c.channel] || '#888'}1c`, color: R_CHANNELS[c.channel] || '#fff', border: `1px solid ${(R_CHANNELS[c.channel] || '#888')}33` }}>{c.channel}</span>
                      <span className="text-[10.5px] text-slate-500">{c.status || ''}</span>
                      <button className="ml-auto btn btn-ghost !p-1.5 !text-[11px]" onClick={() => setComposeOpen(true)} title="Open full composer (switch channel, use AI suggestions)"><Send size={11} /> More</button>
                    </div>
                    <div className="max-h-[240px] overflow-y-auto scrollbar-thin p-2.5 space-y-1.5">
                      {(c.messages || []).slice().reverse().map(m => (
                        <div key={m.id} className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-[12px] leading-relaxed ${m.direction === 'inbound' ? 'bg-white/6 border border-white/8 text-slate-200' : 'ml-auto bg-white/10 border border-white/14 text-slate-200'}`}>
                          <div className="text-[9.5px] text-slate-500 mb-0.5 flex items-center gap-1.5">{m.direction === 'inbound' ? 'incoming' : 'you'} · {fmtDateTime(m.sentAt)}</div>
                          {m.content || m.text}
                        </div>
                      ))}
                      {!c.messages?.length && <p className="text-[11px] text-slate-600 text-center py-2">No messages in this thread.</p>}
                    </div>
                    <div className="p-2.5 border-t border-white/6 flex items-center gap-2">
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

          {/* Momence */}
          <section className="lead-section">
            <div className="flex items-center gap-2 mb-3">
              <Link2 size={14} className="text-emerald-400" />
              <h3 className="font-display font-semibold text-white text-[13px]">Momence · sales & class history</h3>
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
                    </div>
                    <p className="text-[11px] text-slate-500">Looks up this member on Momence by {lead.email ? 'email' : ''}{lead.email && lead.phone ? ' or ' : ''}{lead.phone ? 'phone' : ''} — no member ID needed.</p>
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
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
                    <Stat label="Home location" value={m.member.homeLocationName || m.member.homeLocation || m.member.locationName || loc?.name?.split(',')[0] || '—'} />
                    <Stat label="Sessions completed" value={classesAttended} />
                    <Stat label="Sessions cancelled" value={classesCancelled} />
                    <Stat label="Active plans" value={m.memberships.length} />
                    <Stat label="First seen" value={fmtDate(m.member.firstSeen)} />
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                  <InfoTile label="Momence member" value={[m.member?.firstName, m.member?.lastName].filter(Boolean).join(' ') || lead.fullName} sub={`#${lead.memberId || m.member?.id || '—'}`} />
                  <InfoTile label="Contact context" value={m.member?.email || lead.email || '—'} sub={m.member?.phoneNumber || m.member?.phone || lead.phone || '—'} />
                  <InfoTile label="Visit context" value={`${m.member?.visits?.total ?? classesAttended} total visits`} sub={`Last visit ${fmtDate(m.member?.visits?.lastVisit || m.member?.lastSeen || m.member?.lastVisit)}`} />
                  <InfoTile label="Membership context" value={(m.memberships || []).find(p => !p.isFrozen)?.name || 'No active plan'} sub={`${m.memberships?.length || 0} active/linked membership records`} />
                </div>
                {m.customFields && Object.keys(m.customFields).length > 0 && (
                  <div className="rounded-xl bg-white/[0.03] border border-white/8 p-3 mb-3">
                    <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Custom fields</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {Object.entries(m.customFields).slice(0, 8).map(([key, value]) => <InfoTile key={key} label={key} value={String(value || '—')} />)}
                    </div>
                  </div>
                )}
                {m.tags && m.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    {m.tags.map((t, i) => <span key={i} className="chip bg-emerald-400/10 text-emerald-300 border border-emerald-400/20"><Tags size={10} />{t}</span>)}
                  </div>
                )}

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
                <p className="text-[10.5px] text-slate-600 mt-2 flex items-center gap-1"><RefreshCw size={10} /> Synced {timeAgo(lead.momenceSyncedAt)}</p>
              </div>
            )}
          </section>

          {/* remarks */}
          <section className="lead-section">
            <h3 className="font-display font-semibold text-white text-[13px] mb-2">Remarks</h3>
            <textarea className="input resize-none" rows={3} value={remarkDraft} onChange={e => setRemarkDraft(e.target.value)} placeholder="Notes from conversations…" />
            <button className="btn btn-ghost !py-1.5 !text-[12px] mt-2" onClick={() => remarkDraft !== lead.remarks && patch({ remarks: remarkDraft }, 'Remarks updated')}>Save remarks</button>
          </section>

          {/* follow-ups */}
          <section className="lead-section lead-section-last">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare size={14} className="text-amber-400" />
              <h3 className="font-display font-semibold text-white text-[13px]">Follow-up timeline</h3>
              <span className="chip ml-auto bg-white/5 border border-white/10 text-slate-400">{realFollowUps.length}</span>
            </div>
            <div className="space-y-0 mb-4">
              {realFollowUps.slice().reverse().map((f, i) => (
                <div key={f.id || i} className="relative pl-5 pb-4 border-l border-white/10 last:border-0 last:pb-0">
                  <span className={`absolute left-[-5px] top-1 w-2.5 h-2.5 rounded-full ${f.done ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <div className="text-[11px] text-slate-500 flex items-center gap-2">
                    <span className="mono">{fmtDate(f.date)}</span>
                    {f.done && <span className="flex items-center gap-0.5 text-emerald-400"><CheckCircle2 size={11} /> done</span>}
                    {!f.done && f.date && f.date < todayStr && <span className="chip !px-1.5 !py-0.5 text-[9px] bg-rose-500/20 text-rose-300">overdue</span>}
                  </div>
                  {f.comments && f.comments !== '-' && <p className="text-[12.5px] text-slate-300 mt-0.5 leading-relaxed">{f.comments}</p>}
                </div>
              ))}
              {!realFollowUps.length && <p className="text-[12px] text-slate-500 mb-3">No follow-ups logged yet.</p>}
            </div>
            <form onSubmit={addFollowUp} className="space-y-2">
              <div className="flex gap-2">
                <input className="input !py-1.5" type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} />
                <input className="input !py-1.5" name="comments" ref={commentsRef} placeholder="Add a follow-up note…" />
              </div>
              <button className="btn btn-primary !py-1.5 !text-[12px] w-full" type="submit"><CalendarPlus size={14} /> Log follow-up</button>
            </form>
            {lead.ai?.followupSuggestions?.length > 0 && (
              <div className="mt-3">
                <div className="text-[10.5px] uppercase tracking-wider lead-accent font-semibold mb-1.5 flex items-center gap-1"><Sparkles size={10} /> AI suggested messages — tap to use</div>
                <div className="space-y-1.5">
                  {lead.ai.followupSuggestions.map((s, i) => (
                    <button key={i} className="w-full text-left card !rounded-xl px-2.5 py-2 hover:bg-white/5 transition-colors" onClick={() => fillSuggestion(s)}>
                      <span className="chip !px-1.5 !py-0.5 text-[9.5px] uppercase bg-white/5 border border-white/10 text-slate-400">{s.label}</span>
                      <span className="block text-[11.5px] text-slate-300 mt-1 leading-relaxed">“{s.text}”</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
        </div>
      </aside>
      </div>
      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} lead={lead} />
      <RespondioTemplateModal open={templateOpen} onClose={() => setTemplateOpen(false)} lead={lead} />
    </>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-black/20 border border-white/8 px-3 py-2 text-center">
      <div className="font-display text-[15px] font-bold text-white mono">{value}</div>
      <div className="text-[9.5px] uppercase tracking-wider text-slate-500 mt-0.5">{label}</div>
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
    <div className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
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
    <div>
      <div className="flex gap-1.5 mb-3">
        {tabs.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold transition-colors ${active === t.key ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`} onClick={() => setActive(t.key)}>
              <Icon size={12} /> {t.label}
            </button>
          )
        })}
      </div>
      {activeChild}
    </div>
  )
}
