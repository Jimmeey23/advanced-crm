import React, { useEffect, useState } from 'react'
import { Send, Phone, MessageCircle, Mail, MessageSquareText, Sparkles } from 'lucide-react'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { Modal, ModalHeader, Avatar, Spinner } from '../ui.jsx'

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, color: '#34d399' },
  { id: 'sms', label: 'SMS', icon: MessageSquareText, color: '#fbbf24' },
  { id: 'email', label: 'Email', icon: Mail, color: '#a78bfa' },
  { id: 'call', label: 'Call', icon: Phone, color: '#38bdf8' }
]

export default function ComposeModal({ open, onClose, lead, defaultChannel = 'whatsapp' }) {
  const { refreshData, toast } = useApp()
  const [channel, setChannel] = useState(defaultChannel)
  const [message, setMessage] = useState('')
  const [log, setLog] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setChannel(defaultChannel)
      setMessage('')
      setError('')
    }
  }, [open, defaultChannel, lead?.id])

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

  const meta = CHANNELS.find(c => c.id === channel)

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
                active ? 'border-white/20 bg-white/10 text-white' : 'border-white/8 bg-white/[0.03] text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon size={13} style={{ color: active ? c.color : undefined }} /> {c.label}
            </button>
          )
        })}
      </div>

      <div className="space-y-2.5">
        <textarea
          className="input resize-none"
          rows={4}
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder={`Type a ${meta?.label} message…`}
        />

        {suggestions.length > 0 && (
          <div className="rounded-xl bg-fuchsia-500/[0.07] border border-fuchsia-400/15 p-2.5">
            <div className="text-[10.5px] uppercase tracking-wider text-fuchsia-300 font-bold mb-1.5 flex items-center gap-1"><Sparkles size={10} /> AI suggested messages</div>
            <div className="space-y-1.5">
              {suggestions.slice(0, 2).map((s, i) => (
                <button key={i} className="w-full text-left text-[11.5px] text-slate-300 bg-white/[0.03] border border-white/8 rounded-lg px-2.5 py-1.5 hover:bg-white/[0.06] transition-colors" onClick={() => setMessage(s.text)}>
                  “{s.text}”
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-[12px] text-slate-300 select-none">
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
    </Modal>
  )
}
