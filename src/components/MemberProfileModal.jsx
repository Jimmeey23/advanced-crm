import React, { useEffect, useState } from 'react'
import { X, Mail, Phone, MapPin, Calendar, Tag, FileText, Receipt, Dumbbell, CreditCard, Loader2 } from 'lucide-react'
import { api, buildQuery } from '../api.js'
import { fmtDate, fmtDateTime, money } from '../lib.js'

const TABS = [
  { id: 'overview', label: 'Overview', icon: Tag },
  { id: 'classes', label: 'Classes', icon: Dumbbell },
  { id: 'sales', label: 'Sales', icon: Receipt },
  { id: 'memberships', label: 'Memberships', icon: CreditCard },
  { id: 'notes', label: 'Notes', icon: FileText }
]

export default function MemberProfileModal({ memberId, locationId, onClose }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    if (!memberId) return
    let alive = true
    setLoading(true); setError(''); setTab('overview')
    api.get(`/api/momence/members/${memberId}/profile?${buildQuery({ locationId })}`)
      .then(data => { if (alive) setProfile(data.profile) })
      .catch(e => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [memberId, locationId])
  useEffect(() => {
    if (!memberId) return
    const close = event => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [memberId, onClose])

  if (!memberId) return null
  const m = profile?.member

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Member profile">
      <div className="absolute inset-0 modal-backdrop" onMouseDown={onClose} />
      <div className="relative member-profile-modal w-full" style={{ maxWidth: 720 }}>
        <button className="btn btn-ghost modal-close member-profile-close" onClick={onClose} aria-label="Close member profile"><X size={16} /></button>
        {loading && <div className="member-profile-loading"><Loader2 className="animate-spin" size={22} /><span>Loading member profile…</span></div>}
        {!loading && error && <div className="member-profile-loading member-profile-error"><span>Could not load this member.</span><small>{error}</small></div>}
        {!loading && !error && m && <>
          <header className="member-profile-header">
            <div className="member-profile-avatar">{[m.firstName, m.lastName].filter(Boolean).map(s => s[0]).join('').toUpperCase() || '?'}</div>
            <div className="min-w-0 flex-1">
              <h2>{[m.firstName, m.lastName].filter(Boolean).join(' ') || 'Unknown member'}</h2>
              <div className="member-profile-contact">
                {m.email && <span><Mail size={12} />{m.email}</span>}
                {m.phoneNumber && <span><Phone size={12} />{m.phoneNumber}</span>}
                {m.homeLocationName && <span><MapPin size={12} />{m.homeLocationName}</span>}
              </div>
            </div>
            <div className="member-profile-id">Momence #{m.id}</div>
          </header>

          <div className="member-profile-stats">
            <div><small>Member since</small><strong>{m.firstSeen ? fmtDate(m.firstSeen) : '—'}</strong></div>
            <div><small>Last visit</small><strong>{m.lastSeen ? fmtDate(m.lastSeen) : '—'}</strong></div>
            <div><small>Total visits</small><strong>{m.visits ?? '—'}</strong></div>
            <div><small>Lifetime sales</small><strong>{money((profile.salesHistory || []).reduce((sum, s) => sum + (Number(s.totalInCurrency) || 0), 0))}</strong></div>
          </div>

          {!!m.tags?.length && <div className="member-profile-tags">{m.tags.map(t => <span key={t} className="chip">{t}</span>)}</div>}

          <div className="member-profile-tabs" role="tablist">
            {TABS.map(t => {
              const count = t.id === 'classes' ? profile.classHistory?.length : t.id === 'sales' ? profile.salesHistory?.length : t.id === 'memberships' ? profile.memberships?.length : t.id === 'notes' ? profile.notes?.length : null
              return (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                  <t.icon size={13} />{t.label}{count != null && <b>{count}</b>}
                </button>
              )
            })}
          </div>

          <div className="member-profile-body">
            {tab === 'overview' && (
              <div className="member-profile-fields">
                {Object.keys(profile.customFields || {}).length
                  ? Object.entries(profile.customFields).map(([k, v]) => (
                    <div key={k}><small>{k}</small><strong>{String(v ?? '—') || '—'}</strong></div>
                  ))
                  : <div className="member-profile-empty">No custom fields recorded for this member.</div>}
              </div>
            )}
            {tab === 'classes' && (
              profile.classHistory?.length
                ? <div className="member-profile-list">{profile.classHistory.map(c => (
                  <div key={c.id} className="member-profile-row">
                    <div><strong>{c.name}</strong><small>{c.teacher || 'No instructor listed'}{c.locationName ? ` · ${c.locationName}` : ''}</small></div>
                    <div className="member-profile-row-right"><span className={c.checkedIn ? 'is-good' : c.cancelledAt ? 'is-bad' : ''}>{c.cancelledAt ? 'Cancelled' : c.checkedIn ? 'Checked in' : 'Booked'}</span><small>{c.startsAt ? fmtDateTime(c.startsAt) : '—'}</small></div>
                  </div>
                ))}</div>
                : <div className="member-profile-empty">No class history found.</div>
            )}
            {tab === 'sales' && (
              profile.salesHistory?.length
                ? <div className="member-profile-list">{profile.salesHistory.map((s, i) => (
                  <div key={s.id || i} className="member-profile-row">
                    <div><strong>{s.itemName}</strong><small>{s.itemType} · {s.paymentMethod}</small></div>
                    <div className="member-profile-row-right"><span className="is-good">{money(Number(s.totalInCurrency) || 0)}</span><small>{s.saleDate ? fmtDate(s.saleDate) : '—'}</small></div>
                  </div>
                ))}</div>
                : <div className="member-profile-empty">No sales records found for this member.</div>
            )}
            {tab === 'memberships' && (
              profile.memberships?.length
                ? <div className="member-profile-list">{profile.memberships.map(mm => (
                  <div key={mm.id} className="member-profile-row">
                    <div><strong>{mm.name}</strong><small>{mm.isFrozen ? 'Frozen' : 'Active'}{mm.eventCreditsLeft != null ? ` · ${mm.eventCreditsLeft} credits left` : ''}</small></div>
                    <div className="member-profile-row-right"><small>{mm.startDate ? fmtDate(mm.startDate) : ''}{mm.endDate ? ` – ${fmtDate(mm.endDate)}` : ''}</small></div>
                  </div>
                ))}</div>
                : <div className="member-profile-empty">No memberships on file.</div>
            )}
            {tab === 'notes' && (
              profile.notes?.length
                ? <div className="member-profile-list">{profile.notes.map(n => (
                  <div key={n.id} className="member-profile-note">
                    <p>{n.note}</p>
                    <small>{n.author || 'Staff'} · {n.createdAt ? fmtDateTime(n.createdAt) : ''}</small>
                  </div>
                ))}</div>
                : <div className="member-profile-empty">No notes on this member yet.</div>
            )}
          </div>
        </>}
      </div>
    </div>
  )
}
