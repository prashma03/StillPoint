import { expect, test } from '@playwright/test'

test('Proof concept demo keeps its 3D canvas and phase controls sized at desktop and mobile widths', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('stillpoint.guest.v1', 'true')
    sessionStorage.setItem('stillpoint.intro.v1', 'complete')
  })
  await page.goto('/proof')
  await expect(page.getByRole('heading', { name: 'Spatial correspondence, made visible.' })).toBeVisible()
  const section = page.getByRole('region', { name: 'Simulated conceptual 3D evidence visualization' })
  await expect(section).toBeVisible()
  const viewport = section.locator('[class*="viewport"]')
  const phasebar = section.locator('[aria-label="Five phases of the simulated comparison"]')
  await expect(phasebar.locator('> div')).toHaveCount(5)

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 })
    const box = await viewport.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(width > 700 ? 500 : 380)
    await expect(section.locator('canvas')).toBeVisible()
    const phases = phasebar.locator('> div')
    const first = await phases.nth(0).boundingBox(), second = await phases.nth(1).boundingBox()
    expect(first?.height).toBeGreaterThan(35)
    expect(second?.height).toBeGreaterThan(35)
    expect(second!.x).toBeGreaterThan(first!.x)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`proof-demo-${width}.png`), fullPage: true })
  }
})
