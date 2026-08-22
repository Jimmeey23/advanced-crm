import React, { useState } from 'react'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { Modal, ModalHeader } from '../ui.jsx'

export default function AddLeadModal({ open, onClose }) {
  const { boot, refreshData, toast, openLead } = useApp()
  const [form, setForm] = useState({ locationId: boot?.locations?.[0]?.id || '', fullName: '', phone: '', email: '', sourceName: 'Website Form', classType: '', remarks: '', stage: 'New Lead' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.fullName.trim()) { setError('Lead name is required'); return }
    setSaving(true); setError('')
    try {
      const lead = await api.post('/api/leads', { ...form, createdAt: new Date().toISOString() })
      refreshData()
      toast(`Lead created — ${lead.fullName}`)
      onClose()
      openLead(lead.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader title="Add new lead" subtitle="Round-robin will assign the next associate automatically." onClose={onClose} />
      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-[11.5px] font-semibold text-slate-500 mb-1 block">Full name *</label>
            <input className="input" value={form.fullName} onChange={set('fullName')} placeholder="e.g. Aisha Khan" autoFocus />
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-slate-500 mb-1 block">Phone</label>
            <input className="input" value={form.phone} onChange={set('phone')} placeholder="91…" />
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-slate-500 mb-1 block">Email</label>
            <input className="input" value={form.email} onChange={set('email')} placeholder="name@email.com" />
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-slate-500 mb-1 block">Studio location</label>
            <select className="input" value={form.locationId} onChange={set('locationId')}>
              {(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-slate-500 mb-1 block">Lead source</label>
            <select className="input" value={form.sourceName} onChange={set('sourceName')}>
              {(boot?.sources || []).map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-slate-500 mb-1 block">Class interest</label>
            <select className="input" value={form.classType} onChange={set('classType')}>
              <option value="">Not specified</option>
              {(boot?.classTypes || []).map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-slate-500 mb-1 block">Stage</label>
            <select className="input" value={form.stage} onChange={set('stage')}>
              {(boot?.stages || []).map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-[11.5px] font-semibold text-slate-500 mb-1 block">Notes / remarks</label>
          <textarea className="input resize-none" rows={3} value={form.remarks} onChange={set('remarks')} placeholder="Any context from the first conversation…" />
        </div>
        {error && <p className="text-[12.5px] text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create lead'}</button>
        </div>
      </form>
    </Modal>
  )
}
