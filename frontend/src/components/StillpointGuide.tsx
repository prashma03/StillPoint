import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { sendGuideMessage, type GuideMessage } from '../lib/ai'
import {
  guideFallback,
  guideLinkAfterFailure,
  guideLinkFromStatus,
  guideLinkLabel,
  guideSegments,
  type GuideLink,
} from '../lib/guide'

type Message = { id: number; from: 'guide' | 'you'; text: string; local?: boolean }

function GuideText({ text }: { text: string }) {
  const nodes: ReactNode[] = []
  guideSegments(text).forEach((part, index) => {
    const lines = part.text.split('\n')
    lines.forEach((line, lineIndex) => {
      const key = `${index}-${lineIndex}`
      if (lineIndex > 0) nodes.push(<br key={`${key}-br`} />)
      if (!line) return
      nodes.push(part.kind === 'strong' ? <strong key={key}>{line}</strong> : <span key={key}>{line}</span>)
    })
  })
  return <>{nodes}</>
}
const suggestions = ['What should I do next?', 'How does verification work?', 'What can I do with my report?']
const pageNames: Record<string, string> = {
  '/': 'home', '/check': 'check', '/protect': 'protect', '/results': 'results',
  '/proof': 'proof', '/trust': 'trust', '/settings': 'settings',
}

export function StillpointGuide() {
  const location = useLocation()
  const page = pageNames[location.pathname] ?? (location.pathname.startsWith('/protected/') ? 'protect' : 'other')
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [link, setLink] = useState<GuideLink>('connecting')
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const counter = useRef(0)
  const history = useRef<GuideMessage[]>([])

  useEffect(() => {
    let active = true
    fetch('http://127.0.0.1:8787/api/status', { signal: AbortSignal.timeout(5000) })
      .then((response) => response.json())
      .then((body: { configured?: boolean }) => { if (active) setLink(guideLinkFromStatus(body.configured, false)) })
      .catch(() => { if (active) setLink('unavailable') })
    return () => { active = false }
  }, [])

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, loading, error])
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    inputRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setQuestion('')
    setError('')
    setMessages((current) => [...current, { id: counter.current++, from: 'you', text: trimmed }])
    const previousHistory = history.current
    const nextHistory = [...previousHistory, { role: 'user' as const, content: trimmed }].slice(-19)
    history.current = nextHistory
    setLoading(true)
    const result = await sendGuideMessage(nextHistory, page)
    setLoading(false)
    if (!result.ok) {
      history.current = previousHistory
      setError(result.error)
      setLink((current) => guideLinkAfterFailure(current, result.code))
      setMessages((current) => [...current, { id: counter.current++, from: 'guide', text: guideFallback(page), local: true }])
      return
    }
    const reply = { role: 'assistant' as const, content: result.reply }
    history.current = [...history.current, reply].slice(-20)
    setMessages((current) => [...current, { id: counter.current++, from: 'guide', text: result.reply }])
    setLink('available')
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void send(question) }

  return <aside className="guide-root" aria-label="Stillpoint Guide">
    {open && <section className="guide-panel" role="dialog" aria-modal="false" aria-labelledby="guide-title">
      <header className="guide-head">
        <span className="guide-mini-orb" aria-hidden="true"><i /><i /><i /></span>
        <div><h2 id="guide-title">Stillpoint Guide</h2><span className={`guide-mode is-${link}`}><i />{guideLinkLabel(link)}</span></div>
        <button className="guide-close" onClick={() => setOpen(false)} aria-label="Close Stillpoint Guide">×</button>
      </header>
      <div className="guide-privacy">Only your chat text and current page label are sent. Don’t include private details.</div>
      <div className="guide-messages" ref={listRef} aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 && <div className="guide-message guide-guide">{link === 'unavailable' || link === 'not_configured' ? 'The conversational AI is unavailable right now. Start the local backend and configure its model API key to chat.' : 'Hi, I’m the Stillpoint Guide. What’s on your mind?'}</div>}
        {messages.map((message) => <div className={`guide-message guide-${message.from}${message.local ? ' guide-local' : ''}`} key={message.id}>{message.local && <span className="guide-source">Not a model reply</span>}<GuideText text={message.text} /></div>)}
        {loading && <div className="guide-message guide-guide guide-thinking" role="status"><i /><i /><i /><span className="sr-only">Stillpoint Guide is responding</span></div>}
        {error && <div className="guide-error" role="alert">{error}</div>}
      </div>
      {messages.length === 0 && link !== 'unavailable' && link !== 'not_configured' && <div className="guide-suggestions">{suggestions.map((item) => <button key={item} onClick={() => void send(item)} disabled={loading}>{item}</button>)}</div>}
      <form className="guide-compose" onSubmit={submit}><label className="sr-only" htmlFor="guide-question">Ask Stillpoint Guide</label><input ref={inputRef} id="guide-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question…" /><button aria-label="Send message" disabled={!question.trim() || loading}>↑</button></form>
      <p className="guide-disclaimer">Model replies are AI generated. Local navigation help is labeled separately. Avoid sharing private information.</p>
    </section>}
    <button className={`guide-orb-button${loading ? ' guide-sending' : ''}`} onClick={() => setOpen((value) => !value)} aria-label={open ? 'Close Stillpoint Guide' : 'Open Stillpoint Guide'} aria-expanded={open} aria-haspopup="dialog">
      <span className="guide-orb" aria-hidden="true"><i /><i /><i /><b /></span><span className="guide-orb-label">Guide</span>
    </button>
  </aside>
}
