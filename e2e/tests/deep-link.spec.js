// @ts-check
// 评论深链:#pp-comment-<id> 打开即定位并在抽屉里聚焦该卡;聚焦卡的 🔗 复制带 hash 的当前页链接。
// 回归:深链正则曾是内部版 ObjectId 的 24 位 hex,UUID 形态的 id 永远匹配不上。
const { test, expect } = require('@playwright/test');
const { setup, mkThread, pin, focusedCard } = require('./_helpers');

const UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

test('UUID id 的深链:打开页面自动滚到锚点并聚焦该卡', async ({ page }) => {
  // 放到首屏外（top:1080），以验证 deep-link 会滚动取景
  const t = mkThread(1, '#t3', { id: UUID });
  await setup(page, { boxes: [{ id: 't3', left: 80, top: 1080 }], threads: [t] });
  await page.goto(`http://pagepin.test/#pp-comment-${UUID}`);

  await expect(focusedCard(page)).toBeVisible();
  await expect(focusedCard(page)).toHaveAttribute('data-pp-num', '1');
  await expect(focusedCard(page).locator('.pp-anno-txt')).toContainText('这是第 1 条评论的内容');
});

test('已解决线程的深链:自动切到「显示全部」再定位', async ({ page }) => {
  const t = mkThread(1, '#t1', { id: UUID, resolved: true });
  await setup(page, { threads: [t] });
  await page.goto(`http://pagepin.test/#pp-comment-${UUID}`);

  await expect(focusedCard(page)).toBeVisible();
  await expect(page.locator('.pp-anno-pin')).toHaveCount(1); // resolved pin 因深链切到 all 被显示
});

test('聚焦卡 🔗:复制「当前页去 hash + #pp-comment-<id>」并 toast', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (s) => { window.__copied = s; return Promise.resolve(); } },
    });
  });
  const t = mkThread(1, '#t1', { id: UUID });
  await setup(page, { threads: [t] });
  await page.goto('http://pagepin.test/');

  await pin(page, 1).click();
  await expect(focusedCard(page)).toBeVisible();
  await focusedCard(page).locator('[data-pp-role="copy-link"]').click();
  await expect(page.locator('[data-pp-role="toast"]')).toContainText('Link copied');
  expect(await page.evaluate(() => window.__copied)).toBe(`http://pagepin.test/#pp-comment-${UUID}`);
});

test('点折叠卡聚焦后再 🔗:同样复制深链,不误触别的卡', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (s) => { window.__copied = s; return Promise.resolve(); } },
    });
  });
  const t = mkThread(1, '#t1', { id: UUID });
  await setup(page, { threads: [t, mkThread(2, '#t2')] });
  await page.goto('http://pagepin.test/');

  // 点 #t1 的折叠卡 → 聚焦展开
  const c1 = page.locator('[data-pp-role="card"][data-tid="' + UUID + '"]');
  await c1.click();
  await expect(focusedCard(page)).toHaveAttribute('data-tid', UUID);
  await focusedCard(page).locator('[data-pp-role="copy-link"]').click();
  await expect(page.locator('[data-pp-role="toast"]')).toContainText('Link copied');
  expect(await page.evaluate(() => window.__copied)).toBe(`http://pagepin.test/#pp-comment-${UUID}`);
});

// 回归：深链正则曾要求 id ≥8 位（[\w-]{8,}），短 id（如 "abc" / "th-cta"）永远定位不到。
// 长度下限无意义（后面 find 兜底），已放宽为 [\w-]+。
test('短 id 的深链(<8 位)也能定位聚焦', async ({ page }) => {
  const t = mkThread(1, '#t1', { id: 'abc' });
  await setup(page, { threads: [t] });
  await page.goto('http://pagepin.test/#pp-comment-abc');
  await expect(focusedCard(page)).toBeVisible();
  await expect(focusedCard(page)).toHaveAttribute('data-tid', 'abc');
});

// 回归：在已打开页里改 hash 不会重载（只发 hashchange），需监听 hashchange 才能定位。
test('已打开页改 hash → hashchange 定位聚焦该卡', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1'), mkThread(2, '#t2', { id: 'xyz-42' })] });
  await page.goto('http://pagepin.test/');
  await page.locator('[data-pp-role="tray"]').waitFor();
  await page.evaluate(() => { location.hash = '#pp-comment-xyz-42'; });
  await expect(focusedCard(page)).toHaveAttribute('data-tid', 'xyz-42');
});
