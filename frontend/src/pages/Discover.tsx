import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader, usePageTitle } from '../components/ui'
import { DiscoverScan } from '../components/DiscoverScan'
import { PublicMatchSearch } from '../components/PublicMatchSearch'

export function Discover() {
  usePageTitle('Discover')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const scene = params.get('scene') ?? ''
  return <div className="page discover">
    <PageHeader eyebrow="Discover" title="Map a photograph" lede="Scan one photograph on this device, inspect its measured structure, then compare another image or open Proof. Public image search stays optional." />
    <DiscoverScan
      onContinue={summary => navigate('/proof', { state: { discoveryScan: summary } })}
      onCompare={summary => navigate('/check', { state: { discoveryScan: summary } })}
    />
    <PublicMatchSearch initialSceneId={scene} startOpen={Boolean(scene)} />
  </div>
}
