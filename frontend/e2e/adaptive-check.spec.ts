import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
test.setTimeout(180000)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('stillpoint.guest.v1', 'true'))
  await page.route('**/api/status', route => route.fulfill({ json: { configured: false } }))
})

test('real local composition inspection and background comparison never load facial landmarks', async ({ page, baseURL }) => {
  const faceLoads: string[] = [], posts: string[] = [], external: string[] = []
  page.on('request', request => {
    if (/face_landmarker|localFaceLandmarks/.test(request.url())) faceLoads.push(request.url())
    if (request.method() === 'POST') posts.push(request.url())
    const url = new URL(request.url())
    const localStatus = url.hostname === '127.0.0.1' && url.pathname === '/api/status'
    if (!localStatus && !request.url().startsWith(`${baseURL}/`) && !/^(data|blob):/.test(request.url())) external.push(request.url())
  })
  await page.goto('/check')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
    const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(256, 256)
    let seed = 417
    for (let i = 0; i < 256 * 256; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i * 4] = seed % 256; pixels.data[i * 4 + 1] = seed >>> 8 & 255; pixels.data[i * 4 + 2] = seed >>> 16 & 255; pixels.data[i * 4 + 3] = 255 }
    ctx.putImageData(pixels, 0, 0); return canvas.toDataURL('image/png').split(',')[1]
  })
  for (const side of ['original', 'suspicious']) await page.getByLabel(`Upload ${side} photograph`).setInputFiles({ name: `${side}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.getByText(/Environmental detail/)).toBeVisible({ timeout: 65000 })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${process.env.STILLPOINT_ART_SCREENSHOTS || 'test-results'}/adaptive-check-${width}.png`, fullPage: true })
  }
  await expect(page.getByRole('checkbox', { name: /I explicitly consent/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue to Privacy Review' }).click()
  await page.getByRole('checkbox', { name: /I reviewed this mask and confirm/ }).check()
  await page.getByRole('button', { name: 'Continue to Feature Review' }).click()
  await expect(page.getByRole('heading', { name: '3. Review Available Features' })).toBeVisible({ timeout: 60000 })
  await page.getByRole('checkbox', { name: /I reviewed the available details/ }).check()
  await page.getByRole('button', { name: 'Continue to Analysis' }).click()
  await page.getByRole('button', { name: 'Analyze Images' }).click()
  await expect(page.getByRole('heading', { name: '5. Comparison Results' })).toBeVisible()
  await page.getByRole('link', { name: 'Continue to Proof' }).click()
  await expect(page.getByRole('heading', { name: 'Correspondences from this comparison' })).toBeVisible()
  expect(faceLoads).toEqual([]); expect(posts).toEqual([]); expect(external).toEqual([])
})

test('sparse images and failed detection remain honest and allow background override', async ({ page }) => {
  await page.goto('/check')
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 128; c.getContext('2d')!.fillRect(0, 0, 128, 128); return c.toDataURL().split(',')[1] })
  const upload = async () => { for (const side of ['original', 'suspicious']) await page.getByLabel(`Upload ${side} photograph`).setInputFiles({ name: `${side}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }) }
  await upload()
  await expect(page.getByText(/Limited usable features/)).toBeVisible({ timeout: 65000 })
  await expect(page.getByRole('checkbox', { name: /I explicitly consent/ })).toHaveCount(0)
  await page.getByLabel('Choose method').selectOption('background')
  await expect(page.locator('.analysis-method-summary strong')).toHaveText('Background Geometry')
  await page.route('**/models/composition/detector.worker.js', route => route.abort())
  await page.reload()
  await upload()
  await expect(page.getByText(/Composition detection could not load/)).toBeVisible({ timeout: 30000 })
  await page.getByLabel('Choose method').selectOption('background')
  await expect(page.getByRole('button', { name: 'Continue to Privacy Review' })).toBeEnabled()
  await expect(page.getByRole('checkbox', { name: /I explicitly consent/ })).toHaveCount(0)
})

test('consented local facial geometry preserves measured results into Proof without stored coordinates', async ({ page }) => {
  // Existing non-sensitive synthetic test-room image, cropped locally. No external image request.
  const sample = readFileSync('../test images/stillpoint_original_person.png').toString('base64')
  let consentGiven = false
  const earlyLoads: string[] = [], posts: string[] = []
  page.on('request', request => {
    if (/face_landmarker|localFaceLandmarks/.test(request.url()) && !consentGiven) earlyLoads.push(request.url())
    if (request.method() === 'POST') posts.push(request.url())
  })
  await page.goto('/check')
  const png = await page.evaluate(async sample => {
    const image = new Image(); image.src = `data:image/png;base64,${sample}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = 285; canvas.height = 345
    canvas.getContext('2d')!.drawImage(image, 505, 318, 95, 115, 0, 0, 285, 345)
    return canvas.toDataURL('image/png').split(',')[1]
  }, sample)
  for (const side of ['original', 'suspicious']) await page.getByLabel(`Upload ${side} photograph`).setInputFiles({ name: `${side}-headshot.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.locator('.analysis-composition-details')).toBeVisible({ timeout: 65000 })
  await page.locator('.analysis-composition-details summary').click()
  // This tilted synthetic crop can be missed by the frontal box detector.
  // Exercise the explicit override using real landmarks, not invented bounds.
  await expect(page.locator('.analysis-composition-details')).toContainText('corners outside face bounds')
  await page.getByLabel('Choose method').selectOption('facial')
  expect(earlyLoads).toEqual([])
  await expect(page.getByRole('checkbox', { name: /I explicitly consent/ })).not.toBeChecked()
  await page.getByRole('button', { name: 'Continue to Privacy Review' }).click()
  await page.getByRole('checkbox', { name: /I reviewed this mask and confirm/ }).check()
  consentGiven = true
  await page.getByRole('checkbox', { name: /I explicitly consent/ }).check()
  await page.getByRole('button', { name: 'Continue to Feature Review' }).click()
  await page.getByRole('checkbox', { name: /I reviewed this method/ }).check()
  await page.getByRole('button', { name: 'Continue to Analysis' }).click()
  await page.getByRole('button', { name: 'Analyze Images' }).click()
  await expect(page.getByRole('heading', { name: '5. Comparison Results' })).toBeVisible({ timeout: 60000 })
  await expect(page.locator('.facial-proof')).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Continue to Proof' })).toBeVisible()
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('stillpoint.case.v1')!))
  expect(stored.analysisMethod).toBe('facial')
  expect(stored.faceGeometrySummary.sourceLandmarks).toBeGreaterThan(0)
  expect(JSON.stringify(stored)).not.toContain('"x":')
  await page.getByRole('link', { name: 'Continue to Proof' }).click()
  await expect(page.locator('.facial-proof')).toHaveCount(1)
  await expect(page.locator('.analysis-results-heading h3')).toHaveText('Facial Landmark Geometry')
  expect(earlyLoads).toEqual([]); expect(posts).toEqual([])
})
