import { useState } from 'react'
import { PersonMaskControls } from './PersonMaskControls'
import { emptyPhoto } from '../lib/checkSession'
import { maskBounds } from '../lib/localSegmentation'
import { settingsStore } from '../lib/storage'
import type { SegmentRect } from '../lib/ai'

/** Protect/advanced compatibility: use the local pixel mask's encompassing
 * rectangle because these existing editors store one rectangular cover. */
export function SegmentAssist({ file, onRects, consentScope }: { file: File | null; onRects: (rects: SegmentRect[], model: string) => void; consentScope: string }) {
  const [mode, setMode] = useState<'automatic' | 'manual'>(() => settingsStore().load().maskingPreference === 'manual' ? 'manual' : 'automatic')
  return <section className="stack" aria-label="Person masking assistance"><h2>Suggest a privacy cover</h2>
    <p className="muted">This editor uses a rectangle enclosing the suggested person pixels. Review and resize the cover before confirming.</p>
    <PersonMaskControls key={consentScope} photo={{ ...emptyPhoto(), file, hash: consentScope, label: file?.name ?? '' }} mode={mode} onMode={setMode} canManual={!!file} onManual={() => setMode('manual')} onAutomatic={() => {}} onMask={(mask, model) => onRects(maskBounds(mask), model ?? 'Automatic mask')} />
    {mode === 'manual' && <p className="note">Use the manual privacy-cover controls in the editor below.</p>}
  </section>
}
