import React, { useState } from 'react'
import { Plus, MapPin, Users, Target, TrendingUp, Crown, Swords, Pencil, UserMinus, RotateCcw, UserCog } from 'lucide-react'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { Avatar, Modal, ModalHeader, Empty } from '../ui.jsx'
import { money } from '../lib.js'
import AssociateCompareModal from '../components/AssociateCompareModal.jsx'

export default function Team() {
  const { boot, refreshData, toast, dataVersion, openLead } = useApp()
  const [locModal, setLocModal] = useState({ open: false, location: null })
  const [asnModal, setAsnModal] = useState({ open: false, locationId: '' })
  const [faceoffOpen, setFaceoffOpen] = useState(false)
  const [editAsn, setEditAsn] = useState(null)
  const [manageTeamLocation, setManageTeamLocation] = useState(null)
  const { data: team } = useFetch(() => api.get('/api/analytics/team'), [dataVersion])
  const { data: leadsResp } = useFetch(() => api.get('/api/leads?pageSize=1000'), [dataVersion])

  const setLocationActive = async (location, active) => {
    try {
      await api.patch(`/api/locations/${location.id}`, { active })
      toast(active ? 'Studio restored' : 'Studio removed from active locations')
      refreshData()
    } catch (e) { toast(e.message, 'error') }
  }

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
          <button className="btn btn-primary" onClick={() => setLocModal({ open: true, location: null })}><Plus size={15} /> Add location</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(boot?.locations || []).map(loc => {
          const locLeads = leads.filter(l => l.locationId === loc.id)
          const locTeam = (boot?.associates || []).filter(a => (a.locationIds || [a.locationId]).includes(loc.id))
          const won = locLeads.filter(l => l.status === 'won').length
          return (
            <div key={loc.id} className={`card card-hover p-5 ${loc.active === false ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-display font-semibold text-white text-[14.5px]">{loc.name}</h3>
                  <p className="text-[11.5px] text-slate-500 flex items-center gap-1 mt-1"><MapPin size={11} /> {loc.city}, {loc.country}</p>
                </div>
                <div className="flex items-center gap-1">
                  {loc.active === false && <span className="chip bg-amber-500/10 border border-amber-400/20 text-amber-300">Inactive</span>}
                  <button className="btn btn-ghost !p-1.5" title="Edit studio" onClick={() => setLocModal({ open: true, location: loc })}><Pencil size={13} /></button>
                  <button className="btn btn-ghost !p-1.5" title={loc.active === false ? 'Restore studio' : 'Remove studio'} onClick={() => setLocationActive(loc, loc.active === false)}>{loc.active === false ? <RotateCcw size={13} /> : <UserMinus size={13} />}</button>
                </div>
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
                    <button key={a.id} type="button" className={`w-full text-left flex items-center gap-2.5 rounded-xl bg-white/[0.03] border border-white/6 px-3 py-2 hover:bg-white/[0.06] transition-colors ${a.active === false ? 'opacity-55' : ''}`} onClick={() => setEditAsn(a)}>
                      <Avatar name={a.name} color={a.color} photoUrl={a.photoUrl} photoZoom={a.photoZoom} photoPosX={a.photoPosX} photoPosY={a.photoPosY} size={26} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-semibold text-slate-200 truncate">{a.name}</div>
                        <div className="text-[10.5px] text-slate-500">{a.role}{a.active === false ? ' · inactive' : ''}</div>
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

              <div className="grid grid-cols-2 gap-2 mt-3">
                <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={() => setManageTeamLocation(loc)}><UserCog size={13} /> Manage team</button>
                <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={() => setAsnModal({ open: true, locationId: loc.id })}><Plus size={13} /> New associate</button>
              </div>
            </div>
          )
        })}
      </div>

      <LocationModal modal={locModal} onClose={() => setLocModal({ open: false, location: null })} onSaved={(edited) => { refreshData(); toast(edited ? 'Studio updated' : 'Studio added') }} />
      <AssociateModal modal={asnModal} onClose={() => setAsnModal(m => ({ ...m, open: false }))} onSaved={() => { refreshData(); toast('Associate added') }} />
      <EditAssociateModal associate={editAsn} onClose={() => setEditAsn(null)} onSaved={() => { refreshData(); toast('Associate updated') }} />
      <LocationTeamModal location={manageTeamLocation} associates={boot?.associates || []} onClose={() => setManageTeamLocation(null)} onSaved={() => { refreshData(); toast('Studio team assignments updated') }} />
      <AssociateCompareModal open={faceoffOpen} onClose={() => setFaceoffOpen(false)} />
    </div>
  )
}

function LocationTeamModal({ location, associates, onClose, onSaved }) {
  const [selected, setSelected] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  React.useEffect(() => {
    if (!location) return
    setSelected(new Set(associates.filter(a => (a.locationIds || [a.locationId]).includes(location.id)).map(a => a.id)))
    setError('')
  }, [location?.id, associates])
  if (!location) return null
  const toggle = (id) => setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const saveAssignments = async () => {
    setSaving(true); setError('')
    try {
      await Promise.all(associates.map(associate => {
        const current = associate.locationIds || [associate.locationId].filter(Boolean)
        const shouldInclude = selected.has(associate.id)
        const locationIds = shouldInclude ? [...new Set([...current, location.id])] : current.filter(id => id !== location.id)
        if (locationIds.join('|') === current.join('|')) return Promise.resolve()
        return api.patch(`/api/associates/${associate.id}`, { locationIds, locationId: locationIds.includes(associate.locationId) ? associate.locationId : locationIds[0] || null })
      }))
      onSaved(); onClose()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }
  return <Modal open={!!location} onClose={onClose} width={560}>
    <ModalHeader title={`Manage ${location.name} team`} subtitle="Add existing associates, move coverage, or remove people from this studio" onClose={onClose} />
    <div className="location-team-list">
      {associates.map(associate => <button type="button" key={associate.id} className={`location-team-option ${selected.has(associate.id) ? 'is-selected' : ''}`} onClick={() => toggle(associate.id)}>
        <Avatar name={associate.name} color={associate.color} photoUrl={associate.photoUrl} photoZoom={associate.photoZoom} photoPosX={associate.photoPosX} photoPosY={associate.photoPosY} size={34} />
        <span><b>{associate.name}</b><small>{associate.role} · {(associate.locationIds || [associate.locationId]).length} studio assignment(s)</small></span>
        <span className="location-team-check">{selected.has(associate.id) ? 'Assigned' : 'Add'}</span>
      </button>)}
    </div>
    {error && <p className="text-[12px] text-rose-400 mt-3">{error}</p>}
    <div className="flex justify-end gap-2 pt-4"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={saveAssignments}>{saving ? 'Saving…' : 'Save assignments'}</button></div>
  </Modal>
}

function MiniStat({ icon, label, value, color }) {
  return (
    <div className="rounded-xl bg-black/20 border border-white/8 px-2 py-2 text-center">
      <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 mb-1" style={{ color }}>{icon}{label}</div>
      <div className="font-display text-[17px] font-bold text-white mono">{value}</div>
    </div>
  )
}

function LocationModal({ modal, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', city: '', country: 'India', address: '', fullAddress: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  React.useEffect(() => {
    if (!modal.open) return
    setForm(modal.location ? { name: modal.location.name || '', city: modal.location.city || '', country: modal.location.country || 'India', address: modal.location.address || '', fullAddress: modal.location.fullAddress || '' } : { name: '', city: '', country: 'India', address: '', fullAddress: '' })
  }, [modal.open, modal.location?.id])
  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setErr('Location name required'); return }
    setSaving(true); setErr('')
    try {
      if (modal.location) await api.patch(`/api/locations/${modal.location.id}`, form)
      else await api.post('/api/locations', form)
      onSaved(!!modal.location); onClose()
    }
    catch (x) { setErr(x.message) }
    finally { setSaving(false) }
  }
  return (
    <Modal open={modal.open} onClose={onClose} width={480}>
      <ModalHeader title={modal.location ? 'Edit studio location' : 'Add studio location'} onClose={onClose} />
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
          <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : modal.location ? 'Save changes' : 'Add location'}</button>
        </div>
      </form>
      <style>{`.label{display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px}`}</style>
    </Modal>
  )
}

function AssociateModal({ modal, onClose, onSaved }) {
  const { boot } = useApp()
  const emptyForm = () => ({ name: '', role: 'Sales Associate', email: '', color: '#f43f5e', revenueTargetMonthly: 0, conversionTargetPct: 0, locationId: modal.locationId, locationIds: modal.locationId ? [modal.locationId] : [] })
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const colors = ['#f43f5e', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#6366f1', '#ec4899', '#14b8a6']

  React.useEffect(() => {
    if (!modal.open) return
    const locationId = modal.locationId || boot?.locations?.[0]?.id || ''
    setForm(f => ({ ...f, locationId, locationIds: locationId ? [locationId] : [] }))
  }, [modal.open, modal.locationId])

  if (!modal.open) return null
  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setErr('Name required'); return }
    setSaving(true); setErr('')
    try { await api.post('/api/associates', form); onSaved(); onClose(); setForm(emptyForm()) }
    catch (x) { setErr(x.message) }
    finally { setSaving(false) }
  }
  return (
    <Modal open={modal.open} onClose={onClose} width={620}>
      <ModalHeader title="Add associate" onClose={onClose} />
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label">Full name *</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Role</label><select className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option>Sales Associate</option><option>Studio Manager</option><option>Lead Generator</option></select></div>
          <div><label className="label">Primary studio</label><select className="input" value={form.locationId} onChange={e => setForm({ ...form, locationId: e.target.value, locationIds: [e.target.value, ...(form.locationIds || []).filter(id => id !== e.target.value)] })}>{(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        </div>
        <div><label className="label">Studio coverage</label><div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 p-2">{(boot?.locations || []).map(location => <label key={location.id} className="flex items-center gap-2 text-[11px] text-slate-300"><input type="checkbox" checked={(form.locationIds || []).includes(location.id)} onChange={() => { const selected = form.locationIds || []; const locationIds = selected.includes(location.id) ? selected.filter(id => id !== location.id) : [...selected, location.id]; setForm({ ...form, locationIds, locationId: locationIds[0] || '' }) }} />{location.name}</label>)}</div></div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Email</label><input className="input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="label">Revenue target</label><input className="input" type="number" min="0" value={form.revenueTargetMonthly} onChange={e => setForm({ ...form, revenueTargetMonthly: Number(e.target.value) })} /></div>
          <div><label className="label">Conversion target %</label><input className="input" type="number" min="0" max="100" value={form.conversionTargetPct} onChange={e => setForm({ ...form, conversionTargetPct: Number(e.target.value) })} /></div>
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
  const { boot } = useApp()
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  React.useEffect(() => {
    if (!associate) return
    setForm({ ...associate, locationIds: associate.locationIds || [associate.locationId].filter(Boolean), photoUrl: associate.photoUrl || '', photoZoom: associate.photoZoom || 100, photoPosX: associate.photoPosX ?? 50, photoPosY: associate.photoPosY ?? 50 })
  }, [associate])

  if (!associate) return null
  const submit = async (e) => {
    e.preventDefault()
    setSaving(true); setErr('')
    try {
      await api.patch(`/api/associates/${associate.id}`, { ...form, photoUrl: form.photoUrl?.trim() || null })
      onSaved()
      onClose()
    } catch (x) { setErr(x.message) }
    finally { setSaving(false) }
  }
  const toggleLocation = (id) => setForm(current => {
    const selected = current.locationIds || []
    if (selected.length === 1 && selected.includes(id)) return current
    const locationIds = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
    return { ...current, locationIds, locationId: locationIds.includes(current.locationId) ? current.locationId : locationIds[0] || '' }
  })
  return (
    <Modal open={!!associate} onClose={onClose} width={660}>
      <ModalHeader title={associate.name} subtitle="Profile, role and studio assignments" onClose={onClose} />
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Full name</label><input className="input" value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label className="label">Email</label><input className="input" type="email" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="label">Role</label><select className="input" value={form.role || 'Sales Associate'} onChange={e => setForm({ ...form, role: e.target.value })}><option>Sales Associate</option><option>Studio Manager</option><option>Lead Generator</option></select></div>
          <div><label className="label">Primary studio</label><select className="input" value={form.locationId || ''} onChange={e => setForm({ ...form, locationId: e.target.value, locationIds: [e.target.value, ...(form.locationIds || []).filter(id => id !== e.target.value)] })}>{(boot?.locations || []).filter(l => l.active !== false).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        </div>
        <div><label className="label">Studio coverage</label><div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 p-2">{(boot?.locations || []).filter(l => l.active !== false).map(location => <label key={location.id} className="flex items-center gap-2 text-[11px] text-slate-300"><input type="checkbox" checked={(form.locationIds || []).includes(location.id)} onChange={() => toggleLocation(location.id)} />{location.name}</label>)}</div></div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Revenue target</label><input className="input" type="number" min="0" value={form.revenueTargetMonthly || 0} onChange={e => setForm({ ...form, revenueTargetMonthly: Number(e.target.value) })} /></div>
          <div><label className="label">Conversion target %</label><input className="input" type="number" min="0" max="100" value={form.conversionTargetPct || 0} onChange={e => setForm({ ...form, conversionTargetPct: Number(e.target.value) })} /></div>
          <div><label className="label">Status</label><select className="input" value={form.active === false ? 'inactive' : 'active'} onChange={e => setForm({ ...form, active: e.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Removed / inactive</option></select></div>
        </div>
        <div className="flex items-center gap-3">
          <Avatar name={form.name || associate.name} color={form.color || associate.color} photoUrl={form.photoUrl} photoZoom={form.photoZoom} photoPosX={form.photoPosX} photoPosY={form.photoPosY} size={64} />
          <div className="flex-1">
            <label className="label">Photo URL</label>
            <input className="input" value={form.photoUrl || ''} onChange={e => setForm({ ...form, photoUrl: e.target.value })} placeholder="/avatars/name.jpg or https://…" />
          </div>
        </div>
        {form.photoUrl && (
          <div className="space-y-2.5 pt-1">
            <div>
              <div className="flex items-center justify-between"><label className="label !mb-0">Zoom</label><span className="text-[11px] text-slate-500">{form.photoZoom}%</span></div>
              <input type="range" min={100} max={250} step={1} value={form.photoZoom} onChange={e => setForm({ ...form, photoZoom: Number(e.target.value) })} className="w-full" />
            </div>
            <div>
              <div className="flex items-center justify-between"><label className="label !mb-0">Horizontal position</label><span className="text-[11px] text-slate-500">{form.photoPosX}%</span></div>
              <input type="range" min={0} max={100} step={1} value={form.photoPosX} onChange={e => setForm({ ...form, photoPosX: Number(e.target.value) })} className="w-full" />
            </div>
            <div>
              <div className="flex items-center justify-between"><label className="label !mb-0">Vertical position</label><span className="text-[11px] text-slate-500">{form.photoPosY}%</span></div>
              <input type="range" min={0} max={100} step={1} value={form.photoPosY} onChange={e => setForm({ ...form, photoPosY: Number(e.target.value) })} className="w-full" />
            </div>
            <button type="button" className="btn btn-ghost !py-1.5 !text-[11.5px]" onClick={() => setForm({ ...form, photoZoom: 100, photoPosX: 50, photoPosY: 50 })}>Reset crop</button>
          </div>
        )}
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
