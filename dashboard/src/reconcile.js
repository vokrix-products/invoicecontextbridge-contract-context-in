// Contract-context reconciliation engine (mirrors processor.py)

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.75

export function normalize(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
}

function parseNumber(value) {
  const n = parseFloat(String(value).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? 0 : n
}

export function parseTerms(contractText) {
  const terms = []
  const lines = (contractText || '').split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(.+?)[\s:=]+\$?([0-9][0-9,]*\.?[0-9]*)\s*(.*)$/)
    if (m) {
      const key = m[1].replace(/[-\u2022*]|\d+\./g, '').trim()
      const value = parseNumber(m[2])
      const context = (m[3] || '').trim()
      if (key && value > 0) {
        terms.push({ key: normalize(key), label: key, value, context })
      }
    }
  }
  return terms
}

export function parseInvoiceLines(invoiceText) {
  const lines = []
  const rows = (invoiceText || '').split('\n')
  for (const raw of rows) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(.+?)\s+\$?([0-9][0-9,]*\.?[0-9]*)\s*(?:x\s*([0-9.]+))?$/i)
    if (m) {
      const description = m[1].replace(/[-\u2022*]|\d+\./g, '').trim()
      const amount = parseNumber(m[2])
      const quantity = m[3] ? parseFloat(m[3]) : 1
      if (description) lines.push({ description, amount, quantity })
    }
  }
  return lines
}

export function reconcileLines(contractText, invoiceText) {
  const terms = parseTerms(contractText)
  const lines = parseInvoiceLines(invoiceText)
  const results = lines.map((line) => {
    const desc = normalize(line.description)
    let best = null
    let bestScore = 0
    for (const term of terms) {
      if (term.key && desc.includes(term.key)) {
        const score = term.key.length / Math.max(desc.length, 1)
        if (score > bestScore) {
          bestScore = score
          best = term
        }
      }
    }
    if (!best) {
      return {
        description: line.description,
        amount: line.amount,
        quantity: line.quantity,
        matchedTerm: null,
        confidence: 0,
        leakage: 0,
        reason: 'no matching contract term',
      }
    }
    const expected = best.value * (line.quantity || 1)
    const leakage = Math.max(0, line.amount - expected)
    return {
      description: line.description,
      amount: line.amount,
      quantity: line.quantity,
      matchedTerm: best.label,
      confidence: bestScore,
      leakage,
      reason: leakage === 0 ? 'within contract' : "leakage vs term '" + best.label + "'",
    }
  })
  const totalLeakage = results.reduce((s, r) => s + r.leakage, 0)
  const summary = {
    lines: results.length,
    matched: results.filter((r) => r.matchedTerm).length,
    lowConfidence: results.filter((r) => r.confidence < DEFAULT_CONFIDENCE_THRESHOLD).length,
    totalLeakage,
  }
  return { results, summary, terms, lineCount: lines.length }
}
