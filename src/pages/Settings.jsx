import React, { useEffect, useRef, useState } from 'react'
import {
  Building2, Link2, Zap, Bell, ShieldCheck, TestTube2, ExternalLink,
  Palette, ListChecks, Users, Bot, Database, Save, Plus, X,
  Sparkles, RotateCcw, Pencil, Check, KeyRound, MessageCircle, Mail, Cloud, Send,
  Webhook, Copy, RefreshCcw, Trash2, ScrollText, Sheet, Filter, ChevronLeft, CircleCheck,
  Search, ChevronRight, IndianRupee, CalendarRange, MapPin
} from 'lucide-react'
import {
  siOpenai, siMailtrap, siGooglesheets, siZoho, siZapier, siTypeform,
  siFacebook, siHubspot, siSlack, siCalendly, siTwilio, siInstagram,
  siIntercom, siSalesforce, siGmail, siWhatsapp, siStripe, siAirtable,
  siGooglecalendar, siZendesk, siAsana, siRazorpay
} from 'simple-icons'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { supabase } from '../lib/supabaseClient.js'
import { Spinner, Modal, ModalHeader } from '../ui.jsx'
import FieldMappingEditor from '../components/FieldMappingEditor.jsx'
import { DEFAULT_COLUMNS } from '../components/ColumnManager.jsx'
import { DEFAULT_LEAD_SOURCES, DEFAULT_MARKETING_CHANNELS, DEFAULT_CLASS_TYPES, DEFAULT_FOLLOW_UP_CHANNELS, defaultChannelForSource, uniqueClean } from '../leadConfig.js'

