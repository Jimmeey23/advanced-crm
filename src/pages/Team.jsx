import React, { useState } from 'react'
import { Plus, MapPin, Users, Target, TrendingUp, Crown, Swords } from 'lucide-react'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { Avatar, Modal, ModalHeader, Empty } from '../ui.jsx'
import { money } from '../lib.js'
import AssociateCompareModal from '../components/AssociateCompareModal.jsx'

export default function Team() {
  const { boot, refreshData, toast, dataVersion, openLead } = useApp()
  const [locModal, setLocModal] = useState(false)
  const [asnModal, setAsnModal] = useState({ open: false, locationId: '' })
  const [faceoffOpen, setFaceoffOpen] = useState(false)
  const [editAsn, setEditAsn] = useState(null)
  const { data: team } = useFetch(() => api.get('/api/analytics/team'), [dataVersion])
  const { data: leadsResp } = useFetch(() => api.get('/api/leads?pageSize=1000'), [dataVersion])

  const leads = leadsResp?.items || []
  const leadCountByLoc = {}
  const openCountByLoc = {}
  for (const l of leads) {
    leadCountByLoc[l.locationId] = (leadCountByLoc[l.locationId] || 0) + 1
    if (l.status === 'open') openCountByLoc[l.locationId] = (openCountByLoc[l.locationId] || 0) + 1
  }

  return (
    <div className="p-6 space-y-6 max-w-[1200px]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-white text-[18px]">Studio locations</h2>
          <p className="text-[12.5px] text-slate-500 mt-0.5">Manage locations and the sales teams that cover them</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-soft" onClick={() => setFaceoffOpen(true)}><Swords size={15} /> Associate faceoff</button>
          <button className="btn btn-primary" onClick={() => setLocModal(true)}><Plus size={15} /> Add location</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(boot?.locations || []).map(loc => {
          const locLeads = leads.filter(l => l.locationId === loc.id)
          const locTeam = (boot?.associates || []).filter(a => a.locationId === loc.id && a.active !== false)
          const won = locLeads.filter(l => l.status === 'won').length
          return (
            <div key={loc.id} className="card card-hover p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-display font-semibold text-white text-[14.5px]">{loc.name}</h3>
                  <p className="text-[11.5px] text-slate-500 flex items-center gap-1 mt-1"><MapPin size={11} /> {loc.city}, {loc.country}</p>
                </div>
                <span className="chip bg-white/5 border border-white/10 text-slate-300">{locLeads.length} leads</span>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <MiniStat icon={<Users size={13} />} label="Open" value={openCountByLoc[loc.id] || 0} color="#06b6d4" />
                <MiniStat icon={<TrendingUp size={13} />} label="Won" value={won} color="#10b981" />
                <MiniStat icon={<Crown size={13} />} label="Team" value={locTeam.length} color="#f59e0b" />
              </div>

              <div className="space-y-1.5">
                {locTeam.map(a => {
                  const stats = team?.find(t => t.associateId === a.id)
                  return (
                    <button key={a.id} type="button" className="w-full text-left flex items-center gap-2.5 rounded-xl bg-white/[0.03] border border-white/6 px-3 py-2 hover:bg-white/[0.06] transition-colors" onClick={() => setEditAsn(a)}>
                      <Avatar name={a.name} color={a.color} photoUrl={a.photoUrl} size={26} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-semibold text-slate-200 truncate">{a.name}</div>
                        <div className="text-[10.5px] text-slate-500">{a.role}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11.5px] text-emerald-400 mono">{money(stats?.revenue || 0)}</div>
                        <div className="text-[10px] text-slate-500">{stats?.won || 0} won</div>
                      </div>
                    </button>
                  )
                })}
                {!locTeam.length && <p className="text-[11.5px] text-slate-600">No associates yet.</p>}
              </div>

              <button className="btn btn-ghost w-full !py-1.5 !text-[12px] mt-3" onClick={() => setAsnModal({ open: true, locationId: loc.id })}>
                <Plus size={13} /> Add associate
              </button>
            </div>
          )
        })}
      </div>

      <LocationModal open={locModal} onClose={() => setLocModal(false)} onSaved={() => { refreshData(); toast('Location added') }} />
      <AssociateModal modal={asnModal} onClose={() => setAsnModal(m => ({ ...m, open: false }))} onSaved={() => { refreshData(); toast('Associate added') }} />
      <EditAssociateModal associate={editAsn} onClose={() => setEditAsn(null)} onSaved={() => { refreshData(); toast('Associate updated') }} />
      <AssociateCompareModal open={faceoffOpen} onClose={() => setFaceoffOpen(false)} />
    </div>
  )
}

