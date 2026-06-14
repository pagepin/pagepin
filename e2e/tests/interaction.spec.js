// @ts-check
// 弹层交互：关闭方式、回复后续、草稿暂存。
const { test, expect } = require('@playwright/test');
const { setup, pin, popover, anyPopup, goto, mkThread } = require('./_helpers');

const THREADS = [
  mkThread(1, '#t1'), mkThread(2, '#t2'), mkThread(3, '#t3'), mkThread(4, '#t4'),
];

test.beforeEach(async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(4);
});

test('Esc 关闭弹层', async ({ page }) => {
  await pin(page, 3).click();
  await expect(anyPopup(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(anyPopup(page)).toHaveCount(0);
});

test('点击空白处关闭弹层', async ({ page }) => {
  await pin(page, 3).click();
  await expect(anyPopup(page)).toHaveCount(1);
  await page.mouse.click(20, 700); // 没有 pin/弹层的空白区
  await expect(anyPopup(page)).toHaveCount(0);
});

test('回复后楼层 +1，且焦点回到回复框', async ({ page }) => {
  await pin(page, 3).click();
  await expect(page.locator('.pp-anno-msg')).toHaveCount(1);
  const ta = popover(page).locator('textarea');
  await ta.fill('补充一条回复');
  await ta.press('Enter');
  await expect(page.locator('.pp-anno-msg')).toHaveCount(2);
  const ta2 = popover(page).locator('textarea');
  await expect(ta2).toBeFocused();
  await expect(ta2).toHaveValue('');
});

test('草稿暂存：切走再切回，回复框内容仍在', async ({ page }) => {
  await pin(page, 3).click();
  await popover(page).locator('textarea').fill('未发送的草稿 ABC');
  // 切到另一条（不发布）
  await pin(page, 4).click();
  await expect(popover(page)).toHaveAttribute('data-pp-num', '4');
  // 切回 #3 —— 草稿应回填
  await pin(page, 3).click();
  await expect(popover(page)).toHaveAttribute('data-pp-num', '3');
  await expect(popover(page).locator('textarea')).toHaveValue('未发送的草稿 ABC');
});
