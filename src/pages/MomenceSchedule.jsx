import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, List, MapPin, Search, Users, X, CheckCircle2, UserPlus, RefreshCw, AlertTriangle } from 'lucide-react'
import { api, buildQuery } from '../api.js'
import { useApp } from '../store.jsx'

const DAY = 86400000
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const iso = d => d.toISOString()
const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const sameDay = (a, b) => dayKey(new Date(a)) === dayKey(new Date(b))
const personName = p => [p?.firstName, p?.lastName].filter(Boolean).join(' ') || 'Unknown member'
const time = value => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
const fullDate = value => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
const membershipName = item => item?.name || item?.membership?.name || item?.membershipName || `Membership #${item?.id || item?.membershipId || item?.boughtMembershipId}`
const membershipId = item => item?.id || item?.membershipId || item?.boughtMembershipId

const formatTone = name => {
  const value = String(name || '').toLowerCase()
  if (value.includes('powercycle') || value.includes('cycle')) return 'cyan'
  if (value.includes('cardio')) return 'rose'
  if (value.includes('barre')) return 'indigo'
  if (value.includes('mat') || value.includes('pilates')) return 'violet'
  if (value.includes('strength') || value.includes('amped')) return 'amber'
  if (value.includes('fit')) return 'emerald'
  if (value.includes('restore') || value.includes('stretch') || value.includes('mobility')) return 'teal'
  if (value.includes('dance')) return 'fuchsia'
  return 'slate'
}

function rangeFor(view, anchor) {
  const d = startOfDay(anchor)
  if (view === 'day') return { start: d, end: new Date(d.getTime() + DAY) }
  if (view === 'month') {
    const first = new Date(d.getFullYear(), d.getMonth(), 1)
    const start = new Date(first.getTime() - first.getDay() * DAY)
    return { start, end: new Date(start.getTime() + 42 * DAY) }
  }
  const mondayOffset = (d.getDay() + 6) % 7
  const start = new Date(d.getTime() - mondayOffset * DAY)
  return { start, end: new Date(start.getTime() + 7 * DAY) }
}

function SessionCard({ session, onClick, compact = false }) {
  const remaining = session.capacity == null ? null : Math.max(0, session.capacity - session.bookingCount)
  return <button className={`mom-session-card tone-${formatTone(session.name)} ${session.isCancelled ? 'is-cancelled' : ''} ${compact ? 'is-compact' : ''}`} onClick={() => onClick(session)}>
    <span className="mom-session-time">{time(session.startsAt)}</span>
    <strong>{session.name}</strong>
    {!compact && <span>{personName(session.teacher)} · {session.inPersonLocation?.name || 'Online'}</span>}
    <small>{session.bookingCount}/{session.capacity ?? '∞'} booked{remaining === 0 ? ' · Full' : ''}</small>
  </button>
}

