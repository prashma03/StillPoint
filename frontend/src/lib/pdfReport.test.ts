import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { runCheck } from './check'
import { buildEvidencePdf } from './pdfReport'
import { sampleDerivative, sampleOriginal } from './samples'

describe('PDF evidence reports', () => {
  it('generates an openable report from a completed analysis record without embedding image data', async () => {
    const outcome = await runCheck({
      source: sampleOriginal,
      suspect: sampleDerivative,
      sourceLabel: 'consented-original.jpg',
      suspectLabel: 'consented-suspect.jpg',
      sourceHash: 'a'.repeat(64),
      suspectHash: 'b'.repeat(64),
      sourceFile: { name: 'consented-original.jpg', mimeType: 'image/jpeg', sizeBytes: 12345 },
      suspectFile: { name: 'consented-suspect.jpg', mimeType: 'image/jpeg', sizeBytes: 23456 },
      detectedKeypoints: { source: 87, suspect: 93 },
      sourceMask: null,
      maskApplied: true,
      sourceMaskApplied: true,
      suspectMaskApplied: true,
      blind: true,
      sample: false,
    }, () => {})
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const blob = await buildEvidencePdf(outcome.record)
    const bytes = await blob.arrayBuffer()
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    const reopened = await PDFDocument.load(bytes)
    expect(reopened.getPageCount()).toBe(2)
    expect(reopened.getTitle()).toContain(outcome.record.id)
    for (const page of reopened.getPages()) {
      const resources = page.node.Resources()
      expect(resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length ?? 0).toBe(0)
    }
    const outputPath = process.env.STILLPOINT_EVIDENCE_PDF_OUTPUT
    if (outputPath) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(outputPath, new Uint8Array(bytes))
    }
  })
})
