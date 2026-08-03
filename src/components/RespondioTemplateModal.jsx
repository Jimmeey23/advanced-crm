import React, { useEffect, useMemo, useState } from 'react'
import { Send, Sparkles, MessageCircle } from 'lucide-react'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { Modal, ModalHeader, Avatar, Spinner } from '../ui.jsx'

function getLibrary(settingsTemplates) {
  const defaults = [
    { id: 'welcome', name: 'welcome_message', label: 'Welcome / First Reply', language: 'en', category: 'marketing', parameters: ['First name', 'Studio name'] },
    { id: 'trial', name: 'trial_booking_followup', label: 'Trial Booking Follow-up', language: 'en', category: 'utility', parameters: ['First name', 'Trial date', 'Studio name'] }
  ]
  return Array.isArray(settingsTemplates) && settingsTemplates.length ? settingsTemplates : defaults
}

export default function RespondioTemplateModal({ open, onClose, lead }) {
  const { boot, refreshData, toast } = useApp()
  const templates = useMemo(() => getLibrary(boot?.settings?.respondio?.wabaTemplates), [boot])
  const [templateId, setTemplateId] = useState('')
  const [values, setValues] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const firstMessage = !(lead?.respondio?.lastOutboundAt || (lead?.followUps || []).some(f => f.via === 'respondio'))

  useEffect(() => {
    if (!open) return
    const initial = templates[0]
    setTemplateId(initial?.id || '')
    setValues((initial?.parameters || []).map(() => ''))
    setError('')
  }, [open, templates])

  const selected = templates.find(t => t.id === templateId) || templates[0]

  useEffect(() => {
    if (!selected) return
    setValues(prev => {
      const next = [...prev]
      while (next.length < (selected.parameters?.length || 0)) next.push('')
      return next.slice(0, selected.parameters?.length || 0)
    })
  }, [selected?.id])

  const setValue = (idx, v) => setValues(curr => curr.map((x, i) => (i === idx ? v : x)))

  const send = async () => {
    setSending(true); setError('')
    try {
      const payload = {
        leadId: lead.id,
        channel: 'whatsapp',
        useTemplate: true,
        template: {
          id: selected?.id,
          name: selected?.name,
          language: selected?.language || 'en',
          namespace: selected?.namespace || '',
          category: selected?.category || '',
          channel: 'whatsapp',
          parameters: values
        },
        logFollowUp: true
      }
      await api.post('/api/respondio/send', payload)
      toast('WhatsApp template sent via Respond.io')
      refreshData()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={560}>
      <ModalHeader
        title={lead ? `Send template to ${lead.fullName.split(' ')[0] || 'lead'}` : 'Send WhatsApp template'}
        subtitle={firstMessage ? 'This will be used for the first WhatsApp message' : 'Send an approved WABA template'}
        onClose={onClose}
      />

      {lead && (
        <div className="flex items-center gap-2.5 mb-4">
          <Avatar name={lead.fullName} size={30} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-white truncate">{lead.fullName}</div>
            <div className="text-[11px] text-slate-500 truncate flex items-center gap-1.5"><MessageCircle size={11} /> {lead.phone || lead.email}</div>
          </div>
          {firstMessage && <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20">first message</span>}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Template</label>
          <select className="input" value={templateId} onChange={e => setTemplateId(e.target.value)}>
            {templates.map(t => <option key={t.id} value={t.id}>{t.label || t.name}</option>)}
          </select>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1.5"><Sparkles size={11} /> Approved WABA template linked in your Respond.io settings</div>
        </div>

        <div className="space-y-2">
          {(selected?.parameters || []).map((label, idx) => (
            <div key={idx}>
              <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Parameter {idx + 1}{label ? ` — ${label}` : ''}</label>
              <input className="input" value={values[idx] || ''} onChange={e => setValue(idx, e.target.value)} placeholder={label || `Value ${idx + 1}`} />
            </div>
          ))}
          {!selected?.parameters?.length && <p className="text-[12px] text-slate-500">This template has no parameters.</p>}
        </div>

        {error && <p className="text-[12px] text-rose-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={send} disabled={sending || !selected}>
            {sending ? <Spinner size={14} /> : <Send size={14} />} Send template
          </button>
        </div>
      </div>
    </Modal>
  )
}