const ACCENTS = [
  { id: 'crimson', label: 'Crimson', from: '#be123c', to: '#f43f5e' },
  { id: 'blue', label: 'Blue', from: '#1d4ed8', to: '#3b82f6' },
  { id: 'purple', label: 'Purple', from: '#6d28d9', to: '#a855f7' },
  { id: 'rani', label: 'Rani pink', from: '#be185d', to: '#ec4899' },
  { id: 'bottle', label: 'Bottle green', from: '#047857', to: '#10b981' },
  { id: 'ash', label: 'Ash gray', from: '#475569', to: '#94a3b8' },
  { id: 'blood', label: 'Blood red', from: '#7f1d1d', to: '#dc2626' },
  { id: 'deep', label: 'Deep blue', from: '#172554', to: '#1e40af' },
  { id: 'teal', label: 'Teal', from: '#0f766e', to: '#14b8a6' },
  { id: 'gold', label: 'Gold', from: '#a16207', to: '#f59e0b' },
  { id: 'graphite', label: 'Graphite', from: '#111827', to: '#64748b' },
  { id: 'mono', label: 'Monochrome', from: '#18181b', to: '#a1a1aa' }
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

const AGENT_TAB_IDS = ['general', 'appearance']

export default function SettingsPage({ jumpTo }) {
  const { boot, refreshData, toast, theme, setTheme, accent, setAccent, role } = useApp()
  const visibleTabs = TABS.filter(t => role === 'admin' || AGENT_TAB_IDS.includes(t.id))
  const [tab, setTab] = useState(() => {
    const requested = jumpTo?.tab || new URLSearchParams(window.location.search).get('tab') || 'general'
    return role !== 'admin' && !AGENT_TAB_IDS.includes(requested) ? 'general' : requested
  })

  useEffect(() => {
    if (!jumpTo?.section) return
    const t = setTimeout(() => {
      const el = document.getElementById(jumpTo.section)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('settings-jump-highlight')
      setTimeout(() => el.classList.remove('settings-jump-highlight'), 1800)
    }, 60)
    return () => clearTimeout(t)
  }, [jumpTo?.section, jumpTo?.tab])
  const [activeIntegration, setActiveIntegration] = useState(() => new URLSearchParams(window.location.search).get('app') || null)
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
  const [fuChannels, setFuChannels] = useState(settings.followUpChannels || DEFAULT_FOLLOW_UP_CHANNELS)
  const [sourceChannelMap, setSourceChannelMap] = useState(settings.business?.sourceChannelMap || {})
  const [leadColumns, setLeadColumns] = useState(settings.leadColumns || DEFAULT_COLUMNS)

  const [locations, setLocations] = useState(boot?.locations || [])
  const [associates, setAssociates] = useState(boot?.associates || [])

  const [mconfig, setMconfig] = useState({ clientId: '', clientSecret: '', username: '', password: '', hostId: '' })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const [gptSet, setGptSet] = useState({ apiKey: '', model: 'gpt-4o-mini' })
  const [gptStatus, setGptStatus] = useState(null)
  const [testGpt, setTestGpt] = useState(false)
  const [testGptResult, setTestGptResult] = useState(null)

  const [respSet, setRespSet] = useState({ apiKey: '', workspaceId: '', session: { token: '', cookie: '', botId: '', orgId: '' } })
  const [respStatus, setRespStatus] = useState(null)
  const [syncingContacts, setSyncingContacts] = useState(false)
  const [syncContactsResult, setSyncContactsResult] = useState(null)

  const syncAllRespondioContacts = async () => {
    setSyncingContacts(true); setSyncContactsResult(null)
    try {
      const result = await api.post('/api/respondio/sync-all-contacts', {})
      setSyncContactsResult(result)
      toast(`Linked ${result.linked} of ${result.checked} leads to their Respond.io conversation`)
    } catch (e) { toast(e.message, 'error') }
    finally { setSyncingContacts(false) }
  }
  const [testResp, setTestResp] = useState(false)
  const [testRespResult, setTestRespResult] = useState(null)
  const [wabaTemplates, setWabaTemplates] = useState([
    { id: 'welcome', label: 'Welcome / First Reply', name: 'welcome_message', language: 'en', category: 'marketing', namespace: '', parameters: ['First name', 'Studio name'] },
    { id: 'trial', label: 'Trial Booking Follow-up', name: 'trial_booking_followup', language: 'en', category: 'utility', namespace: '', parameters: ['First name', 'Trial date', 'Studio name'] }
  ])

  const [mailSet, setMailSet] = useState({ host: 'live.smtp.mailtrap.io', port: 587, user: 'api', pass: '', fromEmail: 'hello@physique57india.com', fromName: 'Physique 57 India', enabled: false })
  const [mailStatus, setMailStatus] = useState(null)
  const [testMail, setTestMail] = useState(false)
  const [testMailResult, setTestMailResult] = useState(null)
  const [verifyMail, setVerifyMail] = useState(false)
  const [mailTo, setMailTo] = useState('')
  const [mailDigest, setMailDigest] = useState(false)
  const [mailDigestResult, setMailDigestResult] = useState(null)

  const [webhooks, setWebhooks] = useState([])
  const [newWebhookName, setNewWebhookName] = useState('')
  const [newWebhookSource, setNewWebhookSource] = useState('')
  const [newWebhookStage, setNewWebhookStage] = useState('')
  const [creatingWebhook, setCreatingWebhook] = useState(false)
  const [webhookLogs, setWebhookLogs] = useState({})
  const [openWebhookLogs, setOpenWebhookLogs] = useState(null)
  const [webhookFieldRef, setWebhookFieldRef] = useState(null)

  const loadWebhooks = () => api.get('/api/webhooks').then(setWebhooks).catch(() => {})

  const [sheetsConfig, setSheetsConfig] = useState(null)
  const [sheetsClientId, setSheetsClientId] = useState('')
  const [sheetsClientSecret, setSheetsClientSecret] = useState('')
  const [sheetsSheetId, setSheetsSheetId] = useState('')
  const [sheetsSheetTab, setSheetsSheetTab] = useState('')
  const [sheetsSyncing, setSheetsSyncing] = useState(false)
  const [pushScriptCopied, setPushScriptCopied] = useState(false)
  const [sheetsSyncResult, setSheetsSyncResult] = useState(null)
  const [sheetsLogs, setSheetsLogs] = useState(null)
  const [sheetsLogsOpen, setSheetsLogsOpen] = useState(false)

  const [sheetsMappingVersion, setSheetsMappingVersion] = useState(0)

  const [zohoConfig, setZohoConfig] = useState(null)
  const [zohoRefreshing, setZohoRefreshing] = useState(false)

  const loadZohoConfig = () => api.get('/api/zoho-people/config').then(setZohoConfig).catch(() => {})

  const toggleZohoShiftAware = async (on) => {
    try {
      const c = await api.put('/api/zoho-people/config', { enabled: on })
      setZohoConfig(c)
      if (on) refreshZohoShifts()
    } catch (e) { toast(e.message, 'error') }
  }

  const refreshZohoShifts = async () => {
    setZohoRefreshing(true)
    try {
      const c = await api.post('/api/zoho-people/refresh-now', {})
      setZohoConfig(c)
      toast(`On-duty shifts refreshed — ${c.onDuty?.emails?.length || 0} on shift today`)
    } catch (e) {
      loadZohoConfig()
      toast(e.message, 'error')
    }
    finally { setZohoRefreshing(false) }
  }

  const loadSheetsConfig = () => api.get('/api/google-sheets/config').then(c => {
    setSheetsConfig(c)
    setSheetsClientId(c.clientId || '')
    setSheetsSheetId(c.sheetId || '')
    setSheetsSheetTab(c.sheetTab || '')
    setSheetsMappingVersion(v => v + 1)
    // Sheet already configured but never had a mapping detected (e.g. set up
    // before auto-detect existed) — run it once so the editor doesn't sit
    // empty forever waiting for someone to click the button.
    if (c.connected && c.sheetId && c.sheetTab && !Object.keys(c.fieldMapping || {}).length) {
      detectMapping(true)
    }
  }).catch(() => {})

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
      setFuChannels(boot.settings.followUpChannels || DEFAULT_FOLLOW_UP_CHANNELS)
      setSourceChannelMap(boot.settings.business?.sourceChannelMap || {})
      setLeadColumns(boot.settings.leadColumns || DEFAULT_COLUMNS)
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
    api.get('/api/respondio/status').then(s => {
      setRespStatus(s)
      setRespSet(r => ({ ...r, session: { ...r.session, botId: r.session?.botId || s.snippetsBotId || '', orgId: r.session?.orgId || s.snippetsOrgId || '' } }))
    }).catch(() => {})
    api.get('/api/mailtrap/status').then(s => {
      setMailStatus(s)
      setMailSet(m => ({ ...m, host: s.host || 'live.smtp.mailtrap.io', port: s.port || 587, user: s.user || 'api', fromEmail: s.fromEmail || 'hello@physique57india.com', fromName: s.fromName || 'Physique 57 India', enabled: s.enabled === true }))
    }).catch(() => {})
    loadWebhooks()
    api.get('/api/webhooks/field-reference').then(d => setWebhookFieldRef(d.fields)).catch(() => setWebhookFieldRef([]))
    loadSheetsConfig()
    loadZohoConfig()
  }, [boot])

  // OAuth redirect lands back on ?tab=integrations&googleSheets=connected|error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('googleSheets')
    if (!status) return
    if (status === 'connected') { toast('Google account connected'); loadSheetsConfig() }
    else if (status === 'error') toast(params.get('message') || 'Google connection failed', 'error')
    params.delete('googleSheets'); params.delete('message')
    const qs = params.toString()
    window.history.replaceState({}, '', qs ? `?${qs}` : window.location.pathname)
  }, [])

  const saveSettings = async (extra = {}) => {
    try {
      await api.put('/api/settings', {
        org, business, cadence, notifications: notif, ai: aiSet, ui, roundRobin: rr, reminders: rem,
        followUpChannels: fuChannels, leadColumns,
        ...extra
      })
      refreshData()
      toast('Settings saved')
      return true
    } catch (e) { toast(e.message, 'error'); return false }
  }

  const saveLists = async () => {
    try {
      const normalizedSourceChannelMap = Object.fromEntries(sources.map(source => [source, sourceChannelMap[source] || defaultChannelForSource(source)]))
      await api.put('/api/lists', { stages, sources, channels, classTypes })
      await api.put('/api/settings', { business: { ...business, sourceChannelMap: normalizedSourceChannelMap }, followUpChannels: fuChannels, leadColumns })
      setSourceChannelMap(normalizedSourceChannelMap)
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
      // Blank session fields mean "leave as-is" (they're re-pasted only
      // when the previous session expires), not "clear this" — omit them
      // so the backend's merge doesn't wipe a still-valid token/cookie.
      const session = Object.fromEntries(Object.entries(respSet.session || {}).filter(([, v]) => String(v || '').trim()))
      await api.put('/api/settings', { respondio: { ...respSet, ...(Object.keys(session).length ? { session } : {}), wabaTemplates } })
      setRespSet(r => ({ ...r, session: { ...r.session, token: '', cookie: '' } }))
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

  const verifyMailFn = async () => {
    setVerifyMail(true); setTestMailResult(null)
    try {
      const r = await api.post('/api/mailtrap/verify', {})
      setTestMailResult({ ok: true, text: `SMTP verified — ${r.host}:${r.port} (${r.user})` })
    } catch (e) { setTestMailResult({ ok: false, text: e.message }) }
    finally { setVerifyMail(false) }
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
      const defaults = {}
      if (newWebhookSource) defaults.source = newWebhookSource
      if (newWebhookStage) defaults.stage = newWebhookStage
      await api.post('/api/webhooks', { name, defaults })
      setNewWebhookName('')
      setNewWebhookSource('')
      setNewWebhookStage('')
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

  const detectWebhookMapping = async (id, payload) => {
    try {
      const { keys, suggested } = await api.post(`/api/webhooks/${id}/detect-mapping`, { payload })
      if (Object.keys(suggested).length) {
        const w = webhooks.find(x => x.id === id)
        const merged = { ...(w?.fieldMapping || {}), ...suggested }
        await api.patch(`/api/webhooks/${id}`, { fieldMapping: merged })
        loadWebhooks()
        toast(`Auto-detected ${Object.keys(suggested).length} of ${keys.length} field${keys.length === 1 ? '' : 's'}`)
      } else {
        toast('No new fields matched automatically from this sample — map the rest by hand above')
      }
    } catch (e) { toast(e.message, 'error') }
  }

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

  const saveSheetsCredentials = async () => {
    try {
      await api.put('/api/google-sheets/config', { clientId: sheetsClientId.trim(), clientSecret: sheetsClientSecret.trim() })
      setSheetsClientSecret('')
      loadSheetsConfig()
      toast('Google OAuth client saved')
    } catch (e) { toast(e.message, 'error') }
  }

  const [detectingMapping, setDetectingMapping] = useState(false)

  const detectMapping = async (silent) => {
    setDetectingMapping(true)
    try {
      const [{ header, suggested }, current] = await Promise.all([
        api.get('/api/google-sheets/detect-mapping'),
        api.get('/api/google-sheets/config')
      ])
      if (Object.keys(suggested).length) {
        const merged = { ...(current?.fieldMapping || {}), ...suggested }
        await api.put('/api/google-sheets/config', { fieldMapping: merged })
        loadSheetsConfig()
        toast(`Auto-detected ${Object.keys(suggested).length} of ${header.length} column${header.length === 1 ? '' : 's'}`)
      } else if (!silent) {
        toast(header.length ? 'No new columns matched automatically — map the rest by hand below' : 'Sheet has no header row yet')
      }
    } catch (e) { if (!silent) toast(e.message, 'error') }
    finally { setDetectingMapping(false) }
  }

  const saveSheetTarget = async () => {
    try {
      await api.put('/api/google-sheets/config', { sheetId: sheetsSheetId.trim(), sheetTab: sheetsSheetTab.trim() })
      toast('Sheet saved')
      await detectMapping(true)
      loadSheetsConfig()
    } catch (e) { toast(e.message, 'error') }
  }

  const saveSheetsMapping = async (fieldMapping) => {
    try {
      await api.put('/api/google-sheets/config', { fieldMapping })
      loadSheetsConfig()
      toast('Field mapping saved')
    } catch (e) { toast(e.message, 'error') }
  }

  const saveSheetsDefaults = async (defaults) => {
    try {
      await api.put('/api/google-sheets/config', { defaults })
      loadSheetsConfig()
      toast('Defaults saved')
    } catch (e) { toast(e.message, 'error') }
  }

  // A full-page navigation cannot send an Authorization header, so the session
  // token rides in the query string — the same exemption /api/events uses.
  const connectGoogle = async () => {
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      if (!token) { toast('Session expired — sign in again', 'error'); return }
      const base = await api.resolveBase()
      window.location.href = `${base}/api/google-sheets/oauth/start?token=${encodeURIComponent(token)}`
    } catch (e) { toast(e.message, 'error') }
  }

  const disconnectGoogle = async () => {
    if (!window.confirm('Disconnect this Google account? Syncing will stop until reconnected.')) return
    try { await api.post('/api/google-sheets/disconnect', {}); loadSheetsConfig(); toast('Google account disconnected') }
    catch (e) { toast(e.message, 'error') }
  }

  // The script carries this deployment's URL and a secret, so it is fetched
  // rather than documented — a hand-typed URL or secret is the setup step most
  // likely to go wrong.
  const copyPushScript = async () => {
    try {
      const { script } = await api.get('/api/google-sheets/apps-script')
      await navigator.clipboard.writeText(script)
      setPushScriptCopied(true)
      setTimeout(() => setPushScriptCopied(false), 6000)
      toast('Push script copied — paste it into the sheet\'s Apps Script editor')
    } catch (e) { toast(e.message, 'error') }
  }

  const syncSheetNow = async (force) => {
    if (force && !window.confirm('Force full resync discards the stored snapshot, so the sheet\'s current value wins every field — any app-side edit the sheet does not know about is overwritten. Continue?')) return
    setSheetsSyncing(true); setSheetsSyncResult(null)
    try {
      const counts = await api.post('/api/google-sheets/sync-now', { force: !!force })
      setSheetsSyncResult({ ok: true, ...counts })
      loadSheetsConfig()
      refreshData()
      toast(`Reconciled — ${counts.created} created, ${counts.merged || 0} merged${counts.deleted ? `, ${counts.deleted} deleted` : ''}`)
    } catch (e) {
      setSheetsSyncResult({ ok: false, error: e.message })
      toast(e.message, 'error')
    } finally { setSheetsSyncing(false) }
  }

  const toggleSheetsLogs = async () => {
    if (sheetsLogsOpen) { setSheetsLogsOpen(false); return }
    setSheetsLogsOpen(true)
    try { setSheetsLogs(await api.get('/api/google-sheets/logs')) } catch (e) { toast(e.message, 'error') }
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

  const [dedupeChecking, setDedupeChecking] = useState(false)
  const [dedupePreview, setDedupePreview] = useState(null)
  const [dedupeRemoving, setDedupeRemoving] = useState(false)
  const [dedupeReviewOpen, setDedupeReviewOpen] = useState(false)
  const [dedupeSelected, setDedupeSelected] = useState(() => new Set())

  const checkDuplicates = async () => {
    setDedupeChecking(true); setDedupePreview(null)
    try {
      const result = await api.post('/api/leads/dedupe', { dryRun: true })
      setDedupePreview(result)
      setDedupeSelected(new Set((result.groups || []).flatMap(g => g.filter(l => l.status === 'remove').map(l => l.id))))
    }
    catch (e) { toast(e.message, 'error') }
    finally { setDedupeChecking(false) }
  }

  const toggleDedupeSelected = (id) => {
    setDedupeSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const removeDuplicates = async () => {
    const removeIds = [...dedupeSelected]
    if (!removeIds.length) { toast('Nothing selected to remove', 'error'); return }
    if (!window.confirm(`Remove ${removeIds.length} selected duplicate lead(s)? This cannot be undone.`)) return
    setDedupeRemoving(true)
    try {
      const result = await api.post('/api/leads/dedupe', { dryRun: false, removeIds })
      toast(`Removed ${result.removed} duplicate lead${result.removed === 1 ? '' : 's'}`)
      setDedupePreview(null)
      setDedupeReviewOpen(false)
      refreshData()
    } catch (e) { toast(e.message, 'error') }
    finally { setDedupeRemoving(false) }
  }

  const [dedupeRemovingAll, setDedupeRemovingAll] = useState(false)

  // Bypasses the checkbox selection entirely — removes every non-oldest
  // lead in every duplicate group (the server's default when no explicit
  // removeIds are passed), regardless of what's checked in the review table.
  const removeAllDuplicates = async () => {
    if (!dedupePreview?.wouldRemove) return
    if (!window.confirm(`Remove all ${dedupePreview.wouldRemove} duplicate lead(s) across ${dedupePreview.duplicateGroups} group(s)? The oldest of each group is kept, the rest deleted — cannot be undone.`)) return
    setDedupeRemovingAll(true)
    try {
      const result = await api.post('/api/leads/dedupe', { dryRun: false })
      toast(`Removed ${result.removed} duplicate lead${result.removed === 1 ? '' : 's'}`)
      setDedupePreview(null)
      setDedupeReviewOpen(false)
      refreshData()
    } catch (e) { toast(e.message, 'error') }
    finally { setDedupeRemovingAll(false) }
  }

  const configured = boot?.integrations?.momence

  return (
    <div className={`p-6 settings-page ${['integrations', 'teams'].includes(tab) ? 'settings-integrations-page' : 'max-w-[980px]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="font-display font-bold text-white text-lg">Settings</h2>
          <p className="text-sm text-slate-500 mt-0.5">Tweak and edit every configuration for your studio network</p>
        </div>
        {tab !== 'integrations' && <button className="btn btn-primary" onClick={() => saveSettings()}><Save size={14} /> Save all settings</button>}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-5 border-b border-white/6 pb-3">
        {visibleTabs.map(t => {
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${tab === t.id ? 'bg-rose-500/20 text-white border border-rose-400/25' : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'}`}>
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
                <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Accent color</label>
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
                <ToggleMini label="Wide table workspace" value={ui.wideTables === true} onChange={v => setUi({ ...ui, wideTables: v })} />
                <ToggleMini label="Compact metric cards" value={ui.compactMetrics === true} onChange={v => setUi({ ...ui, compactMetrics: v })} />
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
              <TagEditor items={sources} onChange={setSources} placeholder="Source name" allowBulk defaults={DEFAULT_LEAD_SOURCES} />
            </Section>
            <Section icon={<ListChecks size={15} className="text-emerald-400" />} title="Marketing channels" desc="Channel grouping used in reports.">
              <TagEditor items={channels} onChange={setChannels} placeholder="Channel name" allowBulk defaults={DEFAULT_MARKETING_CHANNELS} />
              <SourceChannelMapper sources={sources} channels={channels} value={sourceChannelMap} onChange={setSourceChannelMap} />
            </Section>
            <Section icon={<ListChecks size={15} className="text-amber-400" />} title="Class types" desc="Fitness formats offered at the studios.">
              <TagEditor items={classTypes} onChange={setClassTypes} placeholder="Class name" allowBulk defaults={DEFAULT_CLASS_TYPES} />
            </Section>
            <Section icon={<ListChecks size={15} className="text-rose-400" />} title="Follow-up channels" desc="Channels available for follow-up cadence and lead activity.">
              <TagEditor items={fuChannels} onChange={setFuChannels} placeholder="New follow-up channel" defaults={DEFAULT_FOLLOW_UP_CHANNELS} />
            </Section>
            <Section icon={<Filter size={15} className="text-fuchsia-400" />} title="Lead table column definitions" desc="Define each column's data type and create formula, conditional, or dependent columns. Saved definitions become the default table schema.">
              <LeadColumnSchemaEditor columns={leadColumns} onChange={setLeadColumns} />
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
                <button className="btn btn-ghost !py-1.5 !text-sm" onClick={() => setLocations(ls => [...ls, { id: `loc_${Date.now()}`, name: 'New Studio', city: 'Mumbai', country: 'India', active: true, timeZone: 'Asia/Kolkata', accent: 'rose', address: '', fullAddress: '' }])}><Plus size={13} /> Add location</button>
              </div>
            </Section>
            <Section icon={<Users size={15} className="text-emerald-400" />} title="Associates" desc="Assign studio coverage and define monthly revenue and conversion targets.">
              <div className="associate-settings-head" aria-hidden="true">
                <span>Associate</span><span>Role</span><span>Studios</span><span>Revenue target</span><span>Conversion</span><span>State</span>
              </div>
              <div className="space-y-2">
                {associates.map(a => (
                  <div key={a.id} className="associate-settings-row">
                    <input className="input !py-1.5" value={a.name} aria-label="Associate name" onChange={e => setAssociates(as => as.map(x => x.id === a.id ? { ...x, name: e.target.value } : x))} />
                    <input className="input !py-1.5" value={a.role || ''} aria-label={`${a.name} role`} onChange={e => setAssociates(as => as.map(x => x.id === a.id ? { ...x, role: e.target.value } : x))} />
                    <StudioAssignmentPicker associate={a} locations={locations} onChange={locationIds => setAssociates(as => as.map(x => x.id === a.id ? { ...x, locationIds, locationId: locationIds[0] || null } : x))} />
                    <label className="associate-target-input"><IndianRupee size={13} /><input className="input !py-1.5" type="number" min="0" step="1000" value={a.revenueTargetMonthly || ''} placeholder="0" aria-label={`${a.name} monthly revenue target`} onChange={e => setAssociates(as => as.map(x => x.id === a.id ? { ...x, revenueTargetMonthly: Math.max(0, Number(e.target.value)) } : x))} /></label>
                    <label className="associate-target-input"><input className="input !py-1.5" type="number" min="0" max="100" step="1" value={a.conversionTargetPct || ''} placeholder="0" aria-label={`${a.name} conversion target percentage`} onChange={e => setAssociates(as => as.map(x => x.id === a.id ? { ...x, conversionTargetPct: Math.min(100, Math.max(0, Number(e.target.value))) } : x))} /><span>%</span></label>
                    <div className="associate-settings-actions">
                    <button className="btn btn-ghost !p-2" onClick={() => setAssociates(as => as.map(x => x.id === a.id ? { ...x, active: x.active === false } : x))} title="Toggle active">
                      {a.active === false ? <Sparkles size={14} className="text-slate-600" /> : <ShieldCheck size={14} className="text-emerald-400" />}
                    </button>
                    <button className="btn btn-ghost !p-2 text-rose-300" onClick={() => window.confirm(`Delete ${a.name}? Existing leads keep their stored associate id.`) && setAssociates(as => as.filter(x => x.id !== a.id))} title="Delete associate">
                      <Trash2 size={14} />
                    </button>
                    </div>
                  </div>
                ))}
                <button className="btn btn-ghost !py-1.5 !text-sm" onClick={() => setAssociates(as => [...as, { id: `asn_${Date.now()}`, name: 'New Associate', role: 'Sales Associate', email: '', color: '#f43f5e', locationId: locations[0]?.id, locationIds: locations[0]?.id ? [locations[0].id] : [], active: true, revenueTargetMonthly: 0, conversionTargetPct: 0 }])}><Plus size={13} /> Add associate</button>
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
              <CadenceSteps steps={cadence.steps || []} onChange={steps => setCadence({ ...cadence, steps })} channels={fuChannels} />
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
              <p className="text-xs text-slate-500 mt-3 flex items-center gap-1.5"><Sparkles size={11} /> Insights and suggested messages are generated from conversation history, stage, source and engagement — no external API key required.</p>
            </Section>
            <Section icon={<Mail size={15} className="text-cyan-400" />} title="Email reminders" desc="Off by default. When on, sends a daily digest to each associate for their own open, non-imported leads only — never a blanket copy to support, never for CSV-imported leads.">
              <Toggle on={rem.emailReminders === true} onChange={v => setRem({ ...rem, emailReminders: v })} title="Enable email reminders" desc="Also requires 'Enable outbound email' under Integrations → Mailtrap.">
                <p className="text-xs text-slate-500">Covers only leads created directly in the app (Add Lead) — leads brought in via CSV import are always excluded.</p>
              </Toggle>
            </Section>
            <Section id="settings-round-robin" icon={<Zap size={15} className="text-amber-400" />} title="Round-robin assignment" desc="Automatically assign incoming leads.">
              <Toggle on={rr.enabled} onChange={v => setRr({ ...rr, enabled: v })} title="Round-robin lead assignment" desc="Assign every incoming lead to the next associate in rotation for its studio.">
                <div className="flex items-center gap-3">
                  <select className="input !w-auto !py-1.5" value={rr.mode} onChange={e => setRr({ ...rr, mode: e.target.value })}>
                    <option value="fair">Fair rotation (cycle in order)</option>
                    <option value="load-balanced">Load balanced (fewest open leads)</option>
                  </select>
                  <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="accent-rose-500" checked={rr.autoAssignOnImport !== false} onChange={e => setRr({ ...rr, autoAssignOnImport: e.target.checked })} /> Auto-assign on CSV import</label>
                </div>
              </Toggle>
              <Toggle on={zohoConfig?.enabled === true} onChange={toggleZohoShiftAware} title="Shift-aware assignment (Zoho People)" desc="Only rotate leads to associates who are actually on a working shift today — checked against Zoho People's attendance/shift data. Falls back to the full roster if Zoho is unreachable or nobody in a studio's roster matches an on-duty email.">
                {!zohoConfig?.clientId && <p className="text-xs text-amber-400">Add USER_ZOHO_PEOPLE_CLIENT_ID/SECRET/REFRESH_TOKEN in .env first (see Integrations tab).</p>}
                {zohoConfig?.enabled && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <button className="btn btn-soft !py-1.5" onClick={refreshZohoShifts} disabled={zohoRefreshing}>{zohoRefreshing ? <Spinner size={13} /> : <RefreshCcw size={13} />} Refresh shifts now</button>
                    {zohoConfig.onDuty?.date && <span className="text-xs text-slate-400">{zohoConfig.onDuty.emails?.length || 0} on shift today ({zohoConfig.onDuty.date})</span>}
                    {zohoConfig.lastFetchError && <span className="text-xs text-rose-400">Last fetch failed: {zohoConfig.lastFetchError}</span>}
                  </div>
                )}
              </Toggle>
              <Toggle on={rem.followUpEnabled !== false} onChange={v => setRem({ ...rem, followUpEnabled: v })} title="Legacy reminder toggles" desc="Backward-compatible reminder switches.">
                <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="accent-rose-500" checked={rem.leadAgeEnabled !== false} onChange={e => setRem({ ...rem, leadAgeEnabled: e.target.checked })} /> Alert on cold leads with no follow-ups</label>
              </Toggle>
            </Section>
            <button className="btn btn-primary" onClick={() => saveSettings()}><Save size={14} /> Save alert & AI settings</button>
          </>
        )}

        {tab === 'integrations' && (
          <IntegrationsPanel
            active={activeIntegration}
            setActive={setActiveIntegration}
            items={[
              { id: 'momence', label: 'Momence', icon: Link2, category: 'Operations', desc: 'Sales and class history sync', connected: Boolean(configured) },
              { id: 'gpt', label: 'OpenAI', icon: KeyRound, category: 'Intelligence', desc: 'AI enrichment and suggestions', connected: Boolean(gptStatus?.configured) },
              { id: 'respondio', label: 'Respond.io', icon: MessageCircle, category: 'Messaging', desc: 'WhatsApp, SMS and email messaging', connected: Boolean(respStatus?.configured) },
              { id: 'mailtrap', label: 'Mailtrap', icon: Mail, category: 'Messaging', desc: 'Email reminders and digests', connected: Boolean(mailStatus?.configured && mailSet.enabled) },
              { id: 'webhooks', label: 'Lead webhooks', icon: Webhook, category: 'Developer tools', desc: 'Inbound forms and no-code tools', connected: webhooks.length > 0 },
              { id: 'sheets', label: 'Google Sheets', icon: Sheet, category: 'Productivity', desc: 'Import leads from a spreadsheet', connected: Boolean(sheetsConfig?.connected) },
              { id: 'zoho', label: 'Zoho People', icon: Zap, category: 'Operations', desc: 'Shift-aware round robin', connected: Boolean(zohoConfig?.enabled) },
              { id: 'zapier', label: 'Zapier', icon: Zap, category: 'Automation', desc: 'Connect apps through automated Zaps', comingSoon: true },
              { id: 'typeform', label: 'Typeform', icon: ListChecks, category: 'Lead capture', desc: 'Create leads from form submissions', comingSoon: true },
              { id: 'facebookLeads', label: 'Facebook Lead Ads', icon: Users, category: 'Lead capture', desc: 'Import Facebook and Instagram form leads', comingSoon: true },
              { id: 'hubspot', label: 'HubSpot', icon: Cloud, category: 'CRM', desc: 'Two-way contact and lifecycle sync', comingSoon: true },
              { id: 'slack', label: 'Slack', icon: MessageCircle, category: 'Messaging', desc: 'Post alerts and digests to channels', comingSoon: true },
              { id: 'calendly', label: 'Calendly', icon: RotateCcw, category: 'Scheduling', desc: 'Create leads from booked calls', comingSoon: true },
              { id: 'twilio', label: 'Twilio', icon: Send, category: 'Messaging', desc: 'SMS and voice communication', comingSoon: true },
              { id: 'instagram', label: 'Instagram', icon: MessageCircle, category: 'Messaging', desc: 'Manage Instagram lead conversations', comingSoon: true },
              { id: 'intercom', label: 'Intercom', icon: MessageCircle, category: 'Messaging', desc: 'Sync live-chat leads and conversations', comingSoon: true },
              { id: 'salesforce', label: 'Salesforce', icon: Cloud, category: 'CRM', desc: 'Sync contacts, opportunities and ownership', comingSoon: true },
              { id: 'gmail', label: 'Gmail', icon: Mail, category: 'Messaging', desc: 'Send and track lead email', comingSoon: true },
              { id: 'whatsapp', label: 'WhatsApp Business', icon: MessageCircle, category: 'Messaging', desc: 'Message leads from verified business numbers', comingSoon: true },
              { id: 'stripe', label: 'Stripe', icon: IndianRupee, category: 'Payments', desc: 'Create payment links and track Checkout payments', connected: Boolean(boot?.integrations?.stripe) },
              { id: 'airtable', label: 'Airtable', icon: Database, category: 'Productivity', desc: 'Sync lead records with Airtable bases', comingSoon: true },
              { id: 'googleCalendar', label: 'Google Calendar', icon: CalendarRange, category: 'Scheduling', desc: 'Coordinate consultations and follow-ups', comingSoon: true },
              { id: 'zendesk', label: 'Zendesk', icon: MessageCircle, category: 'Support', desc: 'Connect service tickets to lead profiles', comingSoon: true },
              { id: 'asana', label: 'Asana', icon: ListChecks, category: 'Productivity', desc: 'Create tasks for operational follow-up', comingSoon: true },
              { id: 'razorpay', label: 'Razorpay', icon: IndianRupee, category: 'Payments', desc: 'Link Indian payment activity to leads', comingSoon: true }
            ]}
          >
            {activeIntegration === 'momence' && (
            <Section bare>
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
                <a className="btn btn-ghost !py-2 text-sm" href="https://api.docs.momence.com/reference/apiv2authcontroller_token" target="_blank" rel="noreferrer">API reference <ExternalLink size={12} /></a>
              </div>
              {testResult && (
                <p className={`mt-3 text-sm flex items-center gap-1.5 ${testResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testResult.ok ? '✓' : '✕'} {testResult.text}
                </p>
              )}
              {!configured && (
                <p className="mt-3 text-xs text-slate-500">Credentials stay on this server and are only used to call the Momence API (OAuth2 password grant).</p>
              )}
            </Section>
            )}

            {activeIntegration === 'stripe' && (
            <Section bare>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {boot?.integrations?.stripe
                  ? <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20"><ShieldCheck size={11} /> Stripe API connected</span>
                  : <span className="chip bg-amber-500/10 text-amber-300 border border-amber-400/20">Server configuration required</span>}
              </div>
              <div className="card p-4 bg-white/[0.02] border-white/6 space-y-3">
                <div><div className="font-semibold text-white text-base">Server credentials</div><p className="text-xs text-slate-500 mt-1">Set <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_WEBHOOK_SECRET</code> on the API server. Keys are never stored in the browser or returned by the API.</p></div>
                <div><label className="label">Webhook endpoint</label><code className="input block !py-2 !text-xs overflow-x-auto whitespace-nowrap">/api/stripe/webhook</code><p className="text-xs text-slate-500 mt-1">Register this path on the public API domain for <code>checkout.session.completed</code>, <code>checkout.session.async_payment_succeeded</code>, and <code>checkout.session.expired</code>.</p></div>
              </div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="card p-4"><div className="text-xs uppercase tracking-wider text-slate-500">Products</div><div className="text-sm text-slate-300 mt-1">Loaded live from active Stripe Prices.</div></div>
                <div className="card p-4"><div className="text-xs uppercase tracking-wider text-slate-500">Checkout</div><div className="text-sm text-slate-300 mt-1">Supports product carts and custom INR links.</div></div>
                <div className="card p-4"><div className="text-xs uppercase tracking-wider text-slate-500">Tracking</div><div className="text-sm text-slate-300 mt-1">Webhook updates plus manual status refresh.</div></div>
              </div>
            </Section>
            )}

            {activeIntegration === 'gpt' && (
            <Section bare>
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
                <p className={`mt-3 text-sm flex items-center gap-1.5 ${testGptResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testGptResult.ok ? '✓' : '✕'} {testGptResult.text}
                </p>
              )}
              {!gptStatus?.configured && (
                <p className="mt-3 text-xs text-slate-500">Keys can also be set via the USER_OPENAI_API_KEY environment variable, which always wins over this setting.</p>
              )}
            </Section>
            )}

            {activeIntegration === 'respondio' && (
            <Section bare>
              {respStatus?.configured && <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20"><ShieldCheck size={11} /> Configured</span>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div className="sm:col-span-2"><label className="label">API key</label><input className="input" type="password" value={respSet.apiKey} onChange={e => setRespSet({ ...respSet, apiKey: e.target.value })} placeholder={respStatus?.configured ? '•••••••• (stored)' : 'pk_… from app.respond.io'} /></div>
                <div><label className="label">Workspace ID (optional)</label><input className="input" value={respSet.workspaceId} onChange={e => setRespSet({ ...respSet, workspaceId: e.target.value })} placeholder="e.g. 5f2b…" /></div>
              </div>

              {respStatus?.inboundWebhookUrl && (
                <div className="mt-4 rounded-xl bg-white/[0.03] border border-white/6 px-4 py-3">
                  <div className="text-sm font-semibold text-white">Receive replies live</div>
                  <div className="text-xs text-slate-500 mt-0.5 mb-2">Without this, a lead's reply only shows up once someone reopens that lead. In Respond.io, add a Workflow (trigger: <em>Message Received</em>) with a <em>Webhook</em> action pointed at this URL — the payload contents don't matter, arrival alone tells every open tab to refresh.</div>
                  <div className="flex items-center gap-2">
                    <code className="input !py-1.5 flex-1 !text-xs overflow-x-auto whitespace-nowrap">{respStatus.inboundWebhookUrl}</code>
                    <button className="btn btn-ghost !py-1.5" onClick={() => navigator.clipboard?.writeText(respStatus.inboundWebhookUrl).then(() => toast('URL copied')).catch(() => toast('Could not copy — copy manually', 'error'))}><Copy size={13} /> Copy</button>
                  </div>
                </div>
              )}

              {respStatus?.configured && (
                <div className="mt-4 rounded-xl bg-white/[0.03] border border-white/6 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">Sync past conversations</div>
                      <div className="text-xs text-slate-500 mt-0.5">Links every lead to its existing Respond.io contact up front (by email/phone), so full conversation history is ready the first time you open a lead — not just for messages sent after today.</div>
                    </div>
                    <button className="btn btn-soft !py-1.5 !text-sm shrink-0" onClick={syncAllRespondioContacts} disabled={syncingContacts}>
                      {syncingContacts ? <Spinner size={13} /> : <RefreshCcw size={13} />} Sync now
                    </button>
                  </div>
                  {syncContactsResult && <p className="mt-2 text-xs text-emerald-400">✓ Linked {syncContactsResult.linked} of {syncContactsResult.checked} checked ({syncContactsResult.alreadyLinked} were already linked)</p>}
                </div>
              )}

              <div className="mt-4 card p-4 bg-white/[0.02] border-white/6">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div>
                    <div className="font-semibold text-white text-base">Snippets sync (Saved Replies)</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Respond.io has no public API for canned responses — this uses their internal web-app session instead, so it's unsupported and the token expires periodically. When it does, open respond.io in your browser, go to Settings &gt; Snippets, open DevTools &gt; Network, reload, and copy the <code>authorization</code>/<code>cookie</code> headers from any <code>snippet/list</code> request.
                    </div>
                  </div>
                  {respStatus?.snippetsSessionConfigured && <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20 shrink-0"><ShieldCheck size={11} /> Configured</span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div className="sm:col-span-2"><label className="label">Session token (authorization bearer)</label><input className="input" type="password" value={respSet.session?.token || ''} onChange={e => setRespSet({ ...respSet, session: { ...respSet.session, token: e.target.value } })} placeholder={respStatus?.snippetsSessionConfigured ? '•••••••• (stored)' : 'eyJraWQiOi… (JWT from the authorization header)'} /></div>
                  <div className="sm:col-span-2"><label className="label">Cookie header (optional)</label><input className="input" type="password" value={respSet.session?.cookie || ''} onChange={e => setRespSet({ ...respSet, session: { ...respSet.session, cookie: e.target.value } })} placeholder="leave blank unless the token alone gets rejected" /></div>
                  <div><label className="label">Bot ID</label><input className="input" value={respSet.session?.botId || ''} onChange={e => setRespSet({ ...respSet, session: { ...respSet.session, botId: e.target.value } })} placeholder="e.g. 431351" /></div>
                  <div><label className="label">Org ID</label><input className="input" value={respSet.session?.orgId || ''} onChange={e => setRespSet({ ...respSet, session: { ...respSet.session, orgId: e.target.value } })} placeholder="e.g. 424165" /></div>
                </div>
              </div>

              <div className="mt-4 card p-4 bg-white/[0.02] border-white/6">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="font-semibold text-white text-base">Approved WABA templates</div>
                    <div className="text-xs text-slate-500">Linked WABA templates used automatically for first WhatsApp messages and available from the leads table.</div>
                  </div>
                  <button className="btn btn-ghost !py-1.5 !text-sm" onClick={() => setWabaTemplates(t => [...t, { id: `tpl_${Date.now().toString(36)}`, label: 'New template', name: '', language: 'en', namespace: '', parameters: [''] }])}>
                    <Plus size={13} /> Add template
                  </button>
                </div>
                <div className="space-y-3">
                  {wabaTemplates.map((t, idx) => (
                    <div key={t.id || idx} className="rounded-xl border border-white/8 bg-white/[0.02] p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input className="input !py-1.5 !text-sm" placeholder="Display label" value={t.label || ''} onChange={e => setWabaTemplates(arr => arr.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))} />
                        <input className="input !py-1.5 !text-sm" placeholder="Template name" value={t.name || ''} onChange={e => setWabaTemplates(arr => arr.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input className="input !py-1.5 !text-sm" placeholder="Language code (en, en_US)" value={t.language || 'en'} onChange={e => setWabaTemplates(arr => arr.map((x, i) => i === idx ? { ...x, language: e.target.value } : x))} />
                        <select className="input !py-1.5 !text-sm" value={t.category || 'marketing'} onChange={e => setWabaTemplates(arr => arr.map((x, i) => i === idx ? { ...x, category: e.target.value } : x))}>
                          <option value="marketing">marketing</option>
                          <option value="utility">utility</option>
                          <option value="authentication">authentication</option>
                        </select>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Parameters</div>
                        <input className="input !py-1.5 !text-sm" placeholder="Comma-separated parameter labels" value={(t.parameters || []).join(', ')} onChange={e => setWabaTemplates(arr => arr.map((x, i) => i === idx ? { ...x, parameters: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } : x))} />
                      </div>
                      <div className="flex justify-end">
                        <button className="btn btn-ghost !py-1.5 !text-sm text-rose-300" onClick={() => setWabaTemplates(arr => arr.filter((_, i) => i !== idx))}>
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
                <p className={`mt-3 text-sm flex items-center gap-1.5 ${testRespResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testRespResult.ok ? '✓' : '✕'} {testRespResult.text}
                </p>
              )}
              {!respStatus?.configured && (
                <p className="mt-3 text-xs text-slate-500">Keys can also be set via the USER_RESPONDIO_API_KEY environment variable, which always wins over this setting.</p>
              )}
            </Section>
            )}

            {activeIntegration === 'mailtrap' && (
            <Section bare>
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
                <div><label className="label">Port</label><input className="input" type="number" value={mailSet.port} onChange={e => setMailSet({ ...mailSet, port: Number(e.target.value) })} placeholder="587" /></div>
                <div><label className="label">Username</label><input className="input" value={mailSet.user} onChange={e => setMailSet({ ...mailSet, user: e.target.value })} placeholder="api" /></div>
                <div><label className="label">Password</label><input className="input" type="password" value={mailSet.pass} onChange={e => setMailSet({ ...mailSet, pass: e.target.value })} placeholder={mailStatus?.configured ? '•••••••• (stored)' : 'SMTP password'} /></div>
                <div><label className="label">From email</label><input className="input" value={mailSet.fromEmail} onChange={e => setMailSet({ ...mailSet, fromEmail: e.target.value })} placeholder="hello@physique57india.com" /></div>
                <div><label className="label">From name</label><input className="input" value={mailSet.fromName} onChange={e => setMailSet({ ...mailSet, fromName: e.target.value })} placeholder="Physique 57 India" /></div>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-4">
                <button className="btn btn-primary" onClick={saveMail}>Save Mailtrap settings</button>
                <button className="btn btn-ghost" onClick={verifyMailFn} disabled={verifyMail}>{verifyMail ? <Spinner size={14} /> : <ShieldCheck size={13} />} Verify SMTP</button>
                <div className="flex items-center gap-2">
                  <input className="input !w-[200px] !py-1.5" placeholder="test recipient email" value={mailTo} onChange={e => setMailTo(e.target.value)} />
                  <button className="btn btn-ghost" onClick={testMailFn} disabled={testMail}>{testMail ? <Spinner size={14} /> : <Send size={13} />} Send test</button>
                </div>
              </div>
              {testMailResult && (
                <p className={`mt-3 text-sm flex items-center gap-1.5 ${testMailResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testMailResult.ok ? '✓' : '✕'} {testMailResult.text}
                </p>
              )}
              <div className="mt-4 rounded-xl bg-white/[0.03] border border-white/6 px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <div className="text-sm font-semibold text-white">Follow-up digest</div>
                  <div className="text-xs text-slate-500">Daily email to each associate listing only their own follow-ups due in the next 3 days or overdue — never for CSV-imported leads. Requires "Enable outbound email" and "Enable email reminders" (below) to be on.</div>
                </div>
                <button className="btn btn-soft !py-1.5 !text-sm" onClick={sendDigest} disabled={mailDigest}>{mailDigest ? <Spinner size={13} /> : <Send size={13} />} Send digest now</button>
              </div>
              {mailDigestResult && (
                <p className={`mt-2 text-sm flex items-center gap-1.5 ${mailDigestResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {mailDigestResult.ok ? '✓' : '✕'} {mailDigestResult.text}
                </p>
              )}
              {!mailStatus?.configured && (
                <p className="mt-3 text-xs text-slate-500">Set USER_MAILTRAP_PASS to your Mailtrap Email Sending API token. USER_MAILTRAP_HOST, PORT, USER, FROM_EMAIL, FROM_NAME, and ENABLED environment variables also override these settings.</p>
              )}
            </Section>
            )}

            {activeIntegration === 'webhooks' && (
            <Section bare>
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <input className="input flex-1 min-w-[220px]" placeholder="Integration name, e.g. Landing Page Signup Form" value={newWebhookName} onChange={e => setNewWebhookName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createWebhook()} />
                <select className="input !w-auto" value={newWebhookSource} onChange={e => setNewWebhookSource(e.target.value)} title="Default source for leads that omit one">
                  <option value="">Default source (optional)</option>
                  {sources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="input !w-auto" value={newWebhookStage} onChange={e => setNewWebhookStage(e.target.value)} title="Default stage for leads that omit one">
                  <option value="">Default stage (optional)</option>
                  {stages.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button className="btn btn-primary" onClick={createWebhook} disabled={creatingWebhook}>{creatingWebhook ? <Spinner size={14} /> : <Plus size={14} />} Create webhook</button>
              </div>
              <p className="text-xs text-slate-500 mb-4">Source/stage presets apply to every incoming lead from this URL that doesn't already specify one — edit them anytime from the webhook's default values below.</p>
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
                    onDetectMapping={(payload) => detectWebhookMapping(w.id, payload)}
                    onRegenerate={() => regenerateWebhook(w.id)}
                    onDelete={() => deleteWebhook(w.id)}
                    onCopy={() => copyWebhookUrl(w.url)}
                    fieldRef={webhookFieldRef}
                  />
                ))}
                {!webhooks.length && <p className="text-xs text-slate-500">No webhook integrations yet — create one above to get a URL you can paste into any form tool.</p>}
              </div>
            </Section>
            )}

            {activeIntegration === 'sheets' && (
            <Section bare>
              <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/6 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${sheetsConfig?.connected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  {sheetsConfig?.connected ? (
                    <span className="text-sm text-slate-200">Connected as <span className="font-medium text-white">{sheetsConfig.connectedEmail}</span></span>
                  ) : (
                    <span className="text-sm text-slate-500">Not connected</span>
                  )}
                </div>
                {sheetsConfig?.connected ? (
                  <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20"><ShieldCheck size={11} /> Active</span>
                ) : (
                  <span className="chip bg-white/5 border border-white/10 text-slate-400">Setup needed</span>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-white/6 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-5 h-5 rounded-full bg-white/10 text-xs font-semibold text-slate-300 flex items-center justify-center shrink-0">1</span>
                  <h4 className="text-sm font-semibold text-slate-200">OAuth client</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="label">Google Cloud OAuth Client ID</label><input className="input" value={sheetsClientId} onChange={e => setSheetsClientId(e.target.value)} placeholder="….apps.googleusercontent.com" /></div>
                  <div><label className="label">Client secret</label><input className="input" type="password" value={sheetsClientSecret} onChange={e => setSheetsClientSecret(e.target.value)} placeholder={sheetsConfig?.hasClientSecret ? '•••••••• (stored)' : 'GOCSPX-…'} /></div>
                </div>
                <p className="text-xs text-slate-500 mt-2">Create an OAuth client in Google Cloud Console (APIs & Services → Credentials), then add this redirect URI: <code className="text-slate-300 bg-black/20 rounded px-1 py-0.5">{window.location.origin}/api/google-sheets/oauth/callback</code></p>
                <div className="flex items-center gap-3 mt-3">
                  <button className="btn btn-primary" onClick={saveSheetsCredentials}>Save OAuth client</button>
                  {sheetsConfig?.connected ? (
                    <button className="btn btn-ghost text-rose-300" onClick={disconnectGoogle}>Disconnect</button>
                  ) : (
                    <button className="btn btn-soft" onClick={connectGoogle} disabled={!sheetsConfig?.clientId}><Link2 size={13} /> Connect Google Account</button>
                  )}
                </div>
              </div>

              {sheetsConfig?.connected && (
                <>
                  <div className="mt-3 rounded-xl border border-white/6 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-5 h-5 rounded-full bg-white/10 text-xs font-semibold text-slate-300 flex items-center justify-center shrink-0">2</span>
                      <h4 className="text-sm font-semibold text-slate-200">Sheet to sync</h4>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div><label className="label">Sheet ID</label><input className="input" value={sheetsSheetId} onChange={e => setSheetsSheetId(e.target.value)} placeholder="from the sheet's URL between /d/ and /edit" /></div>
                      <div><label className="label">Tab name</label><input className="input" value={sheetsSheetTab} onChange={e => setSheetsSheetTab(e.target.value)} placeholder="e.g. Form Responses 1" /></div>
                    </div>
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                      <button className="btn btn-primary" onClick={saveSheetTarget}>Save sheet</button>
                      <button className="btn btn-soft" onClick={() => syncSheetNow(false)} disabled={sheetsSyncing || !sheetsConfig?.sheetId}>{sheetsSyncing ? <Spinner size={14} /> : <RefreshCcw size={13} />} Sync now</button>
                      <button className="btn btn-ghost !text-sm" onClick={() => syncSheetNow(true)} disabled={sheetsSyncing || !sheetsConfig?.sheetId} title="Ignore the stored snapshot — the sheet's current values win every field">Force full resync</button>
                      <button className="btn btn-ghost !py-2" onClick={toggleSheetsLogs}><ScrollText size={14} /> {sheetsLogsOpen ? 'Hide log' : 'View sync log'}</button>
                    </div>

                    {/* The push script is what makes the sheet authoritative in real
                        time rather than every 30 minutes, and installing it is a
                        manual step inside the spreadsheet — so it gets its own
                        panel with the script pre-filled rather than a doc link. */}
                    <div className="mt-3 rounded-lg border border-white/8 bg-black/15 p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`w-1.5 h-1.5 rounded-full ${sheetsConfig?.pushInstalled ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                        <span className="text-sm font-medium text-slate-200">
                          {sheetsConfig?.pushInstalled ? 'Live push active' : 'Live push not installed'}
                        </span>
                        {sheetsConfig?.lastHookAt && (
                          <span className="text-xs text-slate-500">last push {new Date(sheetsConfig.lastHookAt).toLocaleString()}</span>
                        )}
                        <button className="btn btn-soft !py-1.5 !text-xs ml-auto" onClick={copyPushScript} disabled={!sheetsConfig?.sheetId}>
                          {pushScriptCopied ? 'Copied — now paste it into the sheet' : 'Copy push script'}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        In the spreadsheet: <span className="text-slate-400">Extensions → Apps Script</span>, replace <code>Code.gs</code> with the copied script,
                        Save, then run <code>installTriggers</code> once and approve the permission prompt. Every edit in the sheet then reaches the CRM within a second.
                        Until it is installed, sheet edits are picked up by the 30-minute reconcile instead.
                      </p>
                    </div>

                    {sheetsSyncResult && (
                      <div className={`mt-3 rounded-lg px-3 py-2.5 border text-sm ${sheetsSyncResult.ok ? 'bg-emerald-500/10 border-emerald-400/20 text-emerald-300' : 'bg-rose-500/10 border-rose-400/20 text-rose-300'}`}>
                        {sheetsSyncResult.ok ? (
                          <>
                            <span className="font-medium">✓ Reconciled</span> — {sheetsSyncResult.created} created · {sheetsSyncResult.merged || 0} merged · {sheetsSyncResult.unchanged || 0} unchanged · {sheetsSyncResult.deleted || 0} deleted · {sheetsSyncResult.skipped} skipped
                            {sheetsSyncResult.conflicts > 0 && <span className="text-amber-400/80"> ({sheetsSyncResult.conflicts} field conflict{sheetsSyncResult.conflicts === 1 ? '' : 's'} resolved by edit time)</span>}
                          </>
                        ) : <><span className="font-medium">✕ Sync failed</span> — {sheetsSyncResult.error}</>}
                      </div>
                    )}
                    {sheetsConfig?.lastSyncAt && (
                      <p className="mt-2 text-xs text-slate-500">Last synced {new Date(sheetsConfig.lastSyncAt).toLocaleString()}
                        {sheetsConfig.lastSyncCounts && ` — ${sheetsConfig.lastSyncCounts.created} created, ${sheetsConfig.lastSyncCounts.merged || 0} merged, ${sheetsConfig.lastSyncCounts.deleted || 0} deleted, ${sheetsConfig.lastSyncCounts.skipped} skipped`}. Sheet edits arrive instantly once the push script is installed; a full reconcile also runs every 30 minutes as a safety net.
                      </p>
                    )}

                    {sheetsLogsOpen && (
                      <div className="mt-3 rounded-lg bg-black/20 border border-white/6 p-2.5 max-h-52 overflow-y-auto">
                        {!sheetsLogs && <p className="text-xs text-slate-500">Loading…</p>}
                        {sheetsLogs && !sheetsLogs.length && <p className="text-xs text-slate-500">No syncs yet.</p>}
                        {sheetsLogs && sheetsLogs.map(l => (
                          <div key={l.id} className="flex items-center gap-2 text-xs py-1 border-b border-white/5 last:border-0">
                            <span className="mono text-slate-500">{new Date(l.ts).toLocaleString()}</span>
                            <OutcomeChip outcome={l.outcome} />
                            {l.detail && <span className="text-slate-500 truncate">{l.detail}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 rounded-xl border border-white/6 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-white/10 text-xs font-semibold text-slate-300 flex items-center justify-center shrink-0">3</span>
                        <h4 className="text-sm font-semibold text-slate-200">Field mapping</h4>
                      </div>
                      <button className="btn btn-ghost !py-1.5 !text-sm" onClick={() => detectMapping(false)} disabled={detectingMapping}>
                        {detectingMapping ? <Spinner size={12} /> : <Sparkles size={12} />} Re-detect from sheet
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">Columns are matched to lead fields automatically by name — review and adjust below.</p>
                    <FieldMappingEditor
                      key={sheetsMappingVersion}
                      fieldMapping={sheetsConfig.fieldMapping}
                      defaults={sheetsConfig.defaults}
                      onSaveMapping={saveSheetsMapping}
                      onSaveDefaults={saveSheetsDefaults}
                      keyLabel="sheet column header"
                      keyPlaceholder="column header, e.g. Full Name"
                    />
                  </div>
                </>
              )}
            </Section>
            )}

            {activeIntegration === 'zoho' && (
            <Section bare>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">
                  {zohoConfig?.hasRefreshToken ? `Credentials loaded from .env (${zohoConfig.dataCenter})` : 'Not configured — add keys to .env'}
                </span>
                {zohoConfig?.enabled && <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20"><ShieldCheck size={11} /> Shift-aware active</span>}
              </div>
              <p className="text-xs text-slate-500 mt-2">Credentials are read-only here by design — set them in the server's <code className="text-slate-300 bg-black/20 rounded px-1 py-0.5">.env</code> file: <code className="text-slate-300 bg-black/20 rounded px-1 py-0.5">USER_ZOHO_PEOPLE_CLIENT_ID</code>, <code className="text-slate-300 bg-black/20 rounded px-1 py-0.5">USER_ZOHO_PEOPLE_CLIENT_SECRET</code>, <code className="text-slate-300 bg-black/20 rounded px-1 py-0.5">USER_ZOHO_PEOPLE_REFRESH_TOKEN</code>, and optionally <code className="text-slate-300 bg-black/20 rounded px-1 py-0.5">USER_ZOHO_PEOPLE_DATA_CENTER</code> (in/com/eu/com.au, defaults to in). Restart the server after editing .env.</p>
              <div className="flex items-center gap-3 mt-3">
                <button className="btn btn-soft" onClick={refreshZohoShifts} disabled={zohoRefreshing || !zohoConfig?.hasRefreshToken}>{zohoRefreshing ? <Spinner size={14} /> : <RefreshCcw size={13} />} Refresh shifts now</button>
              </div>
              {zohoConfig?.onDuty?.date && (
                <p className="mt-2 text-xs text-slate-500">Last fetched {zohoConfig.lastFetchAt ? new Date(zohoConfig.lastFetchAt).toLocaleString() : '—'} — {zohoConfig.onDuty.emails?.length || 0} on shift for {zohoConfig.onDuty.date}. Turn on "Shift-aware assignment" under Alerts & AI → Round-robin to use this.</p>
              )}
              {zohoConfig?.lastFetchError && <p className="mt-2 text-xs text-rose-400">Last fetch failed: {zohoConfig.lastFetchError}</p>}
            </Section>
            )}
          </IntegrationsPanel>
        )}

        {tab === 'data' && (
          <>
            <Section icon={<Database size={15} className="text-cyan-400" />} title="Data management" desc="Export, inspect and reset your workspace data.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/[0.03] border border-white/6 px-4 py-3 flex items-center gap-3">
                  <Database size={16} className="text-violet-400" />
                  <div className="flex-1">
                    <div className="text-base font-semibold text-white">Storage</div>
                    <div className="text-xs text-slate-500">{boot?.leads?.length ?? '—'} leads in {boot?.integrations?.supabase ? 'Supabase (cloud sync)' : 'local JSON storage'}</div>
                  </div>
                  {boot?.integrations?.supabase
                    ? <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20"><ShieldCheck size={11} /> Cloud</span>
                    : <span className="chip bg-white/5 border border-white/10 text-slate-400">Local</span>}
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/6 px-4 py-3 flex items-center gap-3">
                  <Sparkles size={16} className="text-emerald-400" />
                  <div className="flex-1">
                    <div className="text-base font-semibold text-white">AI engine</div>
                    <div className="text-xs text-slate-500">Rule-based scoring + optional GPT enrichment</div>
                  </div>
                  {boot?.integrations?.gpt
                    ? <span className="chip bg-emerald-500/10 text-emerald-300 border border-emerald-400/20"><ShieldCheck size={11} /> GPT on</span>
                    : <span className="chip bg-white/5 border border-white/10 text-slate-400">Heuristic</span>}
                </div>
              </div>
              {!boot?.integrations?.supabase && (
                <p className="mt-3 text-xs text-slate-500 flex items-center gap-1.5"><Cloud size={11} /> To enable cloud storage, add USER_SUPABASE_URL and USER_SUPABASE_SERVICE_ROLE_KEY to your .env. Supabase keeps the latest snapshot of every lead and syncs on every change.</p>
              )}
              <button className="btn btn-soft !mt-4" onClick={resetData}><RotateCcw size={14} /> Reset to demo data</button>
              <p className="text-xs text-slate-500 mt-2">This restores the original demo dataset with 130 leads across all 4 studios.</p>
            </Section>

            <Section icon={<Users size={15} className="text-amber-400" />} title="Duplicate leads" desc="Find and remove leads that share the same email or phone number — same person, imported more than once (e.g. an overlapping sync).">
              <button className="btn btn-soft" onClick={checkDuplicates} disabled={dedupeChecking}>
                {dedupeChecking ? <Spinner size={14} /> : <Filter size={14} />} Scan for duplicates
              </button>
              {dedupePreview && (
                <div className="mt-3 rounded-xl bg-white/[0.03] border border-white/6 p-3.5">
                  {dedupePreview.wouldRemove > 0 ? (
                    <>
                      <p className="text-sm text-amber-300">{dedupePreview.wouldRemove} duplicate lead{dedupePreview.wouldRemove === 1 ? '' : 's'} found across {dedupePreview.duplicateGroups} group{dedupePreview.duplicateGroups === 1 ? '' : 's'}.</p>
                      <button className="btn btn-soft !mt-3 !py-1.5 !text-sm" onClick={() => setDedupeReviewOpen(true)}>
                        <Filter size={13} /> Review duplicates
                      </button>
                    </>
                  ) : <p className="text-sm text-emerald-400">No duplicates found.</p>}
                </div>
              )}
            </Section>
          </>
        )}
      </div>

      <Modal open={dedupeReviewOpen} onClose={() => setDedupeReviewOpen(false)} width={760}>
        <ModalHeader
          title="Review duplicate leads"
          subtitle="Rows highlighted amber are the ones that would be removed — the oldest lead in each group is kept. Uncheck any row to keep it instead."
          onClose={() => setDedupeReviewOpen(false)}
        />
        <div className="max-h-[55vh] overflow-y-auto scrollbar-thin rounded-lg border border-white/6">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#14141a] text-slate-500">
              <tr className="text-left">
                <th className="p-2 w-8"></th>
                <th className="p-2">Name</th>
                <th className="p-2">Email</th>
                <th className="p-2">Phone</th>
                <th className="p-2">Source</th>
                <th className="p-2">Created</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(dedupePreview?.groups || []).map((group, gi) => (
                <React.Fragment key={gi}>
                  {group.map(l => {
                    const marked = dedupeSelected.has(l.id)
                    return (
                      <tr key={l.id} className={marked ? 'bg-amber-500/10' : l.status === 'keep' ? 'bg-emerald-500/5' : ''}>
                        <td className="p-2">
                          {l.status === 'remove' && (
                            <input type="checkbox" checked={marked} onChange={() => toggleDedupeSelected(l.id)} />
                          )}
                        </td>
                        <td className="p-2 text-slate-200 truncate max-w-[160px]">{l.fullName}</td>
                        <td className="p-2 mono text-slate-400">{l.email !== '-' ? l.email : ''}</td>
                        <td className="p-2 mono text-slate-400">{l.phone}</td>
                        <td className="p-2 text-slate-400">{l.source}</td>
                        <td className="p-2 text-slate-500">{l.createdAt ? new Date(l.createdAt).toLocaleDateString() : ''}</td>
                        <td className="p-2">
                          {l.status === 'keep'
                            ? <span className="chip bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">Keep</span>
                            : <span className={`chip border ${marked ? 'bg-amber-500/15 text-amber-300 border-amber-500/20' : 'bg-white/5 text-slate-400 border-white/10'}`}>{marked ? 'Remove' : 'Kept (unchecked)'}</span>}
                        </td>
                      </tr>
                    )
                  })}
                  <tr><td colSpan={7} className="h-1.5"></td></tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-slate-500">{dedupeSelected.size} lead{dedupeSelected.size === 1 ? '' : 's'} selected for removal</p>
          <div className="flex gap-2">
            <button className="btn btn-soft !py-1.5 !text-sm" onClick={removeDuplicates} disabled={dedupeRemoving || !dedupeSelected.size}>
              {dedupeRemoving ? <Spinner size={13} /> : <Trash2 size={13} />} Remove selected
            </button>
            <button className="btn btn-primary !py-1.5 !text-sm" onClick={removeAllDuplicates} disabled={dedupeRemovingAll || !dedupePreview?.wouldRemove}>
              {dedupeRemovingAll ? <Spinner size={13} /> : <Trash2 size={13} />} Remove all duplicates
            </button>
          </div>
        </div>
      </Modal>

      <style>{`.label{display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px}`}</style>
    </div>
  )
}

const BRAND = {
  momence: { src: 'https://momence.com/momence-landing_260528/images/favicon.png' },
  gpt: { icon: siOpenai },
  respondio: { src: 'https://assets.respond.io/favicon/favicon.svg' },
  mailtrap: { icon: siMailtrap },
  sheets: { icon: siGooglesheets },
  zoho: { icon: siZoho },
  zapier: { icon: siZapier },
  typeform: { icon: siTypeform },
  facebookLeads: { icon: siFacebook },
  hubspot: { icon: siHubspot },
  slack: { icon: siSlack },
  calendly: { icon: siCalendly },
  twilio: { icon: siTwilio },
  instagram: { icon: siInstagram },
  intercom: { icon: siIntercom },
  salesforce: { icon: siSalesforce },
  gmail: { icon: siGmail },
  whatsapp: { icon: siWhatsapp },
  stripe: { icon: siStripe },
  airtable: { icon: siAirtable },
  googleCalendar: { icon: siGooglecalendar },
  zendesk: { icon: siZendesk },
  asana: { icon: siAsana },
  razorpay: { icon: siRazorpay }
}

function StudioAssignmentPicker({ associate, locations, onChange }) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef(null)
  const selected = associate.locationIds?.length ? associate.locationIds : (associate.locationId ? [associate.locationId] : [])
  useEffect(() => {
    if (!open) return undefined
    const closeOnOutsideClick = event => {
      if (!pickerRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return
      setOpen(false)
      pickerRef.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])
  const toggle = (locationId) => {
    const next = selected.includes(locationId)
      ? selected.filter(id => id !== locationId)
      : [...selected, locationId]
    onChange(next)
  }
  const summary = selected.length
    ? selected.map(id => locations.find(location => location.id === id)?.name?.split(',')[0]).filter(Boolean).join(', ')
    : 'Select studios'

  return (
    <div className={`associate-studio-picker ${open ? 'is-open' : ''}`} ref={pickerRef}>
      <button type="button" className="associate-studio-trigger" title={summary} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(value => !value)}><MapPin size={13} /><span>{summary}</span><ChevronRight size={13} /></button>
      {open && <div className="associate-studio-menu" role="listbox" aria-multiselectable="true">
        {locations.map(location => (
          <label key={location.id}>
            <input type="checkbox" checked={selected.includes(location.id)} onChange={() => toggle(location.id)} />
            <span>{location.name}</span>
            {selected[0] === location.id && <small>Primary</small>}
          </label>
        ))}
      </div>}
    </div>
  )
}

function BrandLogo({ id, size = 36, icon: Icon }) {
  const b = BRAND[id]
  const markSize = Math.round(size * 0.55)
  return (
    <span className="integration-brand-logo" style={{ width: size, height: size }}>
      {b?.src ? <img src={b.src} alt="" width={markSize} height={markSize} /> : b?.icon ? (
        <svg className="integration-brand-svg" width={markSize} height={markSize} viewBox="0 0 24 24" aria-hidden="true" style={{ '--brand-color': `#${b.icon.hex}`, '--brand-dark-color': b.icon.hex === '000000' ? '#f8fafc' : `#${b.icon.hex}` }}>
          <path fill="currentColor" d={b.icon.path} />
        </svg>
      ) : <Icon size={markSize} aria-hidden="true" />}
    </span>
  )
}

// Tile menu of every integration with a connected/setup-needed tick, plus
// the detail panel (the matching <Section>, passed as children) for
// whichever one is selected — clicking a tile drills in, "Back" returns to
// the grid instead of scrolling through every integration's settings.
function IntegrationsPanel({ active, setActive, items, children }) {
  const [query, setQuery] = useState('')
  if (!active) {
    const normalizedQuery = query.trim().toLowerCase()
    const visible = normalizedQuery
      ? items.filter(app => `${app.label} ${app.desc} ${app.category}`.toLowerCase().includes(normalizedQuery))
      : items
    const available = visible.filter(app => !app.comingSoon)
    const upcoming = visible.filter(app => app.comingSoon)
    const connectedCount = items.filter(app => app.connected).length
    const renderApp = (app, index) => (
      <button key={app.id} onClick={() => setActive(app.id)} className="integration-app-card" style={{ '--integration-index': index }}>
        <BrandLogo id={app.id} icon={app.icon} />
        <div className="integration-app-copy">
          <div className="integration-app-label">{app.label}</div>
          <div className="integration-app-category">{app.category}</div>
          <div className="integration-app-desc">{app.desc}</div>
        </div>
        <div className="integration-app-footer">
          {app.comingSoon
            ? <span className="integration-status is-upcoming">Coming soon</span>
            : app.connected
              ? <span className="integration-status is-connected"><CircleCheck size={11} /> Connected</span>
              : <span className="integration-status">Setup needed</span>}
          <ChevronRight size={15} className="integration-app-arrow" />
        </div>
      </button>
    )
    return (
      <div className="integrations-catalogue">
        <div className="integrations-catalogue-head">
          <div><h2>Connected workspace</h2><p>{connectedCount} connected · {items.length} available apps</p></div>
          <label className="integrations-search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search integrations" aria-label="Search integrations" /></label>
        </div>
        {!!available.length && <section className="integrations-group"><div className="integrations-group-head"><h3>Available now</h3><span>{available.length}</span></div><div className="integrations-app-grid">{available.map(renderApp)}</div></section>}
        {!!upcoming.length && <section className="integrations-group"><div className="integrations-group-head"><h3>More apps</h3><span>{upcoming.length}</span></div><div className="integrations-app-grid">{upcoming.map(renderApp)}</div></section>}
        {!visible.length && <div className="integrations-empty"><Search size={20} /><p>No integrations match “{query}”.</p></div>}
      </div>
    )
  }

  const app = items.find(i => i.id === active)
  return (
    <div className="space-y-4">
      <button className="btn btn-ghost !py-1.5 !text-sm" onClick={() => setActive(null)}>
        <ChevronLeft size={14} /> Back to integrations
      </button>
      {app && (
        <div className="integration-detail-head">
          <BrandLogo id={app.id} icon={app.icon} size={44} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-display font-semibold text-white text-lg">{app.label}</div>
              {app.comingSoon
                ? <span className="chip !py-0.5 bg-white/5 border border-white/10 text-slate-500 text-xs">Coming soon</span>
                : app.connected
                  ? <span className="chip !py-0.5 bg-emerald-500/10 text-emerald-300 border border-emerald-400/20 text-xs"><ShieldCheck size={10} /> Connected</span>
                  : <span className="chip !py-0.5 bg-white/5 border border-white/10 text-slate-400 text-xs">Setup needed</span>}
            </div>
            <div className="text-sm text-slate-500 mt-0.5">{app.desc}</div>
          </div>
          {!app.comingSoon && <span className="integration-persistence"><Database size={11} /> Server persisted</span>}
        </div>
      )}
      {app?.comingSoon ? (
        <div className="card p-6 text-center">
          <p className="text-base text-slate-400">{app.label} isn't wired up yet — this app doesn't have a working integration for it today. Let your dev team know if you'd like it prioritized.</p>
        </div>
      ) : <div className="integration-config-shell">{children}</div>}
    </div>
  )
}

function Section({ icon, title, desc, bare, id, children }) {
  if (bare) return <div id={id} className="card p-5">{children}</div>
  return (
    <div id={id} className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">{icon}</span>
        <h3 className="font-display font-semibold text-white text-md">{title}</h3>
      </div>
      <p className="text-sm text-slate-500 mb-4">{desc}</p>
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

function TagEditor({ items, onChange, placeholder, allowBulk = false, defaults = [] }) {
  const [draft, setDraft] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDraft, setBulkDraft] = useState('')
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
  const addBulk = () => {
    const incoming = bulkDraft.split(/[\n\t,]+/).map(value => value.trim()).filter(Boolean)
    onChange(uniqueClean([...items, ...incoming]))
    setBulkDraft(''); setBulkOpen(false)
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {items.map((v, i) => (
          <span key={`${v}-${i}`} className="chip bg-white/5 border border-white/10 text-slate-200 group">
            {editIdx === i ? (
              <input autoFocus className="!bg-transparent outline-none !w-[120px] text-sm !p-0" value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => commitEdit(i)} onKeyDown={e => e.key === 'Enter' && commitEdit(i)} />
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
        {allowBulk && <button className="btn btn-ghost !py-1.5" onClick={() => setBulkOpen(v => !v)}><ListChecks size={14} /> Bulk add</button>}
        {!!defaults.length && <button className="btn btn-soft !py-1.5" onClick={() => onChange(uniqueClean([...items, ...defaults]))}><Sparkles size={14} /> Add defaults</button>}
      </div>
      {bulkOpen && <div className="taxonomy-bulk-panel"><label>Paste one value per line, or separate values with commas or tabs.</label><textarea className="input" rows={7} value={bulkDraft} onChange={e => setBulkDraft(e.target.value)} placeholder={`Paste ${placeholder?.toLowerCase() || 'values'} here…`} /><div><span>{uniqueClean(bulkDraft.split(/[\n\t,]+/)).length} unique values ready</span><button className="btn btn-primary !py-1.5" disabled={!bulkDraft.trim()} onClick={addBulk}><Plus size={13} /> Add all</button></div></div>}
    </div>
  )
}

function SourceChannelMapper({ sources, channels, value, onChange }) {
  const [open, setOpen] = useState(false)
  const mapped = sources.filter(source => value[source]).length
  return <div className="source-channel-mapper">
    <button className="source-channel-mapper-head" onClick={() => setOpen(v => !v)}><span><b>Source → channel grouping</b><small>{mapped} of {sources.length} sources explicitly grouped</small></span><ChevronRight size={14} className={open ? 'rotate-90' : ''} /></button>
    {open && <div className="source-channel-map-grid">{sources.map(source => <label key={source}><span>{source}</span><select className="input !py-1.5" value={value[source] || defaultChannelForSource(source)} onChange={e => onChange({ ...value, [source]: e.target.value })}>{channels.map(channel => <option key={channel}>{channel}</option>)}</select></label>)}</div>}
  </div>
}

const COLUMN_DATA_TYPES = ['text', 'number', 'currency', 'percent', 'date', 'datetime', 'boolean']
const COLUMN_KINDS = ['base', 'formula', 'conditional', 'dependent']
const LEAD_FIELD_OPTIONS = ['fullName', 'phone', 'email', 'source', 'owner', 'location', 'score', 'risk', 'valueEstimate', 'classType', 'missedCount', 'lastOutreachDays', 'created', 'remarks', 'stage', 'status', 'statusGroup', 'trialDate', 'firstPurchaseDate']

function LeadColumnSchemaEditor({ columns, onChange }) {
  const patch = (id, changes) => onChange(columns.map(column => column.id === id ? { ...column, ...changes } : column))
  const add = (kind = 'base') => onChange([...columns, { id: `setting_col_${Date.now()}`, kind, field: kind === 'base' ? 'phone' : '', label: 'New column', type: 'text', hidden: false, formula: '', dependsOn: 'stage', operator: 'equals', expectedValue: '', trueValue: '', falseValue: '' }])
  return <div className="column-schema-editor">
    <div className="column-schema-toolbar"><span>{columns.length} configured columns</span>{COLUMN_KINDS.map(kind => <button key={kind} className="btn btn-ghost !py-1.5 capitalize" onClick={() => add(kind)}><Plus size={12} /> {kind}</button>)}</div>
    <div className="column-schema-list">{columns.map((column, index) => <div className="column-schema-row" key={column.id}>
      <div className="column-schema-main">
        <span className="column-schema-order">{index + 1}</span>
        <input className="input !py-1.5" aria-label="Column label" value={column.label || ''} onChange={e => patch(column.id, { label: e.target.value })} />
        <select className="input !py-1.5" value={column.kind || 'base'} onChange={e => patch(column.id, { kind: e.target.value })}>{COLUMN_KINDS.map(kind => <option key={kind}>{kind}</option>)}</select>
        <select className="input !py-1.5" value={column.type || 'text'} onChange={e => patch(column.id, { type: e.target.value })}>{COLUMN_DATA_TYPES.map(type => <option key={type}>{type}</option>)}</select>
        <button className="btn btn-ghost !p-2 text-rose-300" onClick={() => onChange(columns.filter(item => item.id !== column.id))}><Trash2 size={13} /></button>
      </div>
      <div className="column-schema-detail">
        {column.kind === 'base' && <label><span>Lead field</span><select className="input !py-1.5" value={column.field || 'phone'} onChange={e => patch(column.id, { field: e.target.value })}>{LEAD_FIELD_OPTIONS.map(field => <option key={field}>{field}</option>)}</select></label>}
        {column.kind === 'formula' && <label className="is-wide"><span>Formula expression</span><input className="input !py-1.5 mono" value={column.formula || ''} onChange={e => patch(column.id, { formula: e.target.value })} placeholder="e.g. valueEstimate * 0.1" /></label>}
        {(column.kind === 'conditional' || column.kind === 'dependent') && <>
          <label><span>Depends on</span><select className="input !py-1.5" value={column.dependsOn || 'stage'} onChange={e => patch(column.id, { dependsOn: e.target.value })}>{LEAD_FIELD_OPTIONS.map(field => <option key={field}>{field}</option>)}</select></label>
          <label><span>Condition</span><select className="input !py-1.5" value={column.operator || 'equals'} onChange={e => patch(column.id, { operator: e.target.value })}><option value="equals">equals</option><option value="not_equals">does not equal</option><option value="contains">contains</option><option value="greater_than">greater than</option><option value="less_than">less than</option><option value="is_empty">is empty</option><option value="is_not_empty">is not empty</option></select></label>
          {!['is_empty', 'is_not_empty'].includes(column.operator) && <label><span>Compare with</span><input className="input !py-1.5" value={column.expectedValue || ''} onChange={e => patch(column.id, { expectedValue: e.target.value })} /></label>}
          <label><span>{column.kind === 'dependent' ? 'Field/value when true' : 'Value when true'}</span><input className="input !py-1.5" value={column.trueValue || ''} onChange={e => patch(column.id, { trueValue: e.target.value })} placeholder={column.kind === 'dependent' ? 'e.g. remarks' : 'Displayed value'} /></label>
          {column.kind === 'conditional' && <label><span>Value when false</span><input className="input !py-1.5" value={column.falseValue || ''} onChange={e => patch(column.id, { falseValue: e.target.value })} /></label>}
        </>}
      </div>
    </div>)}</div>
    <p className="column-schema-help">Formula fields use lead field names directly. Dependent columns can return another lead field when their condition matches; conditional columns return configured true/false values.</p>
  </div>
}

function CadenceSteps({ steps, onChange, channels = DEFAULT_FOLLOW_UP_CHANNELS }) {
  const rows = [0, 1, 2, 3].map(i => steps[i] || { days: 3, channel: 'call', label: `Follow-up ${i + 1}` })
  const update = (i, patch) => {
    const next = rows.map((r, idx) => idx === i ? { ...r, ...patch } : r)
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] border border-white/6 px-3 py-2.5">
          <span className="chip bg-white/5 border border-white/10 text-slate-300 !px-2 !py-1 text-xs shrink-0">Follow-up {i + 1}</span>
          <input className="input !w-16 !py-1.5" type="number" min={1} value={r.days} onChange={e => update(i, { days: Number(e.target.value) || 1 })} />
          <span className="text-xs text-slate-500 shrink-0">days after previous contact</span>
          <select className="input !w-auto !py-1.5 ml-auto" value={r.channel} onChange={e => update(i, { channel: e.target.value })}>
            {channels.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
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
      {!rules.length && <p className="text-xs text-slate-600">No custom rules yet — leads won't be flagged beyond the built-in alerts.</p>}
    </div>
  )
}

function ToggleMini({ label, value, onChange }) {
  return (
    <button className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/6 px-3.5 py-2.5 text-left" onClick={() => onChange(!value)}>
      <span className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${value ? 'bg-rose-500' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-pure-white transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      <span className="text-sm font-medium text-slate-300 flex-1">{label}</span>
    </button>
  )
}

function ThemeCard({ active, onClick, title, sub, swatch }) {
  return (
    <button onClick={onClick} className={`rounded-2xl p-3 border transition-all ${active ? 'border-rose-400/40 bg-white/5' : 'border-white/10 bg-white/[0.02] hover:bg-white/5'}`}>
      <div className="h-16 rounded-xl mb-2" style={{ background: swatch, border: '1px solid rgba(255,255,255,0.12)' }} />
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold text-white">{title}</span>
        <span className="text-xs text-slate-500 ml-auto">{sub}</span>
        {active && <span className="w-4 h-4 rounded-full bg-emerald-400 flex items-center justify-center"><Check size={11} className="text-black" /></span>}
      </div>
    </button>
  )
}

const WEBHOOK_METHODS = ['POST', 'PUT', 'GET']

function WebhookRow({ webhook, logs, logsOpen, onToggleLogs, onRename, onSaveMapping, onSaveDefaults, onSaveMethod, onTest, onDetectMapping, onRegenerate, onDelete, onCopy, fieldRef }) {
  const [nameDraft, setNameDraft] = useState(webhook.name)
  const [testOpen, setTestOpen] = useState(false)
  const [testPayload, setTestPayload] = useState('{\n  "name": "Jane Doe",\n  "phone_number": "9876543210",\n  "email": "jane@example.com"\n}')
  const [testResult, setTestResult] = useState(null)
  const [testError, setTestError] = useState('')
  const [testing, setTesting] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)

  const toggleDocs = () => setDocsOpen(o => !o)

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

  const detectFromPayload = async () => {
    setDetecting(true); setTestError('')
    try {
      const parsed = JSON.parse(testPayload)
      await onDetectMapping(parsed)
    } catch (e) {
      setTestError(e instanceof SyntaxError ? 'Sample payload is not valid JSON' : e.message)
    } finally { setDetecting(false) }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3.5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input className="input !py-1.5 flex-1 min-w-[160px] font-semibold" value={nameDraft} onChange={e => setNameDraft(e.target.value)}
          onBlur={() => nameDraft.trim() && nameDraft !== webhook.name && onRename(nameDraft.trim())} />
        <select className="input !py-1.5 !text-sm !w-auto" value={webhook.method || 'POST'} onChange={e => onSaveMethod(e.target.value)} title="Request method this webhook accepts">
          {WEBHOOK_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="text-xs text-slate-500">Created {new Date(webhook.createdAt).toLocaleDateString()}</span>
        <span className="text-xs text-slate-500">· Last used {webhook.lastUsedAt ? new Date(webhook.lastUsedAt).toLocaleString() : 'never'}</span>
        <button className="btn btn-ghost !p-2" onClick={onToggleLogs} title="View call log"><ScrollText size={14} /></button>
        <button className="btn btn-ghost !p-2" onClick={onRegenerate} title="Regenerate key"><RefreshCcw size={14} /></button>
        <button className="btn btn-ghost !p-2 text-rose-400" onClick={onDelete} title="Delete"><Trash2 size={14} /></button>
      </div>
      <div className="flex items-center gap-2">
        <code className="input !py-1.5 flex-1 !text-xs overflow-x-auto whitespace-nowrap">{webhook.url}</code>
        <button className="btn btn-ghost !py-1.5" onClick={onCopy}><Copy size={13} /> Copy</button>
      </div>
      {webhook.method === 'GET' && <p className="text-xs text-amber-400/90">GET mode — send lead fields as query params on this URL, not a body.</p>}

      <FieldMappingEditor
        key={JSON.stringify(webhook.fieldMapping)}
        fieldMapping={webhook.fieldMapping}
        defaults={webhook.defaults}
        onSaveMapping={onSaveMapping}
        onSaveDefaults={onSaveDefaults}
        keyLabel="incoming payload key"
        keyPlaceholder="incoming JSON key, e.g. full_name"
        aliasReference={fieldRef}
      />

      <div>
        <button className="btn btn-ghost !py-1.5 !text-sm" onClick={() => setTestOpen(o => !o)}><TestTube2 size={12} /> {testOpen ? 'Hide test tool' : 'Test this webhook'}</button>
        {testOpen && (
          <div className="mt-2 space-y-2 rounded-lg bg-black/20 border border-white/6 p-2.5">
            <p className="text-xs text-slate-500">Paste a sample payload to preview the lead it would create — nothing is saved.</p>
            <textarea className="input !text-sm font-mono resize-none" rows={5} value={testPayload} onChange={e => setTestPayload(e.target.value)} />
            <div className="flex items-center gap-2">
              <button className="btn btn-soft !py-1.5 !text-sm" onClick={runTest} disabled={testing}>{testing ? <Spinner size={12} /> : <Zap size={12} />} Preview</button>
              <button className="btn btn-ghost !py-1.5 !text-sm" onClick={detectFromPayload} disabled={detecting}>{detecting ? <Spinner size={12} /> : <Sparkles size={12} />} Detect mapping from this payload</button>
            </div>
            {testError && <p className="text-xs text-rose-400">{testError}</p>}
            {testResult && (
              testResult.missing?.length ? (
                <p className="text-xs text-rose-400">Missing required field(s): {testResult.missing.join(', ')}</p>
              ) : (
                <div className="rounded-lg bg-white/[0.03] border border-white/8 p-2 space-y-1">
                  {Object.entries(testResult.preview || {}).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-xs">
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

      <div>
        <button className="btn btn-ghost !py-1.5 !text-sm" onClick={toggleDocs}><ScrollText size={12} /> {docsOpen ? 'Hide API docs' : 'API docs'}</button>
        {docsOpen && (
          <div className="mt-2 space-y-3 rounded-lg bg-black/20 border border-white/6 p-2.5 text-xs">
            <div>
              <div className="text-slate-500 mb-1">Auth: the <code className="mono">{webhook.key}</code> token embedded in the URL is the sole credential — anyone with the URL can post leads. No separate header needed. Regenerate to revoke it.</div>
            </div>
            <div>
              <div className="text-slate-400 font-semibold mb-1">Create / update a lead ({webhook.method || 'POST'})</div>
              <div className="text-slate-500 mb-1">Matches an existing lead by email or phone and updates it; otherwise creates a new lead. Send only the fields you want to set/change.</div>
              <pre className="input !text-xs font-mono overflow-x-auto whitespace-pre">{webhook.method === 'GET'
                ? `curl "${webhook.url}?name=Jane+Doe&email=jane@example.com&phone=9876543210"`
                : `curl -X POST '${webhook.url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\n    "name": "Jane Doe",\n    "email": "jane@example.com",\n    "phone": "9876543210",\n    "notes": "Interested in trial class"\n  }'`}</pre>
            </div>
            <div>
              <div className="text-slate-400 font-semibold mb-1">Responses</div>
              <div className="space-y-0.5 text-slate-500">
                <div><code className="mono text-emerald-400">201</code> {'{status:"created", leadId}'} — no existing lead matched</div>
                <div><code className="mono text-sky-400">200</code> {'{status:"updated", leadId}'} — matched by email/phone, fields merged in</div>
                <div><code className="mono text-rose-400">400</code> missing name or a valid email/phone</div>
                <div><code className="mono text-rose-400">404</code> unknown/regenerated key</div>
                <div><code className="mono text-rose-400">405</code> wrong HTTP method for this webhook</div>
                <div><code className="mono text-rose-400">429</code> rate limit exceeded (30 requests/min per webhook)</div>
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-semibold mb-1">Recognized field ids</div>
              <div className="text-slate-500 mb-1">Any of these incoming key spellings map automatically to the field, on top of whatever's set in the field mapping above.</div>
              {!fieldRef && <p className="text-slate-500">Loading…</p>}
              {fieldRef && (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {fieldRef.map(f => (
                    <div key={f.field} className="flex items-start gap-2">
                      <span className="text-slate-200 mono w-28 shrink-0">{f.field}</span>
                      <span className="text-slate-500 mono truncate">{f.aliases.join(', ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {logsOpen && (
        <div className="rounded-lg bg-black/20 border border-white/6 p-2.5 max-h-52 overflow-y-auto">
          {!logs && <p className="text-xs text-slate-500">Loading…</p>}
          {logs && !logs.length && <p className="text-xs text-slate-500">No calls received yet.</p>}
          {logs && logs.map(l => (
            <div key={l.id} className="flex items-center gap-2 text-xs py-1 border-b border-white/5 last:border-0">
              <span className="mono text-slate-500">{new Date(l.ts).toLocaleString()}</span>
              <OutcomeChip outcome={l.outcome} />
              {l.detail && <span className="text-slate-500 truncate" title={l.detail}>{l.detail}</span>}
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
    updated: 'bg-sky-500/15 text-sky-300',
    duplicate: 'bg-amber-500/15 text-amber-300',
    validation_failed: 'bg-rose-500/15 text-rose-300',
    invalid_body: 'bg-rose-500/15 text-rose-300',
    rate_limited: 'bg-rose-500/15 text-rose-300',
    synced: 'bg-emerald-500/15 text-emerald-300',
    error: 'bg-rose-500/15 text-rose-300'
  }
  return <span className={`chip !px-1.5 !py-0.5 text-xs ${styles[outcome] || 'bg-white/10 text-slate-300'}`}>{outcome}</span>
}

function Toggle({ on, onChange, title, desc, children }) {
  return (
    <div className="rounded-2xl border border-white/8 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h4 className="font-display font-semibold text-white text-base">{title}</h4>
          <p className="text-sm text-slate-500 mt-0.5">{desc}</p>
        </div>
        <button onClick={() => onChange(!on)} className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${on ? 'bg-rose-500' : 'bg-white/10'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-pure-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      {on && <div className="mt-4">{children}</div>}
    </div>
  )
}
