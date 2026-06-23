// @ts-check
// 评论 kind 在聚焦卡里可改:点 chip → PATCH {kind} → pin/卡条重新上色;
// 再点同一项 → 取消(kind=null),回中性色。后端 PATCH /api/comments/threads/:tid 已支持可选 kind。
const { test, expect } = require('@playwright/test');
const { setup, goto, mkThread, pin, focusedCard, ready } = require('./_helpers');

const BUG_RGB = 'rgb(194, 54, 27)'; // #c2361b
const NO_KIND_RGB = 'rgb(58, 66, 75)'; // #3a424b

const pinColor = (page) =>
  page.locator('.pp-anno-pin').evaluate((el) => getComputedStyle(el).backgroundColor);

test('聚焦卡点 kind chip:PATCH {kind} + pin 重新上色;再点取消回中性', async ({ page }) => {
  const patches = [];
  const t = mkThread(1, '#t1', { kind: null });
  await setup(page, { threads: [t], onPatch: (b) => patches.push(b) });
  await goto(page);
  await ready(page);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(1);
  expect(await pinColor(page)).toBe(NO_KIND_RGB); // 无 kind = 中性

  await pin(page, 1).click();
  await expect(focusedCard(page)).toBeVisible();

  // 选 Bug
  await focusedCard(page).locator('[data-pp-kind="bug"]').click();
  await expect.poll(() => patches.at(-1) && patches.at(-1).kind).toBe('bug');
  await expect(focusedCard(page).locator('[data-pp-kind="bug"]')).toHaveClass(/pp-anno-on/);
  await expect.poll(() => pinColor(page)).toBe(BUG_RGB); // pin 重新上色为 Bug

  // 再点同项 → 取消(kind=null)
  await focusedCard(page).locator('[data-pp-kind="bug"]').click();
  await expect.poll(() => patches.at(-1) && patches.at(-1).kind).toBe(null);
  await expect(focusedCard(page).locator('[data-pp-kind="bug"]')).not.toHaveClass(/pp-anno-on/);
  await expect.poll(() => pinColor(page)).toBe(NO_KIND_RGB);
});

test('改 kind 不影响 resolved:卡仍展开,回复框仍在', async ({ page }) => {
  const t = mkThread(1, '#t1', { kind: 'copy' });
  await setup(page, { threads: [t] });
  await goto(page);
  await ready(page);

  await pin(page, 1).click();
  await expect(focusedCard(page)).toBeVisible();
  await focusedCard(page).locator('[data-pp-kind="question"]').click();
  await expect(focusedCard(page).locator('[data-pp-kind="question"]')).toHaveClass(/pp-anno-on/);
  // 卡未被关闭,reply 框仍在
  await expect(focusedCard(page).locator('[data-pp-role="reply"]')).toBeVisible();
});
