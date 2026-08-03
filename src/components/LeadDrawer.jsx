import React, { useEffect, useMemo, useState } from 'react'
import {
  X, Phone, Mail, MapPin, Sparkles, CalendarPlus, RefreshCw, Link2,
  CheckCircle2, Send, Clock, Lightbulb, TrendingUp, Tags, Receipt,
  Award, MessageSquare, ChevronDown, Bot, MessageCircle, Loader2, Inbox
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { Avatar, ScorePill, Spinner } from '../ui.jsx'
import { fmtDate, fmtDateTime, timeAgo, stageClass, riskClass, money } from '../lib.js'
import ComposeModal from './ComposeModal.jsx'

const R_CHANNELS = { whatsapp: '#34d399', sms: '#fbbf24', email: '#a78bfa', call: '#38bdf8' }

export default function LeadDrawer() {
  const { boot, lookup, drawerLeadId, closeLead, refreshData, toast, dataVersion } = useApp()
  const [memberIdInput, setMemberIdInput] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [remarkDraft, setRemarkDraft] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [enriching, setEnriching] = useState(false)
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
  useEffect(() => { setSyncError('') }, [drawerLeadId])

  const doEnrich = async () => {
    setEnriching(true)
    try {
      await api.post(`/api/leads/${lead.id}/enrich`)
      toast('GPT intelligence updated')
      refreshData(); reload()
    } catch (e) { toast(e.message, 'error') }
    finally { setEnriching(false) }
  }

  const loc = lead ? lookup.locById[lead.locationId] : null
  const owner = lead ? lookup.asnById[lead.associateId] : null
  const ownerOptions = useMemo(() =>
    (boot?.associates || []).filter(a => !lead || a.locationId === lead.locationId || a.active),
    [boot, lead]
  )

  if (!drawerLeadId) return null

  if (!lead) {
    return (
      <div className="fixed inset-0 z-[80] flex justify-end">
        <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={closeLead} />
        <aside className="relative w-full max-w-[580px] h-full bg-[#0b0e1a] border-l border-white/10 flex items-center justify-center">
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

  const doSync = async () => {
    let memberId = lead.memberId
    if (!memberId && memberIdInput.trim()) {
      await patch({ memberId: memberIdInput.trim() }, 'Member ID saved')
      memberId = memberIdInput.trim()
    }
    if (!memberId) { setSyncError('Enter a Momence member ID first.'); return }
    setSyncing(true); setSyncError('')
    try {
      await api.post(`/api/momence/sync/${lead.id}`)
      toast('Momence profile synced')
      refreshData(); reload()
    } catch (e) { setSyncError(e.message); toast(e.message, 'error') }
    finally { setSyncing(false) }
  }

  const m = lead.momence
  const classesAttended = m?.classHistory?.filter(c => c.checkedIn).length || 0

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
      <aside className="relative w-full max-w-[580px] h-full bg-[#0b0e1a] border-l border-white/10 flex flex-col shadow-2xl" style={{ animation: 'slideIn .2s ease' }}>
        {/* header */}
        <div className="px-6 pt-5 pb-4 border-b border-white/8">
          <div className="flex items-start gap-3">
            <Avatar name={lead.fullName} color={owner?.color} size={46} />
            <div className="flex-1 min-w-0">
              <h2 className="font-display text-[18px] font-bold text-white truncate">{lead.fullName}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[12px] text-slate-400">
                <span className="flex items-center gap-1"><Phone size={11} />{lead.phone || '—'}</span>
                <span className="flex items-center gap-1 truncate"><Mail size={11} />{lead.email}</span>
              </div>
            </div>
            <button className="btn btn-ghost !p-2" onClick={closeLead}><X size={16} /></button>
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
            {owner && <span className="flex items-center gap-1"><Avatar name={owner.name} color={owner.color} size={14} /> {owner.name}</span>}
            <span className="ml-auto">{lead.memberId ? `Momence #${lead.memberId}` : 'No member link'}</span>
          </div>

          <button
            className="btn btn-primary !py-1.5 !text-[12px] w-full mt-3"
            onClick={() => setComposeOpen(true)}
          >
            <MessageCircle size={13} /> Send message via Respond.io
          </button>
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
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-5">
          {/* AI panel */}
          <section className="card !rounded-2xl p-4 border-fuchsia-400/15" style={{ background: 'linear-gradient(135deg, rgba(217,70,239,0.08), rgba(244,63,94,0.04))' }}>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={14} className="text-fuchsia-400" />
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
                <div className="flex items-center gap-2"><Send size={12} className="text-cyan-400" /> Next move: <b className="text-slate-200">{lead.ai.nextAction.label}</b></div>
              </div>
            </div>
            <div className="rounded-xl bg-black/20 border border-white/8 p-3">
              <div className="text-[11px] font-semibold text-fuchsia-300 mb-1 flex items-center gap-1.5"><Lightbulb size={12} /> Suggested action</div>
              <p className="text-[12.5px] text-slate-200 leading-relaxed">{lead.ai.nextAction.text}</p>
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {(lead.ai?.insights || []).map((ins, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11.5px] text-slate-400"><span className="text-fuchsia-400 mt-0.5">•</span>{ins}</div>
              ))}
            </div>
          </section>

          {/* summary */}
          <section className="card !rounded-2xl p-4">
            <h3 className="font-display font-semibold text-white text-[13px] mb-2">AI summary</h3>
            <p className="text-[12.5px] text-slate-300 leading-relaxed">{lead.ai.summary}</p>
          </section>

          {/* GPT enrichment */}
          <section className="card !rounded-2xl p-4 border-cyan-400/15">
            <div className="flex items-center gap-2 mb-3">
              <Bot size={14} className="text-cyan-400" />
              <h3 className="font-display font-semibold text-white text-[13px]">GPT deep-dive</h3>
              {lead.gpt?.generatedAt && <span className="chip ml-auto bg-white/5 border border-white/10 text-slate-400">{timeAgo(lead.gpt.generatedAt)}</span>}
            </div>

            {lead.gpt ? (
              <div className="space-y-2.5">
                <div className="rounded-xl bg-black/20 border border-white/8 p-3">
                  <div className="text-[11px] font-semibold text-cyan-300 mb-1 flex items-center gap-1.5"><Lightbulb size={12} /> GPT summary</div>
                  <p className="text-[12.5px] text-slate-200 leading-relaxed">{lead.gpt.summary}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={`chip capitalize ${lead.gpt.sentiment === 'positive' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-400/20' : lead.gpt.sentiment === 'negative' ? 'bg-rose-500/10 text-rose-300 border border-rose-400/20' : 'bg-white/5 border border-white/10 text-slate-300'}`}>
                    <TrendingUp size={10} /> sentiment: {lead.gpt.sentiment}
                  </span>
                  <span className="chip bg-white/5 border border-white/10 text-slate-300"><Clock size={10} /> best time: {lead.gpt.bestContactTime || '—'}</span>
                  {lead.gpt.nextAction && <span className="chip bg-cyan-500/10 text-cyan-300 border border-cyan-400/20"><Send size={10} /> {lead.gpt.nextAction.label}</span>}
                </div>
                {lead.gpt.nextAction?.text && <p className="text-[12px] text-slate-300 leading-relaxed">{lead.gpt.nextAction.text}</p>}
                {(lead.gpt.insights || []).length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {(lead.gpt.insights || []).map((ins, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[11.5px] text-slate-400"><span className="text-cyan-400 mt-0.5">•</span>{ins}</div>
                    ))}
                  </div>
                )}
                {(lead.gpt.followupSuggestions || []).length > 0 && (
                  <div>
                    <div className="text-[10.5px] uppercase tracking-wider text-cyan-300 font-semibold mb-1.5 flex items-center gap-1"><Sparkles size={10} /> GPT suggested messages</div>
                    <div className="space-y-1.5">
                      {lead.gpt.followupSuggestions.map((s, i) => (
                        <button key={i} className="w-full text-left card !rounded-xl px-2.5 py-2 hover:bg-white/5 transition-colors" onClick={() => { setComposeOpen(true) }}>
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
                  {!boot?.settings?.gpt?.configured && !boot?.settings?.gpt?.apiKey && (
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
          <section className="card !rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle size={14} className={boot?.settings?.respondio?.configured ? 'text-emerald-400' : 'text-slate-500'} />
              <h3 className="font-display font-semibold text-white text-[13px]">Respond.io conversation</h3>
              {boot?.settings?.respondio?.configured && <span className="chip ml-auto bg-white/5 border border-white/10 text-slate-400">{conv?.conversations?.length || 0} threads</span>}
            </div>

            {!boot?.settings?.respondio?.configured ? (
              <div className="text-[12.5px] text-slate-400 flex items-center gap-2"><span>Connect Respond.io in Settings → Integrations to view and send messages.</span></div>
            ) : conv?.error ? (
              <p className="text-[12px] text-rose-400">{conv.error}</p>
            ) : !conv || !conv.conversations?.length ? (
              <div className="text-[12px] text-slate-500 flex items-center gap-2"><Inbox size={14} /> No conversations found for this lead yet.</div>
            ) : (
              <div className="space-y-3">
                {conv.conversations.map(c => (
                  <div key={c.id} className="rounded-xl bg-white/[0.02] border border-white/6 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/6">
                      <span className="chip !py-0.5 !px-2 text-[9.5px] uppercase" style={{ background: `${R_CHANNELS[c.channel] || '#888'}1c`, color: R_CHANNELS[c.channel] || '#fff', border: `1px solid ${(R_CHANNELS[c.channel] || '#888')}33` }}>{c.channel}</span>
                      <span className="text-[10.5px] text-slate-500">{c.status || ''}</span>
                      <button className="ml-auto btn btn-ghost !p-1.5 !text-[11px]" onClick={() => setComposeOpen(true)}><Send size={11} /> Reply</button>
                    </div>
                    <div className="max-h-[240px] overflow-y-auto scrollbar-thin p-2.5 space-y-1.5">
                      {(c.messages || []).slice().reverse().map(m => (
                        <div key={m.id} className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-[12px] leading-relaxed ${m.direction === 'inbound' ? 'bg-white/6 border border-white/8 text-slate-200' : 'ml-auto bg-cyan-500/10 border border-cyan-400/20 text-slate-200'}`}>
                          <div className="text-[9.5px] text-slate-500 mb-0.5 flex items-center gap-1.5">{m.direction === 'inbound' ? 'incoming' : 'you'} · {fmtDateTime(m.sentAt)}</div>
                          {m.content || m.text}
                        </div>
                      ))}
                      {!c.messages?.length && <p className="text-[11px] text-slate-600 text-center py-2">No messages in this thread.</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Momence */}
          <section className="card !rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Link2 size={14} className="text-emerald-400" />
              <h3 className="font-display font-semibold text-white text-[13px]">Momence · sales & class history</h3>
            </div>

            {!boot?.settings?.momence?.configured ? (
              <div className="text-[12.5px] text-slate-400 flex items-center gap-2"><span>Connect Momence in Settings to pull sales and class history automatically.</span></div>
            ) : !m ? (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <input className="input !py-1.5" placeholder="Momence member ID (e.g. 15875720)" value={memberIdInput} onChange={e => setMemberIdInput(e.target.value)} />
                  <button className="btn btn-soft !py-2" onClick={doSync} disabled={syncing}>{syncing ? <Spinner size={14} /> : <RefreshCw size={14} />} Sync</button>
                </div>
                {lead.memberId && <p className="text-[11.5px] text-slate-500">Linked to member #{lead.memberId} — click sync to map history.</p>}
                {syncError && <p className="text-[11.5px] text-rose-400 mt-1">{syncError}</p>}
              </div>
            ) : (
              <div>
                {m.member && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <Stat label="Total visits" value={m.member.visits?.total ?? '—'} />
                    <Stat label="Classes attended" value={classesAttended} />
                    <Stat label="Active plans" value={m.memberships.length} />
                    <Stat label="First seen" value={fmtDate(m.member.firstSeen)} />
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
                    { key: 'plans', label: `Plans (${m.memberships?.length || 0})`, icon: CalendarPlus }
                  ]}>
                  <div key="sales">
                    {(m?.salesHistory || []).slice(0, 8).map((s, i) => (
                      <Row key={i} icon={<Receipt size={13} className="text-emerald-400" />} title={s.itemName} sub={s.itemType} right={money(s.totalInCurrency)} meta={fmtDate(s.saleDate)} />
                    ))}
                    {!m.salesHistory?.length && <EmptyNote text="No sales records found for this member." />}
                  </div>
                  <div key="classes">
                    {(m?.classHistory || []).slice(0, 8).map((c, i) => (
                      <Row key={i} icon={<Award size={13} className={c.checkedIn ? 'text-emerald-400' : 'text-slate-500'} />} title={c.name} sub={[c.type, c.teacher].filter(Boolean).join(' · ')} right={c.checkedIn ? 'Attended' : 'Booked'} meta={fmtDateTime(c.startsAt)} />
                    ))}
                    {!m.classHistory?.length && <EmptyNote text="No class history for this member yet." />}
                  </div>
                  <div key="plans">
                    {(m?.memberships || []).map((p, i) => (
                      <Row key={i} icon={<CalendarPlus size={13} className={p.isFrozen ? 'text-amber-400' : 'text-cyan-400'} />} title={p.name} sub={p.type.replace(/-/g, ' ')} right={p.isFrozen ? 'Frozen' : (p.endDate ? `until ${fmtDate(p.endDate)}` : 'active')} meta={`${p.eventCreditsLeft ?? p.usedSessions ?? '—'} credits used`} />
                    ))}
                    {!m.memberships?.length && <EmptyNote text="No active memberships." />}
                  </div>
                </Tabbed>
                <p className="text-[10.5px] text-slate-600 mt-2 flex items-center gap-1"><RefreshCw size={10} /> Synced {timeAgo(lead.momenceSyncedAt)}</p>
              </div>
            )}
          </section>

          {/* remarks */}
          <section className="card !rounded-2xl p-4">
            <h3 className="font-display font-semibold text-white text-[13px] mb-2">Remarks</h3>
            <textarea className="input resize-none" rows={3} value={remarkDraft} onChange={e => setRemarkDraft(e.target.value)} placeholder="Notes from conversations…" />
            <button className="btn btn-ghost !py-1.5 !text-[12px] mt-2" onClick={() => remarkDraft !== lead.remarks && patch({ remarks: remarkDraft }, 'Remarks updated')}>Save remarks</button>
          </section>

          {/* follow-ups */}
          <section className="card !rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare size={14} className="text-amber-400" />
              <h3 className="font-display font-semibold text-white text-[13px]">Follow-up timeline</h3>
              <span className="chip ml-auto bg-white/5 border border-white/10 text-slate-400">{lead.followUps?.length || 0}</span>
            </div>
            <div className="space-y-0 mb-4">
              {(lead.followUps || []).slice().reverse().map((f, i) => (
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
              {!lead.followUps?.length && <p className="text-[12px] text-slate-500 mb-3">No follow-ups logged yet.</p>}
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
                <div className="text-[10.5px] uppercase tracking-wider text-fuchsia-300 font-semibold mb-1.5 flex items-center gap-1"><Sparkles size={10} /> AI suggested messages — tap to use</div>
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
      </aside>
      </div>
      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} lead={lead} />
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

function Tabbed({ tabs, children }) {
  const [active, setActive] = React.useState(tabs[0].key)
  const activeTab = tabs.find(t => t.key === active)
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
      {React.Children.toArray(children).find(c => c.key === activeTab.key)}
    </div>
  )
}
