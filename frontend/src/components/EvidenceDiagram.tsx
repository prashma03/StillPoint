import { useEffect, useState } from 'react'
import type { Residual, SceneGraph } from '../lib/types'

type Props = {
  source: SceneGraph
  suspect: SceneGraph
  residuals: Residual[]
  showLines: boolean
  replayKey: number | string
  reduced: boolean
  sourceCaption: string
  suspectCaption: string
  responsive?: boolean
}

const LEFT = 36
const RIGHT = 548
const TOP = 36
const SIZE = 420

function mapCoord(value: number, origin: number, size = SIZE) {
  return origin + (value / 1000) * size
}

export function EvidenceDiagram({
  source,
  suspect,
  residuals,
  showLines,
  replayKey,
  reduced,
  sourceCaption,
  suspectCaption,
  responsive = false,
}: Props) {
  const [active, setActive] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [stacked, setStacked] = useState(() => responsive && typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches)
  const keyOf = (name: string) => name.trim().toLowerCase()
  const residualByName = new Map(residuals.map((item) => [keyOf(item.name), item]))
  const sourceByName = new Map(source.room_objects.map((item) => [keyOf(item.name), item]))
  const suspectByName = new Map(suspect.room_objects.map((item) => [keyOf(item.name), item]))
  const correspondences = residuals.flatMap((residual) => {
    const key = keyOf(residual.name)
    const left = sourceByName.get(key), right = suspectByName.get(key)
    if (!left || !right) return []
    const values = [left.x, left.y, left.width, left.height, right.x, right.y, right.width, right.height]
    return values.every(Number.isFinite) ? [{ residual, left, right }] : []
  })
  const focusedName = active ?? selected ?? correspondences[0]?.residual.name ?? null
  const focusedResidual = focusedName ? residualByName.get(keyOf(focusedName)) : undefined
  useEffect(() => {
    if (!responsive) return
    const query = window.matchMedia('(max-width: 600px)')
    const update = () => setStacked(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [responsive])
  if (correspondences.length === 0) {
    return <div className={`diagram-empty${responsive ? ' diagram-empty-responsive' : ''}`} role="status">
      <strong>No paired details to visualize</strong>
      <span>This comparison has no shared, drawable background points. The measurements remain in the result summary.</span>
    </div>
  }
  const diagramSize = stacked ? 440 : SIZE
  const leftOrigin = stacked ? 30 : LEFT
  const rightOrigin = stacked ? 30 : RIGHT
  const sourceTop = TOP
  const suspectTop = stacked ? 506 : TOP
  const viewWidth = stacked ? 580 : 1080
  const viewHeight = stacked ? 970 : 500
  const mapY = (value: number, top: number) => mapCoord(value, top, diagramSize)

  return (
    <div className={reduced ? 'diagram' : 'diagram diagram-play'} key={replayKey}>
      <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label="Two abstract room diagrams with correspondence between background reference points" style={{ fontFamily: 'inherit' }}>
        <rect x="0" y="0" width={viewWidth} height={viewHeight} fill="#141F2B" />
        <text x={leftOrigin} y="24" fill="#A6B4C2" fontSize="13">
          {sourceCaption}
        </text>
        <text x={rightOrigin} y={stacked ? 494 : 24} fill="#A6B4C2" fontSize="13">
          {suspectCaption}
        </text>
        {source.room_objects.map((obj) => (
          <Furniture key={`s-${obj.name}`} obj={obj} origin={leftOrigin} top={sourceTop} size={diagramSize} />
        ))}
        {suspect.room_objects.map((obj) => (
          <Furniture key={`t-${obj.name}`} obj={obj} origin={rightOrigin} top={suspectTop} size={diagramSize} />
        ))}
        {showLines &&
          correspondences.map(({ residual: item, left, right }, index) => {
            const x1 = mapCoord(left.x + left.width / 2, leftOrigin, diagramSize)
            const y1 = mapY(left.y + left.height / 2, sourceTop)
            const x2 = mapCoord(right.x + right.width / 2, rightOrigin, diagramSize)
            const y2 = mapY(right.y + right.height / 2, suspectTop)
            const focused = focusedName
            const dim = focused && focused !== item.name
            return (
              <line
                key={item.name}
                className="ln"
                pathLength={1}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={item.aligned ? '#50DDE8' : '#F3B75E'}
                strokeWidth={item.aligned ? 2.4 : 1.5}
                strokeDasharray={item.aligned ? undefined : '5 5'}
                opacity={dim ? 0.12 : item.aligned ? 0.95 : 0.58}
                onMouseEnter={() => setActive(item.name)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setSelected(item.name)}
                style={{ animationDelay: `${420 + index * 70}ms`, cursor: 'pointer' }}
                aria-label={`${item.name}, ${item.aligned ? 'aligned' : 'outside alignment threshold'}`}
              />
            )
          })}
        {correspondences.map(({ residual: item, left, right }, index) => {
          const dim = focusedName && keyOf(focusedName) !== keyOf(item.name)
          return (
            <g key={keyOf(item.name)} className="pt" style={{ opacity: dim ? 0.28 : 1 }}>
              <Point
                x={mapCoord(left.x + left.width / 2, leftOrigin, diagramSize)}
                y={mapY(left.y + left.height / 2, sourceTop)}
                name={left.name}
                aligned={item.aligned}
                delay={index * 80}
                onActive={setActive}
                onSelect={() => setSelected(item.name)}
              />
              <Point
                x={mapCoord(right.x + right.width / 2, rightOrigin, diagramSize)}
                y={mapY(right.y + right.height / 2, suspectTop)}
                name={right.name}
                aligned={item.aligned}
                delay={index * 80 + 40}
                onActive={setActive}
                onSelect={() => setSelected(item.name)}
              />
            </g>
          )
        })}
      </svg>
      <p className="diagram-readout">
        {focusedName && focusedResidual
          ? `${focusedName}: residual ${focusedResidual.distance.toFixed(2)}. ${
              focusedResidual.aligned ? 'Aligned within threshold' : 'Outside the alignment threshold'
            }.`
          : 'No paired reference points are available in this scene map.'}
      </p>
    </div>
  )
}

function Furniture({ obj, origin, top, size }: { obj: SceneGraph['room_objects'][number]; origin: number; top: number; size: number }) {
  const x = mapCoord(obj.x, origin, size)
  const y = mapCoord(obj.y, top, size)
  const w = Math.max((obj.width / 1000) * size, 8)
  const h = Math.max((obj.height / 1000) * size, 8)
  if (obj.width === 0 && obj.height === 0) return null
  return <rect x={x} y={y} width={w} height={h} fill="none" stroke="#7E93A8" strokeWidth="1.4" />
}

function Point({
  x,
  y,
  name,
  aligned,
  delay,
  onActive,
  onSelect,
}: {
  x: number
  y: number
  name: string
  aligned: boolean
  delay: number
  onActive: (name: string | null) => void
  onSelect: (name: string) => void
}) {
  return (
    <g className="pt" style={{ animationDelay: `${delay}ms` }}>
      <circle
        cx={x}
        cy={y}
        r="11"
        fill="transparent"
        tabIndex={0}
        role="button"
        aria-label={`${name}, ${aligned ? 'aligned' : 'not aligned'}`}
        onMouseEnter={() => onActive(name)}
        onMouseLeave={() => onActive(null)}
        onFocus={() => onActive(name)}
        onBlur={() => onActive(null)}
        onClick={() => onSelect(name)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(name) } }}
      />
      <circle cx={x} cy={y} r="4.5" fill={aligned ? '#50DDE8' : '#F3B75E'} />
      <text x={x + 8} y={y - 8} fill="#A6B4C2" fontSize="12">
        {name}
      </text>
    </g>
  )
}
