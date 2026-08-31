import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgePercent, CalendarClock, Check, Copy, Edit3, Plus, RefreshCw,
  Search, ShieldAlert, Tag, Trash2, Users, X
} from 'lucide-react'
import { api, buildQuery } from '../api.js'
import { useApp } from '../store.jsx'
import { Modal, ModalHeader, Spinner } from '../ui.jsx'
import { discountCodeStatus, discountLabel, emptyDiscountCode, toApiPayload, toEditorModel } from './discountCodeModel.js'

const MARKET_LABELS = { mumbai: 'Mumbai', blr: 'Bengaluru' }

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

function dateLabel(value) {
  if (!value) return 'No limit'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function membershipIds(code) {
  return (code?.assignedMemberships || []).map(item => Number(item?.id ?? item)).filter(Number.isFinite)
}

export default function DiscountCodes() {
  const { boot, toast } = useApp()
  const markets = useMemo(() => visibleMarkets(boot), [boot])
  const [market, setMarket] = useState(() => markets[0] || 'mumbai')
  const [codes, setCodes] = useState([])
  const [memberships, setMemberships] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [acting, setActing] = useState('')
  const loadRequest = useRef(0)

  useEffect(() => {
    if (markets.length && !markets.includes(market)) setMarket(markets[0])
  }, [market, markets])

  const load = useCallback(async () => {
    if (!markets.includes(market)) { setLoading(false); return }
    const requestId = ++loadRequest.current
    setLoading(true); setError('')
    try {
      const query = buildQuery({ market, includeExpired: true })
      const [codeData, membershipData] = await Promise.all([
        api.get(`/api/momence-discount-codes?${query}`),
        api.get(`/api/momence-discount-codes/memberships?${buildQuery({ market })}`)
      ])
      if (requestId !== loadRequest.current) return
      setCodes(codeData.codes || [])
      setMemberships(membershipData.memberships || [])
    } catch (cause) {
      if (requestId === loadRequest.current) setError(cause.message || 'Could not load Momence discount codes.')
    } finally { if (requestId === loadRequest.current) setLoading(false) }
  }, [market, markets])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return codes
    return codes.filter(code => `${code.code || ''} ${code.description || ''}`.toLowerCase().includes(query))
  }, [codes, search])

  const counts = useMemo(() => codes.reduce((out, code) => {
    out[discountCodeStatus(code)]++
    return out
  }, { active: 0, scheduled: 0, expired: 0 }), [codes])

  const mutate = async (key, action, success) => {
    if (acting) return
    setActing(key)
    try { await action(); toast(success); await load() }
    catch (cause) { toast(cause.message || 'Momence action failed', 'error'); throw cause }
    finally { setActing('') }
  }

  const toggleStatus = code => {
    const enable = discountCodeStatus(code) === 'expired'
    return mutate(`status-${code.id}`, () => api.post(`/api/momence-discount-codes/${code.id}/status?${buildQuery({ market })}`, {
      enabled: enable, code: toApiPayload(toEditorModel(code))
    }), enable ? `${code.code} enabled with no expiry` : `${code.code} disabled immediately`)
  }

  const remove = code => mutate(`delete-${code.id}`, () => api.delete(`/api/momence-discount-codes/${code.id}?${buildQuery({ market })}`), `${code.code} deleted`)
    .then(() => setConfirming(null)).catch(() => {})

  if (!markets.length) return <div className="discount-codes-page"><div className="discount-empty"><ShieldAlert /><h2>No assigned Momence market</h2><p>Ask an admin to assign your CRM account to a Mumbai or Bengaluru studio.</p></div></div>

  return <div className="discount-codes-page">
    <header className="discount-page-header">
      <div>
        <h2>Discount codes</h2>
        <p>Create and govern Momence offers for the studios assigned to your CRM account.</p>
      </div>
      <div className="discount-header-actions">
        {markets.length > 1 && <div className="discount-market-tabs" role="tablist" aria-label="Market">
          {markets.map(item => <button key={item} role="tab" aria-selected={market === item} className={market === item ? 'active' : ''} onClick={() => setMarket(item)}>{MARKET_LABELS[item]}</button>)}
        </div>}
        <button className="btn btn-ghost" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        <button className="btn btn-primary" onClick={() => setEditor({ id: null, model: emptyDiscountCode() })}><Plus size={15} /> Create code</button>
      </div>
    </header>

    <section className="discount-summary" aria-label="Discount code summary">
      <div><BadgePercent /><span><b>{codes.length}</b><small>Total codes</small></span></div>
      <div><Check /><span><b>{counts.active}</b><small>Active now</small></span></div>
      <div><CalendarClock /><span><b>{counts.scheduled}</b><small>Scheduled</small></span></div>
      <div><Tag /><span><b>{counts.expired}</b><small>Expired</small></span></div>
    </section>

    <section className="discount-table-shell">
      <div className="discount-toolbar">
        <label><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search code or description" /></label>
        <span>{MARKET_LABELS[market]} · {memberships.length} active memberships available</span>
      </div>

      {loading ? <div className="discount-loading"><Spinner size={24} /><span>Loading Momence codes and memberships…</span></div>
        : error ? <div className="discount-error"><ShieldAlert /><div><b>Momence could not be reached</b><p>{error}</p></div><button className="btn btn-ghost" onClick={load}>Try again</button></div>
          : !filtered.length ? <div className="discount-empty"><BadgePercent /><h3>{search ? 'No matching codes' : 'No discount codes yet'}</h3><p>{search ? 'Try a different search.' : `Create the first ${MARKET_LABELS[market]} offer from this workspace.`}</p></div>
            : <div className="discount-table-wrap"><table className="discount-table">
              <thead><tr><th>Code</th><th>Discount</th><th>Status</th><th>Validity</th><th>Usage</th><th>Membership scope</th><th aria-label="Actions" /></tr></thead>
              <tbody>{filtered.map(code => {
                const status = discountCodeStatus(code)
                const assigned = membershipIds(code)
                const assignedNames = assigned.map(id => memberships.find(item => item.id === id)?.name).filter(Boolean)
                return <tr key={code.id}>
                  <td data-label="Code"><div className="discount-code-name"><b>{code.code}</b><button onClick={() => navigator.clipboard?.writeText(code.code).then(() => toast('Code copied')).catch(() => toast('Clipboard access was blocked', 'error'))} title="Copy code"><Copy size={13} /></button></div><small>{code.description || 'No description'}</small></td>
                  <td data-label="Discount"><strong>{discountLabel(code)}</strong>{code.isNewCustomersOnly && <small>Newcomers only</small>}</td>
                  <td data-label="Status"><span className={`discount-status is-${status}`}>{status}</span></td>
                  <td data-label="Validity"><span>{code.validFrom ? dateLabel(code.validFrom) : 'Immediately'}</span><small>to {dateLabel(code.expiresAt)}</small></td>
                  <td data-label="Usage"><span>{code.isUnlimited ? 'Unlimited' : `${code.usageAmount ?? code.usageAmountGlobal ?? 0} uses`}</span><small>{code.numberOfRenewalsDiscountIsValidFor != null ? `${code.numberOfRenewalsDiscountIsValidFor} renewals` : 'No renewal limit'}</small></td>
                  <td data-label="Membership scope"><span>{assigned.length ? `${assigned.length} selected` : 'All eligible'}</span><small title={assignedNames.join(', ')}>{assignedNames.slice(0, 2).join(', ') || 'No membership restriction'}</small></td>
                  <td><div className="discount-row-actions">
                    <button title="Edit" onClick={() => setEditor({ id: code.id, model: toEditorModel(code) })}><Edit3 size={15} /></button>
                    <button title={status === 'expired' ? 'Enable with no expiry' : 'Disable immediately'} disabled={!!acting} onClick={() => toggleStatus(code).catch(() => {})}>{acting === `status-${code.id}` ? <Spinner size={14} /> : status === 'expired' ? <Check size={15} /> : <X size={15} />}</button>
                    <button className="danger" title="Delete" disabled={!!acting} onClick={() => setConfirming(code)}><Trash2 size={15} /></button>
                  </div></td>
                </tr>
              })}</tbody>
            </table></div>}
    </section>

    <DiscountEditor editor={editor} market={market} memberships={memberships} acting={acting} onClose={() => setEditor(null)} onSave={async model => {
      const body = toApiPayload(model)
      const key = editor.id ? `edit-${editor.id}` : 'create'
      await mutate(key, () => editor.id
        ? api.put(`/api/momence-discount-codes/${editor.id}?${buildQuery({ market })}`, body)
        : api.post(`/api/momence-discount-codes?${buildQuery({ market })}`, body), editor.id ? `${body.code} updated` : `${body.code} created`)
      setEditor(null)
    }} />

    <Modal open={!!confirming} onClose={() => !acting && setConfirming(null)} width={440}>
      {confirming && <div className="discount-confirm">
        <span className="discount-danger-icon"><Trash2 /></span>
        <h2>Delete {confirming.code}?</h2>
        <p>This permanently removes the code from Momence. This action cannot be undone.</p>
        <div><button className="btn btn-ghost" onClick={() => setConfirming(null)}>Keep code</button><button className="btn discount-delete-btn" disabled={!!acting} onClick={() => remove(confirming)}>{acting ? <Spinner size={15} /> : <Trash2 size={15} />} Delete {confirming.code}</button></div>
      </div>}
    </Modal>
  </div>
}

