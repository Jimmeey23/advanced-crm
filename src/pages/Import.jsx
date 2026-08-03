import React, { useRef, useState } from 'react'
import { UploadCloud, FileSpreadsheet, ArrowRight, CheckCircle2, RefreshCcw, History, Download } from 'lucide-react'
import { useApp } from '../store.jsx'
import { useFetch } from '../hooks.js'
import { api } from '../api.js'
import { Spinner } from '../ui.jsx'

const FIELDS = [
  { key: 'id', label: 'ID', required: false },
  { key: 'fullName', label: 'Full name', required: true },
  { key: 'phone', label: 'Phone number', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'createdAt', label: 'Created at', required: false },
  { key: 'sourceId', label: 'Source ID', required: false },
  { key: 'sourceName', label: 'Lead source', required: false },
  { key: 'memberId', label: 'Momence member ID', required: false },
  { key: 'convertedAt', label: 'Converted to customer at', required: false },
  { key: 'stage', label: 'Stage', required: false },
  { key: 'associate', label: 'Associate / owner', required: false },
  { key: 'remarks', label: 'Remarks / notes', required: false },
  { key: 'followUps', label: 'Follow-ups', required: false },
  { key: 'center', label: 'Center / location', required: false },
  { key: 'classType', label: 'Class type', required: false },
  { key: 'hostId', label: 'Host ID', required: false },
  { key: 'channel', label: 'Channel', required: false },
  { key: 'status', label: 'Status', required: false },
  { key: 'period', label: 'Period', required: false },
  { key: 'purchasesMade', label: 'Purchases made', required: false },
  { key: 'valueEstimate', label: 'LTV', required: false },
  { key: 'visits', label: 'Visits', required: false },
  { key: 'trialStatus', label: 'Trial status', required: false },
  { key: 'conversionStatus', label: 'Conversion status', required: false },
  { key: 'retentionStatus', label: 'Retention status', required: false }
]

