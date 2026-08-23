import React, { useEffect, useState } from 'react'
import {
  Building2, Link2, Zap, Bell, ShieldCheck, TestTube2, ExternalLink,
  Palette, ListChecks, Users, Bot, Database, Save, Plus, X,
  Sparkles, RotateCcw, Pencil, Check, KeyRound, MessageCircle, Mail, Cloud, Send,
  Webhook, Copy, RefreshCcw, Trash2, ScrollText
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { Spinner } from '../ui.jsx'

const ACCENTS = [
  { id: 'crimson', label: 'Crimson', from: '#be123c', to: '#f43f5e' },
  { id: 'blue', label: 'Blue', from: '#1d4ed8', to: '#3b82f6' },
  { id: 'purple', label: 'Purple', from: '#6d28d9', to: '#a855f7' },
  { id: 'rani', label: 'Rani pink', from: '#be185d', to: '#ec4899' },
  { id: 'bottle', label: 'Bottle green', from: '#047857', to: '#10b981' },
  { id: 'ash', label: 'Ash gray', from: '#475569', to: '#94a3b8' },
  { id: 'blood', label: 'Blood red', from: '#7f1d1d', to: '#dc2626' },
  { id: 'deep', label: 'Deep blue', from: '#172554', to: '#1e40af' }
]

const TABS = [
  { id: 'general', label: 'General', icon: Building2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'leads', label: 'Lead config', icon: ListChecks },
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'alerts', label: 'Alerts & AI', icon: Bot },
  { id: 'integrations', label: 'Integrations', icon: Link2 },
  { id: 'data', label: 'Data', icon: Database }
]

