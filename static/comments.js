/* pagepin 评论层 —— 由数据平面 serve HTML 时注入（见 serving.ts）。
 *
 * 约束：
 *  - 宿主页面不可控：所有类名带 pp-anno 前缀、UI 挂独立容器、用户内容一律 textContent 渲染；
 *  - 身份来自 /api/viewer（pp_view 会话）：401 = 匿名访客，静默退出不留痕迹；
 *  - 分享会话访客（guest）：/api/viewer 带 ?handle=&slug= 探测，返回 guest:true 进入访客模式 ——
 *    可建线程/回复/删自己的线程；resolve/reopen/kind 修改控件一律隐藏（服务端对 guest PATCH 401）；
 *    署名走请求体 author_name（localStorage 'pp-guest-name' 预填，留空由服务端落「访客」）；
 *  - 锚点 = CSS 选择器 + 元素内相对偏移；"@page" = 整页评论（无 pin，仅抽屉卡片）；
 *    选择器失效（页面改版）降级为抽屉里的「锚点丢失」卡片（不丢评论）。
 *
 * 交互模型（v3，右侧浮动抽屉 + 常驻 j/k + 发光相机）：
 *  - 右侧一根浮动抽屉是唯一全局 chrome：页面满宽渲染、零回流（抽屉 fixed 覆盖，不预留宽度）；
 *    前导 16px 羽化成透明，窄屏（≤1366）自动收起为右缘 tab，宽屏（≥1536）自动展开。
 *  - 读与改都在抽屉内的线程卡：聚焦卡就地展开（评论流 + 回复 + kind + 解决/重开/删除）。
 *  - 导航即「常驻 j/k + 发光相机」：聚焦元素套发光环并把视口滚到取景位；点 pin = 聚焦该卡。
 *  - C 进评论模式（十字光标）：点元素 / 在图片上拖框 = 打点，草稿落在抽屉里；
 *    r 解决并前进（Gmail archive-and-next）、\ 收起抽屉、Esc 退出。
 *  - #pp-comment-<id> 深链直达并聚焦；窗口聚焦 + 30s 轮询静默刷新。
 *
 * 移动端形态（Tideline：bottom sheet + AIM 打点）—— 桌面 v3 原样保留，移动是新增分支：
 *  - 激活条件（启动时一次判定，会话内不随 resize 切换形态）：
 *      (a) 主指针 coarse（触屏）且 screen 短边 ≤640px —— 手机竖/横屏都命中（用 screen 而非
 *          innerWidth：无 <meta viewport> 的宿主页在手机上 layout viewport 是 980px）；
 *          iPad(短边 ≥768) 不命中，仍走桌面抽屉；或
 *      (b) 视口宽 ≤520px（任意指针）—— 取代旧的 @media(max-width:520px) 满宽抽屉规则。
 *  - 唯一全局 chrome 是底部 sheet（[data-pp-role="sheet"]，data-pp-detent=peek|half|full 三档，
 *    整条 peek bar 可拖可点：Pointer Events 拖拽 + 松手就近吸附 detent；挂载后一次性 peek-bounce
 *    自我教学，prefers-reduced-motion 跳过）；右拇指角常驻「+ Note」FAB（[data-pp-role="fab"]）。
 *  - AIM 瞄准模式（移动端的 C/评论模式）：整页 SVG evenodd 挖洞压暗、可锚定元素点亮
 *    （[data-pp-role="aim-target"]）+ 底部指令条（[data-pp-role="aim-hint"]）；离目标的粗拇指点
 *    吸附到「最近锚点」（绝不静默落成 @page）。打完点即退出 AIM，草稿落在 sheet 里（HALF 档）。
 *  - 相机把锚点停在 sheet 上方的「实时空明区」——按目标 detent 的 sheet 顶边现算，不是固定视口比例。
 *  - 底部余量走文档根 scroll-padding-bottom（非布局属性，零回流）；绝不往宿主页注入任何节点。
 *  - 打点/图片框选统一迁到 Pointer Events（GROWTH-PLAN A4）：触屏也能在图片上拖拽框选区域。
 *
 * e2e 钩子：稳定的 data-pp-role / data-pp-* 属性（与展示/i18n 解耦），见各处标注。
 *   移动端新增：sheet / sheet-grab / sheet-meta / sheet-dots / fab / aim-dim / aim-target /
 *   aim-hint / aim-cancel / step-prev / step-next / step-pos；root 带 data-pp-form=tideline|drawer。
 */
