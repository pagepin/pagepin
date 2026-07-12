// @ts-check
// 就地气泡 composer(桌面默认评论流):
//   - 元素点击 → composer 在落点(活性 pin + 胶囊),抽屉不再出草稿卡;
//   - 发送:胶囊密封,真 pin 原位接棒(pulse),线程入列;
//   - @page(整页留言)仍走抽屉草稿卡;
//   - Esc:composer 与活性 pin 一并清理,无线程残留。
const { test, expect } = require('@playwright/test');
const { setup, goto, ready, draft, composer, act, pin } = require('./_helpers');

test('元素点击默认就地:composer 在落点,抽屉无草稿卡;发送后 pin 接棒', async ({ page }) => {
  const creates = [];
  await setup(page, { threads: [], onCreate: (b) => creates.push(b) });
  await goto(page); await ready(page);
  await page.keyboard.press('c');
  await page.locator('#t2').click();
  await expect(composer(page)).toBeVisible();
  await expect(page.locator('.pp-anno-livepin')).toHaveCount(1);
  await expect(draft(page)).toHaveCount(0); // 抽屉不再渲染草稿卡
  await composer(page).locator('textarea').fill('这里的留白太挤');
  await composer(page).locator('[data-pp-role="send"]').click();
  await expect.poll(() => creates.length).toBe(1);
  expect(creates[0].selector).toBe('#t2');
  await expect(pin(page, 1)).toBeVisible(); // 真 pin 原位接棒
  await expect(composer(page)).toHaveCount(0);
  await expect(page.locator('.pp-anno-livepin')).toHaveCount(0);
});

test('kind 彩点在胶囊内可选,随请求提交', async ({ page }) => {
  const creates = [];
  await setup(page, { threads: [], onCreate: (b) => creates.push(b) });
  await goto(page); await ready(page);
  await page.keyboard.press('c');
  await page.locator('#t3').click();
  await composer(page).locator('.pp-anno-ckind[data-pp-kind="style"]').click();
  await composer(page).locator('textarea').fill('配色不对');
  await composer(page).locator('textarea').press('Enter');
  await expect.poll(() => creates.length).toBe(1);
  expect(creates[0].kind).toBe('style');
});

test('@page 整页留言仍走抽屉草稿卡', async ({ page }) => {
  await setup(page, { threads: [] });
  await goto(page); await ready(page);
  await act(page, 'whole').click();
  await expect(draft(page)).toBeVisible(); // 抽屉草稿卡
  await expect(composer(page)).toHaveCount(0);
});

test('Esc 清理 composer 与活性 pin,无残留', async ({ page }) => {
  await setup(page, { threads: [] });
  await goto(page); await ready(page);
  await page.keyboard.press('c');
  await page.locator('#t1').click();
  await expect(composer(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(composer(page)).toHaveCount(0);
  await expect(page.locator('.pp-anno-livepin')).toHaveCount(0);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(0);
});
