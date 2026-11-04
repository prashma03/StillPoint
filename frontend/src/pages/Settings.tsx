import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Dialog, PageHeader, usePageTitle } from '../components/ui'
import { useAuthSession } from '../components/AuthSession'
import { useCaseRecord } from '../components/case'
import { getAIStatus, type AIStatus } from '../lib/ai'
import { authError, getAuthClient } from '../lib/auth'
import { clearCurrentComparison, clearPrivateSession, deleteLocalRecords, deleteRegistrations } from '../lib/privacyControls'
import { reviewStore, sceneStore, settingsStore } from '../lib/storage'
import type { Settings as Preferences } from '../lib/types'

type Action = 'comparison' | 'records' | 'registrations' | 'session' | 'logout'
const actions: Record<Action, { title: string; explanation: string; label: string }> = {
  comparison: { title: 'Clear this comparison?', explanation: 'Remove the current Check photographs, masks, Proof previews, comparison result, and Discover selection. Original registrations and private notes remain.', label: 'Clear comparison' },
  records: { title: 'Delete local records?', explanation: 'Remove the current comparison plus private notes and local Trust records. Original registrations remain.', label: 'Delete local records' },
  registrations: { title: 'Delete original registrations?', explanation: 'Remove saved original background maps, file hashes, cover rectangles, and the Protect draft. This does not delete files from your device.', label: 'Delete registrations' },
  session: { title: 'Clear all private session data?', explanation: 'Remove temporary images, masks, comparison results, registrations, Protect drafts, notes, and local Trust records. Your sign-in and preferences remain.', label: 'Clear session data' },
  logout: { title: 'Sign out of Stillpoint?', explanation: 'End this account session and clear its private local data. Previously downloaded reports and provider-side data cannot be deleted here.', label: 'Sign out' },
}
function Row({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return <div className="privacy-row"><div><h3>{title}</h3><p>{detail}</p></div><div className="privacy-row-control">{children}</div></div>
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="privacy-toggle"><input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={e => onChange(e.target.checked)} /><span aria-hidden="true" /></label>
}
export function Settings() {
  usePageTitle('Settings')
  const auth = useAuthSession(), { record, setRecord } = useCaseRecord(), navigate = useNavigate()
  const [preferences, setPreferences] = useState(() => settingsStore().load())
  const [backend, setBackend] = useState<AIStatus | null>(null), [action, setAction] = useState<Action | null>(null)
  const [message, setMessage] = useState(''), [pending, setPending] = useState(false), [version, setVersion] = useState(0)
  const scenes = sceneStore().list(), notes = reviewStore().list()
  useEffect(() => { let live = true; void getAIStatus().then(result => { if (live) setBackend(result) }); return () => { live = false } }, [])
  function update(patch: Partial<Preferences>) {
    const next = { ...preferences, ...patch }; settingsStore().save(next); setPreferences(next)
    if (patch.externalImagesEnabled !== undefined) setMessage(patch.externalImagesEnabled ? 'External image tools are available. Every upload still requires separate consent for that photograph and action.' : 'Future external image AI requests are blocked. Previously submitted images cannot be recalled.')
  }
  async function confirm() {
    if (!action || pending) return
    setPending(true)
    try {
      if (action === 'logout') { if (await auth.logout()) navigate('/login', { replace: true }); else setMessage('Sign-out could not be confirmed. Try again when connected.') }
      else {
        if (action === 'comparison') clearCurrentComparison()
        if (action === 'records') deleteLocalRecords()
        if (action === 'registrations') deleteRegistrations()
        if (action === 'session') clearPrivateSession()
        if (action !== 'registrations') setRecord(null)
        setVersion(version + 1); setMessage(`${actions[action].label} completed on this device. Downloaded reports and copies held by external providers are unaffected.`)
      }
    } catch { setMessage('Some data could not be cleared. Browser storage may be restricted; close this tab and retry.') }
    finally { setPending(false); setAction(null) }
  }
  async function resetPassword() {
    const client = getAuthClient()
    if (!client || !auth.user?.email) return
    setPending(true)
    try {
      const result = await client.auth.resetPasswordForEmail(auth.user.email, { redirectTo: `${window.location.origin}/auth/reset` })
      setMessage(result.error ? authError(result.error) : 'Password reset requested. Check your email and open the link in this same tab. Delivery depends on your configured email service.')
    } catch { setMessage('Could not request the reset email. Check your connection and try again.') }
    finally { setPending(false) }
  }
  return <div className="page settings-page privacy-dashboard">
    <PageHeader eyebrow="Your choices" title="Settings" lede="Understand what stays here, choose what can leave, and clear your data when you’re done." />
    <div className="privacy-summary"><span className="privacy-summary-dot" />Local processing first<span>Images clear on full reopen</span><span>{auth.user ? 'Account session' : 'Guest session'}</span></div>
    <nav className="privacy-jump" aria-label="Settings sections">{[['protection','Privacy & Protection'],['ai','AI Processing'],['data','My Data'],['security','Account & Security'],['advanced','Advanced Settings']].map(([id,label]) => <a key={id} href={`#settings-${id}`}>{label}</a>)}</nav>
    <div className="privacy-grid">
      <section className="panel privacy-section" id="settings-protection"><header><span className="privacy-section-icon" aria-hidden="true">◇</span><div><p className="eyebrow">01 · Privacy & Protection</p><h2>Stay in control of what you see</h2></div></header>
        <Row title="Start with Blind Mode" detail="Applied to new checks. Turning it off still requires a separate choice before a suspicious image is shown."><Toggle label="Start checks with Blind Mode" checked={preferences.blindMode} onChange={blindMode => update({ blindMode })} /></Row>
        <Row title="Preferred masking method" detail="Automatic masking runs on this device first. Manual rectangles are always available."><select aria-label="Preferred masking method" value={preferences.maskingPreference ?? 'local'} onChange={e => update({ maskingPreference: e.target.value as 'local' | 'manual' })}><option value="local">On-device</option><option value="manual">Manual</option></select></Row>
        <Row title="Sensitive image visibility" detail="Suspicious photos stay concealed until you explicitly acknowledge viewing them. Reviewing a mask can reveal content outside its cover."><span className="privacy-badge">Action-specific</span></Row>
        <Row title="Retention" detail="Full reopen or refresh clears image-related session data before the app renders. Page-to-page navigation keeps your active work."><span className="privacy-badge">Clear on reopen</span></Row>
      </section>
      <section className="panel privacy-section" id="settings-ai"><header><span className="privacy-section-icon" aria-hidden="true">✧</span><div><p className="eyebrow">02 · AI Processing</p><h2>Local first. External by choice.</h2></div></header>
        <Row title="On-device person masking" detail="Bundled MediaPipe SelfieSegmenter runs in a browser worker. It can miss people or details; review and refine with rectangles."><span className="privacy-badge">No photo upload</span></Row>
        <Row title="Allow external image AI tools" detail="Makes optional SAM detection and AI feature mapping available. This switch is not upload consent; each action still asks separately."><Toggle label="Allow external image AI tools" checked={!!preferences.externalImagesEnabled} onChange={externalImagesEnabled => update({ externalImagesEnabled })} /></Row>
        <Row title="External model service" detail={backend?.ok ? backend.configured ? 'A key is configured. This does not verify model access or availability.' : 'No model key is configured. Local and manual tools work without it.' : 'Backend status is unavailable. Local and manual tools remain available.'}><span className="privacy-badge privacy-badge-amber">{backend?.ok && backend.configured ? 'Configured · unverified' : 'Unavailable'}</span></Row>
        <details className="privacy-disclosure"><summary>Consent and cancellation</summary><p>Settings never authorizes an image transfer. Each external tool explains the image, purpose, and configured provider, asks for consent, and offers Cancel. Consent resets for a new photo or action. Cancelling cannot recall an upload the provider already received. No automatic fallback sends an image externally.</p><p>Public-image search in Discover is separate: it sends the original to TinEye only after its own search authorization. The Guide sends typed conversation text, not photographs.</p></details>
      </section>
      <section className="panel privacy-section" id="settings-data"><header><span className="privacy-section-icon" aria-hidden="true">▤</span><div><p className="eyebrow">03 · My Data</p><h2>Your session, your controls</h2></div></header>
        <Row title="Original registrations" detail={`${scenes.length} saved background maps in this tab. Registrations are not retained after a full reopen.`}><Button variant="secondary" disabled={!scenes.length || pending} onClick={() => setAction('registrations')}>Delete registrations</Button></Row>
        <Row title="Current comparison" detail={record ? 'A comparison result is available in this tab. Clear it with its temporary images and masks.' : 'No completed result is open. Temporary uploads or a draft may still be held in this tab.'}><Button variant="secondary" disabled={pending} onClick={() => setAction('comparison')}>Clear comparison</Button></Row>
        <Row title="Local notes and records" detail={`${notes.length} private notes, plus any local Trust records. No connected reviewer or cloud deletion is offered.`}><Button variant="secondary" disabled={pending} onClick={() => setAction('records')}>Delete local records</Button></Row>
        <Row title="Everything in this private session" detail="Clear temporary photographs, Proof previews, maps, drafts, notes, and results. Sign-in and preferences remain."><Button variant="secondary" disabled={pending} onClick={() => setAction('session')}>Clear session data</Button></Row>
        <details className="privacy-disclosure"><summary>Downloaded reports and external copies</summary><p>Reports you export are files on your device. Stillpoint cannot list or delete downloaded reports, browser or OS backups, or copies held by an external provider. Use your device’s file manager for downloaded files.</p></details>
      </section>
      <section className="panel privacy-section" id="settings-security"><header><span className="privacy-section-icon" aria-hidden="true">○</span><div><p className="eyebrow">04 · Account & Security</p><h2>{auth.user ? 'Your account session' : 'Using Stillpoint as a guest'}</h2></div></header>
        <Row title="Account" detail={auth.user?.email ?? 'No account is required for a one-time comparison. No photos are automatically saved to an account.'}><span className="privacy-badge">{auth.user ? 'Supabase Auth' : 'Guest'}</span></Row>
        {auth.user ? <><Row title="Password" detail="Request a secure recovery link through Supabase. Email delivery must be configured."><Button variant="secondary" disabled={pending || !auth.configured || !auth.user.email} onClick={() => void resetPassword()}>Send password reset email</Button></Row><Row title="Active session" detail="Sign out of this account session and clear its local private data. Other devices are not managed here."><Button variant="secondary" disabled={pending} onClick={() => setAction('logout')}>Sign out</Button></Row></> : <div className="privacy-section-actions"><Button to="/login" variant="secondary">Log in or create an account</Button></div>}
        <details className="privacy-disclosure"><summary>Account storage and session limits</summary><p>Authentication credentials go to Supabase, never with your photos. Browser authentication tokens are kept in tab session storage; this is not an HttpOnly cookie session. Account-backed image saving is not implemented. Switching identity clears local private work. Logout revokes refresh access for this session; issued access tokens follow the provider’s expiry rules.</p></details>
      </section>
    </div>
    <section className="panel privacy-section privacy-facts"><h2>Privacy, in plain language</h2><div className="privacy-facts-grid">
      <details className="privacy-disclosure"><summary>Processed on Your Device</summary><p>File decoding, hashes, manual masks, bundled automatic segmentation, local feature extraction and matching, redacted previews, coordinate comparison, and report generation run in your browser. The optional Python cross-check sends coordinate maps to your local backend.</p></details>
      <details className="privacy-disclosure"><summary>Sent for AI Processing</summary><p>External SAM receives an unmasked, resized image. AI feature mapping receives a redacted image whose backgrounds may still identify someone. Both use the local backend’s configured Meta endpoint after separate consent. Provider retention, training, and backups cannot be verified here.</p></details>
      <details className="privacy-disclosure"><summary>What Stillpoint Stores</summary><p>Temporary files and pixel masks live in memory. Background coordinates, file hashes, cover rectangles, notes, and the latest result may use tab storage until cleared or fully reopened. Preferences use local browser storage. Authentication tokens are managed separately.</p></details>
      <details className="privacy-disclosure"><summary>What Stillpoint Does Not Store</summary><p>The browser storage layer rejects image data URLs in records. The local Python API does not write uploaded images or request bodies to disk. Original photographs are not automatically uploaded into account storage. These statements do not cover providers, browser caches, or downloaded exports.</p></details>
      <details className="privacy-disclosure"><summary>Delete My Data</summary><p>Use the confirmed deletion controls above for data managed by Stillpoint. JavaScript cleanup releases references; it does not guarantee forensic erasure from RAM, disk, backups, downloads, or external services. Reopening clears private image-related work under the established session policy.</p></details>
    </div></section>
    <section className="panel privacy-section" id="settings-advanced"><details><summary className="privacy-advanced-title">Advanced Settings</summary>
      <Row title="Local Python comparison" detail="Cross-check coordinate maps with the Python engine on this computer. No photographs are sent by this option."><Toggle label="Use local Python comparison" checked={preferences.pythonEngine} onChange={pythonEngine => update({ pythonEngine })} /></Row>
      <dl className="privacy-diagnostics"><div><dt>Backend</dt><dd>{backend === null ? 'Checking…' : backend.ok ? 'Reachable on this device' : 'Not reachable'}</dd></div><div><dt>External endpoint</dt><dd>{backend?.ok ? backend.provider_origin ?? 'Not reported' : 'Unknown'}</dd></div><div><dt>Scene / masking models</dt><dd>{backend?.ok ? `${backend.scene_model} / ${backend.seg_model}` : 'Not reported'}</dd></div><div><dt>Local model</dt><dd>MediaPipe SelfieSegmenter · bundled assets; browser support checked when run</dd></div></dl>
      <details className="privacy-disclosure"><summary>Developer configuration</summary><p>External AI requires a server-side MODEL_API_KEY and backend/requirements.txt. Credentials are never displayed here. Endpoint overrides can change the recipient; inspect your backend configuration before authorizing uploads. Authentication requires public Supabase configuration and email delivery. No API keys or SMTP secrets should be entered into this page.</p></details>
    </details></section>
    {message && <p role="status" className="note privacy-feedback">{message}</p>}
    <Dialog open={action !== null} title={action ? actions[action].title : 'Confirm deletion'} confirmLabel={pending ? 'Working…' : action ? actions[action].label : 'Confirm'} onConfirm={() => void confirm()} onClose={() => { if (!pending) setAction(null) }}><p>{action ? actions[action].explanation : ''}</p><p className="muted">This cannot remove provider-side data, backups, or previously downloaded files.</p></Dialog>
  </div>
}