export default function Import() {
  const { boot, refreshData, toast } = useApp()
  const [step, setStep] = useState(1)
  const [parsed, setParsed] = useState(null)
  const [mapping, setMapping] = useState({})
  const [options, setOptions] = useState({ locationId: boot?.locations?.[0]?.id || '', autoAssign: true, defaultStage: boot?.settings?.business?.defaultStage || boot?.stages?.[0] || 'New Enquiry' })
  const [uploading, setUploading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)

  const { data: history, reload: reloadHistory } = useFetch(() => api.get('/api/imports'), [])

  const handleFile = async (file) => {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.upload('/api/leads/import/parse', fd)
      setParsed(res)
      setMapping(res.autoMap || {})
      setStep(2)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setUploading(false)
    }
  }

  const setMapField = (field, col) => setMapping(m => ({ ...m, [field]: col }))
  const setFollowUp = (idx, field, col) => {
    const fups = [...(mapping.followUps || [])]
    const p = fups.find(p => p.index === idx)
    if (p) p[field] = col
    else fups.push({ index: idx, date: field === 'date' ? col : null, comments: field === 'comments' ? col : null })
    setMapping(m => ({ ...m, followUps: fups }))
  }

  const apply = async () => {
    setApplying(true)
    try {
      const res = await api.post('/api/leads/import/apply', {
        rows: parsed.rows, mapping, options: { ...options, fileName: parsed.fileName }
      })
      setResult(res)
      setStep(3)
      refreshData()
      reloadHistory()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setApplying(false)
    }
  }

  const reset = () => { setStep(1); setParsed(null); setMapping({}); setResult(null) }

  return (
    <div className="p-6 space-y-5 max-w-[1100px]">
      {/* steps indicator */}
      <div className="flex items-center gap-2 text-[12.5px]">
        {[
          { n: 1, label: 'Upload CSV' }, { n: 2, label: 'Map columns' }, { n: 3, label: 'Import & verify' }
        ].map((s, i) => (
          <React.Fragment key={s.n}>
            {i > 0 && <ArrowRight size={14} className="text-slate-600" />}
            <span className={`flex items-center gap-2 chip ${step >= s.n ? 'bg-rose-500/15 text-rose-200 border border-rose-400/25' : 'bg-white/5 text-slate-500 border border-white/10'}`}>
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9.5px] font-bold ${step >= s.n ? 'bg-rose-500 text-white' : 'bg-white/10'}`}>{s.n}</span>
              {s.label}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* step 1: upload */}
      {step === 1 && (
        <div>
          <div
            className="card p-10 flex flex-col items-center justify-center text-center cursor-pointer border-dashed hover:border-rose-400/40 transition-colors"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }}
          >
            {uploading ? <Spinner size={26} /> : <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-400/25 flex items-center justify-center text-rose-400 mb-4"><UploadCloud size={26} /></div>}
            <h3 className="font-display font-semibold text-white text-[16px]">Drop your CSV here, or click to browse</h3>
            <p className="text-[12.5px] text-slate-500 mt-1.5 max-w-md">Headers are auto-detected — you can remap every column in the next step. Follow-up date/comment pairs (up to 4) are detected automatically.</p>
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
            <button className="btn btn-primary mt-5"><FileSpreadsheet size={15} /> Choose CSV file</button>
          </div>

          <div className="card p-4 mt-4">
            <h4 className="font-display font-semibold text-white text-[13px] mb-2 flex items-center gap-2"><Download size={14} className="text-slate-400" /> Expected format</h4>
            <p className="text-[11.5px] text-slate-500 mb-2">Recommended columns (tab or comma separated):</p>
            <pre className="text-[10.5px] leading-relaxed text-slate-400 bg-black/30 rounded-lg p-3 overflow-x-auto scrollbar-thin">ID, Full Name, Phone Number, Email, Created At, Source ID, Source Name, Member ID, Converted To Customer At, Stage Name, Associate, Remarks, Follow Up 1 Date, Follow Up Comments (1), Follow Up 2 Date, Follow Up Comments (2), Follow Up 3 Date, Follow Up Comments (3), Follow Up 4 Date, Follow Up Comments (4), Center, Class Type, Host ID, Status, Channel, Period, Purchases Made, LTV, Visits, Trial Status, Conversion Status, Retention Status</pre>
          </div>
        </div>
      )}

      {/* step 2: mapping */}
      {step === 2 && parsed && (
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display font-semibold text-white text-[14px]">Map your columns</h3>
                <p className="text-[11.5px] text-slate-500 mt-0.5">{parsed.fileName} · {parsed.total} rows · {parsed.columns.length} columns detected</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-[12px] text-slate-300"><input type="checkbox" checked={options.autoAssign} className="accent-rose-500" onChange={e => setOptions(o => ({ ...o, autoAssign: e.target.checked }))} /> Auto-assign (round robin)</label>
                <select className="input !w-auto !py-1.5" value={options.locationId} onChange={e => setOptions(o => ({ ...o, locationId: e.target.value }))}>
                  {(boot?.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <button className="btn btn-ghost !py-2 !text-[12px]" onClick={() => setMapping(parsed.autoMap)}><RefreshCcw size={13} /> Auto-map</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {FIELDS.map(f => (
                <div key={f.key} className="flex items-center gap-2.5">
                  <span className="w-[150px] shrink-0 text-[12.5px] text-slate-300">
                    {f.label} {f.required && <span className="text-rose-400">*</span>}
                  </span>
                  <select className="input !py-1.5" value={mapping[f.key] || ''} onChange={e => setMapField(f.key, e.target.value)}>
                    <option value="">— skip —</option>
                    {parsed.columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <div className="text-[12.5px] text-slate-300 mb-2">Follow-up pairs (date + comments)</div>
              <div className="space-y-2">
                {[1, 2, 3, 4].map(idx => {
                  const p = (mapping.followUps || []).find(x => x.index === idx)
                  return (
                    <div key={idx} className="grid grid-cols-[1fr_1fr] gap-2 items-center">
                      <span className="text-[11.5px] text-slate-500 w-16">Follow-up {idx}</span>
                      <select className="input !py-1 !text-[11.5px]" value={p?.date || ''} onChange={e => setFollowUp(idx, 'date', e.target.value)}>
                        <option value="">— date —</option>
                        {parsed.columns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select className="input !py-1 !text-[11.5px]" value={p?.comments || ''} onChange={e => setFollowUp(idx, 'comments', e.target.value)}>
                        <option value="">— comments —</option>
                        {parsed.columns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* preview */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-white/8 text-[12.5px] text-slate-300 font-semibold">Preview (first 5 rows)</div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-left text-[11.5px]">
                <thead><tr className="text-slate-500 border-b border-white/8">{parsed.columns.map(c => <th key={c} className="px-3 py-2 font-semibold whitespace-nowrap">{c}</th>)}</tr></thead>
                <tbody>
                  {parsed.preview.map((r, i) => (
                    <tr key={i} className="border-b border-white/5">
                      {parsed.columns.map(c => <td key={c} className="px-3 py-2 text-slate-300 whitespace-nowrap max-w-[220px] truncate">{r[c] || ''}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={reset}>Back</button>
            <button className="btn btn-primary" onClick={apply} disabled={applying || !mapping.fullName}>
              {applying ? <Spinner size={15} /> : <UploadCloud size={15} />} Import {parsed.total} rows
            </button>
          </div>
        </div>
      )}

      {/* step 3: result */}
      {step === 3 && result && (
        <div className="card p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-400/25 flex items-center justify-center text-emerald-400 mx-auto mb-4"><CheckCircle2 size={26} /></div>
          <h3 className="font-display font-bold text-white text-[18px]">Import complete</h3>
          <p className="text-[13px] text-slate-400 mt-2">Created <b className="text-emerald-400">{result.created}</b> new leads, skipped <b className="text-slate-300">{result.skipped}</b>.</p>
          {result.errors?.length > 0 && (
            <div className="mt-4 text-left max-w-md mx-auto">
              <p className="text-[11.5px] text-amber-400 font-semibold mb-1">{result.errors.length} rows had issues:</p>
              <div className="space-y-1">{result.errors.slice(0, 5).map((e, i) => <p key={i} className="text-[11px] text-slate-500">Row {e.row}: {e.message}</p>)}</div>
            </div>
          )}
          <div className="flex justify-center gap-2 mt-6">
            <button className="btn btn-ghost" onClick={() => { setStep(2) }}>Review import</button>
            <button className="btn btn-primary" onClick={reset}><UploadCloud size={15} /> Import another file</button>
          </div>
        </div>
      )}

      {/* history */}
      <div className="card p-5">
        <h4 className="font-display font-semibold text-white text-[13px] mb-3 flex items-center gap-2"><History size={14} className="text-slate-400" /> Import history</h4>
        {history?.length ? (
          <div className="space-y-2">
            {history.slice(0, 8).map(h => (
              <div key={h.id} className="flex items-center gap-3 text-[12.5px] py-2 border-b border-white/5 last:border-0">
                <FileSpreadsheet size={15} className="text-rose-400 shrink-0" />
                <span className="text-slate-200 truncate flex-1">{h.fileName}</span>
                <span className="text-emerald-400 mono">{h.created} created</span>
                <span className="text-slate-500">{h.skipped} skipped</span>
                <span className="text-slate-600 whitespace-nowrap">{new Date(h.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-[12px] text-slate-500">No imports yet.</p>}
      </div>
    </div>
  )
}
