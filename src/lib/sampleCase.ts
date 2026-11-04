import { compareGraphs } from './align'
import { present } from './present'
import { hashComparison } from './report'
import { sampleDerivative, sampleMoved, sampleOriginal } from './samples'
import type { CaseRecord } from './types'

export function buildSample(kind: 'derivative' | 'moved'): CaseRecord {
  const suspect = kind === 'derivative' ? sampleDerivative : sampleMoved
  const result = compareGraphs(sampleOriginal, suspect)
  return {
    id: `sample-${kind}`,
    createdAt: new Date().toISOString(),
    sourceLabel: 'Sample graph 1',
    suspectLabel: kind === 'derivative' ? 'Sample graph 2 · edited derivative' : 'Sample graph 3 · moved camera',
    sample: true,
    blind: true,
    engine: 'on-device',
    result,
    presentation: present(result),
    sourceHash: null,
    suspectHash: null,
    hashComparison: hashComparison(null, null),
    maskApplied: false,
    excludedInCheck: 0,
    sourceGraph: sampleOriginal,
    suspectGraph: suspect,
    pythonNote: null,
    sourceOrigin: 'manual',
    suspectOrigin: 'manual',
    sourceModel: null,
    suspectModel: null,
  }
}
