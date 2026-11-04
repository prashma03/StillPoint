import type { ReactNode } from 'react'
import './illustrations.css'

/** Original Stillpoint drawings. Decorative only: never an analysis or safety status. */
export type IllustrationScene = 'trust' | 'discover' | 'check' | 'protect' | 'proof' | 'privacy' | 'limits' | 'report'
type Props = { scene?: IllustrationScene; className?: string; animated?: boolean }

const ink = '#152b3b', mint = '#bce7d4', cream = '#f3e8cb', lavender = '#beb6e3', cyan = '#70dce4'

/** The companion belongs in introductions, never beside sensitive evidence or verdicts. */
export function ShieldCompanion({ pose = 'welcome' }: { pose?: 'welcome' | 'curious' | 'quiet' }) {
  return <g className={`sp-companion sp-companion--${pose}`} stroke={ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="144" cy="210" rx="45" ry="6" fill={ink} stroke="none" opacity=".5" />
    <g className="sp-companion-body">
      <path d="M114 183q-9 15-18 14m59-12q6 16 17 13" fill="none" stroke={cream} strokeWidth="5" />
      <path d="M105 133q-23 7-27 23" fill="none" stroke={mint} strokeWidth="7" />
      <g className="sp-wave"><path d="M173 130q22-8 25-29m0 0-8-6m8 6 7-8" fill="none" stroke={mint} strokeWidth="7" /></g>
      <path d="M99 104q20 1 38-15 18 16 41 15l-3 45q-4 28-36 45-33-16-38-43Z" fill={mint} />
      <path d="M108 110q15-1 29-12" fill="none" stroke="#e2f6e9" strokeWidth="3" />
      <g className="sp-eyes"><path d="M124 128v6m28-6v6" strokeWidth="5" /></g>
      {pose === 'curious' ? <path d="m144 151 9-2m-33-29 10-3" fill="none" /> : pose === 'quiet' ? <path d="M132 152h12" /> : <path d="M130 148q8 7 16-1" fill="none" />}
      <path d="m115 142 4 1m38-1 4-1" stroke="#6cae99" strokeWidth="3" />
    </g>
  </g>
}

function Paper({ x = 0, y = 0, tilt = 0, children }: { x?: number; y?: number; tilt?: number; children?: ReactNode }) {
  return <g transform={`translate(${x} ${y}) rotate(${tilt} 44 55)`} stroke={ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 66 0l20 20-2 86q-34 3-82 0Z" fill={cream} />
    <path d="m66 1-1 22 20-3" fill="#d8cba9" />
    {children ?? <><path d="M18 39h46M18 51h35M18 64h43M18 77h24" fill="none" stroke="#6f807c" strokeWidth="3" /></>}
  </g>
}

function Photo({ x, y, tilt = 0 }: { x: number; y: number; tilt?: number }) {
  return <g transform={`translate(${x} ${y}) rotate(${tilt} 44 38)`} stroke={ink} strokeWidth="3" strokeLinejoin="round">
    <rect width="93" height="79" rx="7" fill={cream} />
    <rect x="9" y="9" width="75" height="54" rx="3" fill="#375768" />
    <circle cx="62" cy="24" r="7" fill={lavender} stroke="none" />
    <path d="m10 60 22-27 19 21 12-12 20 19" fill={mint} />
  </g>
}

function Lens({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return <g className="sp-lens" transform={`translate(${x} ${y})`} stroke={ink} strokeWidth="3.5" strokeLinecap="round">
    <path d="m37 38 26 28" stroke={lavender} strokeWidth="13" />
    <circle cx="16" cy="17" r="30" fill="#203c4b" stroke={cyan} strokeWidth="7" />
    <path d="M0 9q4-11 15-12" stroke={cream} fill="none" />
    <circle cx="20" cy="24" r="4" fill={cream} stroke="none" />
  </g>
}

export function StillpointIllustration({ scene = 'trust', className = '', animated = true }: Props) {
  return <svg className={`sp-art sp-art--${scene}${animated ? ' sp-art--animated' : ''} ${className}`} viewBox="0 0 320 240" fill="none" aria-hidden="true" focusable="false">
    <path d="M43 193c-37-47 5-121 71-127 56-6 67-39 116-20 56 22 68 103 30 140-33 32-172 41-217 7Z" fill="#203544" />
    <g stroke="#496471" strokeWidth="1.5" strokeLinecap="round"><path d="m43 67 6 9m-8-1 10-6M270 118l8-4m-5-3 3 10M58 202l8-4" /><path d="M98 47q14-12 27-9m138 151q-3 9-14 13" /></g>
    {scene === 'trust' && <>
      <g transform="translate(34 25) rotate(-9 60 80)"><Paper x={22} y={28} /><path d="m63 48 3 12 13 1-10 8 3 13-11-7-11 7 3-13-10-8 13-1Z" fill={lavender} stroke={ink} strokeWidth="2" /></g>
      <g transform="translate(55 0)"><ShieldCompanion /></g>
      <path d="M221 161q34-6 37-33" stroke={cyan} strokeWidth="2" strokeDasharray="3 7" />
      <g transform="translate(240 67) rotate(12)" stroke={ink} strokeWidth="3"><rect width="46" height="42" rx="8" fill={lavender} /><path d="M12 0v-9a11 11 0 0 1 22 0V0" stroke={cream} fill="none" /><path d="M23 15v10" strokeWidth="4" /></g>
      <path d="m105 209 15 2m129-4 14-2" stroke={mint} strokeWidth="3" strokeLinecap="round" />
    </>}
    {scene === 'proof' && <>
      <Paper x={57} y={61} tilt={-9} /><Paper x={177} y={72} tilt={8} />
      <g stroke={lavender} strokeWidth="2"><path d="m111 92 90 30-89 24 100 21" /><g fill={lavender}>{[[111,92],[201,122],[112,146],[212,167]].map(([cx,cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5" />)}</g></g>
      <path d="M146 43h27m-14-12v24" stroke={cream} strokeWidth="2" strokeLinecap="round" />
    </>}
    {scene === 'report' && <>
      <Paper x={87} y={55} tilt={-7} />
      <path d="M77 178h108m-100 10h75" stroke={lavender} strokeWidth="3" strokeLinecap="round" />
      <Lens x={195} y={129} />
      <path d="m222 60 3 9m-9-4 13 1" stroke={cream} strokeWidth="2" strokeLinecap="round" />
    </>}
    {scene === 'privacy' && <>
      <Photo x={63} y={88} tilt={-8} />
      <path d="M164 83q-4-28 27-32 31 2 29 35" stroke={cream} strokeWidth="9" />
      <rect x="150" y="81" width="87" height="86" rx="18" fill={mint} stroke={ink} strokeWidth="3" transform="rotate(7 194 124)" />
      <path d="M193 112v22" stroke={ink} strokeWidth="6" strokeLinecap="round" /><circle cx="193" cy="111" r="6" fill={ink} />
      <path d="M85 194q48 20 98 1" stroke={lavender} strokeWidth="2" strokeDasharray="4 6" />
    </>}
    {scene === 'limits' && <>
      <path d="m67 177 29-73 36 73 39-108 31 108 27-57 29 57" stroke={lavender} strokeWidth="3" strokeLinejoin="round" />
      <path d="M58 189h206" stroke={cream} strokeWidth="3" strokeLinecap="round" />
      <path d="M162 49v150" stroke={mint} strokeWidth="2" strokeDasharray="4 7" />
      <circle cx="162" cy="108" r="27" fill="#203544" stroke={mint} strokeWidth="3" /><path d="M162 94v18m0 9v1" stroke={mint} strokeWidth="4" strokeLinecap="round" />
      <path d="m72 67 11-4m161 7 8 8" stroke={cream} strokeWidth="3" />
    </>}
    {scene === 'discover' && <>
      <Photo x={49} y={68} tilt={-7} /><Photo x={162} y={93} tilt={7} />
      <path d="m92 96 65 56 43-31" stroke={lavender} strokeWidth="2" strokeDasharray="4 6" />
      <Lens x={166} y={64} />
    </>}
    {scene === 'check' && <>
      <Photo x={48} y={82} tilt={-7} /><Photo x={180} y={82} tilt={7} />
      <path d="M101 115h113m-97 27 82 1" stroke={lavender} strokeWidth="2" strokeDasharray="4 6" />
      <Lens x={137} y={142} />
    </>}
    {scene === 'protect' && <>
      <path d="M52 86q4-28 33-28h151q28 0 29 30v84q-1 25-30 26H84q-31-2-32-28" stroke={lavender} strokeWidth="2" strokeDasharray="6 7" />
      <Photo x={57} y={88} tilt={-6} /><g transform="translate(72 -3)"><ShieldCompanion pose="quiet" /></g>
    </>}
  </svg>
}

export function PreferenceIllustration({ kind }: { kind: 'privacy' | 'consent' | 'appearance' | 'account' }) {
  return <svg className="sp-preference-art" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false" stroke={ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'privacy' ? <><path d="M10 12q8 0 14-6 6 6 14 6l-2 16q-2 9-12 15-11-6-12-15Z" fill={mint} /><path d="M20 21v3m9-3v3m-8 7h6" /></> : kind === 'consent' ? <><rect x="9" y="10" width="30" height="30" rx="8" fill={lavender} /><path d="M17 8v7m14-7v7M17 24h14m-14 7h8" /></> : kind === 'appearance' ? <><path d="M24 6a18 18 0 1 0 18 18c-13 9-27-4-18-18Z" fill={cream} /><path d="m35 8 1 4 5 1-5 2-1 4-1-4-4-2 4-1Z" fill={lavender} /></> : <><rect x="7" y="8" width="34" height="33" rx="10" fill={cream} /><circle cx="24" cy="20" r="6" fill={lavender} /><path d="M14 35q2-9 10-9t10 9" fill={lavender} /></>}
  </svg>
}
