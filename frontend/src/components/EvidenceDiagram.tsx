import { useState } from 'react'
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
}

const LEFT = 36
const RIGHT = 548
const TOP = 36
const SIZE = 420

function mapCoord(value: number, origin: number) {
  return origin + (value / 1000) * SIZE
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
}: Props) {
  const [active, setActive] = useState<string | null>(null)
  const residualByName = new Map(residuals.map((item) => [item.name, item]))

  return (
    <div className={reduced ? 'diagram' : 'diagram diagram-play'} key={replayKey}>
      <svg viewBox="0 0 1004 500" role="img" aria-label="Two abstract room diagrams with correspondence between background reference points" style={{ fontFamily: 'inherit' }}>
        <rect x="0" y="0" width="1004" height="500" fill="#141F2B" />
        <text x={LEFT} y="24" fill="#A6B4C2" fontSize="13">
          {sourceCaption}
        </text>
        <text x={RIGHT} y="24" fill="#A6B4C2" fontSize="13">
          {suspectCaption}
        </text>
        {source.room_objects.map((obj) => (
          <Furniture key={`s-${obj.name}`} obj={obj} origin={LEFT} />
        ))}
        {suspect.room_objects.map((obj) => (
          <Furniture key={`t-${obj.name}`} obj={obj} origin={RIGHT} />
        ))}
        {showLines &&
          residuals.map((item, index) => {
            const left = source.room_objects.find((obj) => obj.name === item.name)
            const right = suspect.room_objects.find((obj) => obj.name === item.name)
            if (!left || !right) return null
            const x1 = mapCoord(left.x + left.width / 2, LEFT)
            const y1 = mapCoord(left.y + left.height / 2, TOP)
            const x2 = mapCoord(right.x + right.width / 2, RIGHT)
            const y2 = mapCoord(right.y + right.height / 2, TOP)
            const dim = active && active !== item.name
            return (
              <line
                key={item.name}
                className="ln"
                pathLength={1}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={item.aligned ? '#8FB9A4' : '#8E9AAB'}
                strokeWidth={item.aligned ? 1.6 : 1.2}
                opacity={dim ? 0.15 : 0.9}
                style={{ animationDelay: `${420 + index * 70}ms` }}
              />
            )
          })}
        {residuals.map((item, index) => {
          const left = source.room_objects.find((obj) => obj.name === item.name)
          const right = suspect.room_objects.find((obj) => obj.name === item.name)
          if (!left || !right) return null
          const dim = active && active !== item.name
          return (
            <g key={item.name} opacity={dim ? 0.28 : 1}>
              <Point
                x={mapCoord(left.x + left.width / 2, LEFT)}
                y={mapCoord(left.y + left.height / 2, TOP)}
                name={item.name}
                aligned={item.aligned}
                delay={index * 80}
                onActive={setActive}
              />
              <Point
                x={mapCoord(right.x + right.width / 2, RIGHT)}
                y={mapCoord(right.y + right.height / 2, TOP)}
                name={item.name}
                aligned={item.aligned}
                delay={index * 80 + 40}
                onActive={setActive}
              />
            </g>
          )
        })}
      </svg>
      <p className="diagram-readout">
        {active && residualByName.get(active)
          ? `${active}: residual ${residualByName.get(active)!.distance.toFixed(2)}. ${
              residualByName.get(active)!.aligned ? 'Aligned' : 'Not aligned'
            }.`
          : 'Select a reference point to read its correspondence.'}
      </p>
    </div>
  )
}

function Furniture({ obj, origin }: { obj: SceneGraph['room_objects'][number]; origin: number }) {
  const x = mapCoord(obj.x, origin)
  const y = mapCoord(obj.y, TOP)
  const w = Math.max((obj.width / 1000) * SIZE, 8)
  const h = Math.max((obj.height / 1000) * SIZE, 8)
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
}: {
  x: number
  y: number
  name: string
  aligned: boolean
  delay: number
  onActive: (name: string | null) => void
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
      />
      <circle cx={x} cy={y} r="4.5" fill={aligned ? '#8FB9A4' : '#4A9EFF'} />
      <text x={x + 8} y={y - 8} fill="#A6B4C2" fontSize="12">
        {name}
      </text>
    </g>
  )
}
