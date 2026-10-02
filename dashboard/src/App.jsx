import { useEffect, useState, Fragment } from 'react'
import { supabase, PRODUCT_ID, PRODUCT_NAME, PRODUCT_DESCRIPTION, PAYWALL_TITLE, PAYWALL_DESCRIPTION } from './supabase.js'
import { reconcileLines } from './reconcile.js'
import { analyzeWithDeepSeek } from './deepseek.js'

const FREE_LIMIT = 3

const SAMPLE_CONTRACT = [
  'consulting rate = 150',
  'cloud hosting = 4000',
  'support = 1200',
].join(String.fromCharCode(10))

const SAMPLE_INVOICE = [
  'consulting rate monthly 3600',
  'cloud hosting annual 8200',
  'priority support plan 1500',
  'misc expenses 500',
].join(String.fromCharCode(10))

export default function App() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [contractText, setContractText] = useState(SAMPLE_CONTRACT)
  const [invoiceText, setInvoiceText] = useState(SAMPLE_INVOICE)
  const [result, setResult] = useState(null)
  const [aiAnalysis, setAiAnalysis] = useState('')
  const [running, setRunning] = useState(false)
  const [usage, setUsage] = useState(0)
  const [showPaywall, setShowPaywall] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    loadUsage()
  }, [session])

  async function loadUsage() {
    try {
      const { data } = await supabase
        .from('usage')
        .select('count')
        .eq('user_id', session.user.id)
        .eq('product_id', PRODUCT_ID)
        .maybeSingle()
      setUsage((data && data.count) || 0)
    } catch (e) {
      setUsage(0)
    }
  }

  async function incrementUsage(lines) {
    const next = usage + lines
    setUsage(next)
    try {
      await supabase.from('usage').upsert(
        { user_id: session.user.id, product_id: PRODUCT_ID, count: next },
        { onConflict: 'user_id,product_id' }
      )
    } catch (e) {}
  }

  async function signIn() {
    setAuthError('')
    setAuthLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setAuthError(error.message)
    setAuthLoading(false)
  }

  async function signUp() {
    setAuthError('')
    setAuthLoading(true)
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) setAuthError(error.message)
    setAuthLoading(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
    setResult(null)
    setAiAnalysis('')
  }

  async function run() {
    const preview = reconcileLines(contractText, invoiceText)
    const lines = preview.summary.lines || 0
    if (usage + lines > FREE_LIMIT) {
      setShowPaywall(true)
      return
    }
    setRunning(true)
    setAiAnalysis('')
    setResult(preview)
    await incrementUsage(lines)
    const ai = await analyzeWithDeepSeek({
      contractText,
      invoiceText,
      results: preview.results,
      summary: preview.summary,
    })
    setAiAnalysis(ai || '')
    setRunning(false)
  }

  if (!session) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>{PRODUCT_NAME}</h1>
          <p className="sub">{PRODUCT_DESCRIPTION}</p>
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {authError && <div className="err">{authError}</div>}
          <div className="row">
            <button disabled={authLoading} onClick={signIn}>Sign in</button>
            <button disabled={authLoading} className="ghost" onClick={signUp}>Sign up</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>{PRODUCT_NAME}</h1>
          <p className="sub">{PRODUCT_DESCRIPTION}</p>
        </div>
        <div className="user">
          <span>{session.user.email}</span>
          <span className="usage">{usage}/{FREE_LIMIT} free lines</span>
          <button className="ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main>
        <section className="panes">
          <div className="pane">
            <label>Contract context (term = amount)</label>
            <textarea value={contractText} onChange={(e) => setContractText(e.target.value)} />
          </div>
          <div className="pane">
            <label>Invoice lines (description amount)</label>
            <textarea value={invoiceText} onChange={(e) => setInvoiceText(e.target.value)} />
          </div>
        </section>

        <button className="run" disabled={running} onClick={run}>
          {running ? 'Reconciling...' : 'Reconcile invoice'}
        </button>

        {result && (
          <Fragment>
            <section className="summary">
              <div className="stat"><span>Lines</span><strong>{result.summary.lines}</strong></div>
              <div className="stat"><span>Matched</span><strong>{result.summary.matched}</strong></div>
              <div className="stat warn"><span>Low confidence</span><strong>{result.summary.lowConfidence}</strong></div>
              <div className="stat danger"><span>Total leakage</span><strong>${result.summary.totalLeakage.toFixed(2)}</strong></div>
            </section>

            <section className="table">
              <div className="trow thead">
                <span>Line</span><span>Amount</span><span>Matched term</span>
                <span>Confidence</span><span>Leakage</span><span>Reason</span>
              </div>
              {result.results.map((r, i) => (
                <div className="trow" key={i}>
                  <span>{r.description}</span>
                  <span>${r.amount.toFixed(2)}</span>
                  <span>{r.matchedTerm || '-'}</span>
                  <span className={r.confidence < 0.75 ? 'low' : 'ok'}>{(r.confidence * 100).toFixed(0)}%</span>
                  <span className={r.leakage > 0 ? 'low' : 'ok'}>${r.leakage.toFixed(2)}</span>
                  <span>{r.reason}</span>
                </div>
              ))}
            </section>

            {aiAnalysis && (
              <section className="ai">
                <h3>Assistant analysis</h3>
                <pre>{aiAnalysis}</pre>
              </section>
            )}
          </Fragment>
        )}
      </main>

      {showPaywall && (
        <div className="overlay" onClick={() => setShowPaywall(false)}>
          <div className="paywall" onClick={(e) => e.stopPropagation()}>
            <h2>{PAYWALL_TITLE}</h2>
            {PAYWALL_DESCRIPTION}
            <button onClick={() => setShowPaywall(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
