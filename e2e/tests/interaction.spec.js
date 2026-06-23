// @ts-check
// 抽屉卡交互：点 pin/卡 聚焦展开、常驻 j/k 步进、回复后续、回复草稿按线程暂存。
const { test, expect } = require('@playwright/test');
const { setup, pin, focusedCard, goto, mkThread, ready } = require('./_helpers');

const THREADS = [
  mkThread(1, '#t1'), mkThread(2, '#t2'), mkThread(3, '#t3'), mkThread(4, '#t4'),
];

test.beforeEach(async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page);
  await ready(page);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(4);
});

test('点 pin 聚焦该卡并就地展开（显示评论正文 + 回复框）', async ({ page }) => {
  await pin(page, 3).click();
  await expect(focusedCard(page)).toBeVisible();
  await expect(focusedCard(page)).toHaveAttribute('data-pp-num', '3');
  await expect(focusedCard(page).locator('.pp-anno-txt')).toContainText('这是第 3 条评论的内容');
  await expect(focusedCard(page).locator('[data-pp-role="reply"]')).toBeVisible();
});

test('常驻 j/k 在抽屉里步进聚焦（无 Walk 模式）', async ({ page }) => {
  await page.keyboard.press('j'); // 无焦点 → 聚焦文档序第一条
  await expect(focusedCard(page)).toHaveAttribute('data-pp-num', '1');
  await page.keyboard.press('j');
  await expect(focusedCard(page)).toHaveAttribute('data-pp-num', '2');
  await page.keyboard.press('k');
  await expect(focusedCard(page)).toHaveAttribute('data-pp-num', '1');
});

test('回复后楼层 +1，且焦点回到回复框', async ({ page }) => {
  await pin(page, 3).click();
  await expect(focusedCard(page).locator('.pp-anno-msg')).toHaveCount(1);
  const ta = focusedCard(page).locator('[data-pp-role="reply"]');
  await ta.fill('补充一条回复');
  await ta.press('Enter');
  await expect(focusedCard(page).locator('.pp-anno-msg')).toHaveCount(2);
  const ta2 = focusedCard(page).locator('[data-pp-role="reply"]');
  await expect(ta2).toBeFocused();
  await expect(ta2).toHaveValue('');
});

test('回复草稿按线程暂存：切走再切回，回复框内容仍在', async ({ page }) => {
  await pin(page, 3).click();
  await focusedCard(page).locator('[data-pp-role="reply"]').fill('未发送的草稿 ABC');
  // 切到另一条（不发布）
  await pin(page, 4).click();
  await expect(focusedCard(page)).toHaveAttribute('data-pp-num', '4');
  // 切回 #3 —— 草稿应回填
  await pin(page, 3).click();
  await expect(focusedCard(page)).toHaveAttribute('data-pp-num', '3');
  await expect(focusedCard(page).locator('[data-pp-role="reply"]')).toHaveValue('未发送的草稿 ABC');
});
