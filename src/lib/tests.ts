import { compareGraphs } from './align'
import { replacedBackground, zoomAndCrop } from './graphs'
import { protectionLabel } from './present'
import type { AlignResult, SceneGraph } from './types'

export type ProtectionTest = {
  id: string
  title: string
  ran: boolean
  detail: string
  result: AlignResult | null
}

export function runProtectionTests(graph: SceneGraph): ProtectionTest[] {
  const zoomed = compareGraphs(graph, zoomAndCrop(graph, 1.5))
  const replaced = compareGraphs(graph, replacedBackground())
  return [
    {
      id: 'zoom',
      title: 'Zoom and crop',
      ran: true,
      detail:
        'The scene graph was scaled by 1.5 about the center. Objects that left the frame were dropped. This is a geometric transform, not a zoomed photograph.',
      result: zoomed,
    },
    {
      id: 'screenshot',
      title: 'Screenshot compression',
      ran: false,
      detail: 'Pixel recompression is not simulated. No result is shown.',
      result: null,
    },
    {
      id: 'color',
      title: 'Color filter',
      ran: false,
      detail: 'The alignment engine does not read color. A color filter is not applied to pixels in this build.',
      result: null,
    },
    {
      id: 'repaint',
      title: 'AI repaint',
      ran: false,
      detail: 'Image repaint is not implemented. No result is shown.',
      result: null,
    },
    {
      id: 'background',
      title: 'Background replacement',
      ran: true,
      detail:
        'Suspect object names were replaced, so the original background names are gone. Scene matching cannot establish the source when the background has been replaced. This is not a generated photograph.',
      result: replaced,
    },
  ]
}

export function testStatus(test: ProtectionTest): string {
  if (!test.ran) return 'Not available'
  return protectionLabel(test.result)
}
