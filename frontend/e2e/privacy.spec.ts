import { expect, test } from '@playwright/test'

test('bundled segmentation runs in a real browser without any image POST or external request', async ({ page }) => {
  const imagePosts: string[] = [], external: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST') imagePosts.push(request.url())
    if (!request.url().startsWith('http://127.0.0.1:5186') && !request.url().startsWith('data:')) external.push(request.url())
  })
  // Isolate inference from React/Vite HMR; model code, worker, WASM and weights remain real.
  await page.route('**/mask-smoke', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local mask smoke test</title>' }))
  await page.goto('/mask-smoke')
  const result = await page.evaluate(async () => {
    // Browser smoke fixture; verifies real inference, not human-detection accuracy.
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#d6e3e7'; ctx.fillRect(0, 0, 256, 256)
    ctx.fillStyle = '#263d54'; ctx.beginPath(); ctx.arc(128, 65, 25, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(95, 93, 66, 120)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))
    const modulePath = '/src/lib/localSegmentation.ts'
    const { segmentLocally } = await import(/* @vite-ignore */ modulePath)
    let mask
    try { mask = await segmentLocally(blob, new AbortController().signal) }
    catch (error) { throw new Error(`${(error as Error).message} ${(error as Error & { diagnostic?: string }).diagnostic ?? ''}`) }
    return { width: mask.width, height: mask.height, length: mask.data.length, values: [...new Set(Array.from(mask.data))] }
  })
  expect(result.width).toBeGreaterThan(0)
  expect(result.length).toBe(result.width * result.height)
  expect(result.values.every(value => value === 0 || value === 1)).toBe(true)
  expect(imagePosts).toEqual([])
  expect(external.filter(url => !url.includes('/api/status'))).toEqual([])
})

test('Settings stays within desktop/mobile viewports and only requests backend status', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('stillpoint.guest.v1', 'true'))
  await page.route('**/api/status', route => route.fulfill({ json: { configured: false } }))
  const posts: string[] = []
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()) })
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/settings-${width}.png`, fullPage: true })
  }
  expect(posts).toEqual([])
})
