import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Send, Sparkles, MessageCircle, Phone, Mail, MessageSquareText,
  CheckCircle2, Circle, ListFilter, BookmarkPlus, ArrowUpDown, CheckCheck, Check,
  Building2, UserRound, Tag, Info, Ban, Globe2, Languages, Image as ImageIcon,
  FileText, Mic, Clock, UserPlus, X, Headset, RefreshCcw, AlertTriangle
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { Avatar, Spinner, Empty } from '../ui.jsx'
import { getLibrary, fromApiTemplate } from '../components/RespondioTemplateModal.jsx'

const CHANNEL_META = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, color: '#34d399' },
  sms: { label: 'SMS', icon: MessageSquareText, color: '#fbbf24' },
  email: { label: 'Email', icon: Mail, color: '#a78bfa' },
  call: { label: 'Call', icon: Phone, color: '#38bdf8' }
}

const STATUS_TABS = [
  { id: '', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' }
]

const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest activity' },
  { id: 'oldest', label: 'Oldest activity' },
  { id: 'unread', label: 'Unread first' }
]

function sortRows(rows, sort) {
  const copy = [...rows]
  if (sort === 'oldest') return copy.sort((a, b) => (a.lastMessageAt || 0) - (b.lastMessageAt || 0))
  if (sort === 'unread') return copy.sort((a, b) => (b.unreadCount || 0) - (a.unreadCount || 0) || (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
  return copy.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
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

function fullTimestamp(sentAt) {
  if (!sentAt) return ''
  return new Date(sentAt).toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

function dateLabel(sentAt) {
  const d = new Date(sentAt)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}

function sortMessages(list) {
  return [...(list || [])].sort((a, b) => (a.sentAt || 0) - (b.sentAt || 0))
}

const MESSAGE_TYPE_ICON = { image: ImageIcon, file: FileText, document: FileText, audio: Mic, voice: Mic }

function DeliveryTicks({ status }) {
  if (!status) return null
  const s = String(status).toLowerCase()
  if (s === 'failed') return <span className="text-rose-400" title="Failed to deliver">!</span>
  if (s === 'read') return <CheckCheck size={12} className="text-blue-400" />
  if (s === 'delivered') return <CheckCheck size={12} className="text-slate-400" />
  if (s === 'sent') return <Check size={12} className="text-slate-500" />
  return null
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
  const TypeIcon = MESSAGE_TYPE_ICON[String(msg.type || '').toLowerCase()]
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
        {TypeIcon && (
          <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold mb-1 flex items-center gap-1">
            <TypeIcon size={10} /> {msg.type}
          </div>
        )}
        <div className="whitespace-pre-wrap">{msg.content || (msg.templateName || TypeIcon ? '' : '(no content)')}</div>
        <div className="flex items-center justify-end gap-1 mt-1" title={fullTimestamp(msg.sentAt)}>
          <span className="text-[10px] text-slate-500 flex items-center gap-1"><Clock size={9} /> {timeAgo(msg.sentAt)}</span>
          {outbound && <DeliveryTicks status={msg.status} />}
        </div>
      </div>
    </div>
  )
}

function DateSeparator({ sentAt }) {
  return (
    <div className="flex items-center justify-center py-1">
      <span className="text-[10.5px] text-slate-500 bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5">{dateLabel(sentAt)}</span>
    </div>
  )
}

function NewConversationModal({ open, onClose, onCreated }) {
  const [mode, setMode] = useState('search')
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (mode !== 'search' || !q.trim()) { setResults([]); return }
    setSearching(true)
    const t = setTimeout(() => {
      api.get(`/api/respondio/contacts/search?q=${encodeURIComponent(q.trim())}`)
        .then(r => setResults(r.contacts || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 350)
    return () => clearTimeout(t)
  }, [q, mode])

  if (!open) return null

  const createFrom = async (payload) => {
    setSubmitting(true); setError('')
    try {
      const r = await api.post('/api/respondio/contacts', payload)
      onCreated(r.key)
    } catch (e) { setError(e.message) } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="card w-[420px] p-4 space-y-3" onClick={e => e.stopPropagation()} style={{ background: 'var(--tt-bg)' }}>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-white text-[14px]">New conversation</h3>
          <button className="btn btn-ghost !p-1.5" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          <button className={`flex-1 py-1.5 text-[12px] font-semibold transition-colors ${mode === 'search' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-slate-200'}`} onClick={() => setMode('search')}>Search contacts</button>
          <button className={`flex-1 py-1.5 text-[12px] font-semibold border-l border-white/10 transition-colors ${mode === 'new' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-slate-200'}`} onClick={() => setMode('new')}>New contact</button>
        </div>
        {mode === 'search' ? (
          <div className="space-y-2">
            <input className="input !py-1.5 !text-[12px]" placeholder="Search name, phone, or email…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
            <div className="max-h-[220px] overflow-y-auto scrollbar-thin space-y-1">
              {searching && <div className="flex justify-center py-4"><Spinner size={14} /></div>}
              {!searching && q.trim() && !results.length && <p className="text-[11.5px] text-slate-500 text-center py-3">No matches.</p>}
              {results.map(c => (
                <button key={c.id} className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-white/10 flex items-center gap-2" onClick={() => createFrom({ fullName: c.name, email: c.email, phone: c.phone })} disabled={submitting}>
                  <Avatar name={c.name} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-white truncate">{c.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{c.phone || c.email}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input className="input !py-1.5 !text-[12px]" placeholder="Full name" value={fullName} onChange={e => setFullName(e.target.value)} />
            <input className="input !py-1.5 !text-[12px]" placeholder="Phone (with country code)" value={phone} onChange={e => setPhone(e.target.value)} />
            <input className="input !py-1.5 !text-[12px]" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <button className="btn btn-primary w-full !py-1.5 !text-[12px]" onClick={() => createFrom({ fullName, email, phone })} disabled={submitting || (!email.trim() && !phone.trim())}>
              {submitting ? <Spinner size={12} /> : <UserPlus size={12} />} Create & open
            </button>
          </div>
        )}
        {error && <p className="text-[11.5px] text-rose-400">{error}</p>}
      </div>
    </div>
  )
}

export default function Inbox() {
  const { boot, toast, role, associateId } = useApp()
  const [rows, setRows] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [selectedLeadId, setSelectedLeadId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [profile, setProfile] = useState(null)

  const [q, setQ] = useState('')
  const [studio, setStudio] = useState('')
  const [associate, setAssociate] = useState(() => (role === 'agent' && associateId) ? associateId : '')
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [unmatchedOnly, setUnmatchedOnly] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [sort, setSort] = useState('newest')
  const [markingAllRead, setMarkingAllRead] = useState(false)

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
  const [sendMode, setSendMode] = useState('text')

  const threadEndRef = useRef(null)
  const [syncing, setSyncing] = useState(false)
  const autoSyncedRef = useRef(false)
  const [newConvOpen, setNewConvOpen] = useState(false)
  const [agents, setAgents] = useState([])

  useEffect(() => { api.get('/api/respondio/agents').then(r => setAgents(r.agents || [])).catch(() => {}) }, [])

  const loadList = async () => {
    setLoadingList(true)
    try {
      const r = await api.get('/api/inbox?' + new URLSearchParams({
        ...(q ? { q } : {}), ...(studio ? { studio } : {}), ...(associate ? { associate } : {}),
        ...(channel ? { channel } : {}), ...(status ? { status } : {}), ...(unreadOnly ? { unread: '1' } : {})
      }))
      setRows(r.conversations || [])
      return r
    } catch (e) { /* toast avoided on background refresh */ } finally { setLoadingList(false) }
  }

  const loadSnippets = () => api.get('/api/inbox/snippets').then(setSnippets).catch(() => {})

  const [syncingSnippets, setSyncingSnippets] = useState(false)
  const syncSnippets = async () => {
    setSyncingSnippets(true)
    try {
      const r = await api.post('/api/inbox/snippets/sync')
      await loadSnippets()
      toast(`Synced snippets from Respond.io — ${r.added} new, ${r.updated} updated`)
    } catch (e) {
      toast(e.message, 'error')
    } finally { setSyncingSnippets(false) }
  }

  const displayedRows = useMemo(() => {
    const filtered = unmatchedOnly ? rows.filter(r => r.unmatched) : rows
    return sortRows(filtered, sort)
  }, [rows, unmatchedOnly, sort])

  const markAllRead = async () => {
    const unread = displayedRows.filter(r => r.unreadCount > 0)
    if (!unread.length) return
    setMarkingAllRead(true)
    try {
      await Promise.all(unread.map(r => api.post(`/api/inbox/${r.leadId}/read`)))
      setRows(curr => curr.map(r => unread.some(u => u.leadId === r.leadId) ? { ...r, unreadCount: 0 } : r))
    } finally { setMarkingAllRead(false) }
  }

  const syncFromRespondio = async () => {
    setSyncing(true)
    try {
      await api.post('/api/inbox/sync')
      await loadList()
      toast('Synced conversations from Respond.io')
    } catch (e) {
      toast(e.message)
    } finally { setSyncing(false) }
  }

  useEffect(() => { loadList() }, [q, studio, associate, channel, status, unreadOnly])
  useEffect(() => { loadSnippets() }, [])

  // First time the inbox is opened with nothing in the local store yet,
  // pull the existing respond.io conversation history once automatically —
  // otherwise the page looks empty until someone finds the Sync button.
  useEffect(() => {
    if (autoSyncedRef.current || loadingList) return
    if (rows.length === 0 && boot?.integrations?.respondio) {
      autoSyncedRef.current = true
      syncFromRespondio()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingList, rows.length, boot])

  const selected = rows.find(r => r.leadId === selectedLeadId) || null

  const loadProfile = async (leadId) => {
    try {
      const r = await api.get(`/api/inbox/${leadId}/profile`)
      setProfile(r.profile || null)
    } catch (e) { /* enrichment is best-effort */ }
  }

  const openThread = async (leadId) => {
    setSelectedLeadId(leadId)
    setLoadingThread(true)
    setText('')
    setProfile(null)
    setSendMode('text')
    try {
      const r = await api.get(`/api/inbox/${leadId}/messages`)
      setMessages(sortMessages(r.messages))
      await api.post(`/api/inbox/${leadId}/read`)
      setRows(curr => curr.map(row => row.leadId === leadId ? { ...row, unreadCount: 0 } : row))
      loadProfile(leadId)
    } finally { setLoadingThread(false) }
  }

  // Keeps the enriched respond.io profile panel (tags, custom fields,
  // assignee, language/country) reasonably fresh while a conversation stays
  // open, without a live API call on every render.
  useEffect(() => {
    if (!selectedLeadId) return
    const id = setInterval(() => loadProfile(selectedLeadId), 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [selectedLeadId])

  // Real-time: reuse the app-wide SSE channel already open in store.jsx by
  // listening for the same 'respondio-message' broadcast type via a second,
  // Inbox-scoped EventSource — refetch just the affected thread + the list
  // instead of the app's full bootstrap refresh.
  useEffect(() => {
    let es = null
    let cancelled = false
    api.resolveBase().then(base => {
      if (cancelled) return
      es = new EventSource(base + '/api/events')
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data)
          if (data.type !== 'respondio-message') return
          loadList()
          if (data.leadId && data.leadId === selectedLeadId) openThread(selectedLeadId)
        } catch (e) { /* ignore malformed event */ }
      }
      es.onerror = () => { /* browser auto-reconnects */ }
    })
    return () => { cancelled = true; es?.close() }
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

  // WhatsApp's 24-hour customer care window: free-form text is only allowed
  // within 24h of the contact's last inbound message; respond.io has no API
  // field for this, so it's computed the same way WhatsApp itself enforces
  // it — 24h since the latest inbound message (or "never", if there hasn't
  // been one, which also covers a brand-new conversation's first message).
  const lastInboundAt = messages.reduce((max, m) => (m.direction === 'inbound' && m.sentAt > max ? m.sentAt : max), 0) || null
  const windowExpired = channelToSend === 'whatsapp' && (!lastInboundAt || Date.now() - lastInboundAt > 24 * 60 * 60 * 1000)
  const mustUseTemplate = windowExpired
  const templateMode = mustUseTemplate || sendMode === 'template'

  const send = async () => {
    if (!selected) return
    setSending(true); setError('')
    // Unmatched rows are keyed `contact:<respondio-id>` — no CRM lead to
    // send through, so the target travels as `key` instead of `leadId` (see
    // resolveSendTarget in server/index.js).
    const target = selected.unmatched ? { key: selected.leadId } : { leadId: selected.leadId }
    try {
      if (templateMode) {
        if (!selectedTemplate) throw new Error('Select a WhatsApp template before sending.')
        await api.post('/api/respondio/send', {
          ...target, channel: 'whatsapp', useTemplate: true,
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
        await api.post('/api/respondio/send', { ...target, channel: channelToSend, message: text.trim(), logFollowUp: true })
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

  // Assigns/unassigns on respond.io's own side (not just the local CRM
  // mapping) — works for unmatched contact-only rows too, since :key
  // accepts either a lead id or a `contact:<id>` key.
  const setRespondioAgent = async (agentId) => {
    if (!selected) return
    await api.post(`/api/inbox/${selected.leadId}/agent`, { agentId: agentId || null })
    loadList()
  }

  return (
    <div className="p-6 h-[calc(100vh-74px-56px)] flex gap-4">
      {/* Conversation list */}
      <div className="w-[320px] shrink-0 flex flex-col card !rounded-2xl !p-0 overflow-hidden">
        <div className="p-3 border-b border-white/8 space-y-2">
          <div className="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 p-0.5">
            {STATUS_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setStatus(t.id)}
                className={`flex-1 py-1.5 rounded-lg text-[11.5px] font-semibold transition-colors ${
                  status === t.id ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="input !pl-8 !py-1.5 !text-[12px]" placeholder="Search conversations…" value={q} onChange={e => setQ(e.target.value)} />
          </div>

          <div className="flex items-center gap-1.5">
            <button
              className={`btn btn-ghost !py-1.5 !px-2 !text-[11px] flex-1 ${showFilters ? '!bg-white/15' : ''}`}
              onClick={() => setShowFilters(v => !v)}
            >
              <ListFilter size={11} /> Filters
            </button>
            <button
              className={`btn btn-ghost !py-1.5 !px-2 !text-[11px] ${unreadOnly ? '!bg-white/15' : ''}`}
              onClick={() => setUnreadOnly(v => !v)}
            >
              Unread
            </button>
            <button
              className="btn btn-ghost !py-1.5 !px-2 !text-[11px]"
              onClick={markAllRead}
              disabled={markingAllRead || !displayedRows.some(r => r.unreadCount > 0)}
              title="Mark all visible conversations as read"
            >
              {markingAllRead ? <Spinner size={11} /> : <CheckCheck size={11} />}
            </button>
            <button
              className="btn btn-ghost !py-1.5 !px-2 !text-[11px]"
              onClick={syncFromRespondio}
              disabled={syncing}
              title="Pull every existing conversation from Respond.io"
            >
              {syncing ? <Spinner size={11} /> : <Sparkles size={11} />}
            </button>
            <button
              className="btn btn-ghost !py-1.5 !px-2 !text-[11px]"
              onClick={() => setNewConvOpen(true)}
              title="Message any respond.io contact, or create a new one"
            >
              <UserPlus size={11} />
            </button>
          </div>

          {showFilters && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <ArrowUpDown size={11} className="text-slate-500 shrink-0" />
                <select className="input select-strong !py-1.5 !text-[12px] flex-1" value={sort} onChange={e => setSort(e.target.value)}>
                  {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              <select className="input select-strong !py-1.5 !text-[12px]" value={studio} onChange={e => setStudio(e.target.value)} disabled={role === 'agent'}>
                <option value="">All studios</option>
                {(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <select className="input select-strong !py-1.5 !text-[12px]" value={associate} onChange={e => setAssociate(e.target.value)} disabled={role === 'agent'}>
                <option value="">All owners</option>
                {(boot?.associates || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select className="input select-strong !py-1.5 !text-[12px]" value={channel} onChange={e => setChannel(e.target.value)}>
                <option value="">All channels</option>
                {Object.entries(CHANNEL_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
              <label className="flex items-center gap-2 text-[11.5px] text-slate-400 select-none px-0.5">
                <input type="checkbox" className="accent-rose-500" checked={unmatchedOnly} onChange={e => setUnmatchedOnly(e.target.checked)} />
                No matching CRM lead only
              </label>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-0.5">
          {loadingList && <div className="flex justify-center py-8"><Spinner size={18} /></div>}
          {!loadingList && !displayedRows.length && (
            <div className="pt-8"><Empty icon={<MessageCircle size={20} />} title="No conversations" subtitle="Messages from Respond.io will show up here automatically." /></div>
          )}
          {displayedRows.map(row => (
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
              {selected.assigneeId && (
                <span className="chip bg-white/5 border border-white/10 text-slate-300 !text-[10.5px]">
                  {(boot?.associates || []).find(a => a.id === selected.assigneeId)?.name || 'Assigned'}
                </span>
              )}
              <span className={`chip !text-[10.5px] ${selected.status === 'closed' ? 'bg-slate-500/10 text-slate-400 border border-slate-400/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-400/20'}`}>
                {selected.status === 'closed' ? 'Closed' : 'Open'}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-2.5">
              {loadingThread && <div className="flex justify-center py-8"><Spinner size={18} /></div>}
              {!loadingThread && sortMessages(messages).map((m, i, arr) => {
                const prev = arr[i - 1]
                const showSeparator = !prev || new Date(prev.sentAt).toDateString() !== new Date(m.sentAt).toDateString()
                return (
                  <React.Fragment key={m.id}>
                    {showSeparator && <DateSeparator sentAt={m.sentAt} />}
                    <MessageBubble msg={m} />
                  </React.Fragment>
                )
              })}
              <div ref={threadEndRef} />
            </div>

            {windowExpired && (
              <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-400/25 px-3 py-2 text-[11.5px] text-amber-300">
                <Clock size={13} className="shrink-0 mt-0.5" />
                <span>This conversation is outside the 24-hour customer care window{lastInboundAt ? ` (last reply ${timeAgo(lastInboundAt)} ago)` : ''}. You can only send an approved WhatsApp template until the contact messages again.</span>
              </div>
            )}

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
                {channelToSend === 'whatsapp' && (
                  <div className="flex items-center gap-1 ml-auto rounded-lg border border-white/10 p-0.5">
                    <button
                      onClick={() => setSendMode('text')}
                      disabled={mustUseTemplate}
                      className={`px-2 py-1 rounded-md text-[10.5px] font-semibold transition-colors ${!templateMode ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-slate-200'} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      Message
                    </button>
                    <button
                      onClick={() => setSendMode('template')}
                      className={`px-2 py-1 rounded-md text-[10.5px] font-semibold transition-colors flex items-center gap-1 ${templateMode ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      <Sparkles size={10} /> Template
                    </button>
                  </div>
                )}
              </div>

              {templateMode ? (
                <div className="space-y-1.5">
                  {mustUseTemplate && (
                    <div className="flex items-center gap-1.5 text-[10.5px] text-slate-500"><Sparkles size={11} /> Free-form text isn't available right now — send an approved template</div>
                  )}
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
                        <div className="flex items-center justify-between px-1 pb-1">
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Snippets</span>
                          <button className="btn btn-ghost !py-1 !px-1.5 !text-[10px]" onClick={syncSnippets} disabled={syncingSnippets} title="Pull Saved Replies from Respond.io">
                            {syncingSnippets ? <Spinner size={10} /> : <RefreshCcw size={10} />} Sync
                          </button>
                        </div>
                        {snippets.map(s => (
                          <button
                            key={s.id}
                            className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/10 text-[11.5px] text-slate-200"
                            onClick={() => { setText(prev => (prev ? prev + ' ' : '') + s.text); if (!mustUseTemplate) setSendMode('text'); setShowSnippets(false) }}
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

      {/* Contact details */}
      {selected && (
        <div className="w-[260px] shrink-0 flex flex-col card !rounded-2xl !p-4 overflow-y-auto scrollbar-thin gap-4">
          <div className="flex flex-col items-center text-center gap-2">
            <Avatar name={selected.lead.fullName} size={56} />
            <div>
              <div className="text-[13.5px] font-semibold text-white">{selected.lead.fullName}</div>
              <span className={`chip !mt-1 !text-[10px] ${selected.status === 'closed' ? 'bg-slate-500/10 text-slate-400 border border-slate-400/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-400/20'}`}>
                {selected.status === 'closed' ? 'Closed' : 'Open'}
              </span>
            </div>
          </div>

          {selected.unmatched && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-400/20 px-2.5 py-2 text-[11px] text-amber-300 flex items-start gap-1.5">
              <Info size={12} className="shrink-0 mt-0.5" /> No matching CRM lead — this is a respond.io contact only.
            </div>
          )}

          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-[12px] text-slate-300">
              <Phone size={13} className="text-slate-500 shrink-0" />
              <span className="truncate">{selected.lead.phone || '—'}</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-slate-300">
              <Mail size={13} className="text-slate-500 shrink-0" />
              <span className="truncate">{selected.lead.email || '—'}</span>
            </div>
            {!selected.unmatched && (
              <div className="flex items-center gap-2 text-[12px] text-slate-300">
                <Building2 size={13} className="text-slate-500 shrink-0" />
                <span className="truncate">{(boot?.locations || []).find(l => l.id === selected.lead.locationId)?.name || 'No studio'}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-[12px] text-slate-300">
              <Tag size={13} className="text-slate-500 shrink-0" />
              <span className="truncate">{CHANNEL_META[selected.lastMessage?.channel]?.label || 'WhatsApp'}</span>
            </div>
            {profile?.countryCode && (
              <div className="flex items-center gap-2 text-[12px] text-slate-300">
                <Globe2 size={13} className="text-slate-500 shrink-0" />
                <span className="truncate">{profile.countryCode}</span>
              </div>
            )}
            {profile?.language && (
              <div className="flex items-center gap-2 text-[12px] text-slate-300">
                <Languages size={13} className="text-slate-500 shrink-0" />
                <span className="truncate">{profile.language}</span>
              </div>
            )}
            {profile?.assignee && (profile.assignee.firstName || profile.assignee.email) && (
              <div className="flex items-center gap-2 text-[12px] text-slate-300">
                <UserRound size={13} className="text-slate-500 shrink-0" />
                <span className="truncate">Respond.io owner: {[profile.assignee.firstName, profile.assignee.lastName].filter(Boolean).join(' ') || profile.assignee.email}</span>
              </div>
            )}
          </div>

          {Array.isArray(profile?.tags) && profile.tags.length > 0 && (
            <div className="border-t border-white/8 pt-3 space-y-1.5">
              <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold block">Tags</label>
              <div className="flex flex-wrap gap-1">
                {profile.tags.map((t, i) => (
                  <span key={i} className="chip bg-white/5 border border-white/10 text-slate-300 !text-[10px]">{typeof t === 'string' ? t : (t.name || t.label)}</span>
                ))}
              </div>
            </div>
          )}

          {profile?.lifecycle && (
            <div className="border-t border-white/8 pt-3">
              <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold block mb-1">Lifecycle</label>
              <span className="chip bg-violet-500/10 border border-violet-400/20 text-violet-300 !text-[10.5px]">{profile.lifecycle}</span>
            </div>
          )}

          {Array.isArray(profile?.custom_fields) && profile.custom_fields.filter(f => f?.value !== undefined && f?.value !== null && f?.value !== '').length > 0 && (
            <div className="border-t border-white/8 pt-3 space-y-1.5">
              <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold block">Custom fields</label>
              <div className="space-y-1">
                {profile.custom_fields
                  .filter(f => f?.value !== undefined && f?.value !== null && f?.value !== '')
                  .map((f, i) => (
                    <div key={f.name || i} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <span className="text-slate-500 truncate">{f.name}</span>
                      <span className="text-slate-300 truncate max-w-[130px] text-right">{String(f.value)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="border-t border-white/8 pt-3 space-y-2">
            <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold block">Assigned to</label>
            {selected.unmatched ? (
              <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500"><Ban size={12} /> Link a lead to assign</div>
            ) : (
              <select
                className="input select-strong !py-1.5 !text-[11.5px] w-full"
                value={selected.assigneeId || ''}
                onChange={e => setAssignee(e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {(boot?.associates || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
          </div>

          <div className="border-t border-white/8 pt-3 space-y-2">
            <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5"><Headset size={11} /> Respond.io agent</label>
            <select
              className="input select-strong !py-1.5 !text-[11.5px] w-full"
              value={selected.respondioAssignee || ''}
              onChange={e => setRespondioAgent(e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          {!selected.unmatched && (
            <button className="btn btn-ghost !text-[11.5px] justify-center" onClick={toggleStatus}>
              {selected.status === 'closed' ? <><Circle size={12} /> Reopen conversation</> : <><CheckCircle2 size={12} /> Close conversation</>}
            </button>
          )}

          <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1">
            <UserRound size={12} /> {messages.length} message{messages.length === 1 ? '' : 's'} in this thread
          </div>
        </div>
      )}

      <NewConversationModal
        open={newConvOpen}
        onClose={() => setNewConvOpen(false)}
        onCreated={async (key) => {
          setNewConvOpen(false)
          await loadList()
          openThread(key)
        }}
      />
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
