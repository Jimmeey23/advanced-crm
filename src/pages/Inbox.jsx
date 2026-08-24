import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Send, Sparkles, MessageCircle, Phone, Mail, MessageSquareText,
  CheckCircle2, Circle, ListFilter, BookmarkPlus
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { api, API_BASE } from '../api.js'
import { Avatar, Spinner, Empty } from '../ui.jsx'
import { getLibrary, fromApiTemplate } from '../components/RespondioTemplateModal.jsx'

const CHANNEL_META = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, color: '#34d399' },
  sms: { label: 'SMS', icon: MessageSquareText, color: '#fbbf24' },
  email: { label: 'Email', icon: Mail, color: '#a78bfa' },
  call: { label: 'Call', icon: Phone, color: '#38bdf8' }
}

function timeAgo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH}h`
  const diffD = Math.round(diffH / 24)
  if (diffD < 7) return `${diffD}d`
  return d.toLocaleDateString()
}

function ConversationRow({ row, active, onClick }) {
  const meta = CHANNEL_META[row.lastMessage?.channel] || CHANNEL_META.whatsapp
  const Icon = meta.icon
  const preview = row.lastMessage?.templateName
    ? `Template: ${row.lastMessage.templateName}`
    : (row.lastMessage?.content || 'No messages yet')
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors ${
        active ? 'bg-white/10 border border-white/15' : 'hover:bg-white/5 border border-transparent'
      }`}
    >
      <Avatar name={row.lead.fullName} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] font-semibold text-white truncate">{row.lead.fullName}</span>
          <span className="text-[10px] text-slate-500 shrink-0">{timeAgo(row.lastMessageAt)}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Icon size={11} style={{ color: meta.color }} className="shrink-0" />
          <span className={`text-[11.5px] truncate ${row.unreadCount ? 'text-slate-200 font-medium' : 'text-slate-500'}`}>
            {row.lastMessage?.direction === 'outbound' ? 'You: ' : ''}{preview}
          </span>
        </div>
      </div>
      {row.unreadCount > 0 && (
        <span className="chip notification-count !px-1.5 !py-0.5 text-[10px] shrink-0">{row.unreadCount}</span>
      )}
    </button>
  )
}

