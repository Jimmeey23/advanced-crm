import React, { useEffect, useMemo, useState } from 'react'
import { Send, Phone, MessageCircle, Mail, MessageSquareText, Sparkles } from 'lucide-react'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { Modal, ModalHeader, Avatar, Spinner } from '../ui.jsx'
import { getLibrary, fromApiTemplate } from './RespondioTemplateModal.jsx'

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, color: '#34d399' },
  { id: 'sms', label: 'SMS', icon: MessageSquareText, color: '#fbbf24' },
  { id: 'email', label: 'Email', icon: Mail, color: '#a78bfa' },
  { id: 'call', label: 'Call', icon: Phone, color: '#38bdf8' }
]

export default function ComposeModal({ open, onClose, lead, defaultChannel = 'whatsapp' }) {
  const { boot, refreshData, toast } = useApp()
  const [channel, setChannel] = useState(defaultChannel)
  const [message, setMessage] = useState('')
  const [log, setLog] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // WhatsApp only ever sends as an approved template — free text there fails
  // server-side unless a session is already open, and even then the send
  // button used to offer no way to pick a template for a lead's first
  // message. Rather than a separate hidden modal for that, WhatsApp always
  // shows the same template picker any "message this lead" entry point uses.
  const [apiTemplates, setApiTemplates] = useState(null)
  const [templateLoadError, setTemplateLoadError] = useState('')
  const manualTemplates = useMemo(() => getLibrary(boot?.settings?.respondio?.wabaTemplates), [boot])
  const templates = apiTemplates?.length ? apiTemplates : manualTemplates
  const [templateId, setTemplateId] = useState('')
  const [templateValues, setTemplateValues] = useState([])

  useEffect(() => {
    if (open) {
      setChannel(defaultChannel)
      setMessage('')
      setError('')
    }
  }, [open, defaultChannel, lead?.id])

  useEffect(() => {
    if (!open || channel !== 'whatsapp') return
    api.get('/api/respondio/templates')
      .then(r => {
        setApiTemplates(Array.isArray(r.templates) ? r.templates.map(fromApiTemplate) : [])
        setTemplateLoadError(r.templates?.length ? '' : (r.error || 'No approved WABA templates found on your Respond.io WhatsApp channel.'))
      })
      .catch(e => { setApiTemplates([]); setTemplateLoadError(e.message) })
  }, [open, channel])

  useEffect(() => {
    if (!open || channel !== 'whatsapp') return
    const initial = templates[0]
    setTemplateId(initial?.id || '')
    setTemplateValues((initial?.parameters || []).map(() => ''))
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel, apiTemplates])

  const selectedTemplate = templates.find(t => t.id === templateId) || templates[0]

  useEffect(() => {
    if (channel !== 'whatsapp' || !selectedTemplate) return
    setTemplateValues(prev => {
      const next = [...prev]
      while (next.length < (selectedTemplate.parameters?.length || 0)) next.push('')
      return next.slice(0, selectedTemplate.parameters?.length || 0)
    })
  }, [channel, selectedTemplate?.id])

  const setTemplateValue = (idx, v) => setTemplateValues(curr => curr.map((x, i) => (i === idx ? v : x)))

  const suggestions = [
    ...(lead?.ai?.followupSuggestions || []),
    ...(lead?.gpt?.followupSuggestions || [])
  ].filter(s => s.channel === channel)

  const send = async () => {
    if (!message.trim()) { setError('Write a message first.'); return }
    setSending(true); setError('')
    try {
      await api.post('/api/respondio/send', { leadId: lead.id, channel, message: message.trim(), logFollowUp: log })
      toast(`${CHANNELS.find(c => c.id === channel)?.label} sent via Respond.io`)
      refreshData()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const sendTemplate = async () => {
    if (!selectedTemplate || !String(selectedTemplate.name || '').trim()) {
      setError('Select a WhatsApp template before sending.')
      return
    }
    setSending(true); setError('')
    try {
      await api.post('/api/respondio/send', {
        leadId: lead.id,
        channel: 'whatsapp',
        useTemplate: true,
        template: {
          id: selectedTemplate.id,
          name: selectedTemplate.name,
          language: selectedTemplate.language || 'en',
          namespace: selectedTemplate.namespace || '',
          category: selectedTemplate.category || '',
          channel: 'whatsapp',
          channelId: selectedTemplate.channelId,
          rawComponents: selectedTemplate.rawComponents || [],
          parameters: templateValues
        },
        logFollowUp: true
      })
      toast('WhatsApp template sent via Respond.io')
      refreshData()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const meta = CHANNELS.find(c => c.id === channel)
  const isWhatsApp = channel === 'whatsapp'

  return (
    <Modal open={open} onClose={onClose} width={520}>
      <ModalHeader
        title={lead ? `Message ${lead.fullName.split(' ')[0] || 'lead'}` : 'Compose message'}
        subtitle="Sent through your Respond.io integration"
        onClose={onClose}
      />
      {lead && (
        <div className="flex items-center gap-2.5 mb-4">
          <Avatar name={lead.fullName} size={30} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-white truncate">{lead.fullName}</div>
            <div className="text-[11px] text-slate-500 truncate">{lead.phone || lead.email}</div>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-3">
        {CHANNELS.map(c => {
          const Icon = c.icon
          const active = channel === c.id
          return (
            <button
              key={c.id}
              onClick={() => setChannel(c.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[12px] font-semibold transition-colors ${
                active ? 'border-blue-500/20 bg-blue-500/10 text-slate-900' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={13} style={{ color: active ? c.color : undefined }} /> {c.label}
            </button>
          )
        })}
      </div>

      {isWhatsApp ? (
        <div className="space-y-2.5">
          <div>
            <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Template</label>
            <select className="input select-strong" value={templateId} onChange={e => setTemplateId(e.target.value)}>
              {templates.map(t => <option key={t.id} value={t.id}>{t.label || t.name}</option>)}
            </select>
            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
              <Sparkles size={11} />
              {apiTemplates?.length ? 'Live approved templates from your Respond.io WhatsApp channel' : 'Manually configured in Settings > Integrations'}
            </div>
            {templateLoadError && !apiTemplates?.length && <p className="text-[11px] text-amber-500 mt-1">{templateLoadError}</p>}
          </div>

          <div className="space-y-2">
            {(selectedTemplate?.parameters || []).map((label, idx) => (
              <div key={idx}>
                <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Parameter {idx + 1}{label ? ` — ${label}` : ''}</label>
                <input className="input !bg-white/[0.06]" value={templateValues[idx] || ''} onChange={e => setTemplateValue(idx, e.target.value)} placeholder={label || `Value ${idx + 1}`} />
              </div>
            ))}
            {!selectedTemplate?.parameters?.length && <p className="text-[12px] text-slate-500">This template has no parameters.</p>}
          </div>

          {error && <p className="text-[12px] text-rose-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={sendTemplate} disabled={sending || !selectedTemplate}>
              {sending ? <Spinner size={14} /> : <Send size={14} />} Send template
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <textarea
            className="input resize-none"
            rows={4}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={`Type a ${meta?.label} message…`}
          />

          {suggestions.length > 0 && (
            <div className="rounded-xl bg-blue-500/[0.06] border border-blue-500/15 p-2.5">
              <div className="text-[10.5px] uppercase tracking-wider text-blue-500 font-bold mb-1.5 flex items-center gap-1"><Sparkles size={10} /> AI suggested messages</div>
              <div className="space-y-1.5">
                {suggestions.slice(0, 2).map((s, i) => (
                  <button key={i} className="w-full text-left text-[11.5px] text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition-colors" onClick={() => setMessage(s.text)}>
                    “{s.text}”
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-[12px] text-slate-700 select-none">
            <input type="checkbox" className="accent-rose-500" checked={log} onChange={e => setLog(e.target.checked)} />
            Log this message as a completed follow-up
          </label>

          {error && <p className="text-[12px] text-rose-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={send} disabled={sending || !message.trim()}>
              {sending ? <Spinner size={14} /> : <Send size={14} />} Send {meta?.label}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
