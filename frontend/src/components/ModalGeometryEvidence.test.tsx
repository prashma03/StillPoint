import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModalGeometryEvidenceView } from './ModalGeometryEvidence'
import type { ModalGeometryEvidence } from '../lib/types'

const measured: ModalGeometryEvidence = {
  schema_version: 1, provider: 'modal', method: 'ORB + RANSAC',
  image_dimensions: { source: { width: 640, height: 480 }, suspect: { width: 640, height: 480 } },
  source_features: 125, suspect_features: 119, candidate_matches: 9, verified_inliers: 7, rejected_matches: 2, inlier_fraction: 7 / 9,
  alignment: { model: 'homography', coordinate_space: 'redacted pixels', matrix_source_to_suspect: null, ransac_threshold_px: 4, mean_inlier_reprojection_error_px: 1.2, median_inlier_reprojection_error_px: 1.1, source_inlier_hull_coverage: .12 },
  uncertainty: { status: 'caution', reasons: ['few_verified_inliers'] },
  matches: [{ source: { x: .25, y: .4 }, suspect: { x: .3, y: .45 }, inlier: true, reprojection_error_px: 1.2, descriptor_distance: 18 }],
  limitations: ['A 2D homography is not a 3D reconstruction.'],
}

describe('Modal geometric evidence view', () => {
  it('renders measured counts, uncertainty, and actual normalized match coordinates', () => {
    const html = renderToStaticMarkup(<ModalGeometryEvidenceView evidence={measured} />)
    expect(html).toContain('7 / 9')
    expect(html).toContain('Uncertainty: caution')
    expect(html).toContain('few_verified_inliers')
    expect(html).toContain('1 actual Modal image correspondences')
    expect(html).toContain('cx="121.5" cy="160"')
  })
})
