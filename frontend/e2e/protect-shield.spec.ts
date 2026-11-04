import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test('Protect creates native-resolution changed pixels and downloads the same reusable PNG', async ({ page }) => {
  const samplePath = '../test images/stillpoint_original_person.png'
  const originalBytes = readFileSync(samplePath)
  const originalHash = createHash('sha256').update(originalBytes).digest('hex')

  await page.addInitScript(() => {
    sessionStorage.setItem('stillpoint.guest.v1', 'true')
    sessionStorage.setItem('stillpoint.intro.v1', 'complete')
  })
  await page.goto('/protect')
  const input = page.locator('input[type="file"]')
  await input.setInputFiles(samplePath)
  await expect(page.getByRole('img', { name: 'Original photograph before protection' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Shielded Image' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Apply Protection Shield' }).click()
  await expect(page.getByRole('status')).toContainText('Shielded PNG ready', { timeout: 30_000 })
  await expect(page.getByRole('img', { name: 'Protected photograph with pixel values changed' })).toBeVisible()
  const downloadButton = page.getByRole('button', { name: 'Download Shielded Image' })
  await expect(downloadButton).toBeEnabled()

  const preview = await page.evaluate(async () => {
    const source = document.querySelector<HTMLImageElement>('figure img[alt="Original photograph"]')!
    const shielded = document.querySelector<HTMLImageElement>('figure img[alt="Protected photograph with pixel values changed"]')!
    await Promise.all([source.decode(), shielded.decode()])
    const pixels = (image: HTMLImageElement) => {
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
      return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data }
    }
    const original = pixels(source), result = pixels(shielded)
    let changedSamples = 0
    for (let index = 0; index < original.data.length; index += 4) {
      if (original.data[index] !== result.data[index] || original.data[index + 1] !== result.data[index + 1] || original.data[index + 2] !== result.data[index + 2]) changedSamples++
    }
    const png = await fetch(shielded.src).then(response => response.arrayBuffer())
    const digest = await crypto.subtle.digest('SHA-256', png)
    const bytes = new Uint8Array(png); let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    return { sourceWidth: original.width, sourceHeight: original.height, outputWidth: result.width, outputHeight: result.height, changedSamples, outputHash: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), pngBase64: btoa(binary) }
  })
  expect(preview.outputWidth).toBe(preview.sourceWidth)
  expect(preview.outputHeight).toBe(preview.sourceHeight)
  expect(preview.changedSamples).toBeGreaterThan(0)
  const metricText = await page.locator('.num').filter({ hasText: 'Mean change' }).textContent()
  expect(metricText).toMatch(/dB PSNR/)
  expect(Number(metricText?.match(/([\d.]+) dB PSNR/)?.[1])).toBeGreaterThan(25)

  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()])
  expect(download.suggestedFilename()).toBe('stillpoint_original_person_stillpoint_shielded.png')
  const savedPath = await download.path()
  expect(savedPath).toBeTruthy()
  const protectedBytes = readFileSync(savedPath!)
  const protectedHash = createHash('sha256').update(protectedBytes).digest('hex')
  expect(protectedHash).not.toBe(originalHash)
  expect(protectedHash).toBe(preview.outputHash)
  expect(protectedBytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

  const reopened = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
    return { width: image.naturalWidth, height: image.naturalHeight }
  }, protectedBytes.toString('base64'))
  expect(reopened).toEqual({ width: preview.sourceWidth, height: preview.sourceHeight })

  const previewUrl = await page.locator('figure img[alt="Protected photograph with pixel values changed"]').getAttribute('src')
  const [secondDownload] = await Promise.all([page.waitForEvent('download'), downloadButton.click()])
  const secondPath = await secondDownload.path()
  expect(secondDownload.suggestedFilename()).toBe(download.suggestedFilename())
  expect(createHash('sha256').update(readFileSync(secondPath!)).digest('hex')).toBe(protectedHash)
  await expect(page.locator('figure img[alt="Protected photograph with pixel values changed"]')).toHaveAttribute('src', previewUrl!)
  console.log('Shield browser verification:', JSON.stringify({ dimensions: `${preview.outputWidth}x${preview.outputHeight}`, changedRgbPixels: preview.changedSamples, psnr: metricText?.match(/([\d.]+) dB PSNR/)?.[1], originalSha256: originalHash, shieldedSha256: protectedHash, downloadedBytesMatchPreview: true, reopenedDimensions: `${reopened.width}x${reopened.height}`, repeatDownloadSameHash: true }))
})
