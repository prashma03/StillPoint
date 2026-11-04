import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Dialog, PageHeader, usePageTitle } from '../components/ui'
import { sceneStore } from '../lib/storage'

export function ProtectedDetail() {
  usePageTitle('Protected scene')
  const { id } = useParams()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [gone, setGone] = useState(false)
  const scene = useMemo(() => (id ? sceneStore().get(id) : null), [id, gone])

  if (!scene || gone) {
    return (
      <div className="page">
        <PageHeader eyebrow="Protect" title="Scene not on this device" lede="It may have been deleted, or this link is from another browser." />
        <Button to="/protect">Back to protect</Button>
      </div>
    )
  }

  function remove() {
    if (!scene) return
    sceneStore().remove(scene.id)
    setGone(true)
    setOpen(false)
    navigate('/protect')
  }

  function exportGraph() {
    if (!scene) return
    const payload = {
      room_objects: scene.graph.room_objects,
      ...(scene.graph.coverage_percent == null ? {} : { coverage_percent: scene.graph.coverage_percent }),
      ...(scene.graph.total_stable_points == null ? {} : { total_stable_points: scene.graph.total_stable_points }),
      origin: scene.origin ?? 'manual',
      ...(scene.model ? { model: scene.model } : {}),
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'stillpoint-scene-graph.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Protected scene"
        title={scene.label}
        lede="The photograph was not saved. This is the background map that remains."
      />
      <div className="split">
        <SceneSketch objects={scene.graph.room_objects} />
        <div className="stack">
          <dl className="metrics">
            <div><dt>Reference points</dt><dd className="num">{scene.graph.room_objects.length}</dd></div>
            <div><dt>Person mask confirmed</dt><dd>{scene.maskConfirmed ? 'Yes' : 'No'}</dd></div>
            <div><dt>Coverage in file</dt><dd>{scene.graph.coverage_percent == null ? 'Not provided' : `${scene.graph.coverage_percent}%`}</dd></div>
            <div><dt>File hash prefix</dt><dd className="num">{scene.fileHash ? scene.fileHash.slice(0, 12) : 'Not available'}</dd></div>
            <div><dt>Saved</dt><dd>{new Date(scene.createdAt).toLocaleString()}</dd></div>
          </dl>
          {!scene.maskConfirmed && <p className="note">A person mask was not confirmed for this scene.</p>}
          <div className="actions">
            <Button to={`/check?scene=${scene.id}`}>Use in a check</Button>
            <Button to={`/discover?scene=${scene.id}`} variant="secondary">Discover candidates</Button>
            <Button to={`/test?scene=${scene.id}`} variant="secondary">Test this scene</Button>
            <Button variant="secondary" onClick={exportGraph}>Export scene graph</Button>
            <Button variant="secondary" onClick={() => setOpen(true)}>Delete</Button>
          </div>
          <p className="footer-note"><Link to="/protect">All protected scenes</Link></p>
        </div>
      </div>
      <Dialog open={open} title="Delete this scene graph?" confirmLabel="Delete" onConfirm={remove} onClose={() => setOpen(false)}>
        <p className="muted">The map is removed from this browser. The original photograph was not stored here.</p>
      </Dialog>
    </div>
  )
}

function SceneSketch({ objects }: { objects: { name: string; x: number; y: number; width: number; height: number }[] }) {
  return (
    <svg viewBox="0 0 1000 1000" role="img" aria-label="Diagram of saved background objects" style={{ background: '#141F2B', borderRadius: 12 }}>
      {objects.map((obj) => (
        <g key={obj.name}>
          {obj.width > 0 && obj.height > 0 && (
            <rect x={obj.x} y={obj.y} width={obj.width} height={obj.height} fill="none" stroke="#7E93A8" strokeWidth="8" />
          )}
          <circle cx={obj.x + obj.width / 2} cy={obj.y + obj.height / 2} r="14" fill="#4A9EFF" />
          <text x={obj.x + obj.width / 2 + 18} y={obj.y + obj.height / 2} fill="#A6B4C2" fontSize="36">
            {obj.name}
          </text>
        </g>
      ))}
    </svg>
  )
}
