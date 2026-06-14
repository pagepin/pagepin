// @ts-check
// 命令条收起态(第 5 形态):Tuck → dot → restore。
//  - 点 rest 条最右的 Tuck → bar 隐藏、dot 出现并带未解决数
//  - 点 dot → 命令条恢复
//  - 拖 dot 吸附最近角 + localStorage 全局记忆 + reload 保持
//  - 收起态下 pin 仍可点 → 自动展开并开 popover
//  - 零未解决 → 安静 teal dot,无数字徽标
const { test, expect } = require('@playwright/test');
const { setup, goto, mkThread, bar, act, popover, collapsed } = require('./_helpers');

const count = (page) => collapsed(page).locator('[data-pp-role="collapsed-count"]');

test('点 Tuck → 命令条收起为 dot,dot 显示未解决数', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1'), mkThread(2, '#t2')] });
  await goto(page);
  await expect(bar(page)).toBeVisible();
  await act(page, 'collapse').click();
  await expect(bar(page)).toBeHidden();
  await expect(collapsed(page)).toBeVisible();
  await expect(count(page)).toHaveText('2');
});

test('点 dot → 命令条恢复', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await act(page, 'collapse').click();
  await expect(collapsed(page)).toBeVisible();
  await collapsed(page).click();
  await expect(bar(page)).toBeVisible();
  await expect(collapsed(page)).toBeHidden();
});

test('拖 dot 吸附最近角 + localStorage 记忆 + reload 后保持', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await act(page, 'collapse').click();
  const dot = collapsed(page);
  await expect(dot).toBeVisible();

  // 默认停左上(tl)。拖到视口右下,应吸附为 br。
  const box = await dot.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 120, { steps: 5 });
  await page.mouse.move(1120, 600, { steps: 5 }); // 视口右下象限
  await page.mouse.up();

  // 吸附右下:用 right/bottom 定位,清掉 left/top
  await expect
    .poll(() =>
      dot.evaluate((el) => {
        const s = el.style;
        return s.right !== '' && s.bottom !== '' && s.left === '' && s.top === '';
      }),
    )
    .toBe(true);

  // 全局记忆(不带 slug,所有站点共享)
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('pp-anno-collapse')));
  expect(saved).toMatchObject({ on: true, corner: 'br' });

  // reload 后仍收起、仍在该角
  await page.reload();
  await expect(collapsed(page)).toBeVisible();
  await expect(bar(page)).toBeHidden();
  await expect(
    collapsed(page).evaluate((el) => el.style.right !== '' && el.style.bottom !== ''),
  ).resolves.toBe(true);
});

test('收起态下 pin 仍可点 → 自动展开并打开 popover', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(1);
  await act(page, 'collapse').click();
  await expect(bar(page)).toBeHidden();

  await page.locator('.pp-anno-pin').click();
  await expect(popover(page)).toBeVisible();
  await expect(bar(page)).toBeVisible(); // 自动展开
  await expect(collapsed(page)).toBeHidden();
});

test('零未解决 → 安静 teal dot,无数字徽标', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1', { resolved: true })] });
  await goto(page);
  await act(page, 'collapse').click();
  await expect(collapsed(page)).toBeVisible();
  await expect(count(page)).toHaveCount(0);
  await expect(collapsed(page)).toHaveClass(/pp-anno-zero/);
});

test('dot 键盘可达:聚焦后 Enter 恢复命令条', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await act(page, 'collapse').click();
  await expect(collapsed(page)).toBeVisible();
  await collapsed(page).focus();
  await page.keyboard.press('Enter');
  await expect(bar(page)).toBeVisible();
  await expect(collapsed(page)).toBeHidden();
});

test('dot 有 role=button 与含未解决数的 aria-label', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1'), mkThread(2, '#t2')] });
  await goto(page);
  await act(page, 'collapse').click();
  const dot = collapsed(page);
  await expect(dot).toHaveAttribute('role', 'button');
  await expect(dot).toHaveAttribute('aria-label', /2 unresolved/);
});
