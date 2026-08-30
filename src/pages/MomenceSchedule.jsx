import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, List, MapPin, Search, Users, X, CheckCircle2, UserPlus, RefreshCw, AlertTriangle } from 'lucide-react'
import { api, buildQuery } from '../api.js'
import { useApp } from '../store.jsx'
import MemberProfileModal from '../components/MemberProfileModal.jsx'

const DAY = 86400000
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const iso = d => d.toISOString()
const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const sameDay = (a, b) => dayKey(new Date(a)) === dayKey(new Date(b))
export const personName = p => [p?.firstName, p?.lastName].filter(Boolean).join(' ') || 'Unknown member'
export const time = value => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
const fullDate = value => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
const membershipName = item => item?.name || item?.membership?.name || item?.membershipName || `Membership #${item?.id || item?.membershipId || item?.boughtMembershipId}`
const membershipId = item => item?.bookingMembershipId || item?.boughtMembershipId || item?.boughtMembership?.id || item?.id || item?.membershipId

export const formatTone = name => {
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

const initials = p => [p?.firstName, p?.lastName].filter(Boolean).map(s => s[0]).join('').toUpperCase() || '—'

function SessionCard({ session, onClick, compact = false }) {
  const remaining = session.capacity == null ? null : Math.max(0, session.capacity - session.bookingCount)
  const isFull = remaining === 0
  return <button className={`mom-session-card tone-${formatTone(session.name)} ${session.isCancelled ? 'is-cancelled' : ''} ${compact ? 'is-compact' : ''}`} onClick={() => onClick(session)}>
    <div className="mom-session-card-top">
      <span className="mom-session-time">{time(session.startsAt)}</span>
      {isFull && !session.isCancelled && <span className="mom-session-full-badge">Full</span>}
    </div>
    <strong>{session.name}</strong>
    {!compact && <span className="mom-session-instructor"><i>{initials(session.teacher)}</i>{personName(session.teacher)}</span>}
    <small>{session.bookingCount}/{session.capacity ?? '∞'} booked</small>
  </button>
}

function WeeklySchedule({ days, sessions, onOpen }) {
  const [instructorQuery, setInstructorQuery] = useState('')
  const instructors = useMemo(() => [...new Set(sessions.map(s => personName(s.teacher)).filter(n => n !== 'Unknown member'))].sort(), [sessions])
  const filtered = instructorQuery ? sessions.filter(s => personName(s.teacher) === instructorQuery) : sessions

  return <div className="mom-week-grid card">
    <div className="mom-week-grid-controls">
      <span className="mom-week-grid-total">{filtered.length} session{filtered.length === 1 ? '' : 's'} this week</span>
      <label className="mom-week-instructor-filter">
        <Users size={13} />
        <select className="input" value={instructorQuery} onChange={e => setInstructorQuery(e.target.value)}>
          <option value="">All instructors</option>
          {instructors.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
    </div>
    <div className="mom-week-grid-scroll">
      <div className="mom-week-columns-grid">
        {days.map(day => {
          const rows = filtered.filter(session => sameDay(session.startsAt, day)).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
          const isToday = sameDay(day, new Date())
          return <div key={dayKey(day)} className={`mom-week-grid-day ${isToday ? 'is-today' : ''}`}>
            <header>
              <span className="mom-week-day-name">{day.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
              <span className="mom-week-day-num font-display">{day.getDate()}</span>
              <em>{rows.length} class{rows.length === 1 ? '' : 'es'}</em>
            </header>
            <div className="mom-week-grid-list">
              {rows.length
                ? rows.map(session => <SessionCard key={session.id} session={session} onClick={onOpen} />)
                : <span className="mom-no-session">No sessions</span>}
            </div>
          </div>
        })}
      </div>
    </div>
  </div>
}

export default function MomenceSchedule() {
  const { boot, toast, setScheduleSessions, role, locationIds } = useApp()
  const [view, setView] = useState('week')
  const [anchor, setAnchor] = useState(startOfDay(new Date()))
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [location, setLocation] = useState(() => (role === 'agent' && locationIds[0]) ? locationIds[0] : '')
  // boot/locationIds arrive after first render; re-apply the agent lock then.
  useEffect(() => {
    if (role !== 'agent' || !locationIds[0]) return
    setLocation(l => (l === locationIds[0] ? l : locationIds[0]))
  }, [role, locationIds[0]])

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
  useEffect(() => {
    setScheduleSessions(sessions)
    return () => setScheduleSessions([])
  }, [sessions, setScheduleSessions])
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
  const stats = useMemo(() => {
    const totalCapacity = sessions.reduce((sum, s) => sum + (Number(s.capacity) || 0), 0)
    const totalBooked = sessions.reduce((sum, s) => sum + (Number(s.bookingCount) || 0), 0)
    const waitlist = sessions.reduce((sum, s) => sum + (Number(s.waitlistBookingCount) || 0), 0)
    const cancelled = sessions.filter(s => s.isCancelled).length
    return {
      classes: sessions.length,
      occupancy: totalCapacity ? Math.round((totalBooked / totalCapacity) * 100) : 0,
      waitlist,
      cancelled
    }
  }, [sessions])

  if (!boot?.integrations?.momence) return <div className="mom-schedule-page"><div className="mom-empty card"><AlertTriangle /><h2>Connect Momence to load the schedule</h2><p>Add the Public API credentials in Settings, then return here to manage sessions and rosters.</p></div></div>

  return <div className="mom-schedule-page">
    <section className="mom-schedule-toolbar">
      <div><span className="eyebrow">Live from Momence</span><h2 className="font-display">Schedule</h2><p>Review every Studio Session, open its roster, and complete front-desk actions.</p></div>
      <div className="mom-toolbar-actions">
        <button className="btn btn-ghost" onClick={() => setAnchor(startOfDay(new Date()))}>Today</button>
        <div className="mom-stepper"><button onClick={() => shift(-1)} aria-label="Previous period"><ChevronLeft /></button><strong className="font-display">{title}</strong><button onClick={() => shift(1)} aria-label="Next period"><ChevronRight /></button></div>
        <button className="mom-icon-btn" onClick={load} aria-label="Refresh schedule"><RefreshCw className={loading ? 'animate-spin' : ''} /></button>
      </div>
    </section>
    <section className="mom-stat-strip">
      <div><strong>{stats.classes}</strong><span>Classes</span></div>
      <div><strong>{stats.occupancy}%</strong><span>Occupancy</span></div>
      <div><strong>{stats.waitlist}</strong><span>Waitlist</span></div>
      <div><strong>{stats.cancelled}</strong><span>Cancelled</span></div>
    </section>
    <section className="mom-filterbar card">
      <div className="mom-view-tabs" role="tablist">{[['day', CalendarDays], ['week', CalendarDays], ['month', CalendarDays], ['list', List]].map(([id, Icon]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon />{id}</button>)}</div>
      <label><MapPin /><select className="input" value={location} onChange={e => setLocation(e.target.value)} disabled={role === 'agent'}><option value="">All locations</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <span className="mom-session-total">{sessions.length} sessions</span>
    </section>
    {error ? <div className="mom-error card"><AlertTriangle /><div><strong>Schedule could not be loaded</strong><span>{error}</span></div><button className="btn btn-ghost" onClick={load}>Retry</button></div> : loading ? <div className="mom-skeleton-grid">{Array.from({ length: 7 }, (_, i) => <div className="card" key={i} />)}</div> : view === 'week' ? <WeeklySchedule days={days} sessions={sessions} onOpen={openSession} /> : view === 'list' ? <div className="mom-list card">{sessions.length ? sessions.map(s => <SessionCard key={s.id} session={s} onClick={openSession} />) : <Empty />}</div> : <div className={`mom-calendar mom-calendar-${view}`}>{view === 'month' && <div className="mom-month-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}</div>}{days.map(day => {
      const daySessions = sessions.filter(s => sameDay(s.startsAt, day))
      const shown = view === 'month' ? daySessions.slice(0, 6) : daySessions
      const outsideMonth = view === 'month' && day.getMonth() !== anchor.getMonth()
      return <section key={dayKey(day)} className={`mom-day card ${sameDay(day, new Date()) ? 'is-today' : ''} ${outsideMonth ? 'is-outside-month' : ''}`}><header><span>{day.toLocaleDateString('en-IN', { weekday: 'short' })}</span><strong>{day.getDate()}</strong></header><div>{shown.map(s => <SessionCard key={s.id} session={s} onClick={openSession} compact={view === 'month'} />)}{daySessions.length > shown.length && <button className="mom-more-sessions" onClick={() => { setAnchor(day); setView('day') }}>{daySessions.length - shown.length} more</button>}{!daySessions.length && view !== 'month' && <span className="mom-no-session">No sessions</span>}</div></section>
    })}</div>}
    {selected && <SessionDrawer session={selected} detail={detail} loading={detailLoading} onClose={() => setSelected(null)} onRefresh={refreshDetail} />}
  </div>
}

const Empty = () => <div className="mom-empty"><CalendarDays /><h3>No sessions in this period</h3><p>Move to another date range or clear the location filter.</p></div>

// Same stat-tile component as Dashboard's PerfStat — kept in sync visually
// by reusing its exact classes rather than a bespoke metric block.
function PerfStat({ label, value, color, sub }) {
  return (
    <div className="perf-stat-card px-3.5 py-3 flex items-center justify-between">
      <div>
        <div className="text-xs text-slate-400">{label}</div>
        {sub && <div className="text-xs text-slate-600 mt-0.5">{sub}</div>}
      </div>
      <div className="font-display text-lg font-bold mono" style={{ color }}>{value}</div>
    </div>
  )
}

function SessionDrawer({ session, detail, loading, onClose, onRefresh }) {
  const { toast } = useApp()
  const [memberQuery, setMemberQuery] = useState('')
  const [members, setMembers] = useState([])
  const [searching, setSearching] = useState(false)
  const [acting, setActing] = useState('')
  const [showAdd, setShowAdd] = useState(true)
  const [selectedMember, setSelectedMember] = useState(null)
  const [availableMemberships, setAvailableMemberships] = useState([])
  const [hostMemberships, setHostMemberships] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [newMembershipId, setNewMembershipId] = useState('')
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [cancelBooking, setCancelBooking] = useState(null)
  const [cancelOptions, setCancelOptions] = useState({ refund: true, disableNotifications: false, isLateCancellation: false })
  const [rosterTab, setRosterTab] = useState('signups')
  const [rosterSearch, setRosterSearch] = useState('')
  const [viewingMemberId, setViewingMemberId] = useState(null)
  useEffect(() => {
    if (memberQuery.trim().length < 2) { setMembers([]); return }
    const timer = setTimeout(async () => { setSearching(true); try { const r = await api.get(`/api/momence/members?${buildQuery({ query: memberQuery, locationId: session.inPersonLocation?.id })}`); setMembers(r.members || []) } catch (e) { toast(e.message, 'error') } finally { setSearching(false) } }, 300)
    return () => clearTimeout(timer)
  }, [memberQuery])
  const act = async (key, work, success) => { setActing(key); try { await work(); toast(success); await onRefresh() } catch (e) { toast(e.message, 'error') } finally { setActing('') } }
  const inspectMemberships = async member => {
    setActing(`memberships-${member.id}`)
    try {
      const result = await api.get(`/api/momence/members/${member.id}/session-memberships?${buildQuery({ sessionId: session.id, locationId: session.inPersonLocation?.id, recurringBooking: false })}`)
      const eligible = result.memberships || []
      setSelectedMember(member); setAvailableMemberships(eligible); setHostMemberships([]); setPaymentMethods([]); setNewMembershipId(''); setPaymentMethodId('')
      if (!eligible.length) {
        const [catalog, payments] = await Promise.all([
          api.get(`/api/momence/host-memberships?${buildQuery({ locationId: session.inPersonLocation?.id })}`),
          api.get(`/api/momence/payment-methods?${buildQuery({ locationId: session.inPersonLocation?.id })}`)
        ])
        const hostOptions = (catalog.memberships || []).filter(item => item.disabled !== true && item.isDeleted !== true)
        const methodOptions = payments.paymentMethods || []
        setHostMemberships(hostOptions); setPaymentMethods(methodOptions)
        setNewMembershipId(String(hostOptions[0]?.id || '')); setPaymentMethodId(String(methodOptions[0]?.id || ''))
      }
    } catch (e) { toast(e.message, 'error') } finally { setActing('') }
  }
  const add = (memberIdValue, waitlist = false, selectedMembershipId = null) => act(`add-${memberIdValue}`, () => api.post(`/api/momence/sessions/${session.id}/bookings`, { memberId: memberIdValue, membershipId: selectedMembershipId, waitlist, locationId: session.inPersonLocation?.id, recurringBooking: false, overrideCapacity: false }), waitlist ? 'Member added to waitlist' : 'Member booked using the selected active membership')
  const buyMembership = () => act(`purchase-${selectedMember?.id}`, async () => {
    await api.post(`/api/momence/members/${selectedMember.id}/memberships`, { membershipId: newMembershipId, paymentMethodId, locationId: session.inPersonLocation?.id, isEmailSent: false })
    await inspectMemberships(selectedMember)
  }, 'Membership added to the member account. Select it below to complete the booking.')
  const bookings = detail?.bookings || []
  const active = bookings.filter(b => !b.cancelledAt)
  const waitlisted = bookings.filter(b => b.isWaitlisted || b.waitlisted || b.waitlistPosition != null || String(b.status || '').toLowerCase().includes('waitlist'))
  const cancelled = bookings.filter(b => b.cancelledAt)
  const rosterByTab = rosterTab === 'checked' ? active.filter(b => b.checkedIn)
    : rosterTab === 'cancelled' ? cancelled
      : rosterTab === 'waitlist' ? waitlisted
        : active.filter(b => !waitlisted.includes(b))
  const rosterRows = rosterByTab.filter(b => {
    const query = rosterSearch.trim().toLowerCase()
    if (!query) return true
    return `${personName(b.member)} ${b.member?.email || ''} ${b.member?.phoneNumber || ''} ${b.membership?.name || ''} ${b.membershipName || ''}`.toLowerCase().includes(query)
  })
  const d = detail?.session || session
  const isFull = d.capacity != null && d.bookingCount >= d.capacity
  return <div className="mom-drawer-layer" role="dialog" aria-modal="true" aria-label={`Session details for ${session.name}`}><button className="mom-drawer-scrim" onClick={onClose} aria-label="Close session details" /><aside className="mom-session-drawer">
    <header><div><span className="eyebrow">Session details</span><h2>{d.name}</h2><p><Clock3 /> {fullDate(d.startsAt)} · {time(d.startsAt)}–{time(d.endsAt)}</p></div><button className="mom-icon-btn" onClick={onClose} aria-label="Close"><X /></button></header>
    {loading ? <div className="mom-drawer-loading">Loading roster…</div> : <>
      <div className="mom-class-overview">
        <section className="mom-general-card"><h3>General info</h3><div><Clock3 /><span><small>Date</small><strong>{fullDate(d.startsAt)} · {time(d.startsAt)}–{time(d.endsAt)}</strong></span></div><div><Users /><span><small>Instructor</small><strong>{personName(d.teacher)}</strong></span></div><div><MapPin /><span><small>Location</small><strong>{d.inPersonLocation?.name || 'Online session'}</strong></span></div><div><CalendarDays /><span><small>Session</small><strong>{d.isRecurring ? 'Recurring class' : 'Single class'}</strong></span></div></section>
        <div className="mom-metric-row">
          <PerfStat label="Signups" value={`${d.bookingCount ?? active.length}/${d.capacity ?? '∞'}`} color="var(--accent)" />
          <PerfStat label="Duration" value={`${Math.max(0, Math.round((new Date(d.endsAt) - new Date(d.startsAt)) / 60000))}m`} color="#a78bfa" />
          <PerfStat label="Checked in" value={active.filter(b => b.checkedIn).length} color="#34d399" />
          <PerfStat label="Waitlist" value={d.waitlistBookingCount ?? 0} color="#fbbf24" />
        </div>
        <section className="mom-class-sidecard"><div><strong>Note</strong><button type="button">Edit note</button></div><p>{d.note || d.description || 'Add a note for this class.'}</p><div><strong>Recurring</strong><span>{d.isRecurring ? 'Yes' : 'No'}</span></div></section>
      </div>
      <section className="mom-roster-section"><div className="mom-section-head"><div><h3>Add customer into this class</h3><span>{active.length} current signups</span></div><button className="btn btn-primary" onClick={() => setShowAdd(v => !v)}><UserPlus /> {showAdd ? 'Hide customer search' : 'Add member'}</button></div>
        {showAdd && <div className={`mom-member-search ${selectedMember ? 'has-selected-member' : ''}`}>
          {!selectedMember && <>
            <Search /><input autoFocus className="input" value={memberQuery} onChange={e => { setMemberQuery(e.target.value); setAvailableMemberships([]); setHostMemberships([]); setPaymentMethods([]) }} placeholder="Search Momence members by name, email or phone" />{searching && <RefreshCw className="animate-spin" />}
            {members.length > 0 && <div className="mom-member-results">{members.map(m => <div className="mom-member-result-row" key={m.id}><button type="button" className="mom-member-result-name" disabled={!!acting} onClick={() => setViewingMemberId(m.id)}><span><strong>{personName(m)}</strong><small>{m.email || m.phoneNumber}</small></span></button><button type="button" className="mom-member-result-pick" disabled={!!acting} onClick={() => inspectMemberships(m)}><ChevronRight /></button></div>)}</div>}
          </>}
          {selectedMember && <div className="mom-membership-picker">
            <div><span><strong>{personName(selectedMember)}</strong><small>{selectedMember.email || selectedMember.phoneNumber}</small></span><button type="button" title="Choose another member" onClick={() => { setSelectedMember(null); setAvailableMemberships([]); setHostMemberships([]); setPaymentMethods([]) }}><X /></button></div>
            {availableMemberships.length ? <>
              <p>Choose an active membership to book this member into the session.</p>
              {availableMemberships.map(item => <button key={membershipId(item)} disabled={!!acting || isFull} onClick={() => add(selectedMember.id, false, membershipId(item))}><span>{membershipName(item)}</span><small>{item.classesLeft != null ? `${item.classesLeft} classes left` : item.endDate ? `Active until ${fullDate(item.endDate)}` : 'Active and eligible'}</small><strong>{isFull ? 'Class full' : 'Book'}</strong></button>)}
              {isFull && d.waitlistCapacity > 0 && <button className="mom-waitlist-choice" disabled={!!acting} onClick={() => add(selectedMember.id, true)}><span>Add to waitlist</span><small>This class has reached capacity.</small><strong>Waitlist</strong></button>}
            </> : <>
              <p>No active membership is eligible for this session. Add a membership to the member’s account first.</p>
              <div className="mom-purchase-membership">
                <label><span>New membership</span><select className="input" value={newMembershipId} onChange={e => setNewMembershipId(e.target.value)}>{hostMemberships.map(item => <option key={item.id} value={item.id}>{item.name} · ₹{Number(item.price || 0).toLocaleString('en-IN')}</option>)}</select></label>
                <label><span>Payment method</span><select className="input" value={paymentMethodId} onChange={e => setPaymentMethodId(e.target.value)}>{paymentMethods.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}</select></label>
                <button type="button" className="btn btn-primary" disabled={!!acting || !newMembershipId || !paymentMethodId} onClick={buyMembership}><UserPlus /> Add membership</button>
              </div>
            </>}
          </div>}
        </div>}
        <div className="mom-roster-toolbar"><div role="tablist" aria-label="Roster status"><button role="tab" aria-selected={rosterTab === 'signups'} className={rosterTab === 'signups' ? 'active' : ''} onClick={() => setRosterTab('signups')}>Signups <b>{active.length - waitlisted.length}</b></button><button role="tab" aria-selected={rosterTab === 'checked'} className={rosterTab === 'checked' ? 'active' : ''} onClick={() => setRosterTab('checked')}>Checked in <b>{active.filter(b => b.checkedIn).length}</b></button><button role="tab" aria-selected={rosterTab === 'cancelled'} className={rosterTab === 'cancelled' ? 'active' : ''} onClick={() => setRosterTab('cancelled')}>Cancelled <b>{cancelled.length}</b></button><button role="tab" aria-selected={rosterTab === 'waitlist'} className={rosterTab === 'waitlist' ? 'active' : ''} onClick={() => setRosterTab('waitlist')}>Waitlist <b>{Math.max(waitlisted.length, Number(d.waitlistBookingCount || 0))}</b></button></div><label><Search /><input value={rosterSearch} onChange={e => setRosterSearch(e.target.value)} placeholder={`Search ${rosterTab === 'checked' ? 'checked-in members' : rosterTab}…`} /></label><span><button>Options</button><button>Contact this list</button><button>Actions</button></span></div>
        <div className="mom-roster-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Customer name</th>
                <th>Time of signup</th>
                <th>Membership</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rosterRows.length ? rosterRows.map(b => (
                <tr key={b.id} className={b.cancelledAt ? 'is-cancelled' : ''}>
                  <td>
                    <button type="button" className="mom-roster-avatar-cell" disabled={!b.member?.id} title={b.member?.id ? 'View member profile' : undefined} onClick={() => b.member?.id && setViewingMemberId(b.member.id)}>
                      <span className="mom-avatar">{personName(b.member).split(' ').map(x => x[0]).slice(0, 2).join('')}</span>
                    </button>
                  </td>
                  <td>
                    <button type="button" className="mom-roster-identity" disabled={!b.member?.id} title={b.member?.id ? 'View member profile' : undefined} onClick={() => b.member?.id && setViewingMemberId(b.member.id)}>
                      <span className="mom-member-copy"><strong>{personName(b.member)}</strong><small>{b.member?.email || b.member?.phoneNumber || `Booking #${b.id}`}</small></span>
                    </button>
                  </td>
                  <td className="mom-signup-time">{b.createdAt ? new Date(b.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                  <td>
                    {b.membershipUsed
                      ? <span className="mom-payment-copy" title={b.membershipUsed.count > 1 ? `Member has ${b.membershipUsed.count} active memberships — showing the best match` : undefined}>
                        <strong>{b.membershipUsed.name}</strong>
                        <small>{b.membershipUsed.unlimited ? 'Unlimited' : b.membershipUsed.classesLeft != null ? `${b.membershipUsed.classesLeft} classes left` : b.membershipUsed.type}</small>
                      </span>
                      : <span className="mom-payment-copy"><small>No active membership found</small></span>}
                  </td>
                  <td><span className={`mom-status ${b.cancelledAt ? 'cancelled' : b.checkedIn ? 'checked' : waitlisted.includes(b) ? 'waitlisted' : ''}`}>{b.cancelledAt ? 'Cancelled' : b.checkedIn ? 'Checked in' : waitlisted.includes(b) ? 'Waitlisted' : 'Signed up'}</span></td>
                  <td>{!b.cancelledAt && !waitlisted.includes(b) ? <div className="mom-row-actions"><button disabled={!!acting} onClick={() => act(`check-${b.id}`, () => api.put(`/api/momence/bookings/${b.id}/check-in`, { checkedIn: !b.checkedIn, locationId: session.inPersonLocation?.id }), b.checkedIn ? 'Check-in removed' : 'Member checked in')}><CheckCircle2 />{b.checkedIn ? 'Undo' : 'Check in'}</button><button className="danger" disabled={!!acting} onClick={() => setCancelBooking(b)}>Cancel</button></div> : null}</td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="mom-roster-empty"><Users size={22} /><span>{rosterSearch ? `No ${rosterTab} match “${rosterSearch}”.` : `No ${rosterTab === 'checked' ? 'checked-in members' : rosterTab} for this class.`}</span></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {cancelBooking && <div className="mom-cancel-panel" role="alertdialog" aria-label="Cancel booking"><div><strong>Cancel {personName(cancelBooking.member)}?</strong><span>Choose how Momence should process this cancellation.</span></div><label><input type="checkbox" checked={cancelOptions.refund} onChange={e => setCancelOptions(o => ({ ...o, refund: e.target.checked }))} /> Refund eligible credit</label><label><input type="checkbox" checked={cancelOptions.isLateCancellation} onChange={e => setCancelOptions(o => ({ ...o, isLateCancellation: e.target.checked }))} /> Mark as late cancellation</label><label><input type="checkbox" checked={cancelOptions.disableNotifications} onChange={e => setCancelOptions(o => ({ ...o, disableNotifications: e.target.checked }))} /> Do not notify member</label><div><button className="btn btn-ghost" onClick={() => setCancelBooking(null)}>Keep booking</button><button className="btn mom-danger-btn" disabled={!!acting} onClick={() => act(`cancel-${cancelBooking.id}`, () => api.delete(`/api/momence/bookings/${cancelBooking.id}`, { ...cancelOptions, locationId: session.inPersonLocation?.id }), 'Booking cancelled').then(() => setCancelBooking(null))}>Confirm cancellation</button></div></div>}
    </>}
  </aside>
  {viewingMemberId && <MemberProfileModal memberId={viewingMemberId} locationId={session.inPersonLocation?.id} onClose={() => setViewingMemberId(null)} />}
  </div>
}
