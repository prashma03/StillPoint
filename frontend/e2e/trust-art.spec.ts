import { expect, test } from '@playwright/test'

test('illustrated Trust is responsive, respects reduced motion, and keeps characters out of evidence', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('stillpoint.guest.v1', 'true'))
  await page.route('**/api/status', route => route.fulfill({ json: { configured: false } }))
  await page.goto('/trust')
  await expect(page.getByRole('heading', { name: 'Trust is built on transparency.' })).toBeVisible()
  await page.getByRole('heading', { name: 'Trust is built on transparency.' }).evaluate(element => (element as HTMLElement).blur())
  await expect(page.locator('.trust-topic-art svg')).toHaveCount(4)
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const card = page.getByRole('button', { name: /Evidence Integrity/ })
    await expect(card).toBeVisible()
    await page.screenshot({ path: `${process.env.STILLPOINT_ART_SCREENSHOTS || 'test-results'}/trust-illustrated-${width}.png`, fullPage: true })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.locator('.sp-companion-body').evaluate(element => getComputedStyle(element).animationName)).toBe('none')
  const evidence = page.getByRole('button', { name: /Evidence Integrity/ })
  await evidence.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Four independent evidence categories' })).toBeVisible()
  await expect(page.locator('.sp-companion')).toHaveCount(0)
  await page.getByRole('button', { name: /Back to Trust/ }).click()
  await page.getByRole('button', { name: /Verify a Report/ }).click()
  await expect(page.getByRole('heading', { name: 'Report verification is not connected' })).toBeVisible()
  await expect(page.locator('.sp-companion')).toHaveCount(0)
})