function MessageBubble({ msg }) {
  const outbound = msg.direction === 'outbound'
  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-[13px] ${
        outbound ? 'bg-blue-500/15 border border-blue-500/25 text-slate-100' : 'bg-white/5 border border-white/10 text-slate-200'
      }`}>
        {msg.templateName && (
          <div className="text-[10.5px] uppercase tracking-wider text-emerald-400 font-semibold mb-1 flex items-center gap-1">
            <Sparkles size={10} /> Template: {msg.templateName}
          </div>
        )}
        <div className="whitespace-pre-wrap">{msg.content || (msg.templateName ? '' : '(no content)')}</div>
        <div className="text-[10px] text-slate-500 mt-1 text-right">{timeAgo(msg.sentAt)}</div>
      </div>
    </div>
  )
}

export default function Inbox() {
  const { boot, toast } = useApp()
  const [rows, setRows] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [selectedLeadId, setSelectedLeadId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingThread, setLoadingThread] = useState(false)

  const [q, setQ] = useState('')
  const [studio, setStudio] = useState('')
  const [associate, setAssociate] = useState('')
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const [channelToSend, setChannelToSend] = useState('whatsapp')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [showSnippets, setShowSnippets] = useState(false)
  const [snippets, setSnippets] = useState([])

  const [apiTemplates, setApiTemplates] = useState(null)
  const manualTemplates = useMemo(() => getLibrary(boot?.settings?.respondio?.wabaTemplates), [boot])
  const templates = apiTemplates?.length ? apiTemplates : manualTemplates
  const [templateId, setTemplateId] = useState('')
  const [templateValues, setTemplateValues] = useState([])

  const threadEndRef = useRef(null)

  const loadList = async () => {
    setLoadingList(true)
    try {
      const r = await api.get('/api/inbox?' + new URLSearchParams({
        ...(q ? { q } : {}), ...(studio ? { studio } : {}), ...(associate ? { associate } : {}),
        ...(channel ? { channel } : {}), ...(status ? { status } : {}), ...(unreadOnly ? { unread: '1' } : {})
      }))
      setRows(r.conversations || [])
    } catch (e) { /* toast avoided on background refresh */ } finally { setLoadingList(false) }
  }

  const loadSnippets = () => api.get('/api/inbox/snippets').then(setSnippets).catch(() => {})

  useEffect(() => { loadList() }, [q, studio, associate, channel, status, unreadOnly])
  useEffect(() => { loadSnippets() }, [])

  const selected = rows.find(r => r.leadId === selectedLeadId) || null

  const openThread = async (leadId) => {
    setSelectedLeadId(leadId)
    setLoadingThread(true)
    setText('')
    try {
      const r = await api.get(`/api/inbox/${leadId}/messages`)
      setMessages(r.messages || [])
      await api.post(`/api/inbox/${leadId}/read`)
      setRows(curr => curr.map(row => row.leadId === leadId ? { ...row, unreadCount: 0 } : row))
    } finally { setLoadingThread(false) }
  }

  // Real-time: reuse the app-wide SSE channel already open in store.jsx by
  // listening for the same 'respondio-message' broadcast type via a second,
  // Inbox-scoped EventSource — refetch just the affected thread + the list
  // instead of the app's full bootstrap refresh.
  useEffect(() => {
    const es = new EventSource(API_BASE + '/api/events')
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data)
        if (data.type !== 'respondio-message') return
        loadList()
        if (data.leadId && data.leadId === selectedLeadId) openThread(selectedLeadId)
      } catch (e) { /* ignore malformed event */ }
    }
    es.onerror = () => { /* browser auto-reconnects */ }
    return () => es.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeadId])

  useEffect(() => { threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    if (channelToSend !== 'whatsapp' || !selected) return
    api.get('/api/respondio/templates')
      .then(r => setApiTemplates(Array.isArray(r.templates) ? r.templates.map(fromApiTemplate) : []))
      .catch(() => setApiTemplates([]))
  }, [channelToSend, selected?.leadId])

  useEffect(() => {
    if (channelToSend !== 'whatsapp') return
    const initial = templates[0]
    setTemplateId(initial?.id || '')
    setTemplateValues((initial?.parameters || []).map(() => ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelToSend, apiTemplates])

  const selectedTemplate = templates.find(t => t.id === templateId) || templates[0]
  const setTemplateValue = (idx, v) => setTemplateValues(curr => curr.map((x, i) => (i === idx ? v : x)))

  const alreadyMessaged = messages.some(m => m.direction === 'outbound')
  const mustUseTemplate = channelToSend === 'whatsapp' && !alreadyMessaged

  const send = async () => {
    if (!selected) return
    setSending(true); setError('')
    try {
      if (mustUseTemplate) {
        if (!selectedTemplate) throw new Error('Select a WhatsApp template before sending.')
        await api.post('/api/respondio/send', {
          leadId: selected.leadId, channel: 'whatsapp', useTemplate: true,
          template: {
            id: selectedTemplate.id, name: selectedTemplate.name, language: selectedTemplate.language || 'en',
            namespace: selectedTemplate.namespace || '', category: selectedTemplate.category || '',
            channel: 'whatsapp', channelId: selectedTemplate.channelId, rawComponents: selectedTemplate.rawComponents || [],
            parameters: templateValues
          },
          logFollowUp: true
        })
      } else {
        if (!text.trim()) throw new Error('Write a message first.')
        await api.post('/api/respondio/send', { leadId: selected.leadId, channel: channelToSend, message: text.trim(), logFollowUp: true })
      }
      setText('')
      toast('Message sent')
      openThread(selected.leadId)
      loadList()
    } catch (e) {
      setError(e.message)
    } finally { setSending(false) }
  }

  const toggleStatus = async () => {
    if (!selected) return
    const next = selected.status === 'closed' ? 'open' : 'closed'
    await api.post(`/api/inbox/${selected.leadId}/status`, { status: next })
    setRows(curr => curr.map(r => r.leadId === selected.leadId ? { ...r, status: next } : r))
  }

  const setAssignee = async (associateId) => {
    if (!selected) return
    await api.post(`/api/inbox/${selected.leadId}/assign`, { associateId })
    setRows(curr => curr.map(r => r.leadId === selected.leadId ? { ...r, assigneeId: associateId } : r))
  }

  return (
    <div className="p-6 h-[calc(100vh-74px-56px)] flex gap-4">
      {/* Conversation list */}
      <div className="w-[320px] shrink-0 flex flex-col card !rounded-2xl !p-0 overflow-hidden">
        <div className="p-3 border-b border-white/8 space-y-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="input !pl-8 !py-1.5 !text-[12px]" placeholder="Search conversations…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`btn btn-ghost !py-1.5 !px-2.5 !text-[11.5px] flex-1 ${showFilters ? '!bg-white/15' : ''}`}
              onClick={() => setShowFilters(v => !v)}
            >
              <ListFilter size={12} /> Filters
            </button>
            <button
              className={`btn btn-ghost !py-1.5 !px-2.5 !text-[11.5px] ${unreadOnly ? '!bg-white/15' : ''}`}
              onClick={() => setUnreadOnly(v => !v)}
            >
              Unread
            </button>
          </div>
          {showFilters && (
            <div className="space-y-1.5">
              <select className="input select-strong !py-1.5 !text-[12px]" value={studio} onChange={e => setStudio(e.target.value)}>
                <option value="">All studios</option>
                {(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <select className="input select-strong !py-1.5 !text-[12px]" value={associate} onChange={e => setAssociate(e.target.value)}>
                <option value="">All owners</option>
                {(boot?.associates || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <div className="flex gap-1.5">
                <select className="input select-strong !py-1.5 !text-[12px] flex-1" value={channel} onChange={e => setChannel(e.target.value)}>
                  <option value="">All channels</option>
                  {Object.entries(CHANNEL_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>
                <select className="input select-strong !py-1.5 !text-[12px] flex-1" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="">Any status</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-0.5">
          {loadingList && <div className="flex justify-center py-8"><Spinner size={18} /></div>}
          {!loadingList && !rows.length && (
            <div className="pt-8"><Empty icon={<MessageCircle size={20} />} title="No conversations" subtitle="Messages from Respond.io will show up here automatically." /></div>
          )}
          {rows.map(row => (
            <ConversationRow key={row.leadId} row={row} active={row.leadId === selectedLeadId} onClick={() => openThread(row.leadId)} />
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col card !rounded-2xl !p-0 overflow-hidden min-w-0">
        {!selected && (
          <div className="flex-1 flex items-center justify-center">
            <Empty icon={<MessageCircle size={20} />} title="Select a conversation" subtitle="Pick a lead on the left to view the full two-way conversation." />
          </div>
        )}
        {selected && (
          <>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/8">
              <Avatar name={selected.lead.fullName} size={34} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-white truncate">{selected.lead.fullName}</div>
                <div className="text-[11px] text-slate-500 truncate">{selected.lead.phone || selected.lead.email}</div>
              </div>
              <select
                className="input select-strong !py-1.5 !text-[11.5px] !w-[150px]"
                value={selected.assigneeId || ''}
                onChange={e => setAssignee(e.target.value || null)}
                title="Assign conversation"
              >
                <option value="">Unassigned</option>
                {(boot?.associates || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button className="btn btn-ghost !py-1.5 !px-2.5 !text-[11.5px]" onClick={toggleStatus}>
                {selected.status === 'closed' ? <><Circle size={12} /> Reopen</> : <><CheckCircle2 size={12} /> Close</>}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-2.5">
              {loadingThread && <div className="flex justify-center py-8"><Spinner size={18} /></div>}
              {!loadingThread && messages.map(m => <MessageBubble key={m.id} msg={m} />)}
              <div ref={threadEndRef} />
            </div>

            <div className="border-t border-white/8 p-3 space-y-2">
              <div className="flex gap-1.5">
                {Object.entries(CHANNEL_META).map(([k, m]) => {
                  const Icon = m.icon
                  const active = channelToSend === k
                  return (
                    <button
                      key={k}
                      onClick={() => setChannelToSend(k)}
                      className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                        active ? 'border-blue-500/30 bg-blue-500/10 text-white' : 'border-white/10 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Icon size={11} style={{ color: active ? m.color : undefined }} /> {m.label}
                    </button>
                  )
                })}
              </div>

              {mustUseTemplate ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10.5px] text-slate-500"><Sparkles size={11} /> First WhatsApp message must use an approved template</div>
                  <select className="input select-strong !py-1.5 !text-[12px]" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.label || t.name}</option>)}
                  </select>
                  {(selectedTemplate?.parameters || []).map((label, idx) => (
                    <input
                      key={idx}
                      className="input !py-1.5 !text-[12px]"
                      placeholder={label || `Value ${idx + 1}`}
                      value={templateValues[idx] || ''}
                      onChange={e => setTemplateValue(idx, e.target.value)}
                    />
                  ))}
                </div>
              ) : (
                <div className="relative">
                  <textarea
                    className="input resize-none !text-[13px]"
                    rows={2}
                    placeholder={`Type a ${CHANNEL_META[channelToSend].label} message…`}
                    value={text}
                    onChange={e => setText(e.target.value)}
                  />
                </div>
              )}

              {error && <p className="text-[11.5px] text-rose-400">{error}</p>}

              <div className="flex items-center justify-between">
                <div className="relative">
                  <button className="btn btn-ghost !py-1.5 !px-2.5 !text-[11.5px]" onClick={() => setShowSnippets(v => !v)}>
                    <BookmarkPlus size={12} /> Snippets
                  </button>
                  {showSnippets && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowSnippets(false)} />
                      <div className="absolute bottom-full left-0 mb-2 w-[280px] card !rounded-xl p-2 z-20 shadow-2xl space-y-1 max-h-[240px] overflow-y-auto scrollbar-thin">
                        {snippets.map(s => (
                          <button
                            key={s.id}
                            className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/10 text-[11.5px] text-slate-200"
                            onClick={() => { setText(prev => (prev ? prev + ' ' : '') + s.text); setChannelToSend(c => c === 'whatsapp' && mustUseTemplate ? 'sms' : c); setShowSnippets(false) }}
                          >
                            <div className="font-semibold text-[10.5px] text-slate-400 uppercase tracking-wide">{s.label}</div>
                            {s.text}
                          </button>
                        ))}
                        {!snippets.length && <p className="text-[11px] text-slate-500 px-2 py-1">No snippets — add one below.</p>}
                        <SnippetManagerInline onAdded={loadSnippets} />
                      </div>
                    </>
                  )}
                </div>
                <button className="btn btn-primary !py-1.5 !px-3 !text-[12px]" onClick={send} disabled={sending}>
                  {sending ? <Spinner size={13} /> : <Send size={13} />} Send
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SnippetManagerInline({ onAdded }) {
  const [label, setLabel] = useState('')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const add = async () => {
    if (!text.trim()) return
    setSaving(true)
    try {
      await api.post('/api/inbox/snippets', { label: label.trim() || 'Snippet', text: text.trim() })
      setLabel(''); setText('')
      onAdded()
    } finally { setSaving(false) }
  }
  return (
    <div className="border-t border-white/8 pt-1.5 mt-1 space-y-1">
      <input className="input !py-1 !text-[11px]" placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} />
      <textarea className="input !py-1 !text-[11px] resize-none" rows={2} placeholder="New snippet text" value={text} onChange={e => setText(e.target.value)} />
      <button className="btn btn-primary w-full !py-1 !text-[11px]" onClick={add} disabled={saving || !text.trim()}>
        {saving ? <Spinner size={11} /> : <BookmarkPlus size={11} />} Add
      </button>
    </div>
  )
}
