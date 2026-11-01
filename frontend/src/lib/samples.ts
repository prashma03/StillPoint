import graph1 from '../../../sample_data/graph1.json'
import graph2 from '../../../sample_data/graph2.json'
import graph3 from '../../../sample_data/graph3.json'
import { readGraph } from './graphs'
import type { SceneGraph } from './types'

function must(data: unknown, name: string): SceneGraph {
  const read = readGraph(data)
  if (!read.ok) throw new Error(`${name} is not a valid scene graph`)
  return read.graph
}

export const sampleOriginal = must(graph1, 'graph1')
export const sampleDerivative = must(graph2, 'graph2')
export const sampleMoved = must(graph3, 'graph3')