export default function SettingsPage() {
  const { boot, refreshData, toast, theme, setTheme, accent, setAccent } = useApp()
  const [tab, setTab] = useState('general')
  const settings = boot?.settings || {}

  const [org, setOrg] = useState(settings.org || {})
  const [business, setBusiness] = useState(settings.business || {})
  const [cadence, setCadence] = useState(settings.cadence || {})
  const [notif, setNotif] = useState(settings.notifications || {})
  const [aiSet, setAiSet] = useState(settings.ai || {})
  const [ui, setUi] = useState(settings.ui || {})
  const [rr, setRr] = useState(settings.roundRobin || {})
  const [rem, setRem] = useState(settings.reminders || {})

  const [stages, setStages] = useState(boot?.stages || [])
  const [sources, setSources] = useState(boot?.sources || [])
  const [channels, setChannels] = useState(boot?.channels || [])
  const [classTypes, setClassTypes] = useState(boot?.classTypes || [])
  const [fuChannels, setFuChannels] = useState(settings.followUpChannels || ['call', 'whatsapp', 'email', 'sms'])

  const [locations, setLocations] = useState(boot?.locations || [])
  const [associates, setAssociates] = useState(boot?.associates || [])

  const [mconfig, setMconfig] = useState({ clientId: '', clientSecret: '', username: '', password: '', hostId: '' })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const [gptSet, setGptSet] = useState({ apiKey: '', model: 'gpt-4o-mini' })
  const [gptStatus, setGptStatus] = useState(null)
  const [testGpt, setTestGpt] = useState(false)
  const [testGptResult, setTestGptResult] = useState(null)

  const [respSet, setRespSet] = useState({ apiKey: '', workspaceId: '' })
  const [respStatus, setRespStatus] = useState(null)
  const [testResp, setTestResp] = useState(false)
  const [testRespResult, setTestRespResult] = useState(null)
  const [wabaTemplates, setWabaTemplates] = useState([
    { id: 'welcome', label: 'Welcome / First Reply', name: 'welcome_message', language: 'en', category: 'marketing', namespace: '', parameters: ['First name', 'Studio name'] },
    { id: 'trial', label: 'Trial Booking Follow-up', name: 'trial_booking_followup', language: 'en', category: 'utility', namespace: '', parameters: ['First name', 'Trial date', 'Studio name'] }
  ])

  const [mailSet, setMailSet] = useState({ host: '', port: 2525, user: '', pass: '', fromEmail: '', fromName: '', enabled: false })
  const [mailStatus, setMailStatus] = useState(null)
  const [testMail, setTestMail] = useState(false)
  const [testMailResult, setTestMailResult] = useState(null)
  const [mailTo, setMailTo] = useState('')
  const [mailDigest, setMailDigest] = useState(false)
  const [mailDigestResult, setMailDigestResult] = useState(null)

  const [webhooks, setWebhooks] = useState([])
  const [newWebhookName, setNewWebhookName] = useState('')
  const [creatingWebhook, setCreatingWebhook] = useState(false)
  const [webhookLogs, setWebhookLogs] = useState({})
  const [openWebhookLogs, setOpenWebhookLogs] = useState(null)

  const loadWebhooks = () => api.get('/api/webhooks').then(setWebhooks).catch(() => {})

  useEffect(() => {
    if (boot?.settings) {
      setOrg(boot.settings.org || {})
      setBusiness(boot.settings.business || {})
      setCadence(boot.settings.cadence || {})
      setNotif(boot.settings.notifications || {})
      setAiSet(boot.settings.ai || {})
      setUi(boot.settings.ui || {})
      setRr(boot.settings.roundRobin || {})
      setRem(boot.settings.reminders || {})
      setFuChannels(boot.settings.followUpChannels || ['call', 'whatsapp', 'email', 'sms'])
      setWabaTemplates(boot.settings.respondio?.wabaTemplates || [
        { id: 'welcome', label: 'Welcome / First Reply', name: 'welcome_message', language: 'en', category: 'marketing', namespace: '', parameters: ['First name', 'Studio name'] },
        { id: 'trial', label: 'Trial Booking Follow-up', name: 'trial_booking_followup', language: 'en', category: 'utility', namespace: '', parameters: ['First name', 'Trial date', 'Studio name'] }
      ])
    }
    setStages(boot?.stages || [])
    setSources(boot?.sources || [])
    setChannels(boot?.channels || [])
    setClassTypes(boot?.classTypes || [])
    setLocations(boot?.locations || [])
    setAssociates(boot?.associates || [])
    api.get('/api/momence/config').then(c => {
      setMconfig({ clientId: c.clientId || '', clientSecret: '', username: c.username || '', password: '', hostId: c.hostId || '' })
    }).catch(() => {})
    api.get('/api/gpt/status').then(s => {
      setGptStatus(s)
      setGptSet({ apiKey: '', model: s.model || 'gpt-4o-mini' })
    }).catch(() => {})
    api.get('/api/respondio/status').then(s => setRespStatus(s)).catch(() => {})
    api.get('/api/mailtrap/status').then(s => {
      setMailStatus(s)
      setMailSet(m => ({ ...m, host: s.host || '', fromEmail: s.fromEmail || '', enabled: s.enabled === true }))
    }).catch(() => {})
    loadWebhooks()
  }, [boot])

  const saveSettings = async (extra = {}) => {
    try {
      await api.put('/api/settings', {
        org, business, cadence, notifications: notif, ai: aiSet, ui, roundRobin: rr, reminders: rem,
        followUpChannels: fuChannels,
        ...extra
      })
      refreshData()
      toast('Settings saved')
      return true
    } catch (e) { toast(e.message, 'error'); return false }
  }

  const saveLists = async () => {
    try {
      await api.put('/api/lists', { stages, sources, channels, classTypes })
      refreshData()
      toast('Lead options updated')
    } catch (e) { toast(e.message, 'error') }
  }

  const saveTeams = async () => {
    try {
      await api.put('/api/locations', locations)
      await api.put('/api/associates', associates)
      refreshData()
      toast('Teams updated')
    } catch (e) { toast(e.message, 'error') }
  }

  const saveMomence = async () => {
    try {
      await api.put('/api/momence/config', mconfig)
      refreshData()
      toast('Momence credentials saved')
    } catch (e) { toast(e.message, 'error') }
  }

  const testMomence = async () => {
    setTesting(true); setTestResult(null)
    try {
      const r = await api.post('/api/momence/test', {})
      setTestResult({ ok: true, text: `Connected as ${r.profile.firstName} ${r.profile.lastName} (${r.profile.email})` })
    } catch (e) { setTestResult({ ok: false, text: e.message }) }
    finally { setTesting(false) }
  }

  const saveGpt = async () => {
    try {
      await api.put('/api/settings', { gpt: gptSet })
      refreshData(); toast('GPT settings saved')
      api.get('/api/gpt/status').then(setGptStatus).catch(() => {})
    } catch (e) { toast(e.message, 'error') }
  }

  const testGptFn = async () => {
    setTestGpt(true); setTestGptResult(null)
    try {
      const r = await api.post('/api/gpt/test', {})
      setTestGptResult({ ok: true, text: `OK — ${r.gpt?.summary ? 'generated a lead summary' : 'model responded'}` })
    } catch (e) { setTestGptResult({ ok: false, text: e.message }) }
    finally { setTestGpt(false) }
  }

  const saveResp = async () => {
    try {
      await api.put('/api/settings', { respondio: { ...respSet, wabaTemplates } })
      refreshData(); toast('Respond.io settings saved')
      api.get('/api/respondio/status').then(setRespStatus).catch(() => {})
    } catch (e) { toast(e.message, 'error') }
  }

  const testRespFn = async () => {
    setTestResp(true); setTestRespResult(null)
    try {
      const r = await api.post('/api/respondio/test', {})
      setTestRespResult({ ok: true, text: 'Connected to Respond.io workspace' })
    } catch (e) { setTestRespResult({ ok: false, text: e.message }) }
    finally { setTestResp(false) }
  }

  const saveMail = async () => {
    try {
      await api.put('/api/settings', { mailtrap: mailSet })
      refreshData(); toast('Mailtrap settings saved')
      api.get('/api/mailtrap/status').then(setMailStatus).catch(() => {})
    } catch (e) { toast(e.message, 'error') }
  }

  const testMailFn = async () => {
    if (!mailTo.trim()) { toast('Enter a recipient email first', 'error'); return }
    setTestMail(true); setTestMailResult(null)
    try {
      const r = await api.post('/api/mailtrap/test', { to: mailTo.trim() })
      setTestMailResult({ ok: !r.skipped, text: r.skipped ? `Skipped — ${r.reason || 'not configured'}` : 'Test email sent' })
    } catch (e) { setTestMailResult({ ok: false, text: e.message }) }
    finally { setTestMail(false) }
  }

  const sendDigest = async () => {
    setMailDigest(true); setMailDigestResult(null)
    try {
      const r = await api.post('/api/mailtrap/reminders', {})
      setMailDigestResult({ ok: true, text: `Digest sent to ${r.sent || 0} recipient(s)` })
    } catch (e) { setMailDigestResult({ ok: false, text: e.message }) }
    finally { setMailDigest(false) }
  }

  const createWebhook = async () => {
    const name = newWebhookName.trim()
    if (!name) { toast('Give the webhook a name first', 'error'); return }
    setCreatingWebhook(true)
    try {
      await api.post('/api/webhooks', { name })
      setNewWebhookName('')
      loadWebhooks()
      toast('Webhook created')
    } catch (e) { toast(e.message, 'error') }
    finally { setCreatingWebhook(false) }
  }

  const updateWebhookMapping = async (id, fieldMapping) => {
    try {
      await api.patch(`/api/webhooks/${id}`, { fieldMapping })
      loadWebhooks()
      toast('Field mapping saved')
    } catch (e) { toast(e.message, 'error') }
  }

  const updateWebhookDefaults = async (id, defaults) => {
    try {
      await api.patch(`/api/webhooks/${id}`, { defaults })
      loadWebhooks()
      toast('Defaults saved')
    } catch (e) { toast(e.message, 'error') }
  }

  const updateWebhookMethod = async (id, method) => {
    try {
      await api.patch(`/api/webhooks/${id}`, { method })
      loadWebhooks()
      toast(`Webhook now accepts ${method} requests`)
    } catch (e) { toast(e.message, 'error') }
  }

  const testWebhook = async (id, payload) => api.post(`/api/webhooks/${id}/test`, { payload })

  const renameWebhook = async (id, name) => {
    try { await api.patch(`/api/webhooks/${id}`, { name }); loadWebhooks() }
    catch (e) { toast(e.message, 'error') }
  }

  const regenerateWebhook = async (id) => {
    if (!window.confirm('Regenerate this key? The current URL will stop working immediately.')) return
    try {
      await api.post(`/api/webhooks/${id}/regenerate`, {})
      loadWebhooks()
      toast('Key regenerated — update the URL wherever it was configured')
    } catch (e) { toast(e.message, 'error') }
  }

  const deleteWebhook = async (id) => {
    if (!window.confirm('Delete this webhook integration? Its URL will stop working immediately.')) return
    try {
      await api.delete(`/api/webhooks/${id}`)
      loadWebhooks()
      toast('Webhook deleted')
    } catch (e) { toast(e.message, 'error') }
  }

  const toggleWebhookLogs = async (id) => {
    if (openWebhookLogs === id) { setOpenWebhookLogs(null); return }
    setOpenWebhookLogs(id)
    try {
      const logs = await api.get(`/api/webhooks/${id}/logs`)
      setWebhookLogs(l => ({ ...l, [id]: logs }))
    } catch (e) { toast(e.message, 'error') }
  }

  const copyWebhookUrl = (url) => {
    navigator.clipboard?.writeText(url).then(() => toast('URL copied')).catch(() => toast('Could not copy — copy manually', 'error'))
  }

  const resetData = async () => {
    if (!window.confirm('Reset all data to the demo dataset? This cannot be undone.')) return
    try {
      await api.post('/api/reset', {})
      refreshData()
      toast('Demo data restored')
      window.location.reload()
    } catch (e) { toast(e.message, 'error') }
  }

  const configured = boot?.settings?.momence?.configured

  return (
    <div className="p-6 max-w-[980px]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="font-display font-bold text-white text-[18px]">Settings</h2>
          <p className="text-[12.5px] text-slate-500 mt-0.5">Tweak and edit every configuration for your studio network</p>
        </div>
        <button className="btn btn-primary" onClick={() => saveSettings()}><Save size={14} /> Save all settings</button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-5 border-b border-white/6 pb-3">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors ${tab === t.id ? 'bg-rose-500/20 text-white border border-rose-400/25' : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'}`}>
              <Icon size={13} /> {t.label}
            </button>
          )
        })}
      </div>

      <div className="space-y-4">
        {tab === 'general' && (
          <>
            <Section icon={<Building2 size={15} className="text-violet-400" />} title="Organization" desc="Shown across the portal and reports.">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name"><input className="input" value={org.name || ''} onChange={e => setOrg({ ...org, name: e.target.value })} /></Field>
                <Field label="Brand"><input className="input" value={org.brand || ''} onChange={e => setOrg({ ...org, brand: e.target.value })} /></Field>
                <Field label="Currency"><select className="input" value={org.currency || 'INR'} onChange={e => setOrg({ ...org, currency: e.target.value })}>
                  <option>INR</option><option>USD</option><option>GBP</option><option>AED</option>
                </select></Field>
                <Field label="Timezone"><select className="input" value={org.timezone || 'Asia/Kolkata'} onChange={e => setOrg({ ...org, timezone: e.target.value })}>
                  <option>Asia/Kolkata</option><option>UTC</option><option>Asia/Dubai</option><option>America/New_York</option>
                </select></Field>
              </div>
            </Section>
            <Section icon={<ListChecks size={15} className="text-cyan-400" />} title="Business defaults" desc="Used when creating leads and generating follow-up plans.">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Default stage"><select className="input" value={business.defaultStage || 'New Lead'} onChange={e => setBusiness({ ...business, defaultStage: e.target.value })}>
                  {stages.map(s => <option key={s}>{s}</option>)}
                </select></Field>
                <Field label="Default source"><select className="input" value={business.defaultSource || 'Website Form'} onChange={e => setBusiness({ ...business, defaultSource: e.target.value })}>
                  {sources.map(s => <option key={s}>{s}</option>)}
                </select></Field>
                <Field label="Business hours — start"><input className="input" type="time" value={business.businessHoursStart || '10:00'} onChange={e => setBusiness({ ...business, businessHoursStart: e.target.value })} /></Field>
                <Field label="Business hours — end"><input className="input" type="time" value={business.businessHoursEnd || '20:00'} onChange={e => setBusiness({ ...business, businessHoursEnd: e.target.value })} /></Field>
                <div className="col-span-2"><Field label="Support email"><input className="input" value={business.supportEmail || ''} onChange={e => setBusiness({ ...business, supportEmail: e.target.value })} /></Field></div>
              </div>
            </Section>
            <Section icon={<Zap size={15} className="text-amber-400" />} title="Follow-up cadence" desc="AI alert thresholds for missed follow-ups and outreach.">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Follow-up due in (days)"><input className="input" type="number" value={cadence.followUpDays || 3} onChange={e => setCadence({ ...cadence, followUpDays: Number(e.target.value) })} /></Field>
                <Field label="Outreach idle (days)"><input className="input" type="number" value={cadence.outreachDays || 7} onChange={e => setCadence({ ...cadence, outreachDays: Number(e.target.value) })} /></Field>
                <Field label="Trial reminder (days)"><input className="input" type="number" value={cadence.trialReminderDays || 1} onChange={e => setCadence({ ...cadence, trialReminderDays: Number(e.target.value) })} /></Field>
              </div>
            </Section>
          </>
        )}

        {tab === 'appearance' && (
          <>
            <Section icon={<Palette size={15} className="text-fuchsia-400" />} title="Theme" desc="Switch between the dark studio look and the glossy white theme.">
              <div className="grid grid-cols-2 gap-3 max-w-[420px]">
                <ThemeCard active={theme === 'dark'} onClick={() => setTheme('dark')} title="Dark" sub="Studio dark" swatch="linear-gradient(135deg,#0b0e1a,#1c2136)" />
                <ThemeCard active={theme === 'light'} onClick={() => setTheme('light')} title="Light" sub="Glossy white" swatch="linear-gradient(135deg,#ffffff,#eef1f8)" />
              </div>
              <div className="mt-4">
                <label className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Accent color</label>
                <div className="flex gap-2">
                  {ACCENTS.map(a => (
                    <button key={a.id} onClick={() => { setAccent(a.id); setUi({ ...ui, accent: a.id }) }}
                      className={`w-10 h-10 rounded-xl transition-transform ${accent === a.id ? 'ring-2 ring-white scale-105' : 'opacity-80 hover:opacity-100'}`}
                      style={{ background: `linear-gradient(135deg, ${a.from}, ${a.to})` }} title={a.label} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4 max-w-[520px]">
                <ToggleMini label="Glossy surfaces" value={ui.glossy !== false} onChange={v => setUi({ ...ui, glossy: v })} />
                <ToggleMini label="Show follow-up columns" value={ui.showFollowUpColumns !== false} onChange={v => setUi({ ...ui, showFollowUpColumns: v })} />
                <ToggleMini label="Density — compact rows" value={ui.density === 'compact'} onChange={v => setUi({ ...ui, density: v ? 'compact' : 'comfortable' })} />
              </div>
            </Section>
          </>
        )}

        {tab === 'leads' && (
          <>
            <Section icon={<ListChecks size={15} className="text-cyan-400" />} title="Pipeline stages" desc="Stages used across the app. Rename, add or remove.">
              <TagEditor items={stages} onChange={setStages} placeholder="Stage name" />
            </Section>
            <Section icon={<ListChecks size={15} className="text-violet-400" />} title="Lead sources" desc="Where leads come from.">
              <TagEditor items={sources} onChange={setSources} placeholder="Source name" />
            </Section>
            <Section icon={<ListChecks size={15} className="text-emerald-400" />} title="Marketing channels" desc="Channel grouping used in reports.">
              <TagEditor items={channels} onChange={setChannels} placeholder="Channel name" />
            </Section>
            <Section icon={<ListChecks size={15} className="text-amber-400" />} title="Class types" desc="Fitness formats offered at the studios.">
              <TagEditor items={classTypes} onChange={setClassTypes} placeholder="Class name" />
            </Section>
            <Section icon={<ListChecks size={15} className="text-rose-400" />} title="Follow-up channels" desc="The 4 outreach indicators shown in the leads table.">
              <div className="flex flex-wrap gap-2">
                {['call', 'whatsapp', 'email', 'sms'].map(ch => (
                  <button key={ch} onClick={() => setFuChannels(c => c.includes(ch) ? c.filter(x => x !== ch) : [...c, ch])}
                    className={`btn !py-1.5 !px-3 text-[12px] capitalize ${fuChannels.includes(ch) ? 'btn-soft' : 'btn-ghost'}`}>
                    <Check size={13} /> {ch}
                  </button>
                ))}
              </div>
            </Section>
            <button className="btn btn-primary" onClick={saveLists}><Save size={14} /> Save lead options</button>
          </>
        )}

        {tab === 'teams' && (
          <>
            <Section icon={<Users size={15} className="text-cyan-400" />} title="Studio locations" desc="Add, edit or deactivate locations.">
              <div className="space-y-2">
                {locations.map(loc => (
                  <div key={loc.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/6 px-3 py-2">
                    <span className={`w-2 h-2 rounded-full ${loc.active === false ? 'bg-slate-600' : 'bg-emerald-400'}`} />
                    <input className="input flex-1 !py-1.5" value={loc.name} onChange={e => setLocations(ls => ls.map(l => l.id === loc.id ? { ...l, name: e.target.value } : l))} />
                    <input className="input !w-[140px] !py-1.5" value={loc.city} onChange={e => setLocations(ls => ls.map(l => l.id === loc.id ? { ...l, city: e.target.value } : l))} />
                    <button className="btn btn-ghost !p-2" onClick={() => setLocations(ls => ls.map(l => l.id === loc.id ? { ...l, active: l.active === false } : l))} title="Toggle active">
                      {loc.active === false ? <Sparkles size={14} className="text-slate-600" /> : <ShieldCheck size={14} className="text-emerald-400" />}
                    </button>
                    <button className="btn btn-ghost !p-2 text-rose-300" onClick={() => window.confirm(`Delete ${loc.name}? Existing leads keep their stored location id.`) && setLocations(ls => ls.filter(l => l.id !== loc.id))} title="Delete location">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={() => setLocations(ls => [...ls, { id: `loc_${Date.now()}`, name: 'New Studio', city: 'Mumbai', country: 'India', active: true, timeZone: 'Asia/Kolkata', accent: 'rose', address: '', fullAddress: '' }])}><Plus size={13} /> Add location</button>
              </div>
            </Section>
            <Section icon={<Users size={15} className="text-emerald-400" />} title="Associates" desc="Sales team members, their studio, role and monthly target.">
              <div className="space-y-2">
                {associates.map(a => (
                  <div key={a.id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] border border-white/6 px-3 py-2">
                    <input className="input !w-[180px] !py-1.5" value={a.name} onChange={e => setAssociates(as => as.map(x => x.id === a.id ? { ...x, name: e.target.value } : x))} />
                    <input className="input !w-[130px] !py-1.5" value={a.role || ''} onChange={e => setAssociates(as => as.map(x => x.id === a.id ? { ...x, role: e.target.value } : x))} />
                    <select className="input !w-auto !py-1.5" value={a.locationId} onChange={e => setAssociates(as => as.map(x => x.id === a.id ? { ...x, locationId: e.target.value } : x))}>
                      {locations.map(l => <option key={l.id} value={l.id}>{l.name.split(',')[0]}</option>)}
                    </select>
                    <input className="input !w-[70px] !py-1.5" type="number" value={a.targetMonthly || 10} onChange={e => setAssociates(as => as.map(x => x.id === a.id ? { ...x, targetMonthly: Number(e.target.value) } : x))} title="Monthly target" />
                    <button className="btn btn-ghost !p-2" onClick={() => setAssociates(as => as.map(x => x.id === a.id ? { ...x, active: x.active === false } : x))} title="Toggle active">
                      {a.active === false ? <Sparkles size={14} className="text-slate-600" /> : <ShieldCheck size={14} className="text-emerald-400" />}
                    </button>
                    <button className="btn btn-ghost !p-2 text-rose-300" onClick={() => window.confirm(`Delete ${a.name}? Existing leads keep their stored associate id.`) && setAssociates(as => as.filter(x => x.id !== a.id))} title="Delete associate">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={() => setAssociates(as => [...as, { id: `asn_${Date.now()}`, name: 'New Associate', role: 'Sales Associate', email: '', color: '#f43f5e', locationId: locations[0]?.id, active: true, targetMonthly: 10 }])}><Plus size={13} /> Add associate</button>
              </div>
            </Section>
            <button className="btn btn-primary" onClick={saveTeams}><Save size={14} /> Save teams</button>
          </>
        )}

        {tab === 'alerts' && (
          <>
            <Section icon={<Bell size={15} className="text-rose-400" />} title="Notifications & alerts" desc="AI-driven alerts across the portal.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ToggleMini label="Follow-up alerts (missed / due)" value={notif.followUpAlerts !== false} onChange={v => setNotif({ ...notif, followUpAlerts: v })} />
                <ToggleMini label="Missed outreach alerts" value={notif.missedOutreachAlerts !== false} onChange={v => setNotif({ ...notif, missedOutreachAlerts: v })} />
                <ToggleMini label="Cold lead alerts (no follow-ups)" value={notif.leadAgeAlerts !== false} onChange={v => setNotif({ ...notif, leadAgeAlerts: v })} />
                <ToggleMini label="High-value lead idle alerts" value={notif.highValueAlerts !== false} onChange={v => setNotif({ ...notif, highValueAlerts: v })} />
                <ToggleMini label="Weekly performance report" value={notif.weeklyReport === true} onChange={v => setNotif({ ...notif, weeklyReport: v })} />
                <ToggleMini label="Daily digest" value={notif.dailyDigest === true} onChange={v => setNotif({ ...notif, dailyDigest: v })} />
              </div>
            </Section>
            <Section icon={<Bell size={15} className="text-amber-400" />} title="Follow-up cadence" desc="Set the interval (and channel) for each of the 4 follow-up steps. A lead idle past its step's day count is flagged as cadence-overdue.">
              <CadenceSteps steps={cadence.steps || []} onChange={steps => setCadence({ ...cadence, steps })} />
            </Section>
            <Section icon={<Zap size={15} className="text-rose-400" />} title="Custom flag rules" desc="Define conditions that, when met, highlight the lead and raise an alert.">
              <CadenceRules rules={cadence.rules || []} onChange={rules => setCadence({ ...cadence, rules })} stages={stages} />
            </Section>
            <Section icon={<Bot size={15} className="text-fuchsia-400" />} title="AI intelligence" desc="Heuristic AI features that run locally on your data.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ToggleMini label="Auto lead scoring (0–100)" value={aiSet.autoScore !== false} onChange={v => setAiSet({ ...aiSet, autoScore: v })} />
                <ToggleMini label="Sentiment detection" value={aiSet.sentiment !== false} onChange={v => setAiSet({ ...aiSet, sentiment: v })} />
                <ToggleMini label="Follow-up message suggestions" value={aiSet.suggestions !== false} onChange={v => setAiSet({ ...aiSet, suggestions: v })} />
                <ToggleMini label="Risk classification (hot/warm/cold)" value={aiSet.riskDetection !== false} onChange={v => setAiSet({ ...aiSet, riskDetection: v })} />
              </div>
              <p className="text-[11.5px] text-slate-500 mt-3 flex items-center gap-1.5"><Sparkles size={11} /> Insights and suggested messages are generated from conversation history, stage, source and engagement — no external API key required.</p>
            </Section>
            <Section icon={<Mail size={15} className="text-cyan-400" />} title="Email reminders" desc="Off by default. When on, sends a daily digest to each associate for their own open, non-imported leads only — never a blanket copy to support, never for CSV-imported leads.">
              <Toggle on={rem.emailReminders === true} onChange={v => setRem({ ...rem, emailReminders: v })} title="Enable email reminders" desc="Also requires 'Enable outbound email' under Integrations → Mailtrap.">
                <p className="text-[11.5px] text-slate-500">Covers only leads created directly in the app (Add Lead) — leads brought in via CSV import are always excluded.</p>
              </Toggle>
            </Section>
            <Section icon={<Zap size={15} className="text-amber-400" />} title="Round-robin assignment" desc="Automatically assign incoming leads.">
              <Toggle on={rr.enabled} onChange={v => setRr({ ...rr, enabled: v })} title="Round-robin lead assignment" desc="Assign every incoming lead to the next associate in rotation for its studio.">
                <div className="flex items-center gap-3">
                  <select className="input !w-auto !py-1.5" value={rr.mode} onChange={e => setRr({ ...rr, mode: e.target.value })}>
                    <option value="fair">Fair rotation (cycle in order)</option>
                    <option value="load-balanced">Load balanced (fewest open leads)</option>
                  </select>
                  <label className="flex items-center gap-2 text-[12px] text-slate-300"><input type="checkbox" className="accent-rose-500" checked={rr.autoAssignOnImport !== false} onChange={e => setRr({ ...rr, autoAssignOnImport: e.target.checked })} /> Auto-assign on CSV import</label>
                </div>
              </Toggle>
              <Toggle on={rem.followUpEnabled !== false} onChange={v => setRem({ ...rem, followUpEnabled: v })} title="Legacy reminder toggles" desc="Backward-compatible reminder switches.">
                <label className="flex items-center gap-2 text-[12px] text-slate-300"><input type="checkbox" className="accent-rose-500" checked={rem.leadAgeEnabled !== false} onChange={e => setRem({ ...rem, leadAgeEnabled: e.target.checked })} /> Alert on cold leads with no follow-ups</label>
              </Toggle>
            </Section>
            <button className="btn btn-primary" onClick={() => saveSettings()}><Save size={14} /> Save alert & AI settings</button>
          </>
        )}

        {tab === 'integrations' && (
          <>
            <Section icon={<Link2 size={15} className={configured ? 'text-emerald-400' : 'text-slate-500'} />} title="Momence integration" desc="Map a lead's sales history, class history and memberships from their Momence member record.">
              {configured && <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20"><ShieldCheck size={11} /> Connected</span>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div><label className="label">Client ID</label><input className="input" value={mconfig.clientId} onChange={e => setMconfig({ ...mconfig, clientId: e.target.value })} placeholder="from momence.com dashboard" /></div>
                <div><label className="label">Client secret</label><input className="input" type="password" value={mconfig.clientSecret} onChange={e => setMconfig({ ...mconfig, clientSecret: e.target.value })} placeholder="••••••••" /></div>
                <div><label className="label">Username (staff login)</label><input className="input" value={mconfig.username} onChange={e => setMconfig({ ...mconfig, username: e.target.value })} /></div>
                <div><label className="label">Password</label><input className="input" type="password" value={mconfig.password} onChange={e => setMconfig({ ...mconfig, password: e.target.value })} /></div>
                <div><label className="label">Host ID (optional)</label><input className="input" value={mconfig.hostId} onChange={e => setMconfig({ ...mconfig, hostId: e.target.value })} placeholder="e.g. 13752" /></div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button className="btn btn-primary" onClick={saveMomence}>Save credentials</button>
                <button className="btn btn-ghost" onClick={testMomence} disabled={testing}>{testing ? <Spinner size={14} /> : <TestTube2 size={14} />} Test connection</button>
                <a className="btn btn-ghost !py-2 text-[12px]" href="https://api.docs.momence.com/reference/apiv2authcontroller_token" target="_blank" rel="noreferrer">API reference <ExternalLink size={12} /></a>
              </div>
              {testResult && (
                <p className={`mt-3 text-[12.5px] flex items-center gap-1.5 ${testResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testResult.ok ? '✓' : '✕'} {testResult.text}
                </p>
              )}
              {!configured && (
                <p className="mt-3 text-[11.5px] text-slate-500">Credentials stay on this server and are only used to call the Momence API (OAuth2 password grant).</p>
              )}
            </Section>

            <Section icon={<KeyRound size={15} className={gptStatus?.configured ? 'text-emerald-400' : 'text-slate-500'} />} title="OpenAI GPT enrichment" desc="Deep-dive summaries, insights and suggested messages per lead, generated by GPT.">
              {gptStatus?.configured && <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20"><ShieldCheck size={11} /> Configured · {gptStatus.model}</span>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div className="sm:col-span-2"><label className="label">API key</label><input className="input" type="password" value={gptSet.apiKey} onChange={e => setGptSet({ ...gptSet, apiKey: e.target.value })} placeholder={gptStatus?.configured ? '•••••••• (stored)' : 'sk-… from platform.openai.com'} /></div>
                <div><label className="label">Model</label><select className="input" value={gptSet.model} onChange={e => setGptSet({ ...gptSet, model: e.target.value })}>
                  <option value="gpt-4o-mini">gpt-4o-mini (fast, cheap)</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                  <option value="gpt-4.1">gpt-4.1</option>
                </select></div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button className="btn btn-primary" onClick={saveGpt}>Save GPT settings</button>
                <button className="btn btn-ghost" onClick={testGptFn} disabled={testGpt}>{testGpt ? <Spinner size={14} /> : <TestTube2 size={14} />} Test enrichment</button>
              </div>
              {testGptResult && (
                <p className={`mt-3 text-[12.5px] flex items-center gap-1.5 ${testGptResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testGptResult.ok ? '✓' : '✕'} {testGptResult.text}
                </p>
              )}
              {!gptStatus?.configured && (
                <p className="mt-3 text-[11.5px] text-slate-500">Keys can also be set via the USER_OPENAI_API_KEY environment variable, which always wins over this setting.</p>
              )}
            </Section>

            <Section icon={<MessageCircle size={15} className={respStatus?.configured ? 'text-emerald-400' : 'text-slate-500'} />} title="Respond.io messaging" desc="Send WhatsApp / SMS / email to a lead from the table or drawer and read the full conversation history.">
              {respStatus?.configured && <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20"><ShieldCheck size={11} /> Configured</span>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div className="sm:col-span-2"><label className="label">API key</label><input className="input" type="password" value={respSet.apiKey} onChange={e => setRespSet({ ...respSet, apiKey: e.target.value })} placeholder={respStatus?.configured ? '•••••••• (stored)' : 'pk_… from app.respond.io'} /></div>
                <div><label className="label">Workspace ID (optional)</label><input className="input" value={respSet.workspaceId} onChange={e => setRespSet({ ...respSet, workspaceId: e.target.value })} placeholder="e.g. 5f2b…" /></div>
              </div>
              <div className="mt-4 card p-4 bg-white/[0.02] border-white/6">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="font-semibold text-white text-[13px]">Approved WABA templates</div>
                    <div className="text-[11.5px] text-slate-500">Linked WABA templates used automatically for first WhatsApp messages and available from the leads table.</div>
                  </div>
                  <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={() => setWabaTemplates(t => [...t, { id: `tpl_${Date.now().toString(36)}`, label: 'New template', name: '', language: 'en', namespace: '', parameters: [''] }])}>
                    <Plus size={13} /> Add template
                  </button>
                </div>
                <div className="space-y-3">
                  {wabaTemplates.map((t, idx) => (
                    <div key={t.id || idx} className="rounded-xl border border-white/8 bg-white/[0.02] p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input className="input !py-1.5 !text-[12px]" placeholder="Display label" value={t.label || ''} onChange={e => setWabaTemplates(arr => arr.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))} />
                        <input className="input !py-1.5 !text-[12px]" placeholder="Template name" value={t.name || ''} onChange={e => setWabaTemplates(arr => arr.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input className="input !py-1.5 !text-[12px]" placeholder="Language code (en, en_US)" value={t.language || 'en'} onChange={e => setWabaTemplates(arr => arr.map((x, i) => i === idx ? { ...x, language: e.target.value } : x))} />
                        <select className="input !py-1.5 !text-[12px]" value={t.category || 'marketing'} onChange={e => setWabaTemplates(arr => arr.map((x, i) => i === idx ? { ...x, category: e.target.value } : x))}>
                          <option value="marketing">marketing</option>
                          <option value="utility">utility</option>
                          <option value="authentication">authentication</option>
                        </select>
                      </div>
                      <div>
                        <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Parameters</div>
                        <input className="input !py-1.5 !text-[12px]" placeholder="Comma-separated parameter labels" value={(t.parameters || []).join(', ')} onChange={e => setWabaTemplates(arr => arr.map((x, i) => i === idx ? { ...x, parameters: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } : x))} />
                      </div>
                      <div className="flex justify-end">
                        <button className="btn btn-ghost !py-1.5 !text-[12px] text-rose-300" onClick={() => setWabaTemplates(arr => arr.filter((_, i) => i !== idx))}>
                          <X size={13} /> Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button className="btn btn-primary" onClick={saveResp}>Save Respond.io settings</button>
                <button className="btn btn-ghost" onClick={testRespFn} disabled={testResp}>{testResp ? <Spinner size={14} /> : <TestTube2 size={14} />} Test connection</button>
              </div>
              {testRespResult && (
                <p className={`mt-3 text-[12.5px] flex items-center gap-1.5 ${testRespResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testRespResult.ok ? '✓' : '✕'} {testRespResult.text}
                </p>
              )}
              {!respStatus?.configured && (
                <p className="mt-3 text-[11.5px] text-slate-500">Keys can also be set via the USER_RESPONDIO_API_KEY environment variable, which always wins over this setting.</p>
              )}
            </Section>

            <Section icon={<Mail size={15} className={mailStatus?.configured ? 'text-emerald-400' : 'text-slate-500'} />} title="Mailtrap email reminders" desc="SMTP sending for test emails and the daily follow-up digest. Off by default — nothing sends until enabled below, even if credentials are filled in.">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {mailStatus?.configured ? (
                  <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20"><ShieldCheck size={11} /> Configured · {mailStatus.host}</span>
                ) : (
                  <span className="chip bg-white/5 border border-white/10 text-slate-400">Not configured</span>
                )}
              </div>
              <ToggleMini label="Enable outbound email" value={mailSet.enabled === true} onChange={v => setMailSet({ ...mailSet, enabled: v })} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div><label className="label">SMTP host</label><input className="input" value={mailSet.host} onChange={e => setMailSet({ ...mailSet, host: e.target.value })} placeholder="live.smtp.mailtrap.io" /></div>
                <div><label className="label">Port</label><input className="input" type="number" value={mailSet.port} onChange={e => setMailSet({ ...mailSet, port: Number(e.target.value) })} placeholder="2525" /></div>
                <div><label className="label">Username</label><input className="input" value={mailSet.user} onChange={e => setMailSet({ ...mailSet, user: e.target.value })} placeholder="api" /></div>
                <div><label className="label">Password</label><input className="input" type="password" value={mailSet.pass} onChange={e => setMailSet({ ...mailSet, pass: e.target.value })} placeholder={mailStatus?.configured ? '•••••••• (stored)' : 'SMTP password'} /></div>
                <div><label className="label">From email</label><input className="input" value={mailSet.fromEmail} onChange={e => setMailSet({ ...mailSet, fromEmail: e.target.value })} placeholder="studio@physique57.in" /></div>
                <div><label className="label">From name</label><input className="input" value={mailSet.fromName} onChange={e => setMailSet({ ...mailSet, fromName: e.target.value })} placeholder="Physique 57 Lead Studio" /></div>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-4">
                <button className="btn btn-primary" onClick={saveMail}>Save Mailtrap settings</button>
                <div className="flex items-center gap-2">
                  <input className="input !w-[200px] !py-1.5" placeholder="test recipient email" value={mailTo} onChange={e => setMailTo(e.target.value)} />
                  <button className="btn btn-ghost" onClick={testMailFn} disabled={testMail}>{testMail ? <Spinner size={14} /> : <Send size={13} />} Send test</button>
                </div>
              </div>
              {testMailResult && (
                <p className={`mt-3 text-[12.5px] flex items-center gap-1.5 ${testMailResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testMailResult.ok ? '✓' : '✕'} {testMailResult.text}
                </p>
              )}
              <div className="mt-4 rounded-xl bg-white/[0.03] border border-white/6 px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <div className="text-[12.5px] font-semibold text-white">Follow-up digest</div>
                  <div className="text-[11px] text-slate-500">Daily email to each associate listing only their own follow-ups due in the next 3 days or overdue — never for CSV-imported leads. Requires "Enable outbound email" and "Enable email reminders" (below) to be on.</div>
                </div>
                <button className="btn btn-soft !py-1.5 !text-[12px]" onClick={sendDigest} disabled={mailDigest}>{mailDigest ? <Spinner size={13} /> : <Send size={13} />} Send digest now</button>
              </div>
              {mailDigestResult && (
                <p className={`mt-2 text-[12.5px] flex items-center gap-1.5 ${mailDigestResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {mailDigestResult.ok ? '✓' : '✕'} {mailDigestResult.text}
                </p>
              )}
              {!mailStatus?.configured && (
                <p className="mt-3 text-[11.5px] text-slate-500">Keys can also be set via the USER_MAILTRAP_HOST / USER_MAILTRAP_USER / USER_MAILTRAP_PASS environment variables, which always win over these settings.</p>
              )}
            </Section>

            <Section icon={<Webhook size={15} className="text-emerald-400" />} title="Lead webhooks" desc="Let signup forms, landing pages or no-code tools (Zapier, Typeform, etc.) create leads automatically — pick GET, POST or PUT per integration.">
              <div className="flex items-center gap-2 mb-4">
                <input className="input flex-1" placeholder="Integration name, e.g. Landing Page Signup Form" value={newWebhookName} onChange={e => setNewWebhookName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createWebhook()} />
                <button className="btn btn-primary" onClick={createWebhook} disabled={creatingWebhook}>{creatingWebhook ? <Spinner size={14} /> : <Plus size={14} />} Create webhook</button>
              </div>
              <div className="space-y-3">
                {webhooks.map(w => (
                  <WebhookRow key={w.id}
                    webhook={w}
                    logs={webhookLogs[w.id]}
                    logsOpen={openWebhookLogs === w.id}
                    onToggleLogs={() => toggleWebhookLogs(w.id)}
                    onRename={(name) => renameWebhook(w.id, name)}
                    onSaveMapping={(m) => updateWebhookMapping(w.id, m)}
                    onSaveDefaults={(d) => updateWebhookDefaults(w.id, d)}
                    onSaveMethod={(m) => updateWebhookMethod(w.id, m)}
                    onTest={(payload) => testWebhook(w.id, payload)}
                    onRegenerate={() => regenerateWebhook(w.id)}
                    onDelete={() => deleteWebhook(w.id)}
                    onCopy={() => copyWebhookUrl(w.url)}
                  />
                ))}
                {!webhooks.length && <p className="text-[11.5px] text-slate-500">No webhook integrations yet — create one above to get a URL you can paste into any form tool.</p>}
              </div>
            </Section>
          </>
        )}

        {tab === 'data' && (
          <>
            <Section icon={<Database size={15} className="text-cyan-400" />} title="Data management" desc="Export, inspect and reset your workspace data.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/[0.03] border border-white/6 px-4 py-3 flex items-center gap-3">
                  <Database size={16} className="text-violet-400" />
                  <div className="flex-1">
                    <div className="text-[13px] font-semibold text-white">Storage</div>
                    <div className="text-[11.5px] text-slate-500">{boot?.leads?.length ?? '—'} leads in {boot?.integrations?.supabase ? 'Supabase (cloud sync)' : 'local JSON storage'}</div>
                  </div>
                  {boot?.integrations?.supabase
                    ? <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20"><ShieldCheck size={11} /> Cloud</span>
                    : <span className="chip bg-white/5 border border-white/10 text-slate-400">Local</span>}
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/6 px-4 py-3 flex items-center gap-3">
                  <Sparkles size={16} className="text-emerald-400" />
                  <div className="flex-1">
                    <div className="text-[13px] font-semibold text-white">AI engine</div>
                    <div className="text-[11.5px] text-slate-500">Rule-based scoring + optional GPT enrichment</div>
                  </div>
                  {boot?.integrations?.gpt
                    ? <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20"><ShieldCheck size={11} /> GPT on</span>
                    : <span className="chip bg-white/5 border border-white/10 text-slate-400">Heuristic</span>}
                </div>
              </div>
              {!boot?.integrations?.supabase && (
                <p className="mt-3 text-[11.5px] text-slate-500 flex items-center gap-1.5"><Cloud size={11} /> To enable cloud storage, add USER_SUPABASE_URL and USER_SUPABASE_SERVICE_ROLE_KEY to your .env. Supabase keeps the latest snapshot of every lead and syncs on every change.</p>
              )}
              <button className="btn btn-soft !mt-4" onClick={resetData}><RotateCcw size={14} /> Reset to demo data</button>
              <p className="text-[11.5px] text-slate-500 mt-2">This restores the original demo dataset with 130 leads across all 4 studios.</p>
            </Section>
          </>
        )}
      </div>

      <style>{`.label{display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px}`}</style>
    </div>
  )
}

function Section({ icon, title, desc, children }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">{icon}</span>
        <h3 className="font-display font-semibold text-white text-[14px]">{title}</h3>
      </div>
      <p className="text-[12px] text-slate-500 mb-4">{desc}</p>
      {children}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

function TagEditor({ items, onChange, placeholder }) {
  const [draft, setDraft] = useState('')
  const [editIdx, setEditIdx] = useState(-1)
  const [editVal, setEditVal] = useState('')

  const add = () => {
    const v = draft.trim()
    if (!v || items.includes(v)) { setDraft(''); return }
    onChange([...items, v]); setDraft('')
  }

  const startEdit = (i) => { setEditIdx(i); setEditVal(items[i]) }
  const commitEdit = (i) => {
    const v = editVal.trim()
    if (v) onChange(items.map((x, idx) => idx === i ? v : x))
    setEditIdx(-1)
  }
  const remove = (v) => onChange(items.filter(x => x !== v))

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {items.map((v, i) => (
          <span key={`${v}-${i}`} className="chip bg-white/5 border border-white/10 text-slate-200 group">
            {editIdx === i ? (
              <input autoFocus className="!bg-transparent outline-none !w-[120px] text-[12px] !p-0" value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => commitEdit(i)} onKeyDown={e => e.key === 'Enter' && commitEdit(i)} />
            ) : (
              <>
                {v}
                <button className="opacity-40 hover:opacity-100 transition-opacity" onClick={() => startEdit(i)}><Pencil size={10} /></button>
                <button className="opacity-40 hover:opacity-100 transition-opacity text-rose-400" onClick={() => remove(v)}><X size={10} /></button>
              </>
            )}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="input !py-1.5 flex-1" placeholder={placeholder} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button className="btn btn-ghost !py-1.5" onClick={add}><Plus size={14} /> Add</button>
      </div>
    </div>
  )
}

const CADENCE_CHANNELS = ['call', 'whatsapp', 'email', 'sms']

function CadenceSteps({ steps, onChange }) {
  const rows = [0, 1, 2, 3].map(i => steps[i] || { days: 3, channel: 'call', label: `Follow-up ${i + 1}` })
  const update = (i, patch) => {
    const next = rows.map((r, idx) => idx === i ? { ...r, ...patch } : r)
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] border border-white/6 px-3 py-2.5">
          <span className="chip bg-white/5 border border-white/10 text-slate-300 !px-2 !py-1 text-[11px] shrink-0">Follow-up {i + 1}</span>
          <input className="input !w-16 !py-1.5" type="number" min={1} value={r.days} onChange={e => update(i, { days: Number(e.target.value) || 1 })} />
          <span className="text-[11.5px] text-slate-500 shrink-0">days after previous contact</span>
          <select className="input !w-auto !py-1.5 ml-auto" value={r.channel} onChange={e => update(i, { channel: e.target.value })}>
            {CADENCE_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="input !w-40 !py-1.5" value={r.label} onChange={e => update(i, { label: e.target.value })} placeholder="Label" />
        </div>
      ))}
    </div>
  )
}

const RULE_FIELDS = [
  { id: 'stage', label: 'Stage', kind: 'stage' },
  { id: 'status', label: 'Status', kind: 'text' },
  { id: 'sourceName', label: 'Source', kind: 'text' },
  { id: 'score', label: 'AI score', kind: 'number' },
  { id: 'valueEstimate', label: 'Value estimate', kind: 'number' },
  { id: 'followUpCount', label: 'Follow-up count', kind: 'number' },
  { id: 'daysSinceCreated', label: 'Days since created', kind: 'number' },
  { id: 'daysSinceLastContact', label: 'Days since last contact', kind: 'number' }
]
const RULE_OPERATORS = [
  { id: 'eq', label: '=' }, { id: 'neq', label: '≠' },
  { id: 'gt', label: '>' }, { id: 'gte', label: '≥' },
  { id: 'lt', label: '<' }, { id: 'lte', label: '≤' },
  { id: 'contains', label: 'contains' }
]

function CadenceRules({ rules, onChange, stages }) {
  const addRule = () => onChange([...rules, {
    id: `rule_${Date.now()}`, name: 'New rule', flagLabel: 'Flagged', flagColor: '#f59e0b', active: true,
    conditions: [{ field: 'daysSinceLastContact', operator: 'gt', value: '5' }]
  }])
  const updateRule = (i, patch) => onChange(rules.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const removeRule = (i) => onChange(rules.filter((_, idx) => idx !== i))
  const updateCondition = (ri, ci, patch) => {
    const conditions = rules[ri].conditions.map((c, idx) => idx === ci ? { ...c, ...patch } : c)
    updateRule(ri, { conditions })
  }

  return (
    <div className="space-y-3">
      {rules.map((rule, ri) => (
        <div key={rule.id} className="rounded-xl border border-white/8 p-3.5 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <input className="input !py-1.5 flex-1" value={rule.name} onChange={e => updateRule(ri, { name: e.target.value })} placeholder="Rule name" />
            <input className="input !w-36 !py-1.5" value={rule.flagLabel} onChange={e => updateRule(ri, { flagLabel: e.target.value })} placeholder="Flag label" />
            <input className="!w-9 !h-9 rounded-lg border border-white/10 bg-transparent" type="color" value={rule.flagColor} onChange={e => updateRule(ri, { flagColor: e.target.value })} />
            <ToggleMini label="Active" value={rule.active !== false} onChange={v => updateRule(ri, { active: v })} />
            <button className="btn btn-ghost !py-1.5 text-rose-400" onClick={() => removeRule(ri)}><X size={13} /></button>
          </div>
          {(rule.conditions || []).map((c, ci) => (
            <div key={ci} className="flex items-center gap-2 pl-3 border-l border-white/10">
              <select className="input !w-auto !py-1.5" value={c.field} onChange={e => updateCondition(ri, ci, { field: e.target.value })}>
                {RULE_FIELDS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <select className="input !w-auto !py-1.5" value={c.operator} onChange={e => updateCondition(ri, ci, { operator: e.target.value })}>
                {RULE_OPERATORS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              {RULE_FIELDS.find(f => f.id === c.field)?.kind === 'stage' ? (
                <select className="input !w-auto !py-1.5" value={c.value} onChange={e => updateCondition(ri, ci, { value: e.target.value })}>
                  {stages.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input className="input !w-32 !py-1.5" value={c.value} onChange={e => updateCondition(ri, ci, { value: e.target.value })} />
              )}
            </div>
          ))}
        </div>
      ))}
      <button className="btn btn-ghost !py-1.5" onClick={addRule}><Plus size={14} /> Add rule</button>
      {!rules.length && <p className="text-[11.5px] text-slate-600">No custom rules yet — leads won't be flagged beyond the built-in alerts.</p>}
    </div>
  )
}

function ToggleMini({ label, value, onChange }) {
  return (
    <button className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/6 px-3.5 py-2.5 text-left" onClick={() => onChange(!value)}>
      <span className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${value ? 'bg-rose-500' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      <span className="text-[12.5px] font-medium text-slate-300 flex-1">{label}</span>
    </button>
  )
}

function ThemeCard({ active, onClick, title, sub, swatch }) {
  return (
    <button onClick={onClick} className={`rounded-2xl p-3 border transition-all ${active ? 'border-rose-400/40 bg-white/5' : 'border-white/10 bg-white/[0.02] hover:bg-white/5'}`}>
      <div className="h-16 rounded-xl mb-2" style={{ background: swatch, border: '1px solid rgba(255,255,255,0.12)' }} />
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-white">{title}</span>
        <span className="text-[11px] text-slate-500 ml-auto">{sub}</span>
        {active && <span className="w-4 h-4 rounded-full bg-emerald-400 flex items-center justify-center"><Check size={11} className="text-black" /></span>}
      </div>
    </button>
  )
}

const LEAD_FIELD_OPTIONS = [
  { id: 'fullName', label: 'Full name' },
  { id: 'firstName', label: 'First name' },
  { id: 'lastName', label: 'Last name' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'source', label: 'Source' },
  { id: 'notes', label: 'Notes' },
  { id: 'classType', label: 'Class type' },
  { id: 'channel', label: 'Channel' },
  { id: 'stage', label: 'Stage' },
  { id: 'status', label: 'Status' },
  { id: 'valueEstimate', label: 'Value estimate' },
  { id: 'associateId', label: 'Associate ID' },
  { id: 'associateName', label: 'Associate name' },
  { id: 'locationId', label: 'Location ID' },
  { id: 'center', label: 'Center' },
  { id: 'memberId', label: 'Member ID' },
  { id: 'hostId', label: 'Host ID' },
  { id: 'period', label: 'Period' },
  { id: 'purchasesMade', label: 'Purchases made' },
  { id: 'visits', label: 'Visits' },
  { id: 'trialStatus', label: 'Trial status' },
  { id: 'conversionStatus', label: 'Conversion status' },
  { id: 'retentionStatus', label: 'Retention status' }
]

const WEBHOOK_METHODS = ['POST', 'PUT', 'GET']

function WebhookRow({ webhook, logs, logsOpen, onToggleLogs, onRename, onSaveMapping, onSaveDefaults, onSaveMethod, onTest, onRegenerate, onDelete, onCopy }) {
  const [nameDraft, setNameDraft] = useState(webhook.name)
  const [mapping, setMapping] = useState(() => Object.entries(webhook.fieldMapping || {}).map(([k, v]) => ({ key: k, field: v })))
  const [mappingDirty, setMappingDirty] = useState(false)
  const [defaults, setDefaults] = useState(() => Object.entries(webhook.defaults || {}).map(([k, v]) => ({ field: k, value: v })))
  const [defaultsDirty, setDefaultsDirty] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [testPayload, setTestPayload] = useState('{\n  "name": "Jane Doe",\n  "phone_number": "9876543210",\n  "email": "jane@example.com"\n}')
  const [testResult, setTestResult] = useState(null)
  const [testError, setTestError] = useState('')
  const [testing, setTesting] = useState(false)

  const addRow = () => { setMapping(m => [...m, { key: '', field: 'fullName' }]); setMappingDirty(true) }
  const updateRow = (i, patch) => { setMapping(m => m.map((r, idx) => idx === i ? { ...r, ...patch } : r)); setMappingDirty(true) }
  const removeRow = (i) => { setMapping(m => m.filter((_, idx) => idx !== i)); setMappingDirty(true) }
  const saveMapping = () => {
    const obj = {}
    for (const r of mapping) if (r.key.trim()) obj[r.key.trim()] = r.field
    onSaveMapping(obj)
    setMappingDirty(false)
  }

  const addDefault = () => { setDefaults(d => [...d, { field: 'source', value: '' }]); setDefaultsDirty(true) }
  const updateDefault = (i, patch) => { setDefaults(d => d.map((r, idx) => idx === i ? { ...r, ...patch } : r)); setDefaultsDirty(true) }
  const removeDefault = (i) => { setDefaults(d => d.filter((_, idx) => idx !== i)); setDefaultsDirty(true) }
  const saveDefaults = () => {
    const obj = {}
    for (const r of defaults) if (r.field && String(r.value).trim()) obj[r.field] = r.value
    onSaveDefaults(obj)
    setDefaultsDirty(false)
  }

  const runTest = async () => {
    setTesting(true); setTestError(''); setTestResult(null)
    try {
      const parsed = JSON.parse(testPayload)
      const result = await onTest(parsed)
      setTestResult(result)
    } catch (e) {
      setTestError(e instanceof SyntaxError ? 'Sample payload is not valid JSON' : e.message)
    } finally { setTesting(false) }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3.5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input className="input !py-1.5 flex-1 min-w-[160px] font-semibold" value={nameDraft} onChange={e => setNameDraft(e.target.value)}
          onBlur={() => nameDraft.trim() && nameDraft !== webhook.name && onRename(nameDraft.trim())} />
        <select className="input !py-1.5 !text-[12px] !w-auto" value={webhook.method || 'POST'} onChange={e => onSaveMethod(e.target.value)} title="Request method this webhook accepts">
          {WEBHOOK_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="text-[11px] text-slate-500">Created {new Date(webhook.createdAt).toLocaleDateString()}</span>
        <span className="text-[11px] text-slate-500">· Last used {webhook.lastUsedAt ? new Date(webhook.lastUsedAt).toLocaleString() : 'never'}</span>
        <button className="btn btn-ghost !p-2" onClick={onToggleLogs} title="View call log"><ScrollText size={14} /></button>
        <button className="btn btn-ghost !p-2" onClick={onRegenerate} title="Regenerate key"><RefreshCcw size={14} /></button>
        <button className="btn btn-ghost !p-2 text-rose-400" onClick={onDelete} title="Delete"><Trash2 size={14} /></button>
      </div>
      <div className="flex items-center gap-2">
        <code className="input !py-1.5 flex-1 !text-[11.5px] overflow-x-auto whitespace-nowrap">{webhook.url}</code>
        <button className="btn btn-ghost !py-1.5" onClick={onCopy}><Copy size={13} /> Copy</button>
      </div>
      {webhook.method === 'GET' && <p className="text-[11px] text-amber-400/90">GET mode — send lead fields as query params on this URL, not a body.</p>}

      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Field mapping — incoming payload key → lead field</div>
        <div className="space-y-1.5">
          {mapping.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input !py-1.5 !text-[12px] flex-1" placeholder="incoming JSON key, e.g. full_name" value={r.key} onChange={e => updateRow(i, { key: e.target.value })} />
              <span className="text-slate-600 text-[11px]">→</span>
              <select className="input !py-1.5 !text-[12px] !w-auto" value={r.field} onChange={e => updateRow(i, { field: e.target.value })}>
                {LEAD_FIELD_OPTIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <button className="btn btn-ghost !p-1.5 text-rose-400" onClick={() => removeRow(i)}><X size={12} /></button>
            </div>
          ))}
          {!mapping.length && <p className="text-[11px] text-slate-600">No manual mapping — common key spellings (name/full_name, phone/mobile, email, etc.) are auto-detected.</p>}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={addRow}><Plus size={12} /> Add field</button>
          {mappingDirty && <button className="btn btn-soft !py-1.5 !text-[12px]" onClick={saveMapping}><Save size={12} /> Save mapping</button>}
        </div>
      </div>

      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Default values — used when the payload omits a field</div>
        <div className="space-y-1.5">
          {defaults.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <select className="input !py-1.5 !text-[12px] !w-auto" value={r.field} onChange={e => updateDefault(i, { field: e.target.value })}>
                {LEAD_FIELD_OPTIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <span className="text-slate-600 text-[11px]">=</span>
              <input className="input !py-1.5 !text-[12px] flex-1" placeholder="fixed value" value={r.value} onChange={e => updateDefault(i, { value: e.target.value })} />
              <button className="btn btn-ghost !p-1.5 text-rose-400" onClick={() => removeDefault(i)}><X size={12} /></button>
            </div>
          ))}
          {!defaults.length && <p className="text-[11px] text-slate-600">No defaults set.</p>}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={addDefault}><Plus size={12} /> Add default</button>
          {defaultsDirty && <button className="btn btn-soft !py-1.5 !text-[12px]" onClick={saveDefaults}><Save size={12} /> Save defaults</button>}
        </div>
      </div>

      <div>
        <button className="btn btn-ghost !py-1.5 !text-[12px]" onClick={() => setTestOpen(o => !o)}><TestTube2 size={12} /> {testOpen ? 'Hide test tool' : 'Test this webhook'}</button>
        {testOpen && (
          <div className="mt-2 space-y-2 rounded-lg bg-black/20 border border-white/6 p-2.5">
            <p className="text-[11px] text-slate-500">Paste a sample payload to preview the lead it would create — nothing is saved.</p>
            <textarea className="input !text-[12px] font-mono resize-none" rows={5} value={testPayload} onChange={e => setTestPayload(e.target.value)} />
            <button className="btn btn-soft !py-1.5 !text-[12px]" onClick={runTest} disabled={testing}>{testing ? <Spinner size={12} /> : <Zap size={12} />} Preview</button>
            {testError && <p className="text-[11.5px] text-rose-400">{testError}</p>}
            {testResult && (
              testResult.missing?.length ? (
                <p className="text-[11.5px] text-rose-400">Missing required field(s): {testResult.missing.join(', ')}</p>
              ) : (
                <div className="rounded-lg bg-white/[0.03] border border-white/8 p-2 space-y-1">
                  {Object.entries(testResult.preview || {}).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-[11.5px]">
                      <span className="text-slate-500 w-28 shrink-0">{k}</span>
                      <span className="text-slate-200 truncate">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {logsOpen && (
        <div className="rounded-lg bg-black/20 border border-white/6 p-2.5 max-h-52 overflow-y-auto">
          {!logs && <p className="text-[11px] text-slate-500">Loading…</p>}
          {logs && !logs.length && <p className="text-[11px] text-slate-500">No calls received yet.</p>}
          {logs && logs.map(l => (
            <div key={l.id} className="flex items-center gap-2 text-[11px] py-1 border-b border-white/5 last:border-0">
              <span className="mono text-slate-500">{new Date(l.ts).toLocaleString()}</span>
              <OutcomeChip outcome={l.outcome} />
              {l.detail && <span className="text-slate-500 truncate">{l.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function OutcomeChip({ outcome }) {
  const styles = {
    created: 'bg-emerald-500/15 text-emerald-300',
    duplicate: 'bg-amber-500/15 text-amber-300',
    validation_failed: 'bg-rose-500/15 text-rose-300',
    invalid_body: 'bg-rose-500/15 text-rose-300',
    rate_limited: 'bg-rose-500/15 text-rose-300'
  }
  return <span className={`chip !px-1.5 !py-0.5 text-[10px] ${styles[outcome] || 'bg-white/10 text-slate-300'}`}>{outcome}</span>
}

function Toggle({ on, onChange, title, desc, children }) {
  return (
    <div className="rounded-2xl border border-white/8 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h4 className="font-display font-semibold text-white text-[13px]">{title}</h4>
          <p className="text-[12px] text-slate-500 mt-0.5">{desc}</p>
        </div>
        <button onClick={() => onChange(!on)} className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${on ? 'bg-rose-500' : 'bg-white/10'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      {on && <div className="mt-4">{children}</div>}
    </div>
  )
}
