import { authenticator } from 'otplib'

const LOGIN_URL = 'https://api.momence.com/auth/login'
const MFA_URL = 'https://api.momence.com/auth/mfa/totp/verify'
const DASHBOARD_ORIGIN = 'https://momence.com'

const ENV_NAMES = Object.freeze({
  email: 'USER_MOMENCE_DASHBOARD_EMAIL',
  password: 'USER_MOMENCE_DASHBOARD_PASSWORD',
  totpSecret: 'USER_MOMENCE_DASHBOARD_TOTP_SECRET'
})

export function dashboardAuthConfig(env = process.env) {
  const values = Object.fromEntries(Object.entries(ENV_NAMES).map(([key, name]) => [key, String(env[name] || '').trim()]))
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => ENV_NAMES[key])
  if (missing.length) throw new Error(`Momence dashboard authentication is not configured: ${missing.join(', ')}`)
  return values
}

function splitSetCookie(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(splitSetCookie)
  return String(value).split(/,(?=\s*[^;,=]+=[^;,]*)/g)
}

function cookiePairs(source) {
  return splitSetCookie(source).map(raw => String(raw).split(';', 1)[0].trim()).filter(pair => pair.includes('='))
}

export function mergeCookieHeaders(...sources) {
  const cookies = new Map()
  for (const pair of sources.flatMap(cookiePairs)) cookies.set(pair.slice(0, pair.indexOf('=')), pair)
  return [...cookies.values()].join('; ')
}

function responseCookies(response) {
  if (typeof response?.headers?.getSetCookie === 'function') return response.headers.getSetCookie()
  return splitSetCookie(response?.headers?.get?.('set-cookie'))
}

async function readBody(response) {
  const text = await response.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

function safeMessage(body, status) {
  const message = typeof body === 'string' ? body : body?.message || body?.error || body?.detail
  return String(message || `Momence dashboard request failed (${status})`).slice(0, 300)
}

export function createMomenceDashboardClient({
  fetchImpl = fetch,
  env = process.env,
  generateTotp = secret => authenticator.generate(secret)
} = {}) {
  let cookieHeader = ''
  let loginPromise = null

  async function authenticate(force = false) {
    if (force) cookieHeader = ''
    if (cookieHeader) return cookieHeader
    if (loginPromise) return loginPromise
    loginPromise = (async () => {
      const config = dashboardAuthConfig(env)
      const deviceData = {
        browser: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        screen: { width: 1470, height: 956 }
      }
      const loginResponse = await fetchImpl(LOGIN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: config.email, password: config.password, deviceData })
      })
      const loginBody = await readBody(loginResponse)
      if (!loginResponse.ok) throw new Error(`Momence dashboard login failed: ${safeMessage(loginBody, loginResponse.status)}`)
      const loginCookies = responseCookies(loginResponse)
      const mfaResponse = await fetchImpl(MFA_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: mergeCookieHeaders(loginCookies) },
        body: JSON.stringify({ token: generateTotp(config.totpSecret), deviceData, trustDevice: true })
      })
      const mfaBody = await readBody(mfaResponse)
      if (!mfaResponse.ok) throw new Error(`Momence dashboard MFA failed: ${safeMessage(mfaBody, mfaResponse.status)}`)
      const combined = mergeCookieHeaders(loginCookies, responseCookies(mfaResponse))
      if (!combined) throw new Error('Momence dashboard authentication did not return a session cookie')
      cookieHeader = combined
      return combined
    })().finally(() => { loginPromise = null })
    return loginPromise
  }

  async function perform(path, init, allowRetry) {
    if (!String(path).startsWith('/_api/primary/')) throw new Error('Momence dashboard path is not allowed')
    const cookie = await authenticate()
    const response = await fetchImpl(`${DASHBOARD_ORIGIN}${path}`, {
      ...init,
      headers: { accept: 'application/json, text/plain, */*', ...(init?.headers || {}), cookie }
    })
    if (allowRetry && (response.status === 401 || response.status === 403)) {
      await authenticate(true)
      return perform(path, init, false)
    }
    const body = await readBody(response)
    if (!response.ok) {
      const error = new Error(safeMessage(body, response.status))
      error.status = response.status
      throw error
    }
    return body
  }

  return { request: (path, init = {}) => perform(path, init, true) }
}
