// OpenAI GPT integration layer for AI enrichment.
// The API key can come from the OPENAI_API_KEY env var or from
// Settings > Integrations (stored in the app's own settings).
import OpenAI from 'openai'

let client = null

export function apiKey(db) {
  return (process.env.USER_OPENAI_API_KEY || '').trim() || db?.settings?.gpt?.apiKey?.trim() || ''
}

export function isEnabled(db) {
  return Boolean(apiKey(db))
}

export function modelName(db) {
  return (process.env.USER_OPENAI_MODEL || db?.settings?.gpt?.model || 'gpt-4o-mini').trim()
}

function getClient(db) {
  const key = apiKey(db)
  if (!key) return null
  if (!client) client = new OpenAI({ apiKey: key })
  return client
}

// Generate enriched intelligence for a lead. Returns null when not
// configured or when the provider call fails (caller falls back to heuristics).
export async function enrichLeadWithGpt(lead, db) {
  const c = getClient(db)
  if (!c) return null

  const fu = (lead.followUps || []).slice(-12).map((f, i) => ({
    n: i + 1,
    date: f.date,
    channel: f.channel || 'note',
    done: Boolean(f.done),
    comments: f.comments
  }))

  const system = [
    'You are the sales intelligence engine for Physique 57, a boutique fitness studio chain.',
    'Given a lead record, produce concise, actionable sales intelligence.',
    'Respond ONLY with a JSON object containing:',
    'summary (string, 2-3 sentences),',
    'insights (array of 3 strings),',
    'nextAction (object {label, text}),',
    'bestContactTime (string),',
    'sentiment ("positive" | "neutral" | "negative" | "unknown"),',
    'followupSuggestions (array of up to 3 objects {channel:"whatsapp"|"call"|"email"|"sms", label, text}).',
    'Keep messages short, natural and free of emojis.'
  ].join(' ')

  const user = JSON.stringify({
    name: lead.fullName,
    stage: lead.stage,
    status: lead.status,
    source: lead.sourceName,
    phone: lead.phone,
    email: lead.email,
    remarks: lead.remarks,
    followUps: fu
  })

  const resp = await c.chat.completions.create({
    model: modelName(db),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.4,
    max_tokens: 700
  })

  const text = resp.choices?.[0]?.message?.content
  if (!text) return null

  const parsed = JSON.parse(text)
  return {
    summary: String(parsed.summary || '').trim() || null,
    insights: Array.isArray(parsed.insights) ? parsed.insights.map(String).filter(Boolean).slice(0, 5) : [],
    nextAction: parsed.nextAction
      ? { label: String(parsed.nextAction.label || 'Next step'), text: String(parsed.nextAction.text || '') }
      : null,
    bestContactTime: String(parsed.bestContactTime || ''),
    sentiment: ['positive', 'neutral', 'negative', 'unknown'].includes(parsed.sentiment) ? parsed.sentiment : 'unknown',
    followupSuggestions: Array.isArray(parsed.followupSuggestions)
      ? parsed.followupSuggestions.slice(0, 3).map(s => ({
          channel: ['call', 'whatsapp', 'email', 'sms'].includes(s.channel) ? s.channel : 'whatsapp',
          label: String(s.label || s.channel || 'Message'),
          text: String(s.text || '')
        }))
      : [],
    model: modelName(db),
    generatedAt: new Date().toISOString()
  }
}