export default function MomenceSchedule() {
  const { boot, toast } = useApp()
  const [view, setView] = useState('week')
  const [anchor, setAnchor] = useState(startOfDay(new Date()))
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [location, setLocation] = useState('')
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const q = buildQuery({ startAfter: iso(range.start), startBefore: iso(range.end), locationId: location })
      const data = await api.get(`/api/momence/sessions?${q}`)
      setSessions(data.sessions || [])
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [range.start.getTime(), range.end.getTime(), location])

  useEffect(() => { load() }, [load])
  const openSession = async session => {
    setSelected(session); setDetail(null); setDetailLoading(true)
    try { setDetail(await api.get(`/api/momence/sessions/${session.id}?${buildQuery({ locationId: session.inPersonLocation?.id })}`)) }
    catch (e) { toast(e.message, 'error') } finally { setDetailLoading(false) }
  }
  const refreshDetail = async () => {
    if (!selected) return
    const data = await api.get(`/api/momence/sessions/${selected.id}?${buildQuery({ locationId: selected.inPersonLocation?.id })}`)
    setDetail(data); await load()
  }
  const shift = direction => {
    const amount = view === 'month' ? 0 : view === 'week' ? 7 : 1
    setAnchor(a => view === 'month' ? new Date(a.getFullYear(), a.getMonth() + direction, 1) : new Date(a.getTime() + direction * amount * DAY))
  }
  const days = useMemo(() => Array.from({ length: view === 'month' ? Math.ceil((range.end - range.start) / DAY) : view === 'week' ? 7 : 1 }, (_, i) => new Date(range.start.getTime() + i * DAY)), [range, view])
  const locations = useMemo(() => [...new Map(sessions.map(s => s.inPersonLocation).filter(Boolean).map(l => [String(l.id), l])).values()], [sessions])
  const title = view === 'month' ? anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : `${fullDate(range.start)}${view === 'week' ? ` – ${fullDate(new Date(range.end.getTime() - DAY))}` : ''}`

  if (!boot?.integrations?.momence) return <div className="mom-schedule-page"><div className="mom-empty card"><AlertTriangle /><h2>Connect Momence to load the schedule</h2><p>Add the Public API credentials in Settings, then return here to manage sessions and rosters.</p></div></div>

  return <div className="mom-schedule-page">
    <section className="mom-schedule-toolbar">
      <div><span className="eyebrow">Live from Momence</span><h2>Schedule</h2><p>Review every Studio Session, open its roster, and complete front-desk actions.</p></div>
      <div className="mom-toolbar-actions">
        <button className="btn btn-ghost" onClick={() => setAnchor(startOfDay(new Date()))}>Today</button>
        <div className="mom-stepper"><button onClick={() => shift(-1)} aria-label="Previous period"><ChevronLeft /></button><strong>{title}</strong><button onClick={() => shift(1)} aria-label="Next period"><ChevronRight /></button></div>
        <button className="mom-icon-btn" onClick={load} aria-label="Refresh schedule"><RefreshCw className={loading ? 'animate-spin' : ''} /></button>
      </div>
    </section>
    <section className="mom-filterbar card">
      <div className="mom-view-tabs" role="tablist">{[['day', CalendarDays], ['week', CalendarDays], ['month', CalendarDays], ['list', List]].map(([id, Icon]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon />{id}</button>)}</div>
      <label><MapPin /><select className="input" value={location} onChange={e => setLocation(e.target.value)}><option value="">All locations</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <span className="mom-session-total">{sessions.length} sessions</span>
    </section>
    {error ? <div className="mom-error card"><AlertTriangle /><div><strong>Schedule could not be loaded</strong><span>{error}</span></div><button className="btn btn-ghost" onClick={load}>Retry</button></div> : loading ? <div className="mom-skeleton-grid">{Array.from({ length: 7 }, (_, i) => <div className="card" key={i} />)}</div> : view === 'list' ? <div className="mom-list card">{sessions.length ? sessions.map(s => <SessionCard key={s.id} session={s} onClick={openSession} />) : <Empty />}</div> : <div className={`mom-calendar mom-calendar-${view}`}>{view === 'month' && <div className="mom-month-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}</div>}{days.map(day => {
      const daySessions = sessions.filter(s => sameDay(s.startsAt, day))
      const shown = view === 'month' ? daySessions.slice(0, 2) : daySessions
      const outsideMonth = view === 'month' && day.getMonth() !== anchor.getMonth()
      return <section key={dayKey(day)} className={`mom-day card ${sameDay(day, new Date()) ? 'is-today' : ''} ${outsideMonth ? 'is-outside-month' : ''}`}><header><span>{day.toLocaleDateString('en-IN', { weekday: 'short' })}</span><strong>{day.getDate()}</strong></header><div>{shown.map(s => <SessionCard key={s.id} session={s} onClick={openSession} compact={view === 'month'} />)}{daySessions.length > shown.length && <button className="mom-more-sessions" onClick={() => { setAnchor(day); setView('day') }}>{daySessions.length - shown.length} more</button>}{!daySessions.length && view !== 'month' && <span className="mom-no-session">No sessions</span>}</div></section>
    })}</div>}
    {selected && <SessionDrawer session={selected} detail={detail} loading={detailLoading} onClose={() => setSelected(null)} onRefresh={refreshDetail} />}
  </div>
}

const Empty = () => <div className="mom-empty"><CalendarDays /><h3>No sessions in this period</h3><p>Move to another date range or clear the location filter.</p></div>