function MiniStat({ icon, label, value, color }) {
  return (
    <div className="rounded-xl bg-black/20 border border-white/8 px-2 py-2 text-center">
      <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 mb-1" style={{ color }}>{icon}{label}</div>
      <div className="font-display text-[17px] font-bold text-white mono">{value}</div>
    </div>
  )
}

function LocationModal({ open, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', city: '', country: 'India', address: '', fullAddress: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setErr('Location name required'); return }
    setSaving(true); setErr('')
    try { await api.post('/api/locations', form); onSaved(); onClose(); setForm({ name: '', city: '', country: 'India', address: '', fullAddress: '' }) }
    catch (x) { setErr(x.message) }
    finally { setSaving(false) }
  }
  return (
    <Modal open={open} onClose={onClose} width={480}>
      <ModalHeader title="Add studio location" onClose={onClose} />
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label">Location name *</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Lodha Place, Wadala" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">City</label><input className="input" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
          <div><label className="label">Country</label><input className="input" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} /></div>
        </div>
        <div><label className="label">Address</label><input className="input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add location'}</button>
        </div>
      </form>
      <style>{`.label{display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px}`}</style>
    </Modal>
  )
}

function AssociateModal({ modal, onClose, onSaved }) {
  const { boot } = useApp()
  const [form, setForm] = useState({ name: '', role: 'Sales Associate', email: '', color: '#f43f5e', targetMonthly: 10, locationId: modal.locationId })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const colors = ['#f43f5e', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#6366f1', '#ec4899', '#14b8a6']

  React.useEffect(() => { if (modal.open) setForm(f => ({ ...f, locationId: modal.locationId || (boot?.locations?.[0]?.id || '') })) }, [modal.open, modal.locationId])

  if (!modal.open) return null
  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setErr('Name required'); return }
    setSaving(true); setErr('')
    try { await api.post('/api/associates', form); onSaved(); onClose(); setForm({ name: '', role: 'Sales Associate', email: '', color: '#f43f5e', targetMonthly: 10, locationId: modal.locationId }) }
    catch (x) { setErr(x.message) }
    finally { setSaving(false) }
  }
  return (
    <Modal open={modal.open} onClose={onClose} width={480}>
      <ModalHeader title="Add associate" onClose={onClose} />
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label">Full name *</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Role</label><select className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option>Sales Associate</option><option>Studio Manager</option><option>Lead Generator</option></select></div>
          <div><label className="label">Location</label><select className="input" value={form.locationId} onChange={e => setForm({ ...form, locationId: e.target.value })}>{(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Email</label><input className="input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="label">Monthly target</label><input className="input" type="number" value={form.targetMonthly} onChange={e => setForm({ ...form, targetMonthly: e.target.value })} /></div>
        </div>
        <div><label className="label">Avatar color</label>
          <div className="flex gap-2">{colors.map(c => <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? 'ring-2 ring-white scale-110' : 'opacity-70'}`} style={{ background: c }} />)}</div>
        </div>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add associate'}</button>
        </div>
      </form>
      <style>{`.label{display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px}`}</style>
    </Modal>
  )
}

function EditAssociateModal({ associate, onClose, onSaved }) {
  const [photoUrl, setPhotoUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  React.useEffect(() => { if (associate) setPhotoUrl(associate.photoUrl || '') }, [associate])

  if (!associate) return null
  const submit = async (e) => {
    e.preventDefault()
    setSaving(true); setErr('')
    try {
      await api.patch(`/api/associates/${associate.id}`, { photoUrl: photoUrl.trim() || null })
      onSaved()
      onClose()
    } catch (x) { setErr(x.message) }
    finally { setSaving(false) }
  }
  return (
    <Modal open={!!associate} onClose={onClose} width={420}>
      <ModalHeader title={associate.name} subtitle="Edit thumbnail" onClose={onClose} />
      <form onSubmit={submit} className="space-y-3">
        <div className="flex items-center gap-3">
          <Avatar name={associate.name} color={associate.color} photoUrl={photoUrl} size={48} />
          <div className="flex-1">
            <label className="label">Photo URL</label>
            <input className="input" value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} placeholder="/avatars/name.jpg or https://…" />
          </div>
        </div>
        <p className="text-[11px] text-slate-500">A file under <code>public/avatars/</code> (e.g. <code>/avatars/jane.jpg</code>) or any hosted image URL. Leave blank to use initials.</p>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
      <style>{`.label{display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px}`}</style>
    </Modal>
  )
}
