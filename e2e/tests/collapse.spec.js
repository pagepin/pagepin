// @ts-check
// 抽屉收起态（第 2 形态）：collapse → 右缘 tab → restore。
//  - 点抽屉头的 collapse → 抽屉滑出（pp-anno-closed）、tab 出现并带未解决数
//  - 点 tab → 抽屉恢复
//  - 手动收起写 localStorage（全局，不带 slug）+ reload 保持
//  - 收起态下 pin 仍可点 → 自动展开并聚焦该卡
//  - 零未解决 → tab 无数字徽标
//  - tab 键盘可达（role=button、含未解决数的 aria-label、Enter 恢复）
const { test, expect } = require('@playwright/test');
const { setup, goto, mkThread, drawer, tab, act, focusedCard, ready } = require('./_helpers');

const count = (page) => tab(page).locator('[data-pp-role="tab-count"]');

test('点 collapse → 抽屉滑出为 tab，tab 显示未解决数', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1'), mkThread(2, '#t2')] });
  await goto(page);
  await ready(page);
  await expect(drawer(page)).not.toHaveClass(/pp-anno-closed/);
  await act(page, 'collapse').click();
  await expect(drawer(page)).toHaveClass(/pp-anno-closed/);
  await expect(tab(page)).toBeVisible();
  await expect(count(page)).toHaveText('2');
});

test('点 tab → 抽屉恢复', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await ready(page);
  await act(page, 'collapse').click();
  await expect(tab(page)).toBeVisible();
  await tab(page).click();
  await expect(drawer(page)).not.toHaveClass(/pp-anno-closed/);
  await expect(tab(page)).toBeHidden();
});

test('手动收起写 localStorage（全局，不带 slug）+ reload 后保持', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await ready(page);
  await act(page, 'collapse').click();
  await expect(drawer(page)).toHaveClass(/pp-anno-closed/);

  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('pp-anno-rail')));
  expect(saved).toMatchObject({ open: false });

  // reload 后仍收起、tab 在
  await page.reload();
  await ready(page);
  await expect(drawer(page)).toHaveClass(/pp-anno-closed/);
  await expect(tab(page)).toBeVisible();
});

test('收起态下 pin 仍可点 → 自动展开并聚焦该卡', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await ready(page);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(1);
  await act(page, 'collapse').click();
  await expect(drawer(page)).toHaveClass(/pp-anno-closed/);

  await page.locator('.pp-anno-pin').click();
  await expect(drawer(page)).not.toHaveClass(/pp-anno-closed/); // 自动展开
  await expect(focusedCard(page)).toBeVisible();
  await expect(tab(page)).toBeHidden();
});

test('零未解决 → tab 无数字徽标', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1', { resolved: true })] });
  await goto(page);
  await ready(page);
  await act(page, 'collapse').click();
  await expect(tab(page)).toBeVisible();
  await expect(count(page)).toHaveCount(0);
});

test('tab 键盘可达：聚焦后 Enter 恢复抽屉', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await ready(page);
  await act(page, 'collapse').click();
  await expect(tab(page)).toBeVisible();
  await tab(page).focus();
  await page.keyboard.press('Enter');
  await expect(drawer(page)).not.toHaveClass(/pp-anno-closed/);
  await expect(tab(page)).toBeHidden();
});

test('tab 含未解决数的 aria-label（原生 button，role 隐式）', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1'), mkThread(2, '#t2')] });
  await goto(page);
  await ready(page);
  await act(page, 'collapse').click();
  await expect(tab(page)).toHaveAttribute('aria-label', /2 unresolved/);
});
