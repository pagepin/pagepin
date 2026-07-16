// @ts-check
// 文本选区评论(设计稿 onPageMouseUp/_findQuote):评论模式选中文字 → 引文草稿 →
// POST 带 quote → 命中行高亮条 + pin 挂行尾;原文改动 → 锚点丢失(评论仍在)。
const { test, expect } = require('@playwright/test');
const { setup, goto, ready, mkThread, draft, dock, focusedCard, pin } = require('./_helpers');

const SENT = '这里有一段可以选中的正文文字，用来验证文本锚点的完整链路。';
const BOXES = [{ id: 't1', left: 40, top: 60, text: SENT }];
const QUOTE = '可以选中的正文文字';

// 选中 #t1 内的 QUOTE 并派发合成 click(真实交互里选区拖拽的 mouseup 自带 click;
// Playwright 的真实 click 会先 mousedown 把选区塌掉,所以走合成事件)
async function selectQuote(page) {
  await page.evaluate((q) => {
    const host = document.getElementById('t1');
    const textNode = host.firstChild;
    const i = textNode.nodeValue.indexOf(q);
    const r = document.createRange();
    r.setStart(textNode, i);
    r.setEnd(textNode, i + q.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    host.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, QUOTE);
}

test('评论模式选中文字 → 引文草稿 → 发布 POST 带 quote,渲染高亮条 + 行尾 pin', async ({ page }) => {
  let created = null;
  await setup(page, { boxes: BOXES, threads: [], onCreate: (b) => (created = b) });
  await goto(page);
  await ready(page);
  await dock(page).locator('[data-pp-act="comment"]').click(); // 进评论模式
  await selectQuote(page);
  // 草稿气泡带引文条与「Text anchor」脚标
  await expect(draft(page)).toBeVisible();
  await expect(draft(page).locator('.pp-anno-dbubble-quote')).toContainText(QUOTE);
  await expect(draft(page).locator('.pp-anno-dbubble-sel')).toContainText('Text anchor');
  await draft(page).locator('textarea').fill('这个说法要再确认一下');
  await draft(page).locator('[data-pp-role="send"]').click();
  // POST 携带 quote 与宿主 selector
  await expect.poll(() => created && created.quote).toBe(QUOTE);
  expect(created.selector).toContain('t1');
  // 命中行高亮条(窄盒内 quote 会折行 → ≥1 条) + pin 文本为作者缩写、挂在最后一条右侧行尾
  await expect(page.locator('.pp-anno-hlrect').first()).toBeVisible();
  await expect(pin(page, 1)).toBeVisible();
  const hl = await page.locator('.pp-anno-hlrect').last().boundingBox();
  const pb = await pin(page, 1).boundingBox();
  expect(pb.x).toBeGreaterThan(hl.x + hl.width - 2); // pin 在高亮条右侧
});

test('quote 线程:高亮条可点聚焦,popover 显示引文;原文改动 → 锚点丢失徽章', async ({ page }) => {
  const t = mkThread(1, '#t1', { quote: QUOTE });
  await setup(page, { boxes: BOXES, threads: [t] });
  await goto(page);
  await ready(page);
  await expect(page.locator('.pp-anno-hlrect').first()).toBeVisible();
  await page.locator('.pp-anno-hlrect').first().click({ position: { x: 4, y: 4 } }); // 点高亮条左端(行尾 pin 悬在右侧上方) = 聚焦
  await expect(focusedCard(page)).toBeVisible();
  await expect(focusedCard(page).locator('.pp-anno-pop-sel')).toContainText(QUOTE);
  // 原文被改(quote 检索不到)→ 高亮/pin 撤下;重新聚焦后卡带「锚点丢失」徽章,评论仍在
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.getElementById('t1').textContent = '整段文字被 agent 重写了'; });
  await expect(page.locator('.pp-anno-hlrect')).toHaveCount(0);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(0);
  await page.keyboard.press('j'); // 锚点丢失线程仍可从 j/k 聚焦
  await expect(focusedCard(page)).toBeVisible();
  await expect(focusedCard(page).locator('.pp-anno-badge-lost')).toBeVisible();
  await expect(focusedCard(page).locator('.pp-anno-txt')).toContainText('这是第 1 条评论的内容');
});

test('托盘头部:版本序数徽章 v3(不再显示 UUID);筛选钮无数字', async ({ page }) => {
  await setup(page, { boxes: BOXES, threads: [mkThread(1, '#t1')], versionN: 3 });
  await goto(page);
  await ready(page);
  await expect(page.locator('.pp-anno-tray-ver')).toHaveText('v3');
  await expect(page.locator('.pp-anno-tray-open')).toContainText('1');
  await expect(page.locator('[data-pp-filter="open"]')).toHaveText('Open');
  await expect(page.locator('[data-pp-filter="all"]')).toHaveText('All');
});
