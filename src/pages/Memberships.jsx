import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, Check, Copy, ExternalLink, Package, RefreshCw, Search, ShieldAlert, Sparkles, Users } from 'lucide-react'
import { api, buildQuery } from '../api.js'
import { useApp } from '../store.jsx'
import { Modal, ModalHeader, Spinner } from '../ui.jsx'
import { catalogGroup } from './membershipModel.js'

const MARKET_LABELS = { mumbai: 'Mumbai', blr: 'Bengaluru' }
const GROUP_ORDER = ['Unlimited memberships', 'Class packages', 'Complimentary']

function marketForLocation(location) {
  const text = `${location?.name || ''} ${location?.city || ''}`.toLowerCase()
  return /(bengaluru|bangalore|indiranagar|kenkere|copper|plash)/.test(text) ? 'blr' : 'mumbai'
}

function visibleMarkets(boot) {
  if (boot?.authUser?.role === 'admin') return ['mumbai', 'blr']
  const ids = new Set(boot?.authUser?.locationIds || [])
  const assigned = new Set((boot?.locations || []).filter(location => ids.has(location.id)).map(marketForLocation))
  return ['mumbai', 'blr'].filter(market => assigned.has(market))
}

function money(value) {
  return value == null ? 'Contact studio' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

function term(item) {
  if (item.autoRenew) return `Renews every ${item.duration || 1} ${item.durationUnit || 'period'}`
  if (item.duration) return `${item.duration} ${item.durationUnit || 'days'} validity`
  return 'No fixed validity shown'
}

function credits(item) {
  if (item.numberOfEvents != null) return `${item.numberOfEvents} class credit${item.numberOfEvents === 1 ? '' : 's'}`
  if (item.money != null) return `${money(item.money)} credit`
  if (item.usageLimitForSessions != null) return `${item.usageLimitForSessions} sessions per cycle`
  return item.type === 'subscription' ? 'Membership access' : 'Flexible access'
}

function Fact({ label, value }) {
  if (value == null || value === '') return null
  return <div className="membership-fact"><span>{label}</span><strong>{value}</strong></div>
}

export default function Memberships() {
  const { boot, toast } = useApp()
  const markets = useMemo(() => visibleMarkets(boot), [boot])
  const [market, setMarket] = useState(markets[0] || '')
  const [items, setItems] = useState([])
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(null)

  useEffect(() => { if (!markets.includes(market)) setMarket(markets[0] || '') }, [market, markets])

  const load = useCallback(async () => {
    if (!market) return
    setLoading(true); setError('')
    try {
      const result = await api.get(`/api/momence-memberships?${buildQuery({ market })}`)
      setItems(result.memberships || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [market])

  useEffect(() => { load() }, [load])

  const categorizedItems = useMemo(() => items.map(item => ({ ...item, catalogGroup: catalogGroup(item) })), [items])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return categorizedItems.filter(item => (groupFilter === 'all' || item.catalogGroup === groupFilter) && (!needle || `${item.name} ${item.description} ${item.tags?.join(' ')}`.toLowerCase().includes(needle)))
  }, [categorizedItems, query, groupFilter])

  const grouped = useMemo(() => GROUP_ORDER.map(group => ({ group, items: filtered.filter(item => item.catalogGroup === group) })).filter(section => section.items.length), [filtered])

  const copyLink = async item => {
    if (!item.purchaseUrl) return toast('Momence did not provide enough information to build a purchase link', 'error')
    try {
      await navigator.clipboard.writeText(item.purchaseUrl)
      setCopied(item.id); setTimeout(() => setCopied(null), 1800)
      toast('Purchase link copied')
    } catch { toast('Could not copy the purchase link', 'error') }
  }

  if (!markets.length) return <div className="memberships-page"><div className="membership-empty"><ShieldAlert /><h2>No assigned Momence market</h2><p>Ask an admin to assign your CRM account to a Mumbai or Bengaluru studio.</p></div></div>

  return <div className="memberships-page">
    <header className="membership-page-header">
      <div><span className="membership-eyebrow">Live Momence catalog</span><h2>Memberships & packages</h2><p>Read-only access to current subscriptions, class packs and money credits.</p></div>
      <div className="membership-header-actions">
        <div className="discount-market-tabs" aria-label="Studio market">
          {markets.map(value => <button key={value} className={market === value ? 'active' : ''} onClick={() => setMarket(value)}>{MARKET_LABELS[value]}</button>)}
        </div>
        <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>{loading ? <Spinner size={13} /> : <RefreshCw size={13} />} Refresh</button>
      </div>
    </header>

    <section className="membership-summary" aria-label="Catalog summary">
      <div><Package /><span><b>{items.length}</b><small>Available offerings</small></span></div>
      <div><CalendarRange /><span><b>{categorizedItems.filter(item => item.catalogGroup === 'Unlimited memberships').length}</b><small>Unlimited</small></span></div>
      <div><Sparkles /><span><b>{categorizedItems.filter(item => item.catalogGroup === 'Complimentary').length}</b><small>Complimentary</small></span></div>
      <div><Users /><span><b>{items.reduce((sum, item) => sum + (item.activeSignups || 0), 0).toLocaleString('en-IN')}</b><small>Active signups</small></span></div>
    </section>

    <section className="membership-catalog">
      <div className="membership-toolbar">
        <label><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search membership or benefit" aria-label="Search memberships" /></label>
        <div className="membership-filter-tabs">
          <button className={groupFilter === 'all' ? 'active' : ''} onClick={() => setGroupFilter('all')}>All</button>
          {GROUP_ORDER.filter(group => categorizedItems.some(item => item.catalogGroup === group)).map(group => <button key={group} className={groupFilter === group ? 'active' : ''} onClick={() => setGroupFilter(group)}>{group.replace(' memberships', '').replace(' packages', '')}</button>)}
        </div>
      </div>

      {loading ? <div className="membership-loading"><Spinner size={18} /> Loading the {MARKET_LABELS[market]} catalog…</div>
        : error ? <div className="membership-error"><ShieldAlert /><div><b>Couldn’t load memberships</b><p>{error}</p></div><button className="btn btn-ghost" onClick={load}>Try again</button></div>
          : !filtered.length ? <div className="membership-empty"><Package /><h3>No matching memberships</h3><p>Clear the search or choose another catalog group.</p></div>
            : <div className="membership-groups">{grouped.map(section => <section key={section.group}>
              <header><div><h3>{section.group}</h3><p>{section.items.length} offering{section.items.length === 1 ? '' : 's'} available in {MARKET_LABELS[market]}</p></div></header>
              <div className="membership-list"><div className="membership-list-head"><span>Membership</span><span>Price</span><span>Validity</span><span>Access</span><span>Actions</span></div>{section.items.map(item => <article key={item.id} className="membership-row">
                <div className="membership-row-name"><div><span className="membership-kind">{item.isIntroOffer ? 'Intro offer' : item.catalogGroup}</span>{item.featured && <span className="membership-featured">Featured</span>}</div><h4>{item.name}</h4><small>{item.hostName || MARKET_LABELS[market]} · #{item.id}</small></div>
                <div className="membership-row-value" data-label="Price"><strong>{money(item.price)}</strong><small>{item.autoRenew ? 'Auto-renewing' : 'One-time'}</small></div>
                <div className="membership-row-value" data-label="Validity"><strong>{term(item)}</strong>{item.activateOnFirstUse && <small>Starts on first use</small>}</div>
                <div className="membership-row-value" data-label="Access"><strong>{credits(item)}</strong>{item.isIntroOffer && <small>Introductory offer</small>}</div>
                <div className="membership-row-actions"><button type="button" className="btn btn-ghost" onClick={() => setSelected(item)}>View details</button><button type="button" className="btn btn-soft" onClick={() => copyLink(item)} disabled={!item.purchaseUrl}>{copied === item.id ? <Check size={13} /> : <Copy size={13} />} {copied === item.id ? 'Copied' : 'Copy link'}</button></div>
              </article>)}</div>
            </section>)}</div>}
    </section>

    <Modal open={!!selected} onClose={() => setSelected(null)} width={720}>
      {selected && <div className="membership-detail">
        <ModalHeader title={selected.name} subtitle={`${selected.hostName || MARKET_LABELS[market]} · Momence #${selected.id}`} onClose={() => setSelected(null)} />
        <div className="membership-detail-price"><div><span>Current price</span><strong>{money(selected.price)}</strong></div><span className="membership-kind">{selected.catalogGroup}</span></div>
        {selected.description && <section><h3>Description</h3><p className="membership-description">{selected.description}</p></section>}
        <section><h3>Offering details</h3><div className="membership-facts">
          <Fact label="Validity" value={term(selected)} /><Fact label="Access" value={credits(selected)} />
          <Fact label="Activation" value={selected.activateOnFirstUse ? 'On first use' : 'On purchase'} />
          <Fact label="Renewal" value={selected.autoRenew ? 'Automatic' : 'Does not auto-renew'} />
          <Fact label="Session limit" value={selected.usageLimitForSessions} /><Fact label="Appointment limit" value={selected.usageLimitForAppointments} />
          <Fact label="Free trial" value={selected.freeTrial ? `${selected.freeTrialDurationInDays || 0} days` : null} />
          <Fact label="Guest passes" value={selected.isGuestPassEnabled ? selected.guestCombinedUsageLimit || 'Included' : null} />
          <Fact label="Age eligibility" value={selected.minEligibleAge != null || selected.maxEligibleAge != null ? `${selected.minEligibleAge ?? 0}–${selected.maxEligibleAge ?? 'any'} years` : null} />
          <Fact label="Active signups" value={selected.activeSignups?.toLocaleString('en-IN')} />
        </div></section>
        {!!selected.benefits?.length && <section><h3>Benefits</h3><ul className="membership-benefits">{selected.benefits.map((benefit, index) => <li key={`${benefit}-${index}`}><Check size={13} />{benefit}</li>)}</ul></section>}
        <footer><button className="btn btn-ghost" onClick={() => setSelected(null)}>Close</button><button className="btn btn-soft" onClick={() => copyLink(selected)}><Copy size={13} /> Copy purchase link</button>{selected.purchaseUrl && <a className="btn btn-primary" href={selected.purchaseUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open purchase page</a>}</footer>
      </div>}
    </Modal>
  </div>
}
