// @ts-check
const { test, expect } = require('@playwright/test');
const { setup, goto, ready } = require('./_helpers');
const GUEST = { sub: 'guest:g-abc', name: null, handle: null, guest: true };
test('guest first-open hint appears once', async ({ page }) => {
  await setup(page, { threads: [], viewer: GUEST });
  await goto(page); await ready(page);
  await expect(page.locator('.pp-anno-firsthint')).toBeVisible({ timeout: 3000 });
  await page.mouse.click(400, 400); // 任意点击即消失并记忆
  await expect(page.locator('.pp-anno-firsthint')).toHaveCount(0);
  await page.reload(); await ready(page);
  await page.waitForTimeout(800);
  await expect(page.locator('.pp-anno-firsthint')).toHaveCount(0); // 只出现一次
});