function SessionDrawer({ session, detail, loading, onClose, onRefresh }) {
  const { toast } = useApp()
  const [memberQuery, setMemberQuery] = useState('')
  const [members, setMembers] = useState([])
  const [searching, setSearching] = useState(false)
  const [acting, setActing] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [selectedMember, setSelectedMember] = useState(null)
  const [availableMemberships, setAvailableMemberships] = useState([])
  const [hostMemberships, setHostMemberships] = useState([])
  const [cancelBooking, setCancelBooking] = useState(null)
  const [cancelOptions, setCancelOptions] = useState({ refund: true, disableNotifications: false, isLateCancellation: false })
  useEffect(() => {
    if (memberQuery.trim().length < 2) { setMembers([]); return }
    const timer = setTimeout(async () => { setSearching(true); try { const r = await api.get(`/api/momence/members?${buildQuery({ query: memberQuery, locationId: session.inPersonLocation?.id })}`); setMembers(r.members || []) } catch (e) { toast(e.message, 'error') } finally { setSearching(false) } }, 300)
    return () => clearTimeout(timer)
  }, [memberQuery])
  const act = async (key, work, success) => { setActing(key); try { await work(); toast(success); await onRefresh() } catch (e) { toast(e.message, 'error') } finally { setActing('') } }
  const inspectMemberships = async member => {
    setActing(`memberships-${member.id}`)
    try {
      const result = await api.get(`/api/momence/members/${member.id}/session-memberships?${buildQuery({ sessionId: session.id, locationId: session.inPersonLocation?.id })}`)
      const eligible = result.memberships || []
      setSelectedMember(member); setAvailableMemberships(eligible); setHostMemberships([])
      if (!eligible.length) {
        const catalog = await api.get(`/api/momence/host-memberships?${buildQuery({ locationId: session.inPersonLocation?.id })}`)
        setHostMemberships(catalog.memberships || [])
      }
    } catch (e) { toast(e.message, 'error') } finally { setActing('') }
  }
  const add = (memberIdValue, waitlist = false, selectedMembershipId = null) => act(`add-${memberIdValue}`, () => api.post(`/api/momence/sessions/${session.id}/bookings`, { memberId: memberIdValue, membershipId: selectedMembershipId, waitlist, locationId: session.inPersonLocation?.id, overrideCapacity: isFull }), waitlist ? 'Member added to waitlist' : 'Member booked using the selected membership')
  const bookings = detail?.bookings || []
  const active = bookings.filter(b => !b.cancelledAt)
  const d = detail?.session || session
  const isFull = d.capacity != null && d.bookingCount >= d.capacity
  return <div className="mom-drawer-layer" role="dialog" aria-modal="true" aria-label={`Session details for ${session.name}`}><button className="mom-drawer-scrim" onClick={onClose} aria-label="Close session details" /><aside className="mom-session-drawer">
    <header><div><span className="eyebrow">Session details</span><h2>{d.name}</h2><p><Clock3 /> {fullDate(d.startsAt)} · {time(d.startsAt)}–{time(d.endsAt)}</p></div><button className="mom-icon-btn" onClick={onClose} aria-label="Close"><X /></button></header>
    {loading ? <div className="mom-drawer-loading">Loading roster…</div> : <>
      <div className="mom-class-overview">
        <section className="mom-general-card"><h3>General info</h3><div><Clock3 /><span><small>Date</small><strong>{fullDate(d.startsAt)} · {time(d.startsAt)}–{time(d.endsAt)}</strong></span></div><div><Users /><span><small>Instructor</small><strong>{personName(d.teacher)}</strong></span></div><div><MapPin /><span><small>Location</small><strong>{d.inPersonLocation?.name || 'Online session'}</strong></span></div><div><CalendarDays /><span><small>Session</small><strong>{d.isRecurring ? 'Recurring class' : 'Single class'}</strong></span></div></section>
        <div className="mom-overview-metrics"><div><small>Signups</small><strong>{d.bookingCount ?? active.length}/{d.capacity ?? '∞'}</strong></div><div><small>Duration</small><strong>{Math.max(0, Math.round((new Date(d.endsAt) - new Date(d.startsAt)) / 60000))} mins</strong></div><div><small>Checked in</small><strong>{active.filter(b => b.checkedIn).length}</strong></div><div><small>Waitlist</small><strong>{d.waitlistBookingCount ?? 0}</strong></div></div>
      </div>
      <section className="mom-roster-section"><div className="mom-section-head"><div><h3>Class roster</h3><span>{active.length} active bookings</span></div><button className="btn btn-primary" onClick={() => setShowAdd(v => !v)}><UserPlus /> Add member</button></div>
        {showAdd && <div className="mom-member-search"><Search /><input autoFocus className="input" value={memberQuery} onChange={e => { setMemberQuery(e.target.value); setSelectedMember(null); setAvailableMemberships([]); setHostMemberships([]) }} placeholder="Search Momence members by name, email or phone" />{searching && <RefreshCw className="animate-spin" />}{members.length > 0 && <div className="mom-member-results">{members.map(m => <div key={m.id}><span><strong>{personName(m)}</strong><small>{m.email || m.phoneNumber}</small></span><button disabled={!!acting} onClick={() => inspectMemberships(m)}>Memberships</button>{isFull && d.waitlistCapacity > 0 && <button disabled={!!acting} onClick={() => add(m.id, true)}>Waitlist</button>}</div>)}</div>}{selectedMember && <div className="mom-membership-picker"><div><strong>Available for {personName(selectedMember)}</strong><button onClick={() => setSelectedMember(null)}><X /></button></div>{availableMemberships.length ? availableMemberships.map(item => <button key={membershipId(item)} disabled={!!acting} onClick={() => add(selectedMember.id, false, membershipId(item))}><span>{membershipName(item)}</span><small>{item.eventCreditsLeft != null ? `${item.eventCreditsLeft} credits left` : 'Eligible for this session'}</small><strong>{isFull ? 'Book + override' : 'Book'}</strong></button>) : <><p>No eligible active membership. A new membership sale is required before booking.</p>{hostMemberships.length > 0 && <div className="mom-host-memberships"><strong>Available host memberships</strong>{hostMemberships.slice(0, 12).map(item => <span key={membershipId(item)}>{membershipName(item)}</span>)}</div>}</>}</div>}</div>}
        <div className="mom-roster">{bookings.length ? bookings.map(b => <div className={`mom-roster-row ${b.cancelledAt ? 'is-cancelled' : ''}`} key={b.id}><span className="mom-avatar">{personName(b.member).split(' ').map(x => x[0]).slice(0,2).join('')}</span><span className="mom-member-copy"><strong>{personName(b.member)}</strong><small>{b.member?.email || b.member?.phoneNumber || `Booking #${b.id}`}</small></span><span className={`mom-status ${b.cancelledAt ? 'cancelled' : b.checkedIn ? 'checked' : ''}`}>{b.cancelledAt ? 'Cancelled' : b.checkedIn ? 'Checked in' : 'Booked'}</span>{!b.cancelledAt && <div className="mom-row-actions"><button disabled={!!acting} onClick={() => act(`check-${b.id}`, () => api.put(`/api/momence/bookings/${b.id}/check-in`, { checkedIn: !b.checkedIn, locationId: session.inPersonLocation?.id }), b.checkedIn ? 'Check-in removed' : 'Member checked in')}><CheckCircle2 />{b.checkedIn ? 'Undo' : 'Check in'}</button><button className="danger" disabled={!!acting} onClick={() => setCancelBooking(b)}>Cancel</button></div>}</div>) : <div className="mom-roster-empty">No bookings yet. Add a community member to begin the roster.</div>}</div>
      </section>
      {cancelBooking && <div className="mom-cancel-panel" role="alertdialog" aria-label="Cancel booking"><div><strong>Cancel {personName(cancelBooking.member)}?</strong><span>Choose how Momence should process this cancellation.</span></div><label><input type="checkbox" checked={cancelOptions.refund} onChange={e => setCancelOptions(o => ({ ...o, refund: e.target.checked }))} /> Refund eligible credit</label><label><input type="checkbox" checked={cancelOptions.isLateCancellation} onChange={e => setCancelOptions(o => ({ ...o, isLateCancellation: e.target.checked }))} /> Mark as late cancellation</label><label><input type="checkbox" checked={cancelOptions.disableNotifications} onChange={e => setCancelOptions(o => ({ ...o, disableNotifications: e.target.checked }))} /> Do not notify member</label><div><button className="btn btn-ghost" onClick={() => setCancelBooking(null)}>Keep booking</button><button className="btn mom-danger-btn" disabled={!!acting} onClick={() => act(`cancel-${cancelBooking.id}`, () => api.delete(`/api/momence/bookings/${cancelBooking.id}`, { ...cancelOptions, locationId: session.inPersonLocation?.id }), 'Booking cancelled').then(() => setCancelBooking(null))}>Confirm cancellation</button></div></div>}
    </>}
  </aside></div>
}
