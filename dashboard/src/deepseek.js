const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

export async function analyzeWithDeepSeek({ contractText, invoiceText, results, summary }) {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY
  if (!apiKey) return null
  const context = import.meta.env.VITE_ASSISTANT_CONTEXT || ''
  const prompt = [
    'You are an AP reconciliation assistant.',
    context,
    '',
    'Contract text:',
    (contractText || '').slice(0, 4000),
    '',
    'Invoice text:',
    (invoiceText || '').slice(0, 4000),
    '',
    'Deterministic reconciliation results:',
    JSON.stringify(results, null, 2),
    'Summary: ' + JSON.stringify(summary),
    '',
    'Provide a concise analysis: which lines are risky, why, and recommended next actions before payment.',
  ].join('\n')
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are a precise invoice reconciliation analyst for accounts payable.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || null
  } catch (e) {
    return null
  }
}