function DiscountEditor({ editor, market, memberships, acting, onClose, onSave }) {
  const [model, setModel] = useState(emptyDiscountCode())
  const [membershipSearch, setMembershipSearch] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { if (editor) { setModel(editor.model); setMembershipSearch(''); setError('') } }, [editor])
  const set = (key, value) => setModel(current => ({ ...current, [key]: value }))
  const filtered = memberships.filter(item => item.name.toLowerCase().includes(membershipSearch.trim().toLowerCase()))
  const selected = new Set(model.assignedMemberships || [])
  const toggleMembership = id => set('assignedMemberships', selected.has(id) ? [...selected].filter(item => item !== id) : [...selected, id])
  const submit = async event => {
    event.preventDefault(); setError('')
    if (!model.code.trim()) { setError('Code is required.'); return }
    if (model.type === 'percentage' && !(Number(model.discountPercentage) > 0 && Number(model.discountPercentage) <= 100)) { setError('Percentage must be between 1 and 100.'); return }
    if (model.type === 'fixed' && !(Number(model.discountValue) > 0)) { setError('Fixed discount must be greater than zero.'); return }
    try { await onSave(model) } catch (cause) { setError(cause.message || 'Could not save this code.') }
  }

  return <Modal open={!!editor} onClose={() => !acting && onClose()} width={880}>
    <ModalHeader title={editor?.id ? `Edit ${model.code}` : 'Create discount code'} subtitle={`${MARKET_LABELS[market]} Momence host · membership-scoped offer`} onClose={onClose} />
    <form className="discount-editor" onSubmit={submit}>
      {error && <div className="discount-form-error"><ShieldAlert size={15} />{error}</div>}
      <div className="discount-form-grid">
        <label><span>Code</span><input className="input" value={model.code} onChange={event => set('code', event.target.value.toUpperCase())} placeholder="WELCOME10" maxLength={40} /></label>
        <label><span>Description</span><input className="input" value={model.description} onChange={event => set('description', event.target.value)} placeholder="Internal context for this offer" /></label>
        <label><span>Discount type</span><select className="input" value={model.type} onChange={event => set('type', event.target.value)}><option value="percentage">Percentage</option><option value="fixed">Fixed amount (₹)</option></select></label>
        <label><span>{model.type === 'percentage' ? 'Percentage off' : 'Amount off (₹)'}</span><input className="input" type="number" min="0" max={model.type === 'percentage' ? 100 : undefined} step="0.01" value={model.type === 'percentage' ? model.discountPercentage : model.discountValue} onChange={event => set(model.type === 'percentage' ? 'discountPercentage' : 'discountValue', event.target.value)} /></label>
        <label><span>Valid from</span><input className="input" type="datetime-local" value={model.validFrom} onChange={event => set('validFrom', event.target.value)} /></label>
        <label><span>Expires at</span><input className="input" type="datetime-local" value={model.expiresAt} onChange={event => set('expiresAt', event.target.value)} /></label>
      </div>

      <div className="discount-limit-row">
        <label className="discount-check"><input type="checkbox" checked={model.isUnlimited} onChange={event => set('isUnlimited', event.target.checked)} /><span><b>Unlimited redemptions</b><small>Turn off to enforce a code-level usage limit.</small></span></label>
        {!model.isUnlimited && <label><span>Usage limit</span><input className="input" type="number" min="1" value={model.usageAmount} onChange={event => set('usageAmount', event.target.value)} /></label>}
        <label><span>Renewal limit</span><input className="input" type="number" min="0" value={model.numberOfRenewalsDiscountIsValidFor} onChange={event => set('numberOfRenewalsDiscountIsValidFor', event.target.value)} placeholder="No limit" /></label>
      </div>

      <div className="discount-eligibility">
        <label className="discount-check"><input type="checkbox" checked={model.isNewCustomersOnly} onChange={event => set('isNewCustomersOnly', event.target.checked)} /><span><b>Newcomers only</b><small>Restrict to new Momence customers.</small></span></label>
        <label className="discount-check"><input type="checkbox" checked={model.isUsableForGiftCards} onChange={event => set('isUsableForGiftCards', event.target.checked)} /><span><b>Gift cards</b><small>Allow this code for gift-card purchases.</small></span></label>
      </div>

      <section className="discount-membership-picker">
        <div className="discount-membership-head"><div><Users size={16} /><span><b>Membership scope</b><small>{selected.size ? `${selected.size} selected` : 'No selection applies the code broadly'}</small></span></div><button type="button" onClick={() => set('assignedMemberships', [])}>Clear</button></div>
        <label className="discount-membership-search"><Search size={14} /><input value={membershipSearch} onChange={event => setMembershipSearch(event.target.value)} placeholder="Search subscriptions and packages" /></label>
        <div className="discount-membership-list">
          {['Subscriptions', 'Packages'].map(group => {
            const items = filtered.filter(item => item.group === group)
            if (!items.length) return null
            return <div key={group}><h4>{group}</h4>{items.map(item => <label key={item.id} className={selected.has(item.id) ? 'selected' : ''}><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleMembership(item.id)} /><span><b>{item.name}</b><small>Momence #{item.id}</small></span><Check size={14} /></label>)}</div>
          })}
          {!filtered.length && <p>No active membership matches this search.</p>}
        </div>
      </section>

      <div className="discount-editor-actions"><p><ShieldAlert size={13} /> Disabling later will expire this code immediately.</p><span><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!!acting}>{acting ? <Spinner size={15} /> : <BadgePercent size={15} />} {editor?.id ? 'Save changes' : 'Create code'}</button></span></div>
    </form>
  </Modal>
}
