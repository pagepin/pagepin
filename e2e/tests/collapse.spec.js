// @ts-check
// Lumen 收起态：托盘 ↔ 仅剩 pill 坞（取代抽屉 ↔ 右缘 tab）。
//  - 坞 [data-pp-role="dock"] 常驻可见；计数钮 [data-pp-role="dock-count"]（= [data-pp-act="collapse"]）
//    开合托盘并显示未解决数。
//  - collapse → 托盘 display:none + .pp-anno-tray-closed；坞仍在，计数钮显示未解决数。
//  - 再点坞计数钮 → 托盘恢复。
//  - 收起写 localStorage（全局，不带 slug，键 pp-anno-rail）+ reload 保持。
//  - 收起态下 pin 仍可点 → 弹 popover 聚焦（不强制展开托盘）。
//  - 零未解决 → 坞计数钮无数字徽标。
//  - 坞计数钮键盘可达（原生 button、含未解决数的 aria-label、Enter 开合）。
const { test, expect } = require('@playwright/test');
const { setup, goto, mkThread, drawer, dock, dockCount, act, focusedCard, pin, ready } = require('./_helpers');

test('点坞计数钮 → 托盘收起为 .pp-anno-tray-closed，坞计数显示未解决数', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1'), mkThread(2, '#t2')] });
  await goto(page);
  await ready(page);
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).not.toHaveClass(/pp-anno-tray-closed/);
  await act(page, 'collapse').click();
  await expect(drawer(page)).toHaveClass(/pp-anno-tray-closed/);
  await expect(drawer(page)).toBeHidden();
  await expect(dock(page)).toBeVisible();
  await expect(dockCount(page)).toHaveText('2');
});

test('再点坞计数钮 → 托盘恢复', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await ready(page);
  await act(page, 'collapse').click();
  await expect(drawer(page)).toBeHidden();
  await act(page, 'collapse').click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).not.toHaveClass(/pp-anno-tray-closed/);
});

test('手动收起写 localStorage（全局，不带 slug）+ reload 后保持', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await ready(page);
  await act(page, 'collapse').click();
  await expect(drawer(page)).toHaveClass(/pp-anno-tray-closed/);

  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('pp-anno-rail')));
  expect(saved).toMatchObject({ open: false });

  // reload 后仍收起（托盘 hidden，故等坞而非托盘可见）、坞仍在
  await page.reload();
  await dock(page).waitFor();
  await expect(drawer(page)).toHaveClass(/pp-anno-tray-closed/);
  await expect(dock(page)).toBeVisible();
});

test('收起态下 pin 仍可点 → 弹 popover 聚焦（不强制展开托盘）', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await ready(page);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(1);
  await act(page, 'collapse').click();
  await expect(drawer(page)).toHaveClass(/pp-anno-tray-closed/);

  await page.locator('.pp-anno-pin').click();
  await expect(focusedCard(page)).toBeVisible(); // at-pin popover 弹出
  await expect(drawer(page)).toHaveClass(/pp-anno-tray-closed/); // 托盘不被强制展开
});

test('零未解决 → 坞计数钮无数字徽标', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1', { resolved: true })] });
  await goto(page);
  await ready(page);
  await act(page, 'collapse').click();
  await expect(dock(page)).toBeVisible();
  await expect(dockCount(page)).toBeVisible();
  await expect(dockCount(page)).not.toHaveText(/\d/); // 无未解决 → 无数字
});

test('坞计数钮键盘可达：聚焦后 Enter 开合托盘', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await ready(page);
  await act(page, 'collapse').click();
  await expect(drawer(page)).toBeHidden();
  await dockCount(page).focus();
  await page.keyboard.press('Enter');
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).not.toHaveClass(/pp-anno-tray-closed/);
});

test('坞计数钮含未解决数的 aria-label（原生 button，role 隐式）', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1'), mkThread(2, '#t2')] });
  await goto(page);
  await ready(page);
  await expect(dockCount(page)).toHaveAttribute('aria-label', /2 unresolved/);
});
