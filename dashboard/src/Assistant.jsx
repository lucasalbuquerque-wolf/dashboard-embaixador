import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ask } from './lib/ai'

export default function Assistant({ context }) {
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  async function send(q) {
    const question = (q ?? input).trim()
    if (!question || busy) return
    setInput(''); setErr('')
    const next = [...msgs, { role: 'user', content: question }]
    setMsgs(next); setBusy(true)
    try { setMsgs([...next, { role: 'assistant', content: await ask(next, context) }]) }
    catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const open = msgs.length > 0 || busy || err

  return (
    <div className="assistant">
      <form className="ask-bar" onSubmit={(e) => { e.preventDefault(); send() }}>
        <i className="ph ph-sparkle ask-ic" />
        <input value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off"
          placeholder="Pergunte ao assistente sobre os dados, programas ou definições…" />
        {open && <button type="button" className="ask-clear" onClick={() => { setMsgs([]); setErr('') }} title="limpar">×</button>}
        <button disabled={busy}>{busy ? '…' : 'Perguntar'}</button>
      </form>
      {open && (
        <div className="chat">
          {msgs.map((m, i) => (
            <div key={i} className={'msg ' + m.role}>
              {m.role === 'assistant'
                ? <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                : m.content}
            </div>
          ))}
          {busy && <div className="msg assistant muted">pensando…</div>}
          {err && <div className="msg erro">⚠ {err}</div>}
          <div ref={endRef} />
        </div>
      )}
    </div>
  )
}
