import { compareGraphs } from './align'
import { excludeMasked, readGraph } from './graphs'
import { hashComparison } from './report'
import { present } from './present'
import type { CaseRecord, MappingOrigin, Mask, SceneGraph, StageUpdate } from './types'

export type CheckInput = {
  allowEmpty?: boolean
  source: SceneGraph | null
  suspect: SceneGraph | null
  sourceLabel: string
  suspectLabel: string
  sourceHash: string | null
  suspectHash: string | null
  detectedKeypoints?: { source: number; suspect: number } | null
  sourceFile?: { name: string; mimeType: string; sizeBytes: number } | null
  suspectFile?: { name: string; mimeType: string; sizeBytes: number } | null
  sourceMaskApplied?: boolean
  suspectMaskApplied?: boolean
  sourceMask: Mask | null
  maskApplied: boolean
  blind: boolean
  sample: boolean
  sourceOrigin?: MappingOrigin
  suspectOrigin?: MappingOrigin
  sourceModel?: string | null
  suspectModel?: string | null
}

export type CheckOutcome =
  | { ok: true; record: CaseRecord }
  | { ok: false; reason: string }

function waitFrame() {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}

export async function runCheck(input: CheckInput, onStage: (stage: StageUpdate) => void): Promise<CheckOutcome> {
  onStage({
    id: 'prepare',
    label: 'Preparing images',
    state: 'active',
    detail: input.sourceHash || input.suspectHash ? 'Hashing file bytes on this device.' : 'No image file in this check.',
  })
  await waitFrame()
  onStage({
    id: 'prepare',
    label: 'Preparing images',
    state: 'done',
    detail: input.sourceHash || input.suspectHash
      ? 'File hashes are ready. Hashing happened on this device.'
      : 'No image file in this check. Scene graphs only.',
  })

  if (!input.source || !input.suspect) {
    return {
      ok: false,
      reason:
        'A source scene graph and a suspect scene graph are both required. Map each photograph to a graph first, then compare.',
    }
  }

  onStage({
    id: 'exclude',
    label: 'Excluding people',
    state: 'active',
    detail: 'Removing person-named objects and any reference point inside the mask.',
  })
  await waitFrame()
  const read = (graph: SceneGraph) => input.allowEmpty && graph.room_objects.length === 0
    ? { ok: true as const, graph, excludedPeople: 0 } : readGraph(graph)
  const source = read(input.source)
  const suspect = read(input.suspect)
  if (!source.ok || !suspect.ok) {
    return { ok: false, reason: 'One of the scene graphs could not be read.' }
  }
  const masked = excludeMasked(source.graph, input.sourceMask)
  const excludedInCheck = source.excludedPeople + suspect.excludedPeople + masked.removed
  onStage({
    id: 'exclude',
    label: 'Excluding people',
    state: 'done',
    detail:
      excludedInCheck > 0
        ? `${excludedInCheck} person-named or masked objects were left out.`
        : input.maskApplied
          ? 'No reference point sat inside the mask.'
          : 'No person mask was applied to this source.',
  })

  onStage({
    id: 'map',
    label: 'Mapping the background',
    state: 'active',
    detail: 'Counting shared background names.',
  })
  await waitFrame()
  onStage({
    id: 'map',
    label: 'Mapping the background',
    state: 'done',
    detail: `${masked.graph.room_objects.length} source objects and ${suspect.graph.room_objects.length} suspect objects remain.`,
  })

  onStage({
    id: 'compare',
    label: 'Comparing viewpoints',
    state: 'active',
    detail: 'Running the alignment engine.',
  })
  await waitFrame()
  const result = compareGraphs(masked.graph, suspect.graph)
  onStage({
    id: 'compare',
    label: 'Comparing viewpoints',
    state: 'done',
    detail: result.verdict,
  })

  onStage({
    id: 'evidence',
    label: 'Preparing evidence',
    state: 'active',
    detail: 'Writing a redacted summary.',
  })
  await waitFrame()
  const record: CaseRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sourceLabel: input.sourceLabel,
    suspectLabel: input.suspectLabel,
    sample: input.sample,
    blind: input.blind,
    engine: 'on-device',
    result,
    presentation: present(result),
    sourceHash: input.sourceHash,
    suspectHash: input.suspectHash,
    detectedKeypoints: input.detectedKeypoints ?? null,
    sourceFile: input.sourceFile ?? null,
    suspectFile: input.suspectFile ?? null,
    sourceMaskApplied: input.sourceMaskApplied ?? input.maskApplied,
    suspectMaskApplied: input.suspectMaskApplied ?? false,
    hashComparison: hashComparison(input.sourceHash, input.suspectHash),
    maskApplied: input.maskApplied,
    excludedInCheck,
    sourceGraph: masked.graph,
    suspectGraph: suspect.graph,
    pythonNote: null,
    sourceOrigin: input.sourceOrigin,
    suspectOrigin: input.suspectOrigin,
    sourceModel: input.sourceModel ?? null,
    suspectModel: input.suspectModel ?? null,
  }
  onStage({
    id: 'evidence',
    label: 'Preparing evidence',
    state: 'done',
    detail: 'The redacted result is ready.',
  })
  return { ok: true, record }
}
