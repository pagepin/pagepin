// @ts-check
// 图片框选(bbox 评论):评论模式下拖动出框 → 区域评论(草稿落在抽屉);轻点仍是点评论;
// 预置 bbox 线程渲染区域框;区域预览随图片滚动重摆;评论模式两步式 + ⌥/⌘ 直接弹。
const { test, expect } = require('@playwright/test');
const { setup, goto, mkThread, draft, ready } = require('./_helpers');

const SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#9ab"/></svg>',
);

/** boundingBox 不自动重试,会撞上评论层重摆瞬间拿到 null —— 包一层 toPass。 */
async function bbox(locator) {
  let b = null;
  await expect(async () => {
    b = await locator.boundingBox();
    expect(b).not.toBeNull();
  }).toPass();
  return b;
}

const IMG_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>html,body{margin:0;height:900px}#shot{position:absolute;left:100px;top:120px;width:400px;height:300px}</style>
</head><body>
<img id="shot" src="data:image/svg+xml,${SVG}" alt="shot">
<script src="/comments.js" data-handle="alice" data-slug="demo" data-path="/" data-version="v1"></script>
</body></html>`;

const draftTa = (page) => page.locator('[data-pp-role="draft"] textarea');
const draftSend = (page) => page.locator('[data-pp-role="draft"] [data-pp-role="send"]');

test('评论模式下在图片上拖动 → 区域评论,rw/rh 随请求提交且区域框渲染', async ({ page }) => {
  let created = null;
  await setup(page, { html: IMG_HTML, onCreate: (b) => { created = b; } });
  await goto(page);
  await ready(page);
  await page.keyboard.press('c'); // 评论模式

  // img 盒 (100,120,400x300):从 (150,170) 拖到 (350,290) → rx=.125 ry≈.1667 rw=.5 rh=.4
  await page.mouse.move(150, 170);
  await page.mouse.down();
  await page.mouse.move(350, 290, { steps: 6 });
  await page.mouse.up();

  await expect(draft(page)).toBeVisible();
  await expect(page.locator('.pp-anno-rubber')).toHaveCount(1); // 撰写期间有虚线预览框

  await draftTa(page).fill('这一块的配色再调暗一点');
  await draftSend(page).click();

  await expect(page.locator('.pp-anno-region')).toHaveCount(1);
  await expect(page.locator('.pp-anno-rubber')).toHaveCount(0); // 预览框已撤
  expect(created.rx).toBeCloseTo(0.125, 2);
  expect(created.ry).toBeCloseTo(50 / 300, 2);
  expect(created.rw).toBeCloseTo(0.5, 2);
  expect(created.rh).toBeCloseTo(0.4, 2);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  const b = await bbox(page.locator('.pp-anno-region'));
  expect(Math.abs(b.x - 150)).toBeLessThan(4);
  expect(Math.abs(b.y - 170)).toBeLessThan(4);
  expect(Math.abs(b.width - 200)).toBeLessThan(4);
  expect(Math.abs(b.height - 120)).toBeLessThan(4);
});

test('预置 bbox 线程:渲染区域框,几何随 rx/ry/rw/rh', async ({ page }) => {
  const t = mkThread(1, '#shot', { rx: 0.25, ry: 0.25, rw: 0.5, rh: 0.5 });
  await setup(page, { html: IMG_HTML, threads: [t] });
  await goto(page);

  const region = page.locator('.pp-anno-region');
  await expect(region).toHaveCount(1);
  const b = await bbox(region);
  expect(Math.abs(b.x - 200)).toBeLessThan(3);
  expect(Math.abs(b.y - 195)).toBeLessThan(3);
  expect(Math.abs(b.width - 200)).toBeLessThan(3);
  expect(Math.abs(b.height - 150)).toBeLessThan(3);
  const pin = await bbox(page.locator('.pp-anno-pin'));
  expect(Math.abs(pin.x + 4 + 14 - 200)).toBeLessThan(20); // pin 钉在框左上角附近
});

test('轻点图片(位移 < 阈值)仍是点评论,不带 rw/rh', async ({ page }) => {
  let created = null;
  await setup(page, { html: IMG_HTML, onCreate: (b) => { created = b; } });
  await goto(page);
  await ready(page);
  await page.keyboard.press('c');

  await page.mouse.click(300, 270);
  await expect(draft(page)).toBeVisible();
  await draftTa(page).fill('就这个点');
  await draftSend(page).click();

  expect(created.rw == null).toBeTruthy();
  expect(created.rh == null).toBeTruthy();
  await expect(page.locator('.pp-anno-region')).toHaveCount(0);
});

test('区域预览随图片滚动重摆(锚在图片上,不固定在视口)', async ({ page }) => {
  await setup(page, { html: IMG_HTML });
  await goto(page);
  await ready(page);
  await page.keyboard.press('c');

  await page.mouse.move(150, 170);
  await page.mouse.down();
  await page.mouse.move(350, 290, { steps: 6 });
  await page.mouse.up();
  await expect(draft(page)).toBeVisible();

  const before = await bbox(page.locator('.pp-anno-rubber'));
  await page.evaluate(() => window.scrollBy(0, 40));
  await page.waitForTimeout(120);
  const after = await bbox(page.locator('.pp-anno-rubber'));
  expect(Math.abs(after.y - (before.y - 40))).toBeLessThan(8); // 随页面上移 40，不固定
  expect(Math.abs(after.x - before.x)).toBeLessThan(4);
});

test('草稿搬家:点别处一步搬到新锚点,文字跟着走;丢字只发生在 Esc/取消', async ({ page }) => {
  await setup(page, { html: IMG_HTML });
  await goto(page);
  await ready(page);
  await page.keyboard.press('c');

  await page.mouse.click(200, 200);
  await expect(draft(page)).toBeVisible();
  const sel1 = await draft(page).getAttribute('data-pp-selector');
  await page.mouse.click(560, 620); // 空稿点别处:一步搬家(不再是"先收掉再点")
  await expect(draft(page)).toBeVisible();
  const sel2 = await draft(page).getAttribute('data-pp-selector');
  expect(sel2).not.toBe(sel1);
  await draftTa(page).fill('还没写完'); // 有字稿点别处:连字搬家
  await page.mouse.click(150, 150);
  await expect(draft(page)).toBeVisible();
  await expect(draftTa(page)).toHaveValue('还没写完');
  expect(await draft(page).getAttribute('data-pp-selector')).not.toBe(sel2);
  await page.keyboard.press('Escape'); // 丢字的显式路径:Esc(或取消钮)
  await expect(draft(page)).toHaveCount(0);
});
