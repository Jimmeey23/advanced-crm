import React, { useState } from 'react'
import { Mail, Lock, ShieldCheck, Loader2, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

async function claimAdminCode(code) {
  if (!code.trim()) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  await fetch('/api/auth/admin-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ code: code.trim() })
  })
}

export default function LoginPage() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [adminCode, setAdminCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
      } else {
        const { error: err } = await supabase.auth.signUp({ email, password })
        if (err) throw err
        await claimAdminCode(adminCode)
      }
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const withGoogle = async () => {
    setError('')
    setBusy(true)
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({ provider: 'google' })
      if (err) throw err
    } catch (err) {
      setError(err.message || 'Google sign-in failed')
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-blob login-blob-1" />
      <div className="login-blob login-blob-2" />
      <div className="login-blob login-blob-3" />

      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-mark">P57</div>
          <div>
            <div className="login-brand-name">Lead Studio</div>
            <div className="login-brand-sub">Physique 57</div>
          </div>
        </div>

        <div className="login-tabs">
          <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Sign up</button>
        </div>

        <form onSubmit={submit} className="login-form">
          <label className="login-field">
            <Mail size={15} />
            <input type="email" required placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <label className="login-field">
            <Lock size={15} />
            <input type="password" required minLength={6} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          {mode === 'signup' && (
            <>
              <label className="login-field">
                <Lock size={15} />
                <input type="password" required minLength={6} placeholder="Confirm password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
              </label>
              <label className="login-field login-field-optional">
                <ShieldCheck size={15} />
                <input type="text" placeholder="Admin code (optional)" value={adminCode} onChange={e => setAdminCode(e.target.value)} />
              </label>
            </>
          )}

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-submit" disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <>{mode === 'signin' ? 'Sign in' : 'Create account'} <ArrowRight size={15} /></>}
          </button>
        </form>

        <div className="login-divider"><span>or</span></div>

        <button type="button" className="login-google" onClick={withGoogle} disabled={busy}>
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.6 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l6-6C34.6 5.5 29.6 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.4-.3-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l6-6C34.6 6.5 29.6 4.5 24 4.5 16 4.5 9 8.9 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44.5c5.5 0 10.4-1.9 14.2-5.1l-6.6-5.4c-2 1.5-4.6 2.5-7.6 2.5-5.4 0-9.9-3.4-11.5-8.2l-6.6 5.1C9 40 16 44.5 24 44.5z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2-2 3.7-3.7 5l6.6 5.4C41.5 35.7 44.5 30.3 44.5 24c0-1.2-.1-2.4-.3-3.5z"/>
          </svg>
          Continue with Google
        </button>
      </div>
    </div>
  )
}
