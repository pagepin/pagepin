// @ts-check
// 弹窗交互：关闭方式、回复后续、草稿暂存。
const { test, expect } = require('@playwright/test');
const { setup, pin, header, goto, mkThread } = require('./_helpers');

const THREADS = [
  mkThread(1, '#t1'), mkThread(2, '#t2'), mkThread(3, '#t3'), mkThread(4, '#t4'),
];

test.beforeEach(async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(4);
});

test('Esc 关闭弹窗', async ({ page }) => {
  await pin(page, 3).click();
  await expect(page.locator('.pp-anno-popup')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pp-anno-popup')).toHaveCount(0);
});

test('点击空白处关闭弹窗', async ({ page }) => {
  await pin(page, 3).click();
  await expect(page.locator('.pp-anno-popup')).toHaveCount(1);
  await page.mouse.click(20, 700); // 没有 pin/弹窗的空白区
  await expect(page.locator('.pp-anno-popup')).toHaveCount(0);
});

test('回复后楼层 +1，且焦点回到回复框', async ({ page }) => {
  await pin(page, 3).click();
  await expect(page.locator('.pp-anno-msg')).toHaveCount(1);
  const ta = page.locator('.pp-anno-popup textarea');
  await ta.fill('补充一条回复');
  await ta.press('Enter');
  await expect(page.locator('.pp-anno-msg')).toHaveCount(2);
  const ta2 = page.locator('.pp-anno-popup textarea');
  await expect(ta2).toBeFocused();
  await expect(ta2).toHaveValue('');
});

test('草稿暂存：切走再切回，回复框内容仍在', async ({ page }) => {
  await pin(page, 3).click();
  await page.locator('.pp-anno-popup textarea').fill('未发送的草稿 ABC');
  // 切到另一条（不发布）
  await pin(page, 4).click();
  await expect(header(page)).toHaveText('#4');
  // 切回 #3 —— 草稿应回填
  await pin(page, 3).click();
  await expect(header(page)).toHaveText('#3');
  await expect(page.locator('.pp-anno-popup textarea')).toHaveValue('未发送的草稿 ABC');
});
