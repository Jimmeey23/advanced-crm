# Lead Webhook Integration — Design

## Purpose
Let external tools (signup forms, landing pages, Zapier, Typeform, etc.) create leads in this CRM automatically via an HTTP webhook, without manual entry.

## Scope
Generic inbound webhook endpoint + per-integration configuration UI. No outbound webhooks (not in scope). No support for platform-specific native connectors (e.g. a dedicated Typeform app) — any tool that can POST JSON works.

## Architecture

### Data model
New table `webhook_integrations`:
- `id`
- `name` — user-facing label (e.g. "Landing Page Signup Form")
- `key` — unique random token (32+ chars), embedded in the URL, acts as bearer secret
- `field_mapping` — JSON object mapping incoming payload keys → lead fields, e.g. `{"full_name":"name","email_address":"email","phone_number":"phone"}`
- `created_at`, `last_used_at`

### Endpoint
`POST /api/webhooks/leads/:key`

Flow:
1. Look up `:key` in `webhook_integrations`. Unknown key → `404`.
2. Rate-limit per key (basic in-memory or existing rate-limit middleware if present) to prevent abuse.
3. Apply `field_mapping` to the JSON body to produce a normalized lead payload (name, email, phone, source, plus any mapped custom fields → lead notes/custom field if the schema supports it).
4. Validate: `name` present, and at least one of `email`/`phone` present. Missing → `400` with a clear error body.
5. Dedupe check: look up existing lead by matching `email` OR `phone`.
   - Match found → do NOT create a new lead. Append a timeline/activity entry on the existing lead ("Duplicate signup received via {integration name}"). Respond `200 {status:"duplicate", leadId}`.
   - No match → create lead via the existing internal lead-creation function (same code path as manual creation, so it gets the same defaults: first pipeline stage, unassigned). Set `source` to the integration name (or payload-provided source if mapped). Respond `201 {status:"created", leadId}`.
6. Update `last_used_at` on the integration record.

### Settings UI
New "Integrations" section (or tab within existing Settings page):
- List of configured webhooks (name, created date, last used).
- "Create webhook" → generates `key`, shows full copyable URL.
- Field mapping editor: shows keys from the most recent received payload (if any) or a manual key/value entry, each mapped via dropdown to a lead field (name / email / phone / source / notes / custom fields already supported by the lead schema).
- Delete/regenerate key action.

### Security
- Key is the sole auth factor — long, random, unguessable. No HMAC signing (adds setup friction for non-technical form tools; static key matches how most no-code tools configure webhooks).
- Regenerating a key invalidates the old one immediately (old URL starts 404ing).

### Error handling
- Unknown key: 404, no leakage of whether key format is valid.
- Missing required fields: 400 with which field(s) are missing.
- Malformed JSON body: 400.
- All webhook calls (success, duplicate, or validation failure) get a lightweight log entry (integration id, timestamp, outcome) visible in the Integrations UI for debugging — helps users confirm their form is wired correctly.

### Testing
- Unit test the field-mapping transform function.
- Integration test: POST with valid key + payload → lead created with correct field values, default stage/unassigned.
- Integration test: duplicate email → no new lead, activity log entry on existing lead.
- Integration test: unknown key → 404. Missing name → 400.