(() => {
  'use strict';
  if (window.__ppAnnoLoaded) return;
  window.__ppAnnoLoaded = true;

  const script = document.currentScript;
  if (!script) return;
  const CFG = {
    handle: script.dataset.handle,
    slug: script.dataset.slug,
    path: script.dataset.path,
    version: script.dataset.version,
    lang: script.dataset.lang,
  };
  if (!CFG.handle || !CFG.slug || !CFG.path) return;

  /* ---------------- i18n（en 默认；data-lang 或 navigator.language 选 zh） ---------------- */
  const LANG = CFG.lang === 'zh' ? 'zh'
    : CFG.lang === 'en' ? 'en'
    : ((navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en');
  const MSG = {
    en: {
      'kind.copy': 'Copy',
      'kind.style': 'Style',
      'kind.question': 'Question',
      'kind.bug': 'Bug',
      'time.justNow': 'just now',
      'time.minAgo': '{n}m ago',
      'time.hoursAgo': '{n}h ago',
      'time.daysAgo': '{n}d ago',
      'brand.review': 'Review',
      'action.hideDrawer': 'Hide drawer (\\)',
      'action.notePage': 'Note on the whole page',
      'action.copyLink': 'Copy link',
      'action.resolveNext': 'Resolve & next (r)',
      'action.resolve': 'Resolve (r)',
      'action.delete': 'Delete',
      'action.deleteConfirm': 'Delete?',
      'meta.openTotal': '{open} open · {total} total',
      'meta.noComments': 'No comments yet',
      'filter.open': 'Open {open}',
      'filter.all': 'All',
      'btn.clickElement': 'Click an element…',
      'btn.comment': 'Comment',
      'moment.verTitle': '{v} published',
      'moment.verBody': 'the agent updated this page',
      'moment.verView': 'View update',
      'moment.fixTitle': 'Fixed',
      'moment.fixBody': '{who} handled the spot you flagged',
      'moment.fixToast': '{n} flagged spot(s) were fixed',
      'moment.doneTitle': 'Review round complete',
      'moment.doneStats': '{n} comments · all resolved',
      'moment.doneTime': 'first fix to zero in {t}',
      'moment.timeUnder': 'under a minute',
      'moment.timeMin': '{m} min',
      'hint.firstOpen': 'Click here, then click anything on the page',
      'btn.reopen': 'Reopen',
      'btn.reply': 'Reply',
      'btn.cancel': 'Cancel',
      'empty.noOpen': 'No open threads. Switch to All to see resolved ones.',
      'empty.none': 'No comments yet.\nClick Comment then an element — or drag on an image to box a region.',
      'hint.move': 'move',
      'hint.comment': 'comment',
      'hint.resolve': 'resolve',
      'hint.hide': 'hide',
      'hint.enterReply': 'Enter to reply',
      'hint.aim': 'Click an element to comment · drag on an image to box a region · Esc to exit',
      'hint.narrow': 'Narrow window — drawer tucked away so the page stays full-width',
      'aria.openDrawer': 'Open review drawer',
      'aria.openDrawerUnresolved': 'Open review drawer ({open} unresolved)',
      'aria.openDrawerResolved': 'Open review drawer (all resolved)',
      'banner.resolved': 'Resolved',
      'chip.done': 'done',
      'card.anchorLost': '⚠ Anchor lost — was on {selector}',
      'placeholder.addNote': 'Add a note…',
      'placeholder.reply': 'Reply…',
      'placeholder.pageNote': 'Say something about the whole page…',
      'placeholder.elementNote': 'What needs changing here?',
      'draft.newComment': 'New comment',
      'toast.resolved': 'Resolved',
      'toast.reopened': 'Reopened',
      'toast.failed': 'Failed',
      'toast.deleteFailed': 'Delete failed',
      'toast.unsent': 'Unsent comment — post it, or press Esc to discard',
      'toast.pageRecorded': 'Whole-page note recorded',
      'toast.linkCopied': 'Link copied',
      'toast.loadFailed': 'Failed to load comments: {error}',
      'badge.guest': 'guest',
      'placeholder.guestName': 'Your name (optional)',
      'fab.note': 'Note',
      'aim.tapTarget': 'Tap the part you want to comment on',
      'empty.noneMobile': 'No comments yet.\nTap "+ Note", then tap the part of the page you mean.',
      'aria.fab': 'Add a note',
      'aria.sheetHandle': 'Drag to resize the review sheet; tap to expand or collapse',
      'aria.prev': 'Previous comment',
      'aria.next': 'Next comment',
    },
    zh: {
      'kind.copy': '文案',
      'kind.style': '样式',
      'kind.question': '疑问',
      'kind.bug': '缺陷',
      'time.justNow': '刚刚',
      'time.minAgo': '{n} 分钟前',
      'time.hoursAgo': '{n} 小时前',
      'time.daysAgo': '{n} 天前',
      'brand.review': '评审',
      'action.hideDrawer': '隐藏抽屉 (\\)',
      'action.notePage': '对整个页面留言',
      'action.copyLink': '复制链接',
      'action.resolveNext': '解决并前进 (r)',
      'action.resolve': '解决 (r)',
      'action.delete': '删除',
      'action.deleteConfirm': '确认删除？',
      'meta.openTotal': '{open} 条未解决 · 共 {total} 条',
      'meta.noComments': '暂无评论',
      'filter.open': '未解决 {open}',
      'filter.all': '全部',
      'btn.clickElement': '点击一个元素…',
      'btn.comment': '评论',
      'moment.verTitle': '{v} 已发布',
      'moment.verBody': 'agent 更新了这个页面',
      'moment.verView': '查看更新',
      'moment.fixTitle': '已修复',
      'moment.fixBody': '{who} 处理了你标注的这处',
      'moment.fixToast': '{n} 处标注已被修复',
      'moment.doneTitle': '本轮评审完成',
      'moment.doneStats': '{n} 条评论 · 全部解决',
      'moment.doneTime': '从第一条解决到清零,用时 {t}',
      'moment.timeUnder': '不到 1 分钟',
      'moment.timeMin': '{m} 分钟',
      'hint.firstOpen': '点这里,再点页面上要改的地方',
      'btn.reopen': '重新打开',
      'btn.reply': '回复',
      'btn.cancel': '取消',
      'empty.noOpen': '没有未解决的线程。切换到「全部」查看已解决的。',
      'empty.none': '暂无评论。\n点「评论」再点一个元素 —— 或在图片上拖拽框选一块区域。',
      'hint.move': '移动',
      'hint.comment': '评论',
      'hint.resolve': '解决',
      'hint.hide': '隐藏',
      'hint.enterReply': '回车发送回复',
      'hint.aim': '点击一个元素来评论 · 在图片上拖拽框选区域 · 按 Esc 退出',
      'hint.narrow': '窗口较窄 —— 抽屉已收起，让页面保持满宽',
      'aria.openDrawer': '打开评审抽屉',
      'aria.openDrawerUnresolved': '打开评审抽屉（{open} 条未解决）',
      'aria.openDrawerResolved': '打开评审抽屉（全部已解决）',
      'banner.resolved': '已解决',
      'chip.done': '已解决',
      'card.anchorLost': '⚠ 锚点丢失 —— 原本位于 {selector}',
      'placeholder.addNote': '添加备注…',
      'placeholder.reply': '回复…',
      'placeholder.pageNote': '说点关于整个页面的想法…',
      'placeholder.elementNote': '这里需要改什么？',
      'draft.newComment': '新建评论',
      'toast.resolved': '已解决',
      'toast.reopened': '已重新打开',
      'toast.failed': '操作失败',
      'toast.deleteFailed': '删除失败',
      'toast.unsent': '评论未发送 —— 发送它，或按 Esc 放弃',
      'toast.pageRecorded': '整页留言已记录',
      'toast.linkCopied': '链接已复制',
      'toast.loadFailed': '加载评论失败：{error}',
      'badge.guest': '访客',
      'placeholder.guestName': '你的名字（可选）',
      'fab.note': '留言',
      'aim.tapTarget': '点一下你想评论的位置',
      'empty.noneMobile': '暂无评论。\n点「+ 留言」，再点页面上要评论的位置。',
      'aria.fab': '添加留言',
      'aria.sheetHandle': '拖动调整评审面板高度；点按展开或收起',
      'aria.prev': '上一条',
      'aria.next': '下一条',
    },
  };
  // 命名为 tr 而非 t：本文件大量用 t 作线程参数（threadCard(t,…)/copyThreadLink(t)/const t = byId 等），
  // 若译函数也叫 t 会被这些局部 t 遮蔽，调用时把线程对象当函数调 → 运行期崩。
  function tr(key, vars) {
    var s = (MSG[LANG] && MSG[LANG][key]) || MSG.en[key] || key;
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m; }) : s;
  }

  const PAGE_SELECTOR = '@page';
  // 四种 kind = 评审色彩地图（agent 从 JSON 读 kind 路由修复）
  const KIND = {
    copy: { label: tr('kind.copy'), color: '#2f6fb0', tint: '#e8f0f9', ink: '#1f4f86' },
    style: { label: tr('kind.style'), color: '#c07a16', tint: '#faf0db', ink: '#8a560b' },
    question: { label: tr('kind.question'), color: '#7c4bc0', tint: '#f0eafb', ink: '#5b3596' },
    bug: { label: tr('kind.bug'), color: '#c2361b', tint: '#fbe7e3', ink: '#94260f' },
  };
  const KIND_KEYS = ['copy', 'style', 'question', 'bug'];
  const NO_KIND = '#3a424b';
  const RESOLVED_COLOR = '#aeb4ba';
  const AVA = ['#2f6fb0', '#0f7c72', '#7c4bc0', '#c07a16', '#b14a42'];

  // 抽屉尺寸 + 宽度感知自动收起（占用宽度依赖：96px@1280 / 53px@1366 / 16px@1440[羽化吃掉] / 0@≥1536）。
  const DRAWER_W = 320;
  const NARROW_MAX = 1366;
  const WIDE_MIN = 1536;
  const widthBucket = (w) => (w <= NARROW_MAX ? 'narrow' : w >= WIDE_MIN ? 'wide' : 'mid');

  // ── 形态判定（Tideline vs 桌面抽屉）：启动时一次定死，会话内不随 resize 切换 ──
  // 见文件头「移动端形态」。用 screen 短边而非 innerWidth 判「手机」：宿主页若无
  // <meta viewport>，手机上 layout viewport 是 980px（innerWidth=980），但 screen.width
  // 仍是设备 CSS 宽（如 390）——按 innerWidth 判会把真手机误判成桌面。
  const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const MOBILE = (COARSE && Math.min(screen.width, screen.height) <= 640) || innerWidth <= 520;
  const REDUCE = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // sheet 三档 detent；peek 高度固定，half/full 按视口现算（resize/转屏时重取）
  const PEEK_H = 76;

  const state = {
    viewer: null,
    threads: [],
    filter: 'open', // open | all（抽屉与 pin：是否显示已解决）
    focusedId: null, // 当前在抽屉里展开的线程
    mode: 'rest', // rest | comment（十字光标打点模式）
    railOpen: true, // 抽屉是否展开
    draft: null, // { selector, rx, ry, box, kind, _cleanup } 新建草稿
    replyStash: new Map(), // threadId -> 未发送回复草稿
    autoHint: false, // 窄屏自动收起的一次性提示
    detent: 'peek', // Tideline：sheet 当前档位 peek | half | full
    sheetDragTop: null, // Tideline：拖拽中 sheet 顶边实时 y（松手吸附后清空）
  };

  // 收起态偏好持久化（全局共享：所有站点同一手动收起偏好；窄屏自动收起不写盘）
  const RAIL_KEY = 'pp-anno-rail';
  function loadRail() {
    // Tideline 无抽屉：railOpen 恒 true，让共享路径里的 `if (!state.railOpen) setRail(true)` 全部 no-op
    if (MOBILE) { state.railOpen = true; return; }
    let manual = null;
    try {
      const v = JSON.parse(localStorage.getItem(RAIL_KEY) || '{}');
      if (v && typeof v === 'object' && typeof v.open === 'boolean') manual = v.open;
    } catch (e) { /* localStorage 不可用：忽略 */ }
    // 手动偏好优先；无偏好时默认展开（评审者一进来就看到评论）。
    // 窄屏不在「初始」隐藏（1280–1366 是笔记本主力分辨率，初始藏掉=看不到评论）；
    // 只有用户「主动把窗口从更宽缩进窄屏」这个 crossing 才自动收起（见 onResizeWidth）。
    state.railOpen = manual != null ? manual : true;
    lastBucket = typeof window === 'undefined' ? 'wide' : widthBucket(window.innerWidth);
  }
  function persistRail() {
    try { localStorage.setItem(RAIL_KEY, JSON.stringify({ open: state.railOpen })); }
    catch (e) { /* 忽略 */ }
  }
  let lastBucket = 'wide';

  /* ---------------- 分享会话访客（guest） ----------------
   * /api/viewer 返回 guest:true 时进入：写操作放行（建线程/回复/删自己的），
   * resolve/reopen/kind 修改一律隐藏；署名不落账号，随写请求以 author_name 提交。 */
  const isGuest = () => !!(state.viewer && state.viewer.guest);
  const isGuestSub = (sub) => typeof sub === 'string' && sub.indexOf('guest:') === 0;
  const GUEST_NAME_KEY = 'pp-guest-name';
  function loadGuestName() {
    try { return localStorage.getItem(GUEST_NAME_KEY) || ''; } catch (e) { return ''; }
  }
  function saveGuestName(name) {
    try { if (name) localStorage.setItem(GUEST_NAME_KEY, name); else localStorage.removeItem(GUEST_NAME_KEY); }
    catch (e) { /* 忽略 */ }
  }

  /* ---------------- API（逐字保留） ---------------- */
  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { msg = (await res.json()).detail || msg; } catch (e) { /* not json */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  const base = `/api/comments/${encodeURIComponent(CFG.handle)}/${encodeURIComponent(CFG.slug)}`;
  const fetchThreads = () => api(`${base}?path=${encodeURIComponent(CFG.path)}`);
  const createThread = (body) => api(base, { method: 'POST', body: JSON.stringify(body) });
  const addReply = (id, body) => api(`/api/comments/threads/${id}/replies`, { method: 'POST', body: JSON.stringify(body) });
  const patchThread = (id, body) => api(`/api/comments/threads/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  const deleteThread = (id) => api(`/api/comments/threads/${id}`, { method: 'DELETE' });

  /* ---------------- 工具（保留） ---------------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(d, w) {
    const s = `<svg width="${w || 15}" height="${w || 15}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const span = document.createElement('span');
    span.className = 'pp-anno-ic';
    span.innerHTML = s;
    return span;
  }
  const ICON = {
    cmd: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 3-3z"/>',
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    arrowR: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checks: '<path d="m18 7-8 8-4-4M22 10l-7.5 7.5L13 16"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    reply: '<path d="M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v1"/>',
    undo: '<path d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    enter: '<path d="M9 10l-5 5 5 5M20 4v7a4 4 0 0 1-4 4H4"/>',
  };
  const avatarColor = (name) => AVA[[...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVA.length];
  const initialOf = (name) => (name || '?').trim().slice(0, 1).toUpperCase();
  function fmtTime(iso) {
    const d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return tr('time.justNow');
    if (diff < 3600) return tr('time.minAgo', { n: Math.floor(diff / 60) });
    if (diff < 86400) return tr('time.hoursAgo', { n: Math.floor(diff / 3600) });
    if (diff < 86400 * 14) return tr('time.daysAgo', { n: Math.floor(diff / 86400) });
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function cssPath(node) {
    if (node.id) return '#' + CSS.escape(node.id);
    const parts = [];
    while (node && node !== document.body && node.parentNode) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); return parts.join(' > '); }
      let part = node.tagName.toLowerCase();
      const sibs = [...node.parentNode.children].filter((c) => c.tagName === node.tagName);
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      parts.unshift(part);
      node = node.parentNode;
    }
    return parts.length ? 'body > ' + parts.join(' > ') : 'body'; // 直点 body:落合法选择器,而非悬尾的 'body > '
  }
  const anchorLabel = (sel) => (sel === PAGE_SELECTOR ? '@page' : sel.replace(/^#/, ''));
  // 线程当前 kind 的色（无 kind → 中性 slate；已解决 → 灰）
  const kindColor = (t) => (t.resolved ? RESOLVED_COLOR : (t.kind && KIND[t.kind] ? KIND[t.kind].color : NO_KIND));
  function toast(msg) {
    const t = el('div', 'pp-anno-toast', msg);
    t.dataset.ppAnno = '1';
    t.dataset.ppRole = 'toast';
    // Tideline：toast 停在 sheet 顶边上方（FULL 档 sheet 几乎满屏 → 保持默认位置，z 序在 sheet 之上）
    if (MOBILE && sheetEl && state.detent !== 'full') {
      t.style.bottom = (innerHeight - sheetTopNow() + 14) + 'px';
    }
    root.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  /* ---------------- 样式（抽屉模型） ---------------- */
  const STYLE = `
  .pp-anno-root{position:absolute;top:0;left:0;width:100%;height:0;font-family:'Hanken Grotesk',-apple-system,system-ui,sans-serif;font-size:14px;line-height:1.55;color:#11161b;transform:none;filter:none}
  .pp-anno-root *{box-sizing:border-box;margin:0;padding:0}
  .pp-anno-ic{display:inline-flex}.pp-anno-ic svg{display:block}
  .pp-anno-mode-on:not(.pp-anno-paused){cursor:crosshair}
  .pp-anno-mode-on:not(.pp-anno-paused) *:not(.pp-anno-root, .pp-anno-root *){cursor:crosshair!important}
  /* 评论/AIM 模式下触屏在图片上拖拽 = 框选而非滚页（Pointer Events 框选的触屏前提） */
  .pp-anno-mode-on:not(.pp-anno-paused) img{touch-action:none!important}
  .pp-anno-hover-hint{outline:2px solid #14958a!important;outline-offset:3px!important;
    box-shadow:0 0 0 6px rgba(61,175,164,.14),0 0 26px 2px rgba(61,175,164,.26)!important;
    border-radius:6px;transition:box-shadow .2s ease,outline-color .2s ease!important}
  .pp-anno-bound{outline:2px solid rgba(15,124,114,.85)!important;outline-offset:2px!important;box-shadow:0 0 0 5px rgba(15,124,114,.12)!important}
  /* ── pin（泪滴，kind 上色，白圈在任意宿主色上都清晰） ── */
  .pp-anno-layer{position:absolute;top:0;left:0;width:100%;height:0;z-index:2147482000;transform:none;filter:none}
  .pp-anno-pin{position:absolute;z-index:2147482600;width:28px;height:28px;border-radius:50% 50% 50% 4px;display:grid;place-items:center;color:#fff;font:700 12px/1 'Hanken Grotesk',sans-serif;cursor:pointer;transform:translate(-4px,-24px);border:2.5px solid #fff;box-shadow:0 3px 10px rgba(28,26,23,.3);user-select:none;transition:transform .15s,box-shadow .15s}
  .pp-anno-pin:hover{transform:translate(-4px,-24px) scale(1.12)}
  .pp-anno-pin.pp-anno-pulse{animation:ppPin .52s cubic-bezier(.2,1.7,.35,1)}
  @keyframes ppPin{0%{transform:translate(-4px,-24px) scale(0) rotate(-18deg)}
    55%{transform:translate(-4px,-24px) scale(1.22) rotate(4deg)}
    75%{transform:translate(-4px,-24px) scale(.94) rotate(-1deg)}
    100%{transform:translate(-4px,-24px) scale(1) rotate(0)}}
  .pp-anno-pin.pp-anno-pulse::after{content:'';position:absolute;inset:-3px;border-radius:inherit;
    border:2px solid rgba(20,149,138,.7);animation:ppPinRing .7s cubic-bezier(.2,.8,.3,1) .12s both;pointer-events:none}
  @keyframes ppPinRing{0%{transform:scale(.7);opacity:.9}100%{transform:scale(2.1);opacity:0}}
  .pp-anno-pin.pp-anno-resolved{filter:saturate(.4);box-shadow:0 2px 6px rgba(28,26,23,.2)}
  .pp-anno-pin.pp-anno-current{transform:translate(-4px,-24px) scale(1.16);z-index:2147482650;box-shadow:0 0 0 3px rgba(255,255,255,.9),0 3px 12px rgba(28,26,23,.4)}
  .pp-anno-pin.pp-anno-current:hover{transform:translate(-4px,-24px) scale(1.16)}
  .pp-anno-region{position:absolute;z-index:2147481900;border:2px solid;border-radius:5px;pointer-events:none;box-sizing:border-box}
  .pp-anno-region.pp-anno-resolved{opacity:.35;filter:saturate(.3)}
  .pp-anno-rubber{position:absolute;z-index:2147482700;border:2px dashed #0f7c72;background:rgba(15,124,114,.08);border-radius:5px;pointer-events:none;box-sizing:border-box}
  /* ── 发光相机：聚焦元素套发光环（不可交互） ── */
  .pp-anno-glow{position:absolute;z-index:2147481950;border-radius:8px;pointer-events:none;box-sizing:border-box;animation:ppBloom .6s cubic-bezier(.2,.8,.3,1) both}
  @keyframes ppBloom{0%{opacity:0;transform:scale(1.04)}40%{opacity:1}100%{opacity:.95;transform:scale(1)}}
  /* ── 右侧浮动抽屉（唯一全局 chrome；fixed 覆盖、绝不预留宽度=零回流；前导 16px 羽化透明） ── */
  .pp-anno-drawer{position:fixed;top:0;right:0;height:100%;width:${DRAWER_W}px;z-index:2147483000;display:flex;flex-direction:column;
    backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
    background:linear-gradient(to right,rgba(255,255,255,0) 0,rgba(255,255,255,.97) 16px);
    box-shadow:-10px 0 34px -20px rgba(17,22,27,.45);
    transition:transform .3s cubic-bezier(.2,.8,.3,1)}
  .pp-anno-drawer.pp-anno-closed{transform:translateX(${DRAWER_W}px)}
  .pp-anno-drawer *{font-family:'Hanken Grotesk',-apple-system,system-ui,sans-serif}
  .pp-anno-dwh{flex:none;border-bottom:1px solid #eef0f1;padding:11px 13px 9px 18px}
  .pp-anno-dwh-top{display:flex;align-items:center;justify-content:space-between}
  .pp-anno-brand{display:inline-flex;align-items:center;gap:7px;font:800 13px/1 'Hanken Grotesk',sans-serif;letter-spacing:-.01em;color:#11161b}
  .pp-anno-brand i{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;background:#11161b;color:#fff}
  .pp-anno-brand i svg{width:12px;height:12px}
  .pp-anno-dwh-collapse{border:none;background:transparent;cursor:pointer;color:#9aa1a9;width:24px;height:24px;border-radius:6px;display:grid;place-items:center}
  .pp-anno-dwh-collapse:hover{background:#f1f3f4;color:#11161b}
  .pp-anno-dwh-meta{display:flex;align-items:center;justify-content:space-between;margin-top:9px;gap:8px}
  .pp-anno-dwh-sub{font-size:11px;color:#8a929b}
  .pp-anno-seg{display:inline-flex;align-items:center;border:1px solid #e1e4e6;border-radius:7px;padding:2px;gap:2px}
  .pp-anno-seg button{border:none;background:transparent;cursor:pointer;font:600 10.5px/1 'Hanken Grotesk',sans-serif;color:#8a929b;padding:3px 8px;border-radius:5px}
  .pp-anno-seg button.pp-anno-on{background:#11161b;color:#fff}
  .pp-anno-dwh-acts{display:flex;gap:6px;margin-top:10px}
  .pp-anno-cbtn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:none;cursor:pointer;border-radius:8px;background:#0f7c72;color:#fff;font:600 12px/1 'Hanken Grotesk',sans-serif;padding:8px 10px}
  .pp-anno-cbtn:hover{background:#0b6358}
  .pp-anno-cbtn.pp-anno-on{background:#11161b}
  .pp-anno-wbtn{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px dashed #cdd3d9;cursor:pointer;border-radius:8px;background:#fff;color:#6b7480;font:600 12px/1 'Hanken Grotesk',sans-serif;padding:8px 11px}
  .pp-anno-wbtn:hover{border-color:#0f7c72;color:#0f7c72;background:#f3faf8}
  /* 列表自己滚动，但隐藏其滚动条 —— 避免与宿主页滚动条并排（注入面板不是文档，不再起第二条滚动条）。
     滚轮/触控板/拖动照常可滚；底部用 dwhint::before 渐隐提示还有内容。 */
  .pp-anno-dwlist{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:10px 10px 10px 18px;scrollbar-width:none;-ms-overflow-style:none;overscroll-behavior:contain}
  .pp-anno-dwlist::-webkit-scrollbar{width:0;height:0}
  .pp-anno-dwhint{position:relative;flex:none;border-top:1px solid #eef0f1;background:#f8f9fa;padding:7px 13px 7px 18px;display:flex;flex-wrap:wrap;gap:4px 9px;align-items:center}
  .pp-anno-dwhint::before{content:"";position:absolute;left:0;right:0;top:-22px;height:22px;pointer-events:none;background:linear-gradient(to bottom,rgba(255,255,255,0),rgba(255,255,255,.97))}
  .pp-anno-kpair{display:inline-flex;align-items:center;gap:4px;font:500 10px/1 'JetBrains Mono',monospace;color:#8a929b}
  .pp-anno-kpair kbd{font:700 9.5px/1 'JetBrains Mono',monospace;color:#3a424b;border:1px solid #dfe2e4;background:#fff;border-radius:4px;padding:2px 4px;box-shadow:0 1px 0 #e7e9eb}
  /* ── 线程卡 ── */
  .pp-anno-card{position:relative;margin-bottom:8px;border:1px solid #e7e9eb;border-radius:11px;background:#fff;overflow:hidden;cursor:pointer;box-shadow:0 1px 2px rgba(17,22,27,.04);transition:box-shadow .24s cubic-bezier(.2,.8,.3,1),border-color .2s,opacity .2s;animation:ppCard .2s cubic-bezier(.2,1.3,.4,1)}
  @keyframes ppCard{from{opacity:0;transform:translateY(6px) scale(.98)}}
  .pp-anno-card:hover{border-color:#d7dadd}
  .pp-anno-card.pp-anno-focused{cursor:default;border-color:#d7dadd;box-shadow:0 2px 8px rgba(17,22,27,.06),0 14px 30px -12px rgba(17,22,27,.14)}
  .pp-anno-card.pp-anno-dim{opacity:.66}
  .pp-anno-card-rail{position:absolute;top:0;bottom:0;left:0;width:3px}
  .pp-anno-card-bd{padding:9px 10px 9px 12px}
  .pp-anno-card-hd{display:flex;align-items:center;gap:8px}
  .pp-anno-num{flex:none;width:20px;height:20px;border-radius:50% 50% 50% 3px;display:grid;place-items:center;color:#fff;font:700 10.5px/1 'Hanken Grotesk',sans-serif}
  .pp-anno-ava{flex:none;border-radius:50%;display:grid;place-items:center;color:#fff;font:700 11px/1 'Hanken Grotesk',sans-serif}
  .pp-anno-who{font-size:12.5px;font-weight:600;color:#11161b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}
  .pp-anno-when{font-size:10.5px;color:#b3b9bf;font-weight:400}
  .pp-anno-anchor{font:600 10px/1 'JetBrains Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}
  .pp-anno-stalebadge{font:600 10px/1 'Hanken Grotesk',sans-serif;color:#b08423}
  .pp-anno-card-acts{margin-left:auto;display:flex;align-items:center;gap:2px;flex:none}
  .pp-anno-iconbtn{border:none;background:none;cursor:pointer;color:#9aa1a9;padding:5px;border-radius:6px;display:inline-flex}
  .pp-anno-iconbtn:hover{background:#f1f3f4;color:#0f7c72}
  .pp-anno-resolvebtn{border:1px solid #e1e4e6;background:#fff;cursor:pointer;color:#9aa1a9;width:24px;height:24px;border-radius:7px;display:grid;place-items:center}
  .pp-anno-resolvebtn:hover{border-color:#0f7c72;color:#0f7c72}
  .pp-anno-donechip{flex:none;display:inline-flex;align-items:center;gap:4px;font:700 9.5px/1 'Hanken Grotesk',sans-serif;text-transform:uppercase;letter-spacing:.04em;color:#8a929b;background:#eef0f1;border-radius:999px;padding:3px 7px}
  .pp-anno-snippet{margin-top:6px;font-size:12px;line-height:1.45;color:#5c636b;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
  .pp-anno-card-ft{margin-top:7px;display:flex;align-items:center;gap:9px;font-size:10.5px;color:#b3b9bf}
  .pp-anno-kindlab{display:inline-flex;align-items:center;gap:4px;font-weight:600}
  .pp-anno-kindlab i{width:6px;height:6px;border-radius:50%;display:inline-block}
  /* 聚焦卡展开区 */
  .pp-anno-resolved-banner{display:flex;align-items:center;gap:6px;background:#f4f6f7;padding:6px 11px;font:700 10px/1 'Hanken Grotesk',sans-serif;text-transform:uppercase;letter-spacing:.05em;color:#8a929b}
  .pp-anno-msgs{margin-top:9px;display:flex;flex-direction:column;gap:9px}
  .pp-anno-msg{display:flex;gap:8px}
  .pp-anno-msg>div:last-child{flex:1;min-width:0}
  .pp-anno-msg-line{display:flex;align-items:center;gap:6px}
  .pp-anno-txt{font-size:12.5px;line-height:1.5;margin-top:2px;color:#34302b;word-break:break-word;white-space:pre-wrap}
  .pp-anno-chips{display:flex;gap:5px;margin-top:9px;flex-wrap:wrap}
  .pp-anno-chip2{display:inline-flex;align-items:center;gap:5px;font:600 10.5px/1 'Hanken Grotesk',sans-serif;padding:4px 8px;border-radius:999px;border:1px solid #e1e4e6;background:#fff;color:#8a929b;cursor:pointer;white-space:nowrap}
  .pp-anno-chip2 i{width:6px;height:6px;border-radius:50%;display:inline-block}
  .pp-anno-chip2.pp-anno-on{color:#fff;border-color:transparent}
  .pp-anno-chip2.pp-anno-on i{background:#fff!important}
  .pp-anno-replyarea{margin-top:9px}
  .pp-anno-replybtn{width:100%;display:flex;align-items:center;gap:7px;border:1px dashed #e1e4e6;background:#fff;cursor:pointer;border-radius:8px;padding:8px 10px;font:500 12px/1 'Hanken Grotesk',sans-serif;color:#9aa1a9}
  .pp-anno-replybtn:hover{border-color:#0f7c72;color:#0f7c72}
  .pp-anno-replybtn kbd{margin-left:auto;font:700 9px/1 'JetBrains Mono',monospace;color:#9aa1a9;border:1px solid #e1e4e6;background:#fff;border-radius:4px;padding:1px 4px}
  .pp-anno-ta-wrap{border:1.5px solid #cdd3d9;border-radius:9px;background:#fafbfb;padding:6px;transition:border-color .15s}
  .pp-anno-ta-wrap:focus-within{border-color:#0f7c72;background:#fff}
  .pp-anno-ta-wrap textarea{width:100%;border:none;background:transparent;resize:none;font:400 12.5px/1.5 'Hanken Grotesk',sans-serif;color:#11161b;outline:none}
  .pp-anno-nameinput{width:100%;border:none;border-bottom:1px dashed #e1e4e6;background:transparent;font:600 11.5px/1.4 'Hanken Grotesk',sans-serif;color:#11161b;outline:none;padding:2px 2px 5px;margin-bottom:5px}
  .pp-anno-nameinput::placeholder{color:#b3b9bf;font-weight:400}
  .pp-anno-guestbadge{flex:none;font:600 9px/1 'Hanken Grotesk',sans-serif;text-transform:uppercase;letter-spacing:.04em;color:#9aa1a9;border:1px solid #e1e4e6;border-radius:4px;padding:1.5px 4px}
  .pp-anno-ta-row{display:flex;align-items:center;gap:8px;margin-top:6px}
  .pp-anno-hint{font-size:10.5px;color:#b3b9bf}
  .pp-anno-send{margin-left:auto;background:#0f7c72;color:#fff;border:none;padding:6px 12px;border-radius:7px;font:600 11.5px/1 'Hanken Grotesk',sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
  .pp-anno-send:hover{background:#0b6358}.pp-anno-send:disabled{opacity:.4;cursor:default}
  .pp-anno-ghost{background:#fff;border:1px solid #e1e4e6;color:#8a929b;padding:6px 11px;border-radius:7px;font:600 11.5px/1 'Hanken Grotesk',sans-serif;cursor:pointer}
  .pp-anno-ghost:hover{border-color:#0f7c72;color:#0f7c72}
  .pp-anno-del{color:#b14a42!important}
  .pp-anno-del.pp-anno-armed{color:#fff!important;background:#c2361b!important;padding:5px 8px!important}
  /* 草稿卡 */
  .pp-anno-draft{border:2px solid #0f7c72;box-shadow:0 14px 30px -12px rgba(17,22,27,.18)}
  .pp-anno-draft.pp-anno-shaking{animation:ppShake .3s}
  @keyframes ppShake{0%,100%{margin-left:0}25%{margin-left:-7px}75%{margin-left:7px}}
  .pp-anno-seltag{margin-left:auto;font:600 10px/1 'JetBrains Mono',monospace;color:#8a929b;background:#f1f3f4;border-radius:6px;padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}
  /* 空态 */
  .pp-anno-empty{text-align:center;color:#9aa1a9;font-size:12px;padding:30px 18px;line-height:1.7}
  /* ── 收起 tab（抽屉第 2 形态：右缘竖条） ── */
  .pp-anno-tab{position:fixed;top:50%;right:0;transform:translateY(-50%);z-index:2147483000;display:flex;align-items:center;gap:6px;border:1px solid #e1e4e6;border-right:none;background:#fff;color:#3a424b;cursor:pointer;padding:13px 8px;border-radius:11px 0 0 11px;box-shadow:-6px 0 20px -12px rgba(17,22,27,.4);font:700 11px/1 'Hanken Grotesk',sans-serif;writing-mode:vertical-rl;animation:ppTabIn .2s cubic-bezier(.2,1.3,.4,1)}
  .pp-anno-tab:hover{transform:translateY(-50%) translateX(-2px)}
  .pp-anno-tab:focus-visible{outline:2px solid #0f7c72;outline-offset:2px}
  .pp-anno-tab .pp-anno-ic{transform:rotate(90deg)}
  .pp-anno-tab .pp-anno-tabdot{writing-mode:horizontal-tb;background:#14958a;color:#fff;border-radius:999px;min-width:16px;height:16px;font:700 9.5px/16px 'JetBrains Mono',monospace;text-align:center;padding:0 4px}
  @keyframes ppTabIn{from{opacity:0;transform:translateY(-50%) translateX(10px)}}
  /* ── toast ── */
  .pp-anno-toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:2147483100;background:#15191c;color:#f3efe7;font-size:12.5px;font-weight:500;padding:9px 16px;border-radius:9px;box-shadow:0 10px 28px -8px rgba(15,124,114,.6);animation:ppPop .2s;display:inline-flex;align-items:center;gap:7px}
  .pp-anno-toast .pp-anno-ic{color:#7fe3d6}
  @keyframes ppPop{from{opacity:0;transform:translateX(-50%) translateY(6px)}}
  .pp-anno-aimhint{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:2147483100;background:rgba(17,22,27,.92);color:#fff;font:500 12px/1 'Hanken Grotesk',sans-serif;padding:9px 14px;border-radius:9px;box-shadow:0 10px 28px -10px rgba(17,22,27,.5);animation:ppPop .2s}
  /* ── Tideline（移动端 bottom sheet 形态；激活条件见文件头，≤520px 的旧满宽抽屉规则已被本形态取代） ── */
  .pp-anno-sheet{position:fixed;left:0;right:0;z-index:2147483000;display:flex;flex-direction:column;
    background:rgba(255,255,255,.97);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
    border-top:1px solid #e1e4e6;border-radius:18px 18px 0 0;
    box-shadow:0 -10px 34px -16px rgba(17,22,27,.4);
    transition:top .28s cubic-bezier(.2,.8,.3,1),height .28s cubic-bezier(.2,.8,.3,1)}
  .pp-anno-sheet *{font-family:'Hanken Grotesk',-apple-system,system-ui,sans-serif}
  .pp-anno-sheet.pp-anno-dragging{transition:none}
  .pp-anno-sheet.pp-anno-nudge{animation:ppNudge .7s cubic-bezier(.2,.8,.3,1) 1}
  @keyframes ppNudge{0%,100%{transform:none}45%{transform:translateY(-12px)}}
  .pp-anno-grab{flex:none;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab}
  .pp-anno-grab:active{cursor:grabbing}
  .pp-anno-grab:focus-visible{outline:2px solid #0f7c72;outline-offset:-2px;border-radius:18px 18px 0 0}
  .pp-anno-grabpill{margin:8px auto 0;width:38px;height:5px;border-radius:999px;background:#cfd4d8}
  .pp-anno-grabrow{display:flex;align-items:center;gap:10px;padding:6px 12px 10px 14px;min-height:48px}
  .pp-anno-grabchev{flex:none;color:#9aa1a9;display:inline-flex;transition:transform .2s}
  .pp-anno-sheet[data-pp-detent="half"] .pp-anno-grabchev,.pp-anno-sheet[data-pp-detent="full"] .pp-anno-grabchev{transform:rotate(180deg)}
  .pp-anno-sheetmeta{flex:1;min-width:0}
  .pp-anno-sheetmeta-line{font:700 13px/1.2 'Hanken Grotesk',sans-serif;color:#11161b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pp-anno-dots{display:flex;gap:4px;margin-top:5px;overflow:hidden}
  .pp-anno-dots i{flex:none;width:7px;height:7px;border-radius:50%;display:inline-block}
  .pp-anno-fab{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:10px 15px;border:none;cursor:pointer;border-radius:12px;background:#0f7c72;color:#fff;font:700 13px/1 'Hanken Grotesk',sans-serif;box-shadow:0 6px 18px -6px rgba(15,124,114,.55)}
  .pp-anno-fab:active{transform:scale(.96)}
  .pp-anno-sheetlist{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:2px 12px 14px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:none;-ms-overflow-style:none}
  .pp-anno-sheetlist::-webkit-scrollbar{width:0;height:0}
  .pp-anno-sheetbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.95);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:4px 2px 8px;margin-bottom:6px}
  /* AIM 瞄准模式：整页压暗（SVG evenodd 挖洞=点亮可锚定元素）+ 点亮框 + 底部指令条 */
  .pp-anno-aimdim{position:absolute;left:0;top:0;z-index:2147482300;pointer-events:none}
  .pp-anno-aimbox{position:absolute;z-index:2147482400;pointer-events:none;border:1.5px dashed #14958a;border-radius:8px;background:rgba(20,149,138,.08);box-sizing:border-box}
  .pp-anno-aimchip{position:fixed;left:50%;transform:translateX(-50%);z-index:2147482950;display:flex;align-items:center;gap:8px;background:rgba(17,22,27,.95);color:#fff;border-radius:12px;padding:8px 8px 8px 14px;font:600 12.5px/1.35 'Hanken Grotesk',sans-serif;box-shadow:0 12px 30px -10px rgba(17,22,27,.6);animation:ppPop .2s;max-width:calc(100vw - 24px)}
  .pp-anno-aimchip button{flex:none;border:none;cursor:pointer;border-radius:9px;background:rgba(255,255,255,.16);color:#fff;font:700 11.5px/1 'Hanken Grotesk',sans-serif;padding:0 12px;min-height:40px}
  .pp-anno-aim .pp-anno-pin,.pp-anno-aim .pp-anno-region,.pp-anno-aim .pp-anno-glow{display:none}
  /* 移动端触控目标放大（≥40px）+ iOS 聚焦输入不自动缩放（字号 ≥16px） */
  .pp-anno-mobile .pp-anno-pin::after{content:"";position:absolute;left:-8px;top:-8px;right:-8px;bottom:-8px;border-radius:50%}
  .pp-anno-mobile .pp-anno-card-bd{padding:11px 12px 11px 14px}
  .pp-anno-mobile .pp-anno-resolvebtn{width:40px;height:40px;border-radius:10px}
  .pp-anno-mobile .pp-anno-iconbtn{width:40px;height:40px;padding:0;display:grid;place-items:center}
  .pp-anno-mobile .pp-anno-del.pp-anno-armed{width:auto}
  .pp-anno-mobile .pp-anno-chip2{padding:9px 12px;font-size:11.5px}
  .pp-anno-mobile .pp-anno-send{min-height:40px;padding:0 16px;font-size:12.5px}
  .pp-anno-mobile .pp-anno-ghost{min-height:40px;padding:0 14px;font-size:12.5px}
  .pp-anno-mobile .pp-anno-replybtn{padding:11px 12px}
  .pp-anno-mobile .pp-anno-ta-wrap textarea{font-size:16px}
  .pp-anno-mobile .pp-anno-nameinput{font-size:16px}
  .pp-anno-mobile .pp-anno-seg button{min-height:40px;padding:0 14px;font-size:11px}
  .pp-anno-mobile .pp-anno-wbtn{min-height:40px}
  .pp-anno-steprow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;border-top:1px solid #eef0f1;padding-top:8px}
  .pp-anno-stepbtn{width:44px;height:40px;display:grid;place-items:center;border:1px solid #e1e4e6;background:#fff;color:#5c636b;border-radius:10px;cursor:pointer}
  .pp-anno-stepbtn:active{background:#f1f3f4}
  .pp-anno-steppos{font:600 11.5px/1 'JetBrains Mono',monospace;color:#8a929b}
  /* ── 评论模式晕影(真实节点,避免与宿主页 html::after 冲突) ── */
  .pp-anno-vignette{position:fixed;inset:0;pointer-events:none;z-index:2147481700;
    box-shadow:inset 0 0 170px 24px rgba(11,99,88,.09);animation:ppVig .7s cubic-bezier(.2,.8,.3,1) both}
  @keyframes ppVig{from{opacity:0}to{opacity:1}}
  /* ── 循环时刻(克制档):新版本横幅 / 修复回执 / 收敛回执 ── */
  .pp-anno-mtbanner{position:fixed;top:14px;left:50%;z-index:2147483200;display:flex;align-items:center;gap:10px;
    padding:9px 10px 9px 14px;border-radius:999px;background:rgba(255,255,255,.96);border:1px solid #bfe5df;
    box-shadow:0 8px 30px -8px rgba(11,99,88,.35),0 1px 3px rgba(17,22,27,.08);
    font-family:'Hanken Grotesk',-apple-system,system-ui,sans-serif;
    transform:translate(-50%,-64px);opacity:0;transition:transform .42s cubic-bezier(.2,1.4,.4,1),opacity .3s ease}
  .pp-anno-mtbanner.pp-anno-min{transform:translate(-50%,0);opacity:1}
  .pp-anno-mtbanner .pp-anno-mdot{position:relative;width:9px;height:9px;border-radius:50%;background:#0f7c72;flex:none}
  .pp-anno-mtbanner .pp-anno-mdot::after{content:'';position:absolute;inset:-4px;border-radius:50%;
    border:2px solid #14958a;opacity:0;animation:ppMPing 2.2s cubic-bezier(.2,.8,.3,1) 1}
  @keyframes ppMPing{0%{transform:scale(.5);opacity:.9}80%{transform:scale(1.5);opacity:0}100%{opacity:0}}
  .pp-anno-mtbanner b{font-size:13px;font-weight:700;color:#11161b}
  .pp-anno-mtbanner span{font-size:12.5px;color:#57606a}
  .pp-anno-mtbanner button{border:none;cursor:pointer;font:700 12px/1 inherit;border-radius:999px;padding:7px 12px}
  .pp-anno-mtbanner .pp-anno-mview{background:#0f7c72;color:#fff}
  .pp-anno-mtbanner .pp-anno-mview:hover{background:#0b6358}
  .pp-anno-mtbanner .pp-anno-mx{background:transparent;color:#9aa1a9;padding:7px 8px}
  .pp-anno-mreceipt{position:absolute;z-index:2147482800;display:flex;align-items:flex-start;gap:9px;max-width:250px;
    padding:10px 13px;border-radius:12px;background:rgba(255,255,255,.97);border:1px solid #bfe5df;
    box-shadow:0 10px 32px -10px rgba(11,99,88,.4);font-family:'Hanken Grotesk',-apple-system,system-ui,sans-serif;
    transform:translateY(6px) scale(.96);opacity:0;transition:transform .38s cubic-bezier(.2,1.4,.4,1),opacity .28s ease}
  .pp-anno-mreceipt.pp-anno-min{transform:none;opacity:1}
  .pp-anno-mreceipt.pp-anno-mout{transform:translateY(-4px);opacity:0}
  .pp-anno-mreceipt i{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;flex:none;background:#0f7c72;color:#fff}
  .pp-anno-mreceipt i svg{width:12px;height:12px}
  .pp-anno-mreceipt b{display:block;font-size:12.5px;font-weight:700;color:#11161b;line-height:1.35}
  .pp-anno-mreceipt span{display:block;font-size:11.5px;color:#57606a;margin-top:2px;line-height:1.4}
  .pp-anno-mreceipt em{font-style:normal;color:#0b6358;font-weight:600}
  .pp-anno-mripple{position:absolute;z-index:2147482550;pointer-events:none;width:28px;height:28px;transform:translate(-4px,-24px)}
  .pp-anno-mripple i{position:absolute;inset:0;border-radius:50%;border:2px solid #14958a;opacity:0;
    animation:ppMRing 1s cubic-bezier(.2,.8,.3,1) forwards}
  .pp-anno-mripple i:nth-child(2){animation-delay:.22s;border-color:#8fd3ca}
  @keyframes ppMRing{0%{transform:scale(.6);opacity:.85}100%{transform:scale(2.4);opacity:0}}
  .pp-anno-card.pp-anno-stamping{transform:scale(.98);opacity:.4;transition:transform .3s ease,opacity .3s ease}
  .pp-anno-mstamp{position:absolute;z-index:5;top:50%;left:50%;display:grid;place-items:center;width:44px;height:44px;
    border-radius:50%;background:#0f7c72;color:#fff;box-shadow:0 6px 20px -4px rgba(11,99,88,.55);
    transform:translate(-50%,-50%) scale(0) rotate(-14deg);animation:ppMStamp .34s cubic-bezier(.2,1.4,.4,1) forwards}
  .pp-anno-mstamp svg{width:22px;height:22px}
  @keyframes ppMStamp{60%{transform:translate(-50%,-50%) scale(1.12) rotate(3deg)}100%{transform:translate(-50%,-50%) scale(1) rotate(0)}}
  .pp-anno-mfinale{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;
    padding:26px 18px 22px;border:1px solid #bfe5df;border-radius:14px;margin:14px 4px;
    background:linear-gradient(180deg,#fff 0%,rgba(230,244,242,.4) 100%);overflow:hidden;
    font-family:'Hanken Grotesk',-apple-system,system-ui,sans-serif}
  .pp-anno-mfinale .pp-anno-mfc{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;
    background:#0f7c72;color:#fff;transform:scale(0);animation:ppMStamp .4s cubic-bezier(.2,1.4,.4,1) .1s forwards}
  .pp-anno-mfinale .pp-anno-mfc svg{width:22px;height:22px}
  .pp-anno-mfinale b{font-size:14.5px;font-weight:800;color:#11161b;margin-top:12px;letter-spacing:-.01em}
  .pp-anno-mfinale span{font-size:12px;color:#57606a;margin-top:5px;line-height:1.6}
  .pp-anno-mfinale em{font-style:normal;font-weight:700;color:#0b6358}
  /* ── guest 首访一次性提示 ── */
  .pp-anno-firsthint{position:fixed;z-index:2147483100;max-width:230px;padding:9px 12px;border-radius:11px;
    background:#11161b;color:#fff;font:600 12px/1.5 'Hanken Grotesk',-apple-system,system-ui,sans-serif;
    box-shadow:0 10px 30px -8px rgba(17,22,27,.5);
    transform:translateY(4px);opacity:0;transition:transform .3s cubic-bezier(.2,1.3,.4,1),opacity .2s ease}
  .pp-anno-firsthint.pp-anno-min{transform:none;opacity:1}
  .pp-anno-firsthint::after{content:'';position:absolute;top:-5px;right:26px;width:10px;height:10px;
    background:#11161b;transform:rotate(45deg)}
  /* ── 新增件的静态降级 ── */
  @media (prefers-reduced-motion:reduce){
    .pp-anno-mtbanner,.pp-anno-mreceipt,.pp-anno-firsthint{transition:none;transform:none;opacity:1}
    .pp-anno-mreceipt.pp-anno-mout{opacity:0}
    .pp-anno-mtbanner{transform:translate(-50%,0)}
    .pp-anno-mripple,.pp-anno-pin.pp-anno-pulse::after{display:none}
    .pp-anno-mstamp,.pp-anno-mfinale .pp-anno-mfc{animation:none;transform:translate(-50%,-50%) scale(1)}
    .pp-anno-mfinale .pp-anno-mfc{transform:scale(1)}
    .pp-anno-vignette{animation:none;opacity:1}
  }
  @media (prefers-reduced-motion:reduce){.pp-anno-root *,.pp-anno-drawer,.pp-anno-drawer *{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
  @media print{.pp-anno-root,.pp-anno-drawer,.pp-anno-tab,.pp-anno-sheet{display:none!important}}
  `;

  /* ---------------- UI 骨架 ---------------- */
  let root, layer, drawer, listEl, tabEl;
  let sheetEl, grabEl, sheetListEl; // Tideline
  // 面板容器：桌面=抽屉，移动=sheet（草稿/回复的 querySelector 统一走这里）
  const panel = () => (MOBILE ? sheetEl : drawer);

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    root = el('div', 'pp-anno-root' + (MOBILE ? ' pp-anno-mobile' : ''));
    root.dataset.ppAnno = '1';
    root.dataset.ppReady = '1'; // e2e「层就绪」门
    root.dataset.ppForm = MOBILE ? 'tideline' : 'drawer'; // e2e：当前形态
    layer = el('div', 'pp-anno-layer');

    if (MOBILE) {
      buildSheet();
      root.append(layer, sheetEl);
      document.body.appendChild(root);
      renderSheet();
      return;
    }

    drawer = el('aside', 'pp-anno-drawer');
    drawer.dataset.ppAnno = '1';
    drawer.dataset.ppRole = 'drawer';
    if (!state.railOpen) drawer.classList.add('pp-anno-closed');

    tabEl = el('button', 'pp-anno-tab');
    tabEl.dataset.ppAnno = '1';
    tabEl.dataset.ppRole = 'tab';
    tabEl.setAttribute('aria-label', tr('aria.openDrawer'));
    tabEl.onclick = () => setRail(true);
    tabEl.style.display = state.railOpen ? 'none' : '';

    root.append(layer, drawer, tabEl);
    document.body.appendChild(root);
    renderDrawer();
  }

  /* ---------------- Tideline：bottom sheet（detent 档位 + Pointer Events 拖拽） ---------------- */
  function detentHeights() {
    const vh = innerHeight;
    return { peek: PEEK_H, half: Math.round(vh * 0.56), full: Math.round(vh * 0.92) };
  }
  const sheetTopFor = (d) => Math.max(0, innerHeight - detentHeights()[d]);
  const sheetTopNow = () => (state.sheetDragTop != null ? state.sheetDragTop : sheetTopFor(state.detent));
  function applyDetent() {
    if (!sheetEl) return;
    const top = sheetTopNow();
    // 高度 = 视口内可见段（不是恒 FULL）：HALF 档列表的 clientHeight 才等于可见区，
    // 内容全部可滚进视野（恒 FULL 会让列表尾段永远卡在视口下缘外）。
    sheetEl.style.top = top + 'px';
    sheetEl.style.height = (innerHeight - top) + 'px';
    sheetEl.dataset.ppDetent = state.detent;
    sheetEl.classList.toggle('pp-anno-dragging', state.sheetDragTop != null);
  }
  function setDetent(d) {
    state.detent = d;
    state.sheetDragTop = null;
    applyDetent();
  }

  function buildSheet() {
    sheetEl = el('section', 'pp-anno-sheet');
    sheetEl.dataset.ppAnno = '1';
    sheetEl.dataset.ppRole = 'sheet';
    sheetEl.setAttribute('aria-label', tr('brand.review'));

    grabEl = el('div', 'pp-anno-grab');
    grabEl.dataset.ppRole = 'sheet-grab';
    grabEl.setAttribute('role', 'button');
    grabEl.setAttribute('aria-label', tr('aria.sheetHandle'));
    grabEl.tabIndex = 0;
    // 整条 peek bar 可拖：Pointer Events + 松手就近吸附；轻点（位移 <4px）= peek ↔ half 切换
    let sheetDrag = null;
    grabEl.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      if (e.target.closest('button')) return; // FAB 等按钮自己处理
      sheetDrag = { id: e.pointerId, startY: e.clientY, baseTop: sheetTopNow(), moved: false };
      try { grabEl.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });
    grabEl.addEventListener('pointermove', (e) => {
      if (!sheetDrag || e.pointerId !== sheetDrag.id) return;
      const dy = e.clientY - sheetDrag.startY;
      if (!sheetDrag.moved && Math.abs(dy) < 4) return;
      sheetDrag.moved = true;
      const hs = detentHeights();
      state.sheetDragTop = Math.min(innerHeight - hs.peek, Math.max(innerHeight - hs.full, sheetDrag.baseTop + dy));
      applyDetent();
    });
    const endSheetDrag = (e) => {
      if (!sheetDrag || e.pointerId !== sheetDrag.id) return;
      try { grabEl.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      const moved = sheetDrag.moved;
      sheetDrag = null;
      if (!moved) { // 轻点整条 bar（不是 5px 小把手）也能开合
        state.sheetDragTop = null;
        setDetent(state.detent === 'peek' ? 'half' : 'peek');
        return;
      }
      const top = state.sheetDragTop != null ? state.sheetDragTop : sheetTopFor(state.detent);
      let best = 'peek', bd = Infinity;
      for (const d of ['peek', 'half', 'full']) {
        const dd = Math.abs(sheetTopFor(d) - top);
        if (dd < bd) { bd = dd; best = d; }
      }
      setDetent(best);
    };
    grabEl.addEventListener('pointerup', endSheetDrag);
    grabEl.addEventListener('pointercancel', endSheetDrag);
    grabEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetent(state.detent === 'peek' ? 'half' : 'peek'); }
    });

    sheetListEl = el('div', 'pp-anno-sheetlist');
    sheetListEl.dataset.ppRole = 'list';
    listEl = sheetListEl; // scrollFocusedCardIntoView 共用
    sheetEl.append(grabEl, sheetListEl);
    applyDetent();
  }

  // Tideline 相机：把锚点停在 sheet 上方的「实时空明区」（按目标 detent 的 sheet 顶边现算）
  function flyToEl(node, detent) {
    if (!node) return;
    const clear = Math.max(120, innerHeight - detentHeights()[detent || state.detent]);
    const r = node.getBoundingClientRect();
    const elTop = r.top + scrollY;
    // 短元素停在空明区 ~45% 处；比空明区还高的元素让顶部贴近上缘（起始处总可见）
    const target = r.height > clear ? elTop - clear * 0.12 : elTop + r.height / 2 - clear * 0.45;
    scrollTo({ top: Math.max(0, target), behavior: REDUCE() ? 'auto' : 'smooth' });
  }

  /* ---------------- 锚点解析（逐字保留） ---------------- */
  const isPage = (t) => t.selector === PAGE_SELECTOR;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const fingerprint = (node) => norm(node.textContent).slice(0, 80);
  function pointVisible(node, cx, cy) {
    let n = node.parentElement;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if (/(auto|scroll|hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY)) {
        const r = n.getBoundingClientRect();
        if (cx < r.left - 1 || cx > r.right + 1 || cy < r.top - 1 || cy > r.bottom + 1) return false;
      }
      n = n.parentElement;
    }
    return true;
  }
  function resolveAnchor(t) {
    if (isPage(t)) return { status: 'page', el: null, pos: null };
    let node = null;
    try { node = document.querySelector(t.selector); } catch (e) { /* 非法选择器 */ }
    if (!node) return { status: 'lost', el: null, pos: null };
    if (t.anchor_text && fingerprint(node) !== t.anchor_text) return { status: 'changed', el: node, pos: null };
    const r = node.getBoundingClientRect();
    const vx = r.left + r.width * t.rx, vy = r.top + r.height * t.ry;
    const pos = { x: vx + scrollX, y: vy + scrollY };
    if (!pointVisible(node, vx, vy)) return { status: 'clipped', el: node, pos };
    return { status: 'ok', el: node, pos };
  }
  const anchorXY = (t) => { const a = resolveAnchor(t); return a.status === 'ok' || a.status === 'clipped' ? a.pos : null; };
  const visibleThreads = () => state.threads.filter((t) => state.filter === 'all' || !t.resolved);
  const unresolved = () => state.threads.filter((t) => !t.resolved);
  const byId = (id) => state.threads.find((t) => t.id === id) || null;

  /* ---------------- 排序：ok 锚点按页面纵向位置（文档序），page/lost/changed 垫后 ---------------- */
  function orderedVisible() {
    const items = visibleThreads().map((t) => ({ t, a: resolveAnchor(t) }));
    const rank = (s) => (s === 'ok' || s === 'clipped' ? 0 : s === 'page' ? 1 : 2);
    items.sort((x, y) => {
      const rx = rank(x.a.status), ry = rank(y.a.status);
      if (rx !== ry) return rx - ry;
      if (rx === 0) return (x.a.pos.y - y.a.pos.y) || (x.a.pos.x - y.a.pos.x);
      return 0;
    });
    return items;
  }

  /* ---------------- 渲染 pin / region / 发光环（保留几何） ---------------- */
  function render() {
    if (!layer) return;
    layer.querySelectorAll('.pp-anno-pin, .pp-anno-region, .pp-anno-glow').forEach((n) => n.remove());
    const ordered = orderedVisible();
    let n = 0;
    let focusedRect = null;
    for (const { t, a } of ordered) {
      if (a.status !== 'ok' && a.status !== 'clipped') { t._num = null; continue; }
      if (a.status !== 'ok') { t._num = null; continue; }
      const pos = a.pos;
      n += 1;
      t._num = n;
      const col = kindColor(t);
      if (t.rw != null && t.rh != null && a.el) {
        const r = a.el.getBoundingClientRect();
        const reg = el('div', 'pp-anno-region' + (t.resolved ? ' pp-anno-resolved' : ''));
        reg.dataset.ppAnno = '1';
        reg.dataset.tid = t.id;
        reg.style.borderColor = col;
        reg.style.background = 'color-mix(in srgb, ' + col + ' 10%, transparent)';
        reg.style.left = (r.left + scrollX + r.width * t.rx) + 'px';
        reg.style.top = (r.top + scrollY + r.height * t.ry) + 'px';
        reg.style.width = (r.width * t.rw) + 'px';
        reg.style.height = (r.height * t.rh) + 'px';
        layer.appendChild(reg);
      }
      const pin = el('div', 'pp-anno-pin' + (t.resolved ? ' pp-anno-resolved' : '')
        + (state.focusedId === t.id ? ' pp-anno-current' : ''));
      pin.dataset.ppAnno = '1';
      pin.dataset.ppRole = 'marker';
      pin.dataset.tid = t.id;
      pin.style.left = pos.x + 'px';
      pin.style.top = pos.y + 'px';
      pin.style.background = col;
      if (t.resolved) { pin.textContent = ''; pin.appendChild(svg(ICON.check, 13)); }
      else pin.textContent = String(n);
      pin.onclick = (e) => { e.stopPropagation(); focusThread(t.id, true); };
      layer.appendChild(pin);
      if (state.focusedId === t.id && !t.resolved && a.el) focusedRect = a.el.getBoundingClientRect();
    }
    // 发光相机：聚焦元素套环（未解决、ok 锚点）
    if (focusedRect) {
      const ft = byId(state.focusedId);
      const accent = ft ? kindColor(ft) : '#0f7c72';
      const g = el('div', 'pp-anno-glow');
      g.dataset.ppAnno = '1';
      g.style.left = (focusedRect.left + scrollX - 5) + 'px';
      g.style.top = (focusedRect.top + scrollY - 5) + 'px';
      g.style.width = (focusedRect.width + 10) + 'px';
      g.style.height = (focusedRect.height + 10) + 'px';
      g.style.boxShadow = `0 0 0 2px ${accent},0 0 0 7px ${accent}22,0 0 26px 2px ${accent}33`;
      layer.appendChild(g);
    }
    // 草稿框的区域预览（box-select）随滚动重摆
    if (state.draft && state.draft.box && state.draft._rubberPos) {
      const rb = layer.querySelector('.pp-anno-rubber');
      const p = state.draft._rubberPos();
      if (rb && p) { rb.style.left = p.x + 'px'; rb.style.top = p.y + 'px'; rb.style.width = p.w + 'px'; rb.style.height = p.h + 'px'; }
    }
    // Tideline AIM：压暗挖洞 + 点亮框随宿主变更/重摆重算（页面坐标系，窗口滚动无需重画）
    if (MOBILE && state.mode === 'comment' && !state.draft) updateAimOverlay();
    syncDrawerCounts();
  }

  /* ---------------- 抽屉渲染 ---------------- */
  const openCount = () => state.threads.filter((t) => !t.resolved).length;

  function setRail(open, opts) {
    if (MOBILE) return; // Tideline 无抽屉/收起 tab
    opts = opts || {};
    if (open === state.railOpen) return;
    if (!open && !opts.force) {
      // 收起前清未发草稿（草稿保护：有稿则抖动拦截）
      if (state.draft && draftHasText() && !opts.discard) { shakeDraft(); return; }
    }
    state.railOpen = open;
    if (!opts.auto) persistRail(); // 自动收起不写盘（只记手动偏好）
    drawer.classList.toggle('pp-anno-closed', !open);
    tabEl.style.display = open ? 'none' : '';
    if (open) { renderDrawer(); requestAnimationFrame(() => scrollFocusedCardIntoView()); }
    else if (opts.refocusTab) tabEl.focus();
    syncDrawerCounts(); // 收起时也要把 tab 的图标/未解决数画出来
    syncFlags();
  }

  function renderDrawer() {
    if (MOBILE) { renderSheet(); return; } // 移动端唯一面板是 sheet；保留函数名减少调用点分叉
    if (!drawer) return;
    drawer.textContent = '';
    const open = openCount();
    const total = state.threads.length;

    // header
    const hd = el('div', 'pp-anno-dwh');
    const top = el('div', 'pp-anno-dwh-top');
    const brand = el('span', 'pp-anno-brand');
    const bi = el('i'); bi.appendChild(svg(ICON.cmd, 12)); brand.append(bi, document.createTextNode(tr('brand.review')));
    const collapse = el('button', 'pp-anno-dwh-collapse'); collapse.dataset.ppAct = 'collapse'; collapse.title = tr('action.hideDrawer');
    collapse.appendChild(svg(ICON.arrowR, 14));
    collapse.onclick = () => setRail(false, { refocusTab: true });
    top.append(brand, collapse);

    const meta = el('div', 'pp-anno-dwh-meta');
    meta.appendChild(el('span', 'pp-anno-dwh-sub', total ? tr('meta.openTotal', { open, total }) : tr('meta.noComments')));
    meta.append(filterSeg());

    const acts = el('div', 'pp-anno-dwh-acts');
    const cbtn = el('button', 'pp-anno-cbtn' + (state.mode === 'comment' ? ' pp-anno-on' : ''));
    cbtn.dataset.ppAct = 'comment';
    cbtn.appendChild(svg(ICON.plus, 14));
    cbtn.appendChild(document.createTextNode(state.mode === 'comment' ? tr('btn.clickElement') : tr('btn.comment')));
    cbtn.onclick = () => (state.mode === 'comment' ? exitComment() : enterComment());
    const wbtn = el('button', 'pp-anno-wbtn'); wbtn.dataset.ppAct = 'whole'; wbtn.title = tr('action.notePage');
    wbtn.appendChild(svg(ICON.msg, 13));
    wbtn.onclick = openDraftForPage;
    acts.append(cbtn, wbtn);

    hd.append(top, meta, acts);
    drawer.appendChild(hd);

    // list
    listEl = el('div', 'pp-anno-dwlist');
    listEl.dataset.ppRole = 'list';
    const ordered = orderedVisible();
    if (!ordered.length && !state.draft) {
      listEl.appendChild(el('div', 'pp-anno-empty', total
        ? tr('empty.noOpen')
        : tr('empty.none')));
    } else {
      for (const { t, a } of ordered) listEl.appendChild(threadCard(t, a));
    }
    if (state.draft) listEl.appendChild(draftCard());
    drawer.appendChild(listEl);

    // hint strip
    const hint = el('div', 'pp-anno-dwhint');
    const kp = (k, label) => { const w = el('span', 'pp-anno-kpair'); w.appendChild(el('kbd', null, k)); w.appendChild(document.createTextNode(label)); return w; };
    hint.append(kp('j/k', tr('hint.move')), kp('c', tr('hint.comment')));
    if (!isGuest()) hint.append(kp('r', tr('hint.resolve'))); // guest 无 resolve：不提示 r
    hint.append(kp('\\', tr('hint.hide')));
    drawer.appendChild(hint);

    if (state.focusedId) requestAnimationFrame(() => scrollFocusedCardIntoView());
  }

  /* ---------------- Tideline：sheet 渲染 ---------------- */
  // seg 过滤器（All/Open）：抽屉与 sheet 共用构建
  function filterSeg() {
    const open = openCount();
    const seg = el('div', 'pp-anno-seg');
    const segOpen = el('button', state.filter === 'open' ? 'pp-anno-on' : null, tr('filter.open', { open }));
    segOpen.dataset.ppAct = 'filter'; segOpen.dataset.ppFilter = 'open';
    segOpen.onclick = () => setFilter('open');
    const segAll = el('button', state.filter === 'all' ? 'pp-anno-on' : null, tr('filter.all'));
    segAll.dataset.ppFilter = 'all';
    segAll.onclick = () => setFilter('all');
    seg.append(segOpen, segAll);
    return seg;
  }

  function renderSheet() {
    if (!sheetEl) return;
    const open = openCount();
    const total = state.threads.length;

    // grab bar：把手 + 开合箭头 + 计数/kind 点阵 + 右拇指角 FAB
    grabEl.textContent = '';
    grabEl.appendChild(el('div', 'pp-anno-grabpill'));
    const row = el('div', 'pp-anno-grabrow');
    const chev = el('span', 'pp-anno-grabchev');
    chev.appendChild(svg('<path d="m18 15-6-6-6 6"/>', 16));
    row.appendChild(chev);
    const meta = el('div', 'pp-anno-sheetmeta');
    const line = el('div', 'pp-anno-sheetmeta-line', total ? tr('meta.openTotal', { open, total }) : tr('meta.noComments'));
    line.dataset.ppRole = 'sheet-meta';
    meta.appendChild(line);
    if (total) {
      const dots = el('div', 'pp-anno-dots');
      dots.dataset.ppRole = 'sheet-dots';
      for (const t of state.threads) {
        const dot = el('i');
        dot.style.background = t.resolved ? '#d7dadd' : (t.kind && KIND[t.kind] ? KIND[t.kind].color : NO_KIND);
        dots.appendChild(dot);
      }
      meta.appendChild(dots);
    }
    row.appendChild(meta);
    const fab = el('button', 'pp-anno-fab');
    fab.dataset.ppRole = 'fab';
    fab.setAttribute('aria-label', tr('aria.fab'));
    fab.appendChild(svg(ICON.plus, 14));
    fab.appendChild(document.createTextNode(tr('fab.note')));
    fab.onclick = (e) => { e.stopPropagation(); state.mode === 'comment' ? exitComment() : enterComment(); };
    row.appendChild(fab);
    grabEl.appendChild(row);

    // 列表：过滤条（sticky）+ 线程卡（与桌面同一套 threadCard/draftCard）
    sheetListEl.textContent = '';
    const ordered = orderedVisible();
    if (!state.draft) {
      const bar = el('div', 'pp-anno-sheetbar');
      if (total > 0) bar.appendChild(filterSeg());
      const wbtn = el('button', 'pp-anno-wbtn');
      wbtn.dataset.ppAct = 'whole';
      wbtn.title = tr('action.notePage');
      wbtn.style.marginLeft = 'auto';
      wbtn.appendChild(svg(ICON.msg, 13));
      wbtn.onclick = openDraftForPage;
      bar.appendChild(wbtn);
      sheetListEl.appendChild(bar);
    }
    if (!ordered.length && !state.draft) {
      sheetListEl.appendChild(el('div', 'pp-anno-empty', total ? tr('empty.noOpen') : tr('empty.noneMobile')));
    } else {
      for (const { t, a } of ordered) sheetListEl.appendChild(threadCard(t, a));
    }
    if (state.draft) sheetListEl.appendChild(draftCard());
    if (state.focusedId) requestAnimationFrame(() => scrollFocusedCardIntoView());
  }

  function syncSheetCounts() {
    if (!sheetEl) return;
    const open = openCount();
    const total = state.threads.length;
    const line = sheetEl.querySelector('[data-pp-role="sheet-meta"]');
    if (line) line.textContent = total ? tr('meta.openTotal', { open, total }) : tr('meta.noComments');
    const so = sheetEl.querySelector('[data-pp-filter="open"]');
    if (so) so.textContent = tr('filter.open', { open });
  }

  function syncDrawerCounts() {
    if (MOBILE) { syncSheetCounts(); return; }
    const open = openCount();
    if (drawer && state.railOpen) {
      const sub = drawer.querySelector('.pp-anno-dwh-sub');
      const total = state.threads.length;
      if (sub) sub.textContent = total ? tr('meta.openTotal', { open, total }) : tr('meta.noComments');
      const so = drawer.querySelector('[data-pp-filter="open"]');
      if (so) so.textContent = tr('filter.open', { open });
    }
    if (tabEl && !state.railOpen) {
      tabEl.textContent = '';
      tabEl.appendChild(svg(ICON.cmd, 14));
      tabEl.appendChild(document.createTextNode(tr('brand.review')));
      if (open > 0) { const d = el('span', 'pp-anno-tabdot', String(open)); d.dataset.ppRole = 'tab-count'; tabEl.appendChild(d); }
      tabEl.setAttribute('aria-label', open > 0 ? tr('aria.openDrawerUnresolved', { open }) : tr('aria.openDrawerResolved'));
    }
  }

  function setFilter(f) {
    if (state.filter === f) return;
    state.filter = f;
    // 切到 open 时，若聚焦的是已解决线程，清焦点
    if (f === 'open') { const ft = byId(state.focusedId); if (ft && ft.resolved) state.focusedId = null; }
    renderDrawer();
    render();
  }

  /* ---------------- 线程卡（折叠摘要 / 聚焦展开） ---------------- */
  function avatar(name, size) {
    const a = el('div', 'pp-anno-ava', initialOf(name));
    a.style.width = a.style.height = size + 'px';
    a.style.fontSize = (size * 0.42) + 'px';
    a.style.background = avatarColor(name);
    return a;
  }

  // guest 作者徽标（author_sub 以 'guest:' 开头时，名字旁的低调小标）
  function guestBadge() {
    const b = el('span', 'pp-anno-guestbadge', tr('badge.guest'));
    b.dataset.ppRole = 'guest-badge';
    return b;
  }

  // 访客署名输入（草稿卡/回复框顶部一行；localStorage 预填，发送时存回）
  function guestNameInput() {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'pp-anno-nameinput';
    inp.dataset.ppRole = 'guest-name';
    inp.placeholder = tr('placeholder.guestName');
    inp.maxLength = 40;
    inp.value = loadGuestName();
    return inp;
  }

  function threadCard(t, a) {
    const focused = state.focusedId === t.id;
    const col = kindColor(t);
    const accent = t.resolved ? '#d7dadd' : (t.kind && KIND[t.kind] ? KIND[t.kind].color : NO_KIND);
    const stale = a.status === 'lost' || a.status === 'changed';
    const card = el('div', 'pp-anno-card'
      + (focused ? ' pp-anno-focused' : '')
      + (t.resolved && !focused ? ' pp-anno-dim' : ''));
    card.dataset.ppRole = 'card';
    card.dataset.tid = t.id;
    card.dataset.ppStatus = a.status;
    card.dataset.ppNum = isPage(t) ? 'page' : (stale ? 'stale' : (t._num != null ? String(t._num) : ''));
    if (focused) card.dataset.ppFocused = '1';
    card.onclick = () => { if (!focused) focusThread(t.id, true); };

    const rail = el('span', 'pp-anno-card-rail'); rail.style.background = accent; card.appendChild(rail);

    if (t.resolved && focused) {
      const banner = el('div', 'pp-anno-resolved-banner');
      banner.appendChild(svg(ICON.checks, 12));
      banner.appendChild(document.createTextNode(tr('banner.resolved')));
      card.appendChild(banner);
    }

    const bd = el('div', 'pp-anno-card-bd');
    const hd = el('div', 'pp-anno-card-hd');
    // 序号徽标 / @page / stale
    if (isPage(t)) { const num = el('span', 'pp-anno-num', '¶'); num.style.background = '#5d574d'; hd.appendChild(num); }
    else if (stale) { const num = el('span', 'pp-anno-num', '!'); num.style.background = '#b08423'; hd.appendChild(num); }
    else if (t._num != null) { const num = el('span', 'pp-anno-num', t.resolved ? '' : String(t._num)); num.style.background = col; if (t.resolved) num.appendChild(svg(ICON.check, 11)); hd.appendChild(num); }
    else { hd.appendChild(avatar(t.comments[0].author_name, 20)); }

    const idn = el('div'); idn.style.minWidth = '0'; idn.style.flex = '1';
    const line1 = el('div'); line1.style.display = 'flex'; line1.style.alignItems = 'center'; line1.style.gap = '6px';
    line1.appendChild(el('span', 'pp-anno-who', t.comments[0].author_name));
    if (isGuestSub(t.comments[0].author_sub)) line1.appendChild(guestBadge());
    if (focused) line1.appendChild(el('span', 'pp-anno-when', '· ' + fmtTime(t.comments[0].created_at)));
    const line2 = el('div'); line2.style.display = 'flex'; line2.style.alignItems = 'center'; line2.style.gap = '6px';
    if (stale) {
      const sb = el('span', 'pp-anno-stalebadge', tr('card.anchorLost', { selector: t.selector }));
      line2.appendChild(sb);
    } else {
      const an = el('span', 'pp-anno-anchor', isPage(t) ? '@page' : `${t._num != null ? t._num + ' · ' : ''}#${anchorLabel(t.selector)}`);
      an.style.color = t.resolved ? '#9aa1a9' : col;
      line2.appendChild(an);
    }
    idn.append(line1, line2);
    hd.appendChild(idn);

    // 右侧动作
    const cardActs = el('div', 'pp-anno-card-acts');
    if (focused) {
      const linkBtn = el('button', 'pp-anno-iconbtn'); linkBtn.dataset.ppRole = 'copy-link'; linkBtn.title = tr('action.copyLink');
      linkBtn.appendChild(svg(ICON.link, 14));
      linkBtn.onclick = (e) => { e.stopPropagation(); copyThreadLink(t); };
      cardActs.appendChild(linkBtn);
      const mine = state.viewer && t.comments[0].author_sub === state.viewer.sub;
      if (mine) cardActs.appendChild(deleteBtn(t));
      // guest 无 resolve/reopen 权限（服务端 PATCH 401）：控件整体不渲染
      if (!isGuest()) {
        if (t.resolved) {
          const reopen = el('button', 'pp-anno-ghost'); reopen.dataset.ppRole = 'reopen';
          reopen.style.padding = '4px 9px'; reopen.appendChild(document.createTextNode(tr('btn.reopen')));
          reopen.onclick = (e) => { e.stopPropagation(); void doResolve(t.id); };
          cardActs.appendChild(reopen);
        } else {
          const rb = el('button', 'pp-anno-resolvebtn'); rb.dataset.ppRole = 'resolve'; rb.title = tr('action.resolveNext');
          rb.appendChild(svg(ICON.check, 14));
          rb.onclick = (e) => { e.stopPropagation(); void doResolve(t.id); };
          cardActs.appendChild(rb);
        }
      }
    } else if (t.resolved) {
      const done = el('span', 'pp-anno-donechip'); done.appendChild(svg(ICON.check, 10)); done.appendChild(document.createTextNode(tr('chip.done')));
      cardActs.appendChild(done);
    } else if (!isGuest()) {
      const rb = el('button', 'pp-anno-resolvebtn'); rb.dataset.ppRole = 'resolve'; rb.title = tr('action.resolve');
      rb.appendChild(svg(ICON.check, 14));
      rb.onclick = (e) => { e.stopPropagation(); void doResolve(t.id); };
      cardActs.appendChild(rb);
    }
    hd.appendChild(cardActs);
    bd.appendChild(hd);

    if (focused) {
      bd.appendChild(focusedBody(t));
    } else {
      bd.appendChild(el('p', 'pp-anno-snippet', t.comments[0].text));
      const ft = el('div', 'pp-anno-card-ft');
      if (t.kind && KIND[t.kind]) {
        const kl = el('span', 'pp-anno-kindlab'); const ki = el('i');
        ki.style.background = t.resolved ? '#d7dadd' : KIND[t.kind].color;
        kl.style.color = t.resolved ? '#9aa1a9' : KIND[t.kind].color;
        kl.append(ki, document.createTextNode(KIND[t.kind].label));
        ft.appendChild(kl);
      }
      if (t.comments.length > 1) { const rc = el('span'); rc.style.display = 'inline-flex'; rc.style.alignItems = 'center'; rc.style.gap = '4px'; rc.appendChild(svg(ICON.reply, 11)); rc.appendChild(document.createTextNode(String(t.comments.length))); ft.appendChild(rc); }
      const tm = el('span', null, fmtTime(t.comments[0].created_at)); tm.style.marginLeft = 'auto'; ft.appendChild(tm);
      bd.appendChild(ft);
    }
    card.appendChild(bd);
    return card;
  }

  function deleteBtn(t) {
    const delBtn = el('button', 'pp-anno-iconbtn pp-anno-del'); delBtn.dataset.ppRole = 'delete'; delBtn.title = tr('action.delete');
    delBtn.appendChild(svg(ICON.x, 14));
    let disarm = null;
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!delBtn.dataset.armed) {
        delBtn.dataset.armed = '1'; delBtn.textContent = tr('action.deleteConfirm'); delBtn.classList.add('pp-anno-armed');
        disarm = setTimeout(() => { delete delBtn.dataset.armed; delBtn.textContent = ''; delBtn.appendChild(svg(ICON.x, 14)); delBtn.classList.remove('pp-anno-armed'); }, 3000);
        return;
      }
      clearTimeout(disarm);
      try {
        const wasIdx = orderedVisible().findIndex((x) => x.t.id === t.id);
        await deleteThread(t.id);
        state.threads = state.threads.filter((x) => x.id !== t.id);
        state.replyStash.delete(t.id);
        // 焦点前移到下一张可见卡
        const ov = orderedVisible();
        state.focusedId = ov.length ? ov[Math.min(wasIdx, ov.length - 1)].t.id : null;
        renderDrawer();
        render();
      } catch (err) { toast(err.message || tr('toast.deleteFailed')); }
    };
    return delBtn;
  }

  function focusedBody(t) {
    const wrap = el('div');
    // 评论流
    const msgs = el('div', 'pp-anno-msgs');
    t.comments.forEach((c) => {
      const m = el('div', 'pp-anno-msg');
      m.appendChild(avatar(c.author_name, 22));
      const right = el('div');
      const line = el('div', 'pp-anno-msg-line');
      line.appendChild(el('span', 'pp-anno-who', c.author_name));
      if (isGuestSub(c.author_sub)) line.appendChild(guestBadge());
      line.appendChild(el('span', 'pp-anno-when', fmtTime(c.created_at)));
      right.append(line, el('div', 'pp-anno-txt', c.text));
      m.appendChild(right);
      msgs.appendChild(m);
    });
    wrap.appendChild(msgs);

    // kind chips（未解决才显示；点选即 PATCH —— guest 无权改，整块不渲染）
    if (!t.resolved && !isGuest()) wrap.appendChild(kindChipsFor(t));

    // 回复区
    wrap.appendChild(replyArea(t));

    // Tideline：卡底部「上一条 / n / m / 下一条」步进（j/k 的触屏对应物，44×40 触控目标）
    if (MOBILE) {
      const ov = orderedVisible();
      const idx = ov.findIndex((x) => x.t.id === t.id);
      if (idx !== -1 && ov.length > 1) {
        const steps = el('div', 'pp-anno-steprow');
        const prev = el('button', 'pp-anno-stepbtn');
        prev.dataset.ppRole = 'step-prev';
        prev.setAttribute('aria-label', tr('aria.prev'));
        prev.appendChild(svg('<path d="m15 18-6-6 6-6"/>', 16));
        prev.onclick = (e) => { e.stopPropagation(); move(-1); };
        const pos = el('span', 'pp-anno-steppos', (idx + 1) + ' / ' + ov.length);
        pos.dataset.ppRole = 'step-pos';
        const next = el('button', 'pp-anno-stepbtn');
        next.dataset.ppRole = 'step-next';
        next.setAttribute('aria-label', tr('aria.next'));
        next.appendChild(svg('<path d="m9 18 6-6-6-6"/>', 16));
        next.onclick = (e) => { e.stopPropagation(); move(1); };
        steps.append(prev, pos, next);
        wrap.appendChild(steps);
      }
    }
    return wrap;
  }

  function kindChipsFor(t) {
    const wrap = el('div', 'pp-anno-chips');
    let kindInFlight = false;
    const applySel = () => {
      wrap.querySelectorAll('.pp-anno-chip2').forEach((x) => {
        const on = !!t.kind && x.dataset.ppKind === t.kind;
        x.classList.toggle('pp-anno-on', on);
        x.style.background = on ? KIND[t.kind].color : '';
      });
    };
    for (const k of KIND_KEYS) {
      const m = KIND[k];
      const b = el('button', 'pp-anno-chip2' + (t.kind === k ? ' pp-anno-on' : ''));
      b.dataset.ppKind = k;
      const dot = el('i'); dot.style.background = m.color;
      b.append(dot, document.createTextNode(m.label));
      if (t.kind === k) b.style.background = m.color;
      b.onclick = async (e) => {
        e.stopPropagation();
        if (kindInFlight) return;
        const newKind = t.kind === k ? null : k;
        kindInFlight = true;
        try {
          const updated = await patchThread(t.id, { kind: newKind });
          Object.assign(t, updated);
          applySel();
          render(); // pin/accent 重新上色
          const railEl = wrap.closest('.pp-anno-card')?.querySelector('.pp-anno-card-rail');
          if (railEl) railEl.style.background = kindColor(t);
        } catch (err) { toast(err.message || tr('toast.failed')); }
        kindInFlight = false;
      };
      wrap.appendChild(b);
    }
    return wrap;
  }

  function replyArea(t) {
    const wrap = el('div', 'pp-anno-replyarea');
    const taWrap = el('div', 'pp-anno-ta-wrap');
    const nameInp = isGuest() ? guestNameInput() : null;
    if (nameInp) taWrap.appendChild(nameInp);
    const ta = document.createElement('textarea');
    ta.rows = 2;
    ta.dataset.ppRole = 'reply';
    ta.placeholder = t.resolved ? tr('placeholder.addNote') : tr('placeholder.reply');
    const stash = state.replyStash.get(t.id);
    if (stash) ta.value = stash;
    ta.oninput = () => { if (ta.value.trim()) state.replyStash.set(t.id, ta.value); else state.replyStash.delete(t.id); syncFlags(); };
    ta.onfocus = syncFlags;
    ta.onblur = syncFlags;
    if (nameInp) nameInp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ta.focus(); } };
    const row = el('div', 'pp-anno-ta-row');
    row.appendChild(el('span', 'pp-anno-hint', tr('hint.enterReply')));
    const send = el('button', 'pp-anno-send');
    send.dataset.ppRole = 'send';
    send.appendChild(svg(ICON.enter, 13));
    send.appendChild(document.createTextNode(tr('btn.reply')));
    row.appendChild(send);
    taWrap.append(ta, row);
    wrap.appendChild(taWrap);

    const submit = async () => {
      const txt = ta.value.trim();
      if (!txt) { ta.focus(); return; }
      send.disabled = true;
      try {
        const body = { text: txt };
        if (nameInp) { const nm = nameInp.value.trim(); saveGuestName(nm); body.author_name = nm || null; }
        const reply = await addReply(t.id, body);
        t.comments.push(reply);
        state.replyStash.delete(t.id);
        renderDrawer();
        render();
        // 重新聚焦回复框
        requestAnimationFrame(() => { const f = panel() && panel().querySelector('[data-pp-focused="1"] [data-pp-role="reply"]'); if (f) f.focus(); });
      } catch (err) { toast(err.message || tr('toast.failed')); send.disabled = false; }
    };
    send.onclick = (e) => { e.stopPropagation(); void submit(); };
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); state.replyStash.delete(t.id); ta.value = ''; ta.blur(); syncFlags(); }
    };
    return wrap;
  }

  /* ---------------- 聚焦 + 发光相机 ---------------- */
  function focusThread(id, scroll) {
    const t = byId(id);
    if (!t) return;
    state.focusedId = id;
    if (MOBILE) {
      // 选中线程时 sheet 至少抬到 HALF（peek 只够扫一眼）；已在 half/full 保持不动
      if (state.detent === 'peek') setDetent('half');
      renderDrawer();
    } else if (!state.railOpen) setRail(true);
    else renderDrawer();
    render();
    if (scroll) {
      const a = resolveAnchor(t);
      if (a.el) {
        if (MOBILE) {
          flyToEl(a.el); // 相机：停进 sheet 上方实时空明区
        } else {
          const r = a.el.getBoundingClientRect();
          const target = scrollY + r.top - innerHeight * 0.38 + r.height / 2;
          scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
        }
      } else if (isPage(t)) {
        scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
    requestAnimationFrame(() => scrollFocusedCardIntoView());
    try { history.replaceState(null, '', location.pathname + location.search + '#pp-comment-' + id); } catch (e) { /* ignore */ }
  }

  function scrollFocusedCardIntoView() {
    if (!listEl || !state.focusedId) return;
    const card = listEl.querySelector('[data-pp-focused="1"]');
    if (card) card.scrollIntoView({ block: 'nearest' });
  }

  function move(delta) {
    const ov = orderedVisible();
    if (!ov.length) return;
    const cur = ov.findIndex((x) => x.t.id === state.focusedId);
    const next = cur === -1 ? (delta > 0 ? 0 : ov.length - 1) : Math.min(ov.length - 1, Math.max(0, cur + delta));
    focusThread(ov[next].t.id, true);
  }

  let resolveInFlight = false;
  async function doResolve(id) {
    if (isGuest()) return; // 访客无 resolve 权限（控件已隐藏；这里兜住 r 快捷键）
    if (resolveInFlight) return;
    const t = byId(id);
    if (!t) return;
    const wasResolved = t.resolved;
    const ov = orderedVisible();
    const i = ov.findIndex((x) => x.t.id === id);
    resolveInFlight = true;
    try {
      const updated = await patchThread(id, { resolved: !wasResolved });
      Object.assign(t, updated);
    } catch (e) { toast(e.message || tr('toast.failed')); resolveInFlight = false; return; }
    resolveInFlight = false;
    if (!wasResolved) { try { await momentStamp(id); } catch (e) { /* 仪式失败不阻断 */ } }
    // resolve-and-advance：刚解决且 filter=open（卡会消失）→ 焦点前移到下一张
    if (!wasResolved && state.filter === 'open') {
      const ov2 = orderedVisible();
      const nxt = ov2[Math.min(i, ov2.length - 1)];
      state.focusedId = nxt ? nxt.t.id : null;
      toast(tr('toast.resolved'));
      if (state.focusedId) { focusThread(state.focusedId, true); return; }
    } else {
      toast(wasResolved ? tr('toast.reopened') : tr('toast.resolved'));
    }
    renderDrawer();
    render();
    momentMaybeFinale();
  }

  /* ---------------- 草稿（新建评论，落在抽屉里） ---------------- */
  const draftHasText = () => !!(state.draft && state.draft.text && state.draft.text.trim());
  function shakeDraft() {
    const card = panel() && panel().querySelector('[data-pp-role="draft"]');
    if (!card) return;
    card.classList.remove('pp-anno-shaking'); void card.offsetWidth; card.classList.add('pp-anno-shaking');
    const ta = card.querySelector('textarea'); if (ta) ta.focus();
    toast(tr('toast.unsent'));
  }
  function clearDraft(discard) {
    if (!state.draft) return true;
    if (!discard && draftHasText()) { shakeDraft(); return false; }
    if (state.draft._cleanup) state.draft._cleanup();
    state.draft = null;
    return true;
  }
  function openDraftFor(selector, rx, ry, box) {
    if (!clearDraft()) return; // 已有未发草稿：拦截
    // 桌面：不退出评论模式 —— 保留十字光标以便连续打点，并让评论模式下的「点空白关空草稿」两步式继续生效。
    // 移动（Tideline）：打完点即退出 AIM（压暗/点亮框/指令条撤掉），草稿落进 sheet。
    if (MOBILE && state.mode === 'comment') { state.mode = 'rest'; teardownAim(); }
    const d = { selector, rx: rx == null ? 0.5 : rx, ry: ry == null ? 0.5 : ry, box: box || null, kind: null, text: '' };
    // box-select：在页面上画持久预览框 + 提供随滚动重摆的几何
    if (box && selector !== PAGE_SELECTOR) {
      let node = null;
      try { node = document.querySelector(selector); } catch (e) { node = null; }
      if (node) {
        const rub = el('div', 'pp-anno-rubber'); rub.dataset.ppAnno = '1'; layer.appendChild(rub);
        d._rubberPos = () => {
          const r = node.getBoundingClientRect();
          return { x: r.left + scrollX + r.width * d.rx, y: r.top + scrollY + r.height * d.ry, w: r.width * box.rw, h: r.height * box.rh };
        };
        d._cleanup = () => rub.remove();
      }
    }
    state.draft = d;
    state.focusedId = null;
    if (MOBILE) { setDetent('half'); renderDrawer(); }
    else if (!state.railOpen) setRail(true); else renderDrawer();
    render();
    if (MOBILE && selector !== PAGE_SELECTOR) {
      let node = null;
      try { node = document.querySelector(selector); } catch (e) { node = null; }
      if (node) flyToEl(node, 'half'); // 相机：被评元素停在 HALF 档 sheet 上方的空明区
    }
    requestAnimationFrame(() => {
      const p = panel();
      if (!p) return;
      const ta = p.querySelector('[data-pp-role="draft"] textarea');
      if (ta) ta.focus();
      const card = p.querySelector('[data-pp-role="draft"]');
      if (card) card.scrollIntoView({ block: 'nearest' });
    });
    syncFlags();
  }
  const openDraftForPage = () => { if (state.mode === 'comment') exitComment(); openDraftFor(PAGE_SELECTOR, 0, 0); };

  /* ---------------- 循环时刻(克制档):反馈环在眼前闭合 ----------------
   * M1 新版本横幅:轮询发现 site_version 变化(agent 重新部署了);
   * M2 修复回执:轮询发现线程被远程 resolve —— pin 原位潮环+回执卡(pin 不在视口则 toast 汇总);
   * M3 解决盖章:本地 resolve 的落地确认;M4 收敛回执:未解决清零时空态变本轮统计。 */
  const moments = { lastVersion: null, pendingFixed: [], stats: { n: 0, firstAt: 0, lastAt: 0 }, finaleShown: false, banner: null };
  const momentMark = () => { const now = Date.now(); if (!moments.stats.firstAt) moments.stats.firstAt = now; moments.stats.lastAt = now; moments.stats.n += 1; };
  function momentSeed(v) { if (v) moments.lastVersion = v; }
  function momentOnFetch(data, oldThreads) {
    if (data && data.site_version) {
      if (moments.lastVersion && data.site_version !== moments.lastVersion) momentBanner(data.site_version);
      moments.lastVersion = data.site_version;
    }
    moments.pendingFixed = (data.threads || [])
      .filter((nt) => { const o = oldThreads.find((x) => x.id === nt.id); return o && !o.resolved && nt.resolved; })
      .map((nt) => {
        const last = nt.comments[nt.comments.length - 1];
        const pin = layer && layer.querySelector('.pp-anno-pin[data-tid="' + nt.id + '"]');
        return {
          id: nt.id, who: (last && last.author_name) || 'agent',
          px: pin ? parseFloat(pin.style.left) : null, py: pin ? parseFloat(pin.style.top) : null,
        };
      });
  }
  function momentAfterRefresh() {
    const list = moments.pendingFixed; moments.pendingFixed = [];
    const seen = list.filter((f) => f.py != null && f.py > scrollY - 40 && f.py < scrollY + innerHeight + 40);
    const unseen = list.length - seen.length;
    seen.forEach((f, i) => setTimeout(() => momentReceipt(f), i * 650));
    if (unseen > 0) toast(tr('moment.fixToast', { n: unseen }));
    list.forEach(momentMark);
    if (list.length) setTimeout(momentMaybeFinale, seen.length * 650 + 400);
  }
  function momentBanner(toV) {
    if (moments.banner) moments.banner.remove();
    const bn = el('div', 'pp-anno-mtbanner');
    bn.dataset.ppAnno = '1';
    bn.setAttribute('role', 'status');
    bn.appendChild(el('span', 'pp-anno-mdot'));
    const tb = document.createElement('b'); tb.textContent = tr('moment.verTitle', { v: toV }); bn.appendChild(tb);
    bn.appendChild(el('span', '', tr('moment.verBody')));
    const view = el('button', 'pp-anno-mview', tr('moment.verView'));
    view.onclick = () => location.reload();
    const x = el('button', 'pp-anno-mx', '\u2715');
    const dismiss = () => { bn.classList.remove('pp-anno-min'); setTimeout(() => bn.remove(), 350); if (moments.banner === bn) moments.banner = null; };
    x.onclick = dismiss;
    bn.append(view, x);
    document.body.appendChild(bn);
    moments.banner = bn;
    requestAnimationFrame(() => bn.classList.add('pp-anno-min'));
    setTimeout(dismiss, 9000);
  }
  function momentReceipt(f) {
    if (!layer || f.px == null) return;
    if (!REDUCE()) {
      const rip = el('span', 'pp-anno-mripple');
      rip.innerHTML = '<i></i><i></i>';
      rip.style.left = f.px + 'px'; rip.style.top = f.py + 'px';
      layer.appendChild(rip);
      setTimeout(() => rip.remove(), 1400);
    }
    const r = el('div', 'pp-anno-mreceipt');
    r.dataset.ppAnno = '1';
    const ic = el('i'); ic.appendChild(svg(ICON.check, 12)); r.appendChild(ic);
    const bd = el('div');
    const tb = document.createElement('b'); tb.textContent = tr('moment.fixTitle'); bd.appendChild(tb);
    const sp = el('span');
    const em = document.createElement('em'); em.textContent = f.who;
    // {who} 处理了你标注的这处 —— 主语着色:按 {who} 分段拼
    const tpl = tr('moment.fixBody', { who: '\u0001' }).split('\u0001');
    sp.appendChild(document.createTextNode(tpl[0]));
    sp.appendChild(em);
    if (tpl[1]) sp.appendChild(document.createTextNode(tpl[1]));
    bd.appendChild(sp);
    r.appendChild(bd);
    r.style.left = Math.max(8, f.px - 20) + 'px';
    r.style.top = (f.py + 12) + 'px';
    layer.appendChild(r);
    requestAnimationFrame(() => r.classList.add('pp-anno-min'));
    setTimeout(() => { r.classList.add('pp-anno-mout'); setTimeout(() => r.remove(), 350); }, 6200);
  }
  async function momentStamp(id) {
    momentMark();
    if (REDUCE()) return;
    const card = panel() && panel().querySelector('[data-pp-role="card"][data-tid="' + id + '"]');
    if (!card) return;
    const st = el('span', 'pp-anno-mstamp');
    st.appendChild(svg(ICON.check, 20));
    card.appendChild(st);
    card.classList.add('pp-anno-stamping');
    await new Promise((r) => setTimeout(r, 300));
  }
  function momentMaybeFinale() {
    if (openCount() > 0) { moments.finaleShown = false; return; }
    if (moments.finaleShown || moments.stats.n === 0) return;
    const empty = panel() && panel().querySelector('.pp-anno-empty');
    if (!empty) return;
    moments.finaleShown = true;
    const ms = Math.max(0, moments.stats.lastAt - moments.stats.firstAt);
    const t = ms < 60000 ? tr('moment.timeUnder') : tr('moment.timeMin', { m: Math.round(ms / 60000) });
    const fin = el('div', 'pp-anno-mfinale');
    const fc = el('span', 'pp-anno-mfc'); fc.appendChild(svg(ICON.check, 20)); fin.appendChild(fc);
    const tb = document.createElement('b'); tb.textContent = tr('moment.doneTitle'); fin.appendChild(tb);
    const st = el('span');
    const em = document.createElement('em'); em.textContent = tr('moment.doneStats', { n: state.threads.length });
    st.appendChild(em);
    st.appendChild(document.createElement('br'));
    st.appendChild(document.createTextNode(tr('moment.doneTime', { t })));
    fin.appendChild(st);
    empty.replaceChildren(fin);
    empty.style.padding = '0';
  }

  function draftCard() {
    const d = state.draft;
    const accent = d.kind && KIND[d.kind] ? KIND[d.kind].color : '#0f7c72';
    const card = el('div', 'pp-anno-card pp-anno-draft');
    card.dataset.ppRole = 'draft';
    card.dataset.ppSelector = d.selector;
    const rail = el('span', 'pp-anno-card-rail'); rail.style.background = accent; card.appendChild(rail);
    const bd = el('div', 'pp-anno-card-bd');
    const hd = el('div', 'pp-anno-card-hd');
    hd.appendChild(avatar(state.viewer ? (state.viewer.name || loadGuestName() || '?') : '?', 20)); // guest 的 name=null：回落本地署名
    hd.appendChild(el('span', 'pp-anno-who', d.selector === PAGE_SELECTOR ? tr('action.notePage') : tr('draft.newComment')));
    if (d.selector !== PAGE_SELECTOR) hd.appendChild(el('span', 'pp-anno-seltag', d.selector));
    bd.appendChild(hd);

    const taWrap = el('div', 'pp-anno-ta-wrap'); taWrap.style.marginTop = '8px';
    const nameInp = isGuest() ? guestNameInput() : null;
    if (nameInp) taWrap.appendChild(nameInp);
    const ta = document.createElement('textarea');
    ta.rows = 2;
    ta.placeholder = d.selector === PAGE_SELECTOR ? tr('placeholder.pageNote') : tr('placeholder.elementNote');
    ta.value = d.text;
    ta.oninput = () => { d.text = ta.value; syncFlags(); };
    if (nameInp) nameInp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ta.focus(); } };
    taWrap.appendChild(ta);
    bd.appendChild(taWrap);

    // kind chips（草稿态本地选择，提交时带上）
    const chips = el('div', 'pp-anno-chips');
    for (const k of KIND_KEYS) {
      const m = KIND[k];
      const b = el('button', 'pp-anno-chip2' + (d.kind === k ? ' pp-anno-on' : ''));
      b.dataset.ppKind = k;
      const dot = el('i'); dot.style.background = m.color;
      b.append(dot, document.createTextNode(m.label));
      if (d.kind === k) b.style.background = m.color;
      b.onclick = (e) => {
        e.stopPropagation();
        d.kind = d.kind === k ? null : k;
        chips.querySelectorAll('.pp-anno-chip2').forEach((x) => { x.classList.remove('pp-anno-on'); x.style.background = ''; });
        if (d.kind) { b.classList.add('pp-anno-on'); b.style.background = KIND[d.kind].color; }
        rail.style.background = d.kind && KIND[d.kind] ? KIND[d.kind].color : '#0f7c72';
      };
      chips.appendChild(b);
    }
    bd.appendChild(chips);

    const row = el('div', 'pp-anno-ta-row');
    const cancel = el('button', 'pp-anno-ghost', tr('btn.cancel'));
    cancel.onclick = (e) => { e.stopPropagation(); clearDraft(true); renderDrawer(); render(); syncFlags(); };
    row.appendChild(cancel);
    const send = el('button', 'pp-anno-send'); send.dataset.ppRole = 'send';
    send.appendChild(document.createTextNode(tr('btn.comment')));
    send.appendChild(svg(ICON.arrowR, 13));
    row.appendChild(send);
    bd.appendChild(row);

    const submit = async () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      send.disabled = true;
      try {
        let node = null;
        if (d.selector !== PAGE_SELECTOR) { try { node = document.querySelector(d.selector); } catch (e) { node = null; } }
        const anchor_text = node ? (fingerprint(node) || null) : null;
        const payload = {
          path: CFG.path, selector: d.selector, rx: d.rx, ry: d.ry,
          rw: d.box ? d.box.rw : null, rh: d.box ? d.box.rh : null, kind: d.kind, anchor_text, text,
        };
        if (nameInp) { const nm = nameInp.value.trim(); saveGuestName(nm); payload.author_name = nm || null; }
        const created = await createThread(payload);
        state.threads.push(created);
        if (state.draft && state.draft._cleanup) state.draft._cleanup();
        state.draft = null;
        state.focusedId = created.id;
        renderDrawer();
        render();
        const pin = layer.querySelector(`.pp-anno-pin[data-tid="${created.id}"]`);
        if (pin) pin.classList.add('pp-anno-pulse');
        else if (d.selector === PAGE_SELECTOR) toast(tr('toast.pageRecorded'));
        syncFlags();
      } catch (err) { toast(err.message || tr('toast.failed')); send.disabled = false; }
    };
    send.onclick = (e) => { e.stopPropagation(); void submit(); };
    ta.onkeydown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit(); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); clearDraft(true); renderDrawer(); render(); syncFlags(); }
    };
    card.appendChild(bd);
    return card;
  }

  /* ---------------- 深链复制（保留，英文化） ---------------- */
  async function copyThreadLink(t) {
    const url = location.href.split('#')[0] + '#pp-comment-' + t.id;
    try { await navigator.clipboard.writeText(url); }
    catch (e) {
      const tmp = el('textarea'); tmp.dataset.ppAnno = '1'; tmp.value = url;
      tmp.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(tmp); tmp.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      tmp.remove();
    }
    toast(tr('toast.linkCopied'));
  }

  /* ---------------- Tideline：AIM 瞄准模式（移动端的评论模式） ----------------
   * 进入：FAB / c 键。页面压暗（SVG evenodd 挖洞）+ 可锚定元素点亮 + 底部指令条；sheet 落回 PEEK。
   * 打点：click 捕获里吸附到「最近锚点」（rect 距离 0=命中内部，平手取面积小者），绝不静默落 @page。
   * 候选集：启动 AIM 时按启发式收集（标题/段落/图/表/按钮/带 id 的块），几何每次 render 重算。 */
  let aimTargets = null;
  let aimChip = null;
  function collectAimTargets() {
    const out = [];
    const CAND = 'h1,h2,h3,h4,h5,h6,p,li,img,figure,figcaption,pre,blockquote,table,button,video,canvas,svg,[id]';
    let nodes = [];
    try { nodes = document.body.querySelectorAll(CAND); } catch (e) { /* 忽略 */ }
    for (const n of nodes) {
      if (out.length >= 400) break;
      if (n.closest('[data-pp-anno]')) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 24 || r.height < 14 || r.width * r.height < 500) continue; // 太小，拇指点不准
      if (r.width >= innerWidth * 0.96 && r.height > innerHeight * 1.1) continue; // 近整页 wrapper 不是有意义的锚点
      out.push(n);
    }
    return out;
  }
  function updateAimOverlay() {
    if (!MOBILE || state.mode !== 'comment' || state.draft || !aimTargets || !layer) return;
    const docW = Math.max(document.documentElement.scrollWidth, innerWidth);
    const docH = Math.max(document.documentElement.scrollHeight, innerHeight);
    const rects = [];
    for (const n of aimTargets) {
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      rects.push({ x: r.left + scrollX - 3, y: r.top + scrollY - 3, w: r.width + 6, h: r.height + 6 });
    }
    // 压暗层：单条 evenodd path，洞内保持原亮度 = 「点亮」可锚定元素
    let dim = layer.querySelector('.pp-anno-aimdim');
    if (!dim) {
      dim = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      dim.setAttribute('class', 'pp-anno-aimdim');
      dim.dataset.ppAnno = '1';
      dim.dataset.ppRole = 'aim-dim';
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('fill', 'rgba(11,15,18,.42)');
      p.setAttribute('fill-rule', 'evenodd');
      dim.appendChild(p);
      layer.appendChild(dim);
    }
    dim.setAttribute('width', String(docW));
    dim.setAttribute('height', String(docH));
    dim.setAttribute('viewBox', '0 0 ' + docW + ' ' + docH);
    let dPath = 'M0 0H' + docW + 'V' + docH + 'H0Z';
    for (const b of rects) dPath += 'M' + b.x + ' ' + b.y + 'h' + b.w + 'v' + b.h + 'h' + (-b.w) + 'Z';
    dim.firstChild.setAttribute('d', dPath);
    // 点亮框：数量对齐后按序复用
    let boxes = layer.querySelectorAll('.pp-anno-aimbox');
    if (boxes.length !== rects.length) {
      boxes.forEach((b) => b.remove());
      for (let i = 0; i < rects.length; i++) {
        const b = el('div', 'pp-anno-aimbox');
        b.dataset.ppAnno = '1';
        b.dataset.ppRole = 'aim-target';
        layer.appendChild(b);
      }
      boxes = layer.querySelectorAll('.pp-anno-aimbox');
    }
    rects.forEach((r, i) => {
      const b = boxes[i];
      b.style.left = r.x + 'px'; b.style.top = r.y + 'px';
      b.style.width = r.w + 'px'; b.style.height = r.h + 'px';
    });
  }
  function teardownAim() {
    aimTargets = null;
    if (aimChip) { aimChip.remove(); aimChip = null; }
    if (root) root.classList.remove('pp-anno-aim');
    if (layer) layer.querySelectorAll('.pp-anno-aimdim,.pp-anno-aimbox').forEach((n) => n.remove());
  }
  // 粗拇指打点：吸附最近锚点，取点在其 rect 内的投影为 rx/ry
  function aimTapAt(x, y) {
    let bestEl = null, bestR = null, bd = Infinity, bestArea = Infinity;
    if (aimTargets) {
      for (const n of aimTargets) {
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        const dist = Math.hypot(dx, dy);
        const area = r.width * r.height;
        if (dist < bd - 0.5 || (Math.abs(dist - bd) <= 0.5 && area < bestArea)) {
          bd = dist; bestArea = area; bestEl = n; bestR = r;
        }
      }
    }
    if (!bestEl) { // 极端页面（零候选）：退回命中点元素本身，仍不落 @page
      const raw = document.elementFromPoint(x, y);
      if (!raw || raw === document.body || raw === document.documentElement || raw.closest('[data-pp-anno]')) return;
      bestEl = raw; bestR = raw.getBoundingClientRect();
      if (!bestR.width || !bestR.height) return;
    }
    const rx = Math.min(1, Math.max(0, (x - bestR.left) / bestR.width));
    const ry = Math.min(1, Math.max(0, (y - bestR.top) / bestR.height));
    openDraftFor(cssPath(bestEl), rx, ry);
  }
  function enterAim() {
    if (state.draft && !clearDraft()) return; // 有稿：抖动拦截
    state.mode = 'comment';
    aimTargets = collectAimTargets();
    setDetent('peek'); // 让出取景空间；指令条停在 sheet 上方
    state.focusedId = null;
    root.classList.add('pp-anno-aim'); // pin/region/glow 让位（CSS 隐藏）
    if (!aimChip) {
      aimChip = el('div', 'pp-anno-aimchip');
      aimChip.dataset.ppAnno = '1';
      aimChip.dataset.ppRole = 'aim-hint';
      aimChip.appendChild(document.createTextNode(tr('aim.tapTarget')));
      const cancel = el('button', null, tr('btn.cancel'));
      cancel.dataset.ppRole = 'aim-cancel';
      cancel.onclick = (e) => { e.stopPropagation(); exitComment(); };
      aimChip.appendChild(cancel);
      aimChip.style.bottom = (PEEK_H + 12) + 'px';
      root.appendChild(aimChip);
    }
    renderDrawer(); // 清掉可能的空草稿卡
    updateAimOverlay();
    syncFlags();
  }

  /* ---------------- 评论模式 + 宿主级标记 ---------------- */
  let vignetteEl = null;
  function enterComment() {
    if (MOBILE) { enterAim(); return; }
    state.mode = 'comment'; if (!state.railOpen) setRail(true); else renderDrawer(); syncFlags();
    if (!vignetteEl) { vignetteEl = el('div', 'pp-anno-vignette'); vignetteEl.dataset.ppAnno = '1'; document.body.appendChild(vignetteEl); }
  }
  function exitComment() {
    state.mode = 'rest';
    if (vignetteEl) { vignetteEl.remove(); vignetteEl = null; }
    if (MOBILE) { teardownAim(); syncFlags(); render(); return; }
    if (hoverHint) { hoverHint.classList.remove('pp-anno-hover-hint'); hoverHint = null; }
    renderDrawer();
    syncFlags();
  }
  // mode-on = 评论模式（无草稿时出十字光标）；paused = 草稿/回复输入占用交互（图片壳据此让权 Esc）
  function replyFocused() {
    const ae = document.activeElement;
    return !!(ae && ae.dataset && ae.dataset.ppRole === 'reply' && ae.value && ae.value.trim());
  }
  function syncFlags() {
    const de = document.documentElement;
    de.classList.toggle('pp-anno-mode-on', state.mode === 'comment' && !state.draft);
    de.classList.toggle('pp-anno-paused', !!state.draft || replyFocused());
    // aim hint（桌面顶部提示条；移动端 AIM 用自己的底部指令条 aim-hint）
    let h = root && root.querySelector('.pp-anno-aimhint');
    if (!MOBILE && state.mode === 'comment' && !state.draft) {
      if (!h) { h = el('div', 'pp-anno-aimhint', tr('hint.aim')); h.dataset.ppAnno = '1'; root.appendChild(h); }
    } else if (h) h.remove();
  }

  /* ---------------- 评论模式 hover + 打点（保留几何） ---------------- */
  let hoverHint = null;
  document.addEventListener('mouseover', (e) => {
    if (state.mode !== 'comment' || state.draft) return;
    if (hoverHint) hoverHint.classList.remove('pp-anno-hover-hint');
    hoverHint = e.target.closest('[data-pp-anno]') ? null : e.target;
    if (hoverHint && hoverHint !== document.body) hoverHint.classList.add('pp-anno-hover-hint');
  }, true);
  const modeArmed = (e) =>
    state.mode === 'comment' && !state.draft &&
    !(e.target.closest && e.target.closest('[data-pp-anno]'));
  document.addEventListener('dragstart', (e) => { if (modeArmed(e)) e.preventDefault(); }, true);
  document.addEventListener('selectstart', (e) => { if (modeArmed(e)) e.preventDefault(); }, true);

  /* ---------------- 图片框选（Pointer Events：鼠标/触屏/笔同一路径，几何保留；GROWTH-PLAN A4） ----------------
   * 触屏前提：评论/AIM 模式下 img 的 touch-action:none（见 STYLE），拖动才走 pointermove 而不是滚页。
   * click 抑制改为时间窗（触屏拖拽后浏览器不一定补发 click，布尔位会把下一次真点击吞掉）。 */
  let suppressClickUntil = 0;
  document.addEventListener('pointerdown', (down) => {
    if (state.mode !== 'comment' || state.draft) return;
    if (!down.isPrimary) return;
    if (down.pointerType === 'mouse' && down.button !== 0) return;
    const img = down.target;
    if (!(img instanceof HTMLImageElement) || img.closest('[data-pp-anno]')) return;
    const r0 = img.getBoundingClientRect();
    if (!r0.width || !r0.height) return;
    const pid = down.pointerId;
    const sx = down.clientX, sy = down.clientY;
    let rubber = null;
    const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const geom = (e) => {
      const x1 = cl(Math.min(sx, e.clientX), r0.left, r0.right);
      const x2 = cl(Math.max(sx, e.clientX), r0.left, r0.right);
      const y1 = cl(Math.min(sy, e.clientY), r0.top, r0.bottom);
      const y2 = cl(Math.max(sy, e.clientY), r0.top, r0.bottom);
      return { x1, y1, w: x2 - x1, h: y2 - y1 };
    };
    const cleanup = () => {
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onCancel);
    };
    const onMove = (e) => {
      if (e.pointerId !== pid) return;
      if (!rubber) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
        rubber = el('div', 'pp-anno-rubber'); rubber.dataset.ppAnno = '1'; layer.appendChild(rubber);
      }
      const g = geom(e);
      rubber.style.left = (g.x1 + scrollX) + 'px'; rubber.style.top = (g.y1 + scrollY) + 'px';
      rubber.style.width = g.w + 'px'; rubber.style.height = g.h + 'px';
    };
    const onCancel = (e) => {
      if (e.pointerId !== pid) return;
      cleanup();
      if (rubber) rubber.remove();
    };
    const onUp = (e) => {
      if (e.pointerId !== pid) return;
      cleanup();
      if (!rubber) return;
      rubber.remove();
      suppressClickUntil = Date.now() + 400;
      const g = geom(e);
      if (g.w < 8 || g.h < 8) return;
      openDraftFor(cssPath(img),
        cl((g.x1 - r0.left) / r0.width, 0, 1), cl((g.y1 - r0.top) / r0.height, 0, 1),
        { rw: Math.min(1, g.w / r0.width), rh: Math.min(1, g.h / r0.height) });
    };
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
  }, true);

  function composeAt(e) {
    const node = e.target;
    const r = node.getBoundingClientRect();
    const rx = r.width ? (e.clientX - r.left) / r.width : 0.5;
    const ry = r.height ? (e.clientY - r.top) / r.height : 0.5;
    openDraftFor(cssPath(node), Math.min(1, Math.max(0, rx)), Math.min(1, Math.max(0, ry)));
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-pp-anno]')) return; // 自家 UI 的点击永不抑制（触屏拖拽后 400ms 内点「发送」不能被吞）
    if (Date.now() < suppressClickUntil) { suppressClickUntil = 0; e.preventDefault(); e.stopPropagation(); return; }
    // Tideline：AIM 模式下的粗拇指点 → 吸附最近锚点（openDraftFor 内部退出 AIM）
    if (MOBILE) {
      if (state.mode !== 'comment') return;
      e.preventDefault();
      e.stopPropagation();
      aimTapAt(e.clientX, e.clientY);
      return;
    }
    if (state.mode === 'comment' || e.altKey || (e.metaKey && !e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      // 已有草稿开着：⌥/⌘ 是明确意图直接换锚点；否则这次点击只收掉草稿
      // （空稿关；有稿则 clearDraft 抖动并返回 false → 不重建，保住 textarea 焦点与光标）
      if (state.draft && !e.altKey && !e.metaKey) { if (clearDraft()) { renderDrawer(); render(); syncFlags(); } return; }
      composeAt(e);
      return;
    }
  }, true);

  /* ---------------- 键盘（常驻 j/k + Walk-less） ---------------- */
  document.addEventListener('keydown', (e) => {
    const ae = document.activeElement || {};
    const typing = /INPUT|TEXTAREA|SELECT/.test(ae.tagName || '') || (ae && ae.isContentEditable);
    if (e.key === 'Escape') {
      if (typing) return; // textarea 自己的 onkeydown 处理 Esc
      // 草稿优先放弃（即使同时处于评论模式），再退出评论模式
      if (state.draft) { clearDraft(true); renderDrawer(); render(); }
      if (state.mode === 'comment') exitComment();
      syncFlags();
      return; // 无草稿/非评论模式时为 no-op：不消费 Esc（让图片壳关闭预览）
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'j': case 'J': e.preventDefault(); move(1); break;
      case 'k': case 'K': e.preventDefault(); move(-1); break;
      case 'r': case 'R': e.preventDefault(); if (state.focusedId) void doResolve(state.focusedId); break;
      case 'c': case 'C': e.preventDefault(); state.mode === 'comment' ? exitComment() : enterComment(); break;
      case '\\':
        e.preventDefault();
        if (MOBILE) setDetent(state.detent === 'peek' ? 'half' : 'peek'); // 硬键盘：\ 开合 sheet
        else setRail(!state.railOpen, { refocusTab: !state.railOpen ? false : true });
        break;
      default: break;
    }
  });

  /* ---------------- 宽度感知自动收起 ---------------- */
  function onResizeWidth() {
    const b = widthBucket(innerWidth);
    if (b === lastBucket) return;
    lastBucket = b;
    if (b === 'narrow' && state.railOpen) {
      setRail(false, { auto: true, discard: false, force: true });
      state.autoHint = true;
      const h = el('div', 'pp-anno-aimhint', tr('hint.narrow'));
      h.dataset.ppAnno = '1'; h.dataset.ppRole = 'auto-hint';
      h.style.top = '50%'; h.style.left = 'auto'; h.style.right = '54px'; h.style.transform = 'translateY(-50%)';
      root.appendChild(h);
      setTimeout(() => h.remove(), 2600);
    } else if (b === 'wide' && !state.railOpen) {
      setRail(true, { auto: true });
    }
  }

  addEventListener('resize', () => {
    render();
    if (MOBILE) applyDetent(); // 转屏/工具栏收放：half/full 档高度按新视口重算（形态本身不切换）
    else onResizeWidth();
  });
  addEventListener('load', () => render());

  /* ---------------- 跟随重摆（保留） ---------------- */
  let rafPending = false;
  function scheduleRender() {
    if (!layer || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }
  document.addEventListener('scroll', (e) => { if (e.target !== document) scheduleRender(); }, true);
  new MutationObserver((muts) => {
    for (const m of muts) {
      const n = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (n && n.closest && n.closest('[data-pp-anno]')) continue;
      if (m.type === 'attributes' && m.attributeName === 'class') {
        const before = (m.oldValue || '').split(/\s+/).filter(Boolean);
        const after = [...m.target.classList];
        const diff = before.filter((x) => !after.includes(x)).concat(after.filter((x) => !before.includes(x)));
        if (diff.length && diff.every((cls) => cls.startsWith('pp-anno-'))) continue;
      }
      scheduleRender();
      return;
    }
  }).observe(document.body, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeOldValue: true,
    attributeFilter: ['style', 'class', 'src', 'width', 'height', 'open', 'hidden'],
  });

  /* ---------------- 静默刷新（保留） ---------------- */
  async function refresh() {
    if (document.visibilityState !== 'visible') return;
    if (state.draft) return; // 撰写中不打断
    try {
      const data = await fetchThreads();
      try { momentOnFetch(data, state.threads); } catch (e) { /* 仪式失败不阻断 */ }
      const before = JSON.stringify(state.threads.map((t) => [t.id, t.comments.length, t.resolved]));
      const after = JSON.stringify(data.threads.map((t) => [t.id, t.comments.length, t.resolved]));
      if (before !== after) {
        state.threads = data.threads;
        if (state.focusedId && !byId(state.focusedId)) state.focusedId = null;
        renderDrawer();
        render();
        try { momentAfterRefresh(); } catch (e) { /* 仪式失败不阻断 */ }
      }
    } catch (e) { /* 静默 */ }
  }
  setInterval(refresh, 30000);
  addEventListener('focus', refresh);

  /* ---------------- 图片查看器壳就地换路径（保留契约） ---------------- */
  addEventListener('pagepin:navigate', (e) => {
    const next = e && e.detail && e.detail.path;
    if (!next || next === CFG.path) return;
    if (!clearDraft()) { e.preventDefault(); return; } // 草稿未发：阻断切换
    CFG.path = next;
    state.threads = [];
    state.focusedId = null;
    if (state.mode === 'comment') exitComment();
    renderDrawer();
    render();
    // 守卫乱序响应：快速连续导航时，丢弃晚到的旧 path 结果
    fetchThreads().then((data) => { if (CFG.path !== next) return; state.threads = data.threads; renderDrawer(); render(); }).catch(() => { /* 静默 */ });
  });

  /* ---------------- 深链 #pp-comment-<id>（id 形态宽匹配；长度不设下限——find 兜底） ---------------- */
  /* guest 首访一次性提示:挂在抽屉「+ 评论」按钮下方,8s 或任意点击后消失,只出现一次 */
  function firstOpenHint() {
    if (MOBILE || !isGuest()) return; // 移动端 FAB 自带自我教学(peek-bounce + 文字钮)
    try { if (localStorage.getItem('pp-hint-v1')) return; } catch (e) { return; }
    const btn = drawer && drawer.querySelector('.pp-anno-cbtn');
    if (!btn || !state.railOpen) return;
    const r = btn.getBoundingClientRect();
    const tip = el('div', 'pp-anno-firsthint', tr('hint.firstOpen'));
    tip.dataset.ppAnno = '1';
    tip.style.top = (r.bottom + 10) + 'px';
    tip.style.right = Math.max(8, innerWidth - r.right) + 'px';
    document.body.appendChild(tip);
    requestAnimationFrame(() => tip.classList.add('pp-anno-min'));
    const done = () => {
      tip.classList.remove('pp-anno-min');
      setTimeout(() => tip.remove(), 300);
      try { localStorage.setItem('pp-hint-v1', '1'); } catch (e) { /* 忽略 */ }
      removeEventListener('pointerdown', done, true);
    };
    addEventListener('pointerdown', done, true);
    setTimeout(done, 8000);
  }

  function maybeDeepLink() {
    const m = location.hash.match(/^#pp-comment-([\w-]+)$/);
    if (!m) return;
    const t = state.threads.find((x) => x.id === m[1]);
    if (!t) return;
    if (t.resolved && state.filter !== 'all') { state.filter = 'all'; }
    setTimeout(() => { if (!state.railOpen) setRail(true); focusThread(t.id, true); }, 300);
  }
  // hash 变化也定位：在已打开页里把地址改成 .../#pp-comment-<id> 不会触发重载（只发 hashchange）
  addEventListener('hashchange', maybeDeepLink);

  /* ---------------- 启动（保留身份门控） ---------------- */
  async function boot() {
    loadRail();
    // 带 ?handle=&slug=：登录缺席时服务端据此判该站点的分享会话访客（guest）
    try { state.viewer = await api(`/api/viewer?handle=${encodeURIComponent(CFG.handle)}&slug=${encodeURIComponent(CFG.slug)}`); }
    catch (e) { return; } // 匿名访客：不渲染任何 UI
    buildUI();
    try {
      const data = await fetchThreads();
      state.threads = data.threads;
      momentSeed(data.site_version || null); // 版本基线:此后 site_version 变化 = agent 发了新版本
    } catch (e) {
      if (e.status === 403) { root.remove(); return; } // 站点已关评论
      toast(tr('toast.loadFailed', { error: e.message || '' }));
    }
    renderDrawer();
    render();
    maybeDeepLink();
    firstOpenHint();
    if (MOBILE) {
      // 底部余量：文档根 scroll-padding-bottom（非布局属性，零回流；帮 scrollIntoView/锚点跳转让开 PEEK 档）。
      // 注：真正的底部 spacer 需往宿主页塞节点/改 padding（都被硬约束禁止），相机 flyToEl 已按 sheet 顶边取景兜底。
      try { document.documentElement.style.scrollPaddingBottom = PEEK_H + 'px'; } catch (e) { /* 忽略 */ }
      // 一次性 peek-bounce：sheet 自己动一下 = 「我可以拖」；prefers-reduced-motion 跳过
      if (!REDUCE()) {
        setTimeout(() => {
          if (sheetEl && state.detent === 'peek' && state.sheetDragTop == null) {
            sheetEl.classList.add('pp-anno-nudge');
            setTimeout(() => { if (sheetEl) sheetEl.classList.remove('pp-anno-nudge'); }, 800);
          }
        }, 600);
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void boot());
  else void boot();
})();
