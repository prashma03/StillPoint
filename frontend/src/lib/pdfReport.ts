import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CaseRecord, RoomObject } from './types'

export type EvidencePdfOptions = {
  thumbnails?: { original?: Blob | null; suspicious?: Blob | null }
}

const ink = rgb(0.08, 0.14, 0.21)
const muted = rgb(0.35, 0.43, 0.51)
const teal = rgb(0.08, 0.48, 0.54)
const line = rgb(0.82, 0.87, 0.9)
const pale = rgb(0.94, 0.97, 0.98)
const amber = rgb(0.68, 0.39, 0.08)
const W = 612, H = 792, M = 48

function clean(value: string | null | undefined): string {
  return (value || 'Not available').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim()
}

function wrapped(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = clean(text).split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const chunks = word.length && font.widthOfTextAtSize(word, size) > width
      ? word.match(/.{1,24}/g) ?? [word] : [word]
    for (const chunk of chunks) {
      const next = current ? `${current} ${chunk}` : chunk
      if (font.widthOfTextAtSize(next, size) > width && current) { lines.push(current); current = chunk }
      else current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

function header(page: PDFPage, regular: PDFFont, bold: PDFFont, id: string) {
  page.drawText('STILLPOINT', { x: M, y: H - 43, size: 11, font: bold, color: teal })
  page.drawText('EVIDENCE REPORT', { x: W - M - 122, y: H - 43, size: 9, font: bold, color: muted })
  page.drawLine({ start: { x: M, y: H - 54 }, end: { x: W - M, y: H - 54 }, thickness: 0.7, color: line })
  page.drawLine({ start: { x: M, y: 38 }, end: { x: W - M, y: 38 }, thickness: 0.7, color: line })
  page.drawText(`Report ${id}`, { x: M, y: 24, size: 8, font: regular, color: muted })
}

function paragraph(page: PDFPage, text: string, x: number, y: number, width: number, font: PDFFont, size = 9, color = ink): number {
  const lines = wrapped(text, font, size, width)
  lines.forEach((entry, i) => page.drawText(entry, { x, y: y - i * (size + 3), size, font, color, maxWidth: width }))
  return y - lines.length * (size + 3) - 5
}

function section(page: PDFPage, title: string, x: number, y: number, bold: PDFFont): number {
  page.drawText(title.toUpperCase(), { x, y, size: 9, font: bold, color: teal })
  return y - 16
}

function point(graph: RoomObject | undefined): { x: number; y: number } | null {
  if (!graph) return null
  return { x: Math.max(0, Math.min(1000, graph.x + graph.width / 2)), y: Math.max(0, Math.min(1000, graph.y + graph.height / 2)) }
}

function evidenceDiagram(page: PDFPage, record: CaseRecord, regular: PDFFont, bold: PDFFont, y: number) {
  const x = M, width = W - 2 * M, height = 158
  page.drawRectangle({ x, y, width, height, color: pale, borderColor: line, borderWidth: 0.8 })
  const leftX = x + 16, rightX = x + width / 2 + 8, innerW = width / 2 - 28
  page.drawText('ORIGINAL FEATURE MAP', { x: leftX, y: y + height - 19, size: 7, font: bold, color: muted })
  page.drawText('SUSPECT FEATURE MAP', { x: rightX, y: y + height - 19, size: 7, font: bold, color: muted })
  const graphY = y + 22, graphHeight = height - 51
  page.drawLine({ start: { x: x + width / 2, y: graphY - 1 }, end: { x: x + width / 2, y: y + height - 26 }, thickness: 0.8, color: line })
  const projections = record.result.residuals.flatMap(residual => {
    const a = point(record.sourceGraph.room_objects.find(item => item.name.toLowerCase() === residual.name.toLowerCase()))
    const b = point(record.suspectGraph.room_objects.find(item => item.name.toLowerCase() === residual.name.toLowerCase()))
    return a && b ? [{ residual, a, b }] : []
  })
  if (!projections.length) {
    page.drawText('No paired feature coordinates are available for a diagram.', { x: leftX, y: y + height / 2, size: 8, font: regular, color: muted })
  }
  for (const { residual, a, b } of projections) {
    const ax = leftX + (a.x / 1000) * innerW, ay = graphY + graphHeight - (a.y / 1000) * graphHeight
    const bx = rightX + (b.x / 1000) * innerW, by = graphY + graphHeight - (b.y / 1000) * graphHeight
    const color = residual.aligned ? teal : amber
    page.drawLine({ start: { x: ax, y: ay }, end: { x: bx, y: by }, thickness: 0.8, color, opacity: 0.62 })
    page.drawCircle({ x: ax, y: ay, size: 2.3, color })
    page.drawCircle({ x: bx, y: by, size: 2.3, color })
  }
  page.drawText(`${projections.length} recorded correspondence(s); teal = within threshold, amber = outside`, { x: leftX, y: y + 9, size: 7, font: regular, color: muted })
}

function fileInfo(name: string, metadata: CaseRecord['sourceFile'], hash: string | null): string {
  const label = clean(metadata?.name || name)
  const type = metadata?.mimeType || 'Not recorded'
  const size = metadata ? `${metadata.sizeBytes.toLocaleString('en-US')} bytes` : 'Not recorded'
  return `File: ${label}\nType: ${type}\nSize: ${size}\nSHA-256: ${hash || 'Not available'}`
}

function drawMetadataBlock(page: PDFPage, title: string, text: string, x: number, y: number, width: number, height: number, regular: PDFFont, bold: PDFFont): number {
  page.drawRectangle({ x, y: y - height, width, height, color: pale, borderColor: line, borderWidth: 0.6 })
  page.drawText(title, { x: x + 12, y: y - 18, size: 9, font: bold, color: ink })
  let cursor = y - 35
  for (const row of text.split('\n')) {
    const lines = wrapped(row, regular, 7.5, width - 24)
    for (const entry of lines) { page.drawText(entry, { x: x + 12, y: cursor, size: 7.5, font: regular, color: muted }); cursor -= 10.5 }
  }
  return y - height - 14
}

export async function buildEvidencePdf(record: CaseRecord, options: EvidencePdfOptions = {}): Promise<Blob> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Stillpoint Evidence Report - ${record.id}`)
  pdf.setAuthor('Stillpoint')
  pdf.setSubject('Image comparison measurements and limitations')
  pdf.setCreator('Stillpoint on-device report generator')
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const pageOne = pdf.addPage([W, H])
  header(pageOne, regular, bold, record.id)
  let y = H - 84
  pageOne.drawText('Image Comparison Evidence', { x: M, y, size: 22, font: bold, color: ink })
  y -= 24
  pageOne.drawText(`Report ID: ${record.id}`, { x: M, y, size: 9, font: regular, color: muted })
  const date = new Date(record.createdAt)
  const analyzedAt = Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString()
  pageOne.drawText(`Analysis time: ${clean(analyzedAt)}`, { x: M, y: y - 14, size: 9, font: regular, color: muted })
  y -= 38

  y = section(pageOne, 'Finding', M, y, bold)
  y = paragraph(pageOne, record.presentation.label, M, y, W - 2 * M, bold, 12, ink)
  y = paragraph(pageOne, record.presentation.summary, M, y, W - 2 * M, regular, 9, ink)
  const explanation = record.result.verdict === 'Likely derivative'
    ? `${record.result.aligned_points} of ${record.result.usable_points} usable reviewed pairs fall within the measured alignment threshold. This is geometric correspondence in the compared feature maps; it does not establish how either image was created or altered.`
    : record.result.verdict === 'No link found'
      ? 'The measured feature maps did not reach the configured correspondence level. This does not prove that the photographs are unrelated; crops, viewpoint changes, missing points, or masking can reduce correspondence.'
      : 'The available measured correspondences were insufficient or mixed. This report does not support a decisive geometric conclusion.'
  y = paragraph(pageOne, explanation, M, y, W - 2 * M, regular, 8.5, ink)

  const boxY = y - 70
  const cards = [
    ['Detected corners', record.detectedKeypoints ? `${record.detectedKeypoints.source} / ${record.detectedKeypoints.suspect}` : 'Not captured'],
    ['Aligned pairs', `${record.result.aligned_points} / ${record.result.usable_points}`],
    ['Threshold', `${record.result.alignment_threshold} units`],
  ]
  const cardWidth = (W - 2 * M - 16) / 3
  cards.forEach(([label, value], i) => {
    const cx = M + i * (cardWidth + 8)
    pageOne.drawRectangle({ x: cx, y: boxY, width: cardWidth, height: 54, color: pale, borderColor: line, borderWidth: 0.6 })
    pageOne.drawText(label, { x: cx + 9, y: boxY + 36, size: 7.2, font: regular, color: muted })
    pageOne.drawText(value, { x: cx + 9, y: boxY + 15, size: 11, font: bold, color: ink })
  })
  y = boxY - 18
  y = section(pageOne, 'Evidence visualization', M, y, bold)
  evidenceDiagram(pageOne, record, regular, bold, 308)
  y = paragraph(pageOne, 'Scene-map diagram of actual named correspondences in this record. It is not a photograph, image reconstruction, or fitted camera transform.', M, 296, W - 2 * M, regular, 7.5, muted)
  if (options.thumbnails) {
    const permitted = [
      options.thumbnails.original && record.sourceMaskApplied ? { blob: options.thumbnails.original, label: 'Masked original preview' } : null,
      options.thumbnails.suspicious && record.suspectMaskApplied ? { blob: options.thumbnails.suspicious, label: 'Masked suspected preview' } : null,
    ].filter((item): item is { blob: Blob; label: string } => !!item)
    if (permitted.length) {
      const top = 274
      pageOne.drawText('OPT-IN MASKED THUMBNAILS', { x: M, y: top, size: 8, font: bold, color: amber })
      for (let i = 0; i < permitted.length; i++) {
        const entry = permitted[i]
        const image = await pdf.embedJpg(await entry.blob.arrayBuffer())
        const maxWidth = 240, maxHeight = 110
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1)
        pageOne.drawImage(image, { x: M + i * 258, y: top - 127, width: image.width * scale, height: image.height * scale })
        pageOne.drawText(entry.label, { x: M + i * 258, y: top - 140, size: 7, font: regular, color: muted })
      }
    }
  }

  const pageTwo = pdf.addPage([W, H])
  header(pageTwo, regular, bold, record.id)
  y = H - 82
  pageTwo.drawText('Method, Files, and Limits', { x: M, y, size: 20, font: bold, color: ink })
  y -= 26
  y = section(pageTwo, 'Comparison methodology', M, y, bold)
  y = paragraph(pageTwo, record.photoMethod || 'Reviewed scene-map coordinate comparison. The image-level detection method was not recorded for this case.', M, y, W - 2 * M, regular, 8.5)
  if (record.faceGeometrySummary) {
    const face = record.faceGeometrySummary
    y = paragraph(pageTwo, `Consent-based facial geometry (aggregate only): ${face.sourceLandmarks} original and ${face.suspectLandmarks} suspected reference landmarks; ${face.alignedLandmarks} within ${face.alignmentThreshold.toFixed(2)} inter-eye spacings; mean normalized residual ${face.meanResidual == null ? 'not available' : face.meanResidual.toFixed(3)} inter-eye spacings. Raw facial landmark coordinates are not included. This does not establish identity or shared image origin.`, M, y, W - 2 * M, regular, 8.2)
  }
  if (record.correspondence) {
    const fit = record.correspondence
    y = paragraph(pageTwo, `Image-plane homography: ${fit.verified} verified and ${fit.rejected} rejected of ${fit.candidates} patch candidates. ${fit.sourceFeatures} and ${fit.suspectFeatures} Harris corners were retained. Mean verified reprojection ${fit.meanVerifiedErrorPx == null ? 'was not available' : `was ${fit.meanVerifiedErrorPx.toFixed(2)} px`} at a ${fit.thresholdPx} px threshold. This is not a 3D reconstruction or a manipulation percentage.`, M, y, W - 2 * M, regular, 8.2)
  }
  y = paragraph(pageTwo, 'The comparison excludes person-named objects and any reviewed feature coordinates falling within confirmed privacy covers, then compares remaining named point centers. Each residual is measured against the threshold shown on page 1. This is an experimental visual correspondence workflow, not an image-authenticity examination.', M, y, W - 2 * M, regular, 8.5)
  y -= 3
  const columnWidth = (W - 2 * M - 12) / 2
  const metadataRows = [fileInfo(record.sourceLabel, record.sourceFile, record.sourceHash), fileInfo(record.suspectLabel, record.suspectFile, record.suspectHash)]
  const metadataHeight = Math.max(...metadataRows.map(value => 35 + value.split('\n').reduce((count, row) => count + wrapped(row, regular, 7.5, columnWidth - 24).length, 0) * 10.5))
  const metadataTop = y
  drawMetadataBlock(pageTwo, 'Original photograph', metadataRows[0], M, metadataTop, columnWidth, metadataHeight, regular, bold)
  y = drawMetadataBlock(pageTwo, 'Suspected photograph', metadataRows[1], M + columnWidth + 12, metadataTop, columnWidth, metadataHeight, regular, bold)
  y -= 1
  y = section(pageTwo, 'Privacy processing', M, y, bold)
  const privacy = `Analysis engine: ${record.engine === 'on-device' ? 'on-device in this browser' : clean(record.engine)}. Uploaded image files are held in browser memory for this workflow and are not sent to the comparison engine. The analysis used background feature maps after privacy-mask exclusion. Mask applied to at least one image: ${record.maskApplied ? 'Yes' : 'No'}. The PDF includes no photograph pixels unless masked thumbnails were explicitly selected; only previews with recorded masking are eligible. ${record.pythonNote ? 'A Python cross-check note is recorded; Stillpoint sends feature-map coordinates to a loopback local backend for that option, not image pixels.' : 'No Python cross-check was recorded.'} ${record.discovery ? 'A reverse-image search candidate was also recorded in this case; that separate search may have disclosed its query to its provider.' : ''}`
  y = paragraph(pageTwo, privacy, M, y, W - 2 * M, regular, 8.2)
  y -= 2
  y = section(pageTwo, 'Limitations and uncertainty', M, y, bold)
  const limits = [
    'Correspondence does not prove manipulation, authorship, identity, consent, ownership, intent, or wrongdoing.',
    'The local Harris-corner and normalized-patch matcher is experimental. It can miss crops, rotation, repeated textures, occlusion, or changed backgrounds; points may also be missed or incorrectly reviewed.',
    'A no-link result does not establish that images are unrelated. Sparse, mixed, or masked features may leave the result indeterminate.',
    'Image metadata may be unavailable. SHA-256 identifies file bytes only and does not establish provenance, capture time, or authenticity.',
    'This report is an explanatory record of software measurements. It is not legally certified evidence or a forensic opinion.',
  ]
  for (const item of limits) y = paragraph(pageTwo, `- ${item}`, M, y, W - 2 * M, regular, 8)
  const footer = 'Generated locally by Stillpoint. No legal certification or image-authenticity conclusion is made.'
  pageTwo.drawText(clean(footer), { x: M, y: 50, size: 7.5, font: regular, color: muted })
  const bytes = await pdf.save()
  const blobBytes = new Uint8Array(bytes.byteLength)
  blobBytes.set(bytes)
  return new Blob([blobBytes.buffer], { type: 'application/pdf' })
}
