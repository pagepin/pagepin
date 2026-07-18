/* pagepin 评论层 —— 由数据平面 serve HTML 时注入（见 serving.ts）。
 *
 * 约束：
 *  - 宿主页面不可控：所有类名带 pp-anno 前缀、UI 挂独立容器、用户内容一律 textContent 渲染；
 *  - 身份来自 /api/viewer（pp_view 会话）：401 = 匿名访客，静默退出不留痕迹；
 *  - 分享会话访客（guest）：/api/viewer 带 ?handle=&slug= 探测，返回 guest:true 进入访客模式 ——
 *    可建线程/回复/删自己的线程；resolve/reopen/kind 修改控件一律隐藏（服务端对 guest PATCH 401）；
 *    署名走请求体 author_name（localStorage 'pp-guest-name' 预填，留空由服务端落「访客」）；
 *  - 锚点 = CSS 选择器 + 元素内相对偏移；"@page" = 整页评论（无 pin，仅托盘列表项）；
 *    选择器失效（页面改版）降级为托盘里的「锚点丢失」项（不丢评论）。
 *
 * 交互模型（Lumen 桌面：泪滴 pin + at-pin popover + 右下 pill 坞/托盘 + 顶部潮汐珠链 + 仪式感时刻）：
 *  - 右下常驻 pill 坞（[data-pp-role="dock"]）：画笔 = arm 评论模式（[data-pp-act="comment"]），
 *    计数钮（[data-pp-role="dock-count"]，[data-pp-act="collapse"]）= 开合托盘 + 未解决数。
 *  - 托盘（[data-pp-role="tray"]）= 列表面：版本徽章 + 未解决数 + 全部/未解决筛选 + 线程行
 *    （[data-pp-role="card"]，stale/lost/done 徽章）+ 快捷键脚注；零回流（fixed 覆盖，不预留宽度）。
 *  - at-pin popover（[data-pp-role="card"][data-pp-focused="1"]）= 详情面：浮在 pin 旁，
 *    评论流 + 回复 + kind + 解决/重开/删除/复制链接/关闭；随滚动重摆，避让托盘则翻到 pin 左侧。
 *  - 顶部 strand 珠链（[data-pp-role="strand"]，配置位 CFG.strand）：每线程一颗珠，映射文档纵向位置。
 *  - 点 pin/珠/托盘行 = 聚焦（弹 popover + halo + 相机滚动）；导航即「常驻 j/k + 相机」。
 *  - C/画笔进评论模式（十字光标）：点元素 / 在图片上拖框 = 打点，草稿落成锚点旁的浮动气泡；
 *    r 解决并前进（Gmail archive-and-next）、\ 开合托盘、Esc 级联关闭（草稿→popover→seal→横幅→托盘→退模式）。
 *  - 仪式感时刻：发布 sweep 光带 + stale 横幅；resolve 泪滴升腾 + 盖章；全清 = 全屏「潮退沙平」封印 seal。
 *  - #pp-comment-<id> 深链直达并聚焦；窗口聚焦 + 30s 轮询静默刷新。
 *  - 配置位（部署经 script data-*）：glass（false=纯色降级，X5 WebView）、strand（顶栏冲突时可关）、armed（默认进模式）。
 *
 * 移动端形态（Tideline：bottom sheet + AIM 打点）—— 与桌面正交，本次重设计不动：
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
 *   aim-hint / aim-cancel / step-prev / step-next / step-pos；root 带 data-pp-form=tideline|lumen。
 *   桌面 Lumen 钩子：dock / dock-count / tray / strand / card(+data-pp-focused) / draft / copy-link /
 *   reply / send / resolve / reopen / delete / guest-name / guest-badge；data-pp-act=comment|collapse|whole|close-card。
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
    versionN: parseInt(script.dataset.versionN || '', 10) || null, // 版本序数(1 起,展示用;version 是 UUID 只做比对)
    lang: script.dataset.lang,
    // Lumen 配置位（部署可通过 script data-* 覆盖；默认见下）
    glass: script.dataset.glass !== 'false', // 玻璃面（false=纯色降级，X5 WebView）
    strand: script.dataset.strand !== 'false', // 顶部潮汐珠链（宿主有 fixed 顶栏时可关）
    armed: script.dataset.armed === 'true', // 默认进入评论模式
  };
  if (!CFG.handle || !CFG.slug || !CFG.path) return;
  let versionN = CFG.versionN; // 轮询响应 site_version_n 会刷新(发布后横幅要显示新序数)
  const verLabel = () => (versionN ? 'v' + versionN : '');

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
      'action.notePage': 'Note on the whole page',
      'action.copyLink': 'Copy link',
      'action.resolveNext': 'Resolve & next (r)',
      'action.resolve': 'Resolve (r)',
      'action.delete': 'Delete',
      'action.deleteConfirm': 'Delete?',
      'meta.openTotal': '{open} open · {total} total',
      'meta.noComments': 'No comments yet',
      'filter.open': 'Open',
      'filter.all': 'All',
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
      'hint.aim': 'Click an element · drag across text · drag on an image to box a region · Esc to exit',
      'aria.openDrawerUnresolved': 'Open review drawer ({open} unresolved)',
      'aria.openDrawerResolved': 'Open review drawer (all resolved)',
      'banner.resolved': 'Resolved',
      'chip.done': 'done',
      'chip.quote': 'Comment on selection',
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
      // ── Lumen 桌面新增 ──
      'dock.arm': 'Comment mode (c)',
      'dock.armed': 'Comment mode on · Esc to exit',
      'dock.tray': 'pagepin review (\\)',
      'action.closeCard': 'Close (Esc)',
      'card.pos': '{n} / {total}',
      'card.staleVer': 'written on {v} · may be stale',
      'card.lostKept': 'anchor lost · comment kept',
      'badge.lost': 'anchor lost',
      'badge.changed': 'content changed',
      'card.anchorChanged': '⚠ Content changed — still at {selector}',
      'card.resolvedAt': 'Resolved · at {v}',
      'card.resolved': 'Resolved',
      'hint.close': 'close',
      'banner.staleReview': 'Review stale comments',
      'banner.later': 'Later',
      'banner.publishedStale': '{v} published · {n} comment(s) on an older version',
      'seal.title': 'Tide out, sand smooth · All clear',
      'seal.body': 'all {n} comments this round are resolved',
      'seal.continue': 'Click anywhere to continue',
      'draft.publish': 'Publish',
      'draft.textAnchor': 'Text anchor',
      'placeholder.comment': 'comment here…',
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
      'action.notePage': '对整个页面留言',
      'action.copyLink': '复制链接',
      'action.resolveNext': '解决并前进 (r)',
      'action.resolve': '解决 (r)',
      'action.delete': '删除',
      'action.deleteConfirm': '确认删除？',
      'meta.openTotal': '{open} 条未解决 · 共 {total} 条',
      'meta.noComments': '暂无评论',
      'filter.open': '未解决',
      'filter.all': '全部',
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
      'hint.aim': '点击元素 · 拖选文字 · 图片上拖拽框选 · 按 Esc 退出',
      'aria.openDrawerUnresolved': '打开评审抽屉（{open} 条未解决）',
      'aria.openDrawerResolved': '打开评审抽屉（全部已解决）',
      'banner.resolved': '已解决',
      'chip.done': '已解决',
      'chip.quote': '评论选中文字',
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
      // ── Lumen 桌面新增 ──
      'dock.arm': '评论模式 (c)',
      'dock.armed': '评论模式开 · Esc 退出',
      'dock.tray': 'pagepin 评审 (\\)',
      'action.closeCard': '关闭 · Esc',
      'card.pos': '{n} / {total}',
      'card.staleVer': '写于 {v} · 可能过期',
      'card.lostKept': '锚点丢失 · 评论仍保留',
      'badge.lost': '锚点丢失',
      'badge.changed': '内容已变',
      'card.anchorChanged': '⚠ 内容已变 —— 仍在 {selector}',
      'card.resolvedAt': '已解决 · 于 {v}',
      'card.resolved': '已解决',
      'hint.close': '关闭',
      'banner.staleReview': '巡检过期评论',
      'banner.later': '稍后',
      'banner.publishedStale': '{v} 已发布 · {n} 条评论写于旧版本',
      'seal.title': '潮退沙平 · All clear',
      'seal.body': '本轮评审的 {n} 条评论已全部解决',
      'seal.continue': '点击任意处继续',
      'draft.publish': '发布',
      'draft.textAnchor': '文本锚点',
      'placeholder.comment': '评论这里…',
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

  // ── 形态判定（Tideline vs 桌面 Lumen 层）：启动时一次定死，会话内不随 resize 切换 ──
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
    filter: 'open', // open | all（托盘与 pin：是否显示已解决）
    focusedId: null, // 当前弹出 popover 的线程
    mode: 'rest', // rest | comment（十字光标打点模式）
    railOpen: true, // Lumen 托盘是否展开（railOpen 语义从抽屉迁移到托盘）
    draft: null, // { selector, rx, ry, box, kind, _cleanup } 新建草稿
    replyStash: new Map(), // threadId -> 未发送回复草稿
    detent: 'peek', // Tideline：sheet 当前档位 peek | half | full
    sheetDragTop: null, // Tideline：拖拽中 sheet 顶边实时 y（松手吸附后清空）
    seal: null, // Lumen 全清封印覆盖层 DOM（在场时非空）
  };

  // 托盘开合偏好持久化（全局共享；键名沿用 pp-anno-rail，语义=托盘开合）
  const RAIL_KEY = 'pp-anno-rail';
  function loadRail() {
    // Tideline 无托盘：railOpen 恒 true，让共享路径里的 `if (!state.railOpen) setRail(true)` 全部 no-op
    if (MOBILE) { state.railOpen = true; return; }
    let manual = null;
    try {
      const v = JSON.parse(localStorage.getItem(RAIL_KEY) || '{}');
      if (v && typeof v === 'object' && typeof v.open === 'boolean') manual = v.open;
    } catch (e) { /* localStorage 不可用：忽略 */ }
    // 手动偏好优先；无偏好时默认展开（评审者一进来就看到评论列表）
    state.railOpen = manual != null ? manual : true;
  }
  function persistRail() {
    try { localStorage.setItem(RAIL_KEY, JSON.stringify({ open: state.railOpen })); }
    catch (e) { /* 忽略 */ }
  }

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
    pen: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    up: '<path d="m5 12 7-7 7 7M12 19V5"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    seal: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
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

  /* ---------------- 样式（Lumen 桌面 + Tideline 移动） ---------------- */
  // Lumen 系统字体栈（去掉从未加载的 'Hanken Grotesk'/'JetBrains Mono' 幽灵字体名）
  const LUM_SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif`;
  const LUM_MONO = `ui-monospace,SFMono-Regular,Menlo,monospace`;
  const STYLE = `
  .pp-anno-root{position:absolute;top:0;left:0;width:100%;height:0;font-family:${LUM_SANS};font-size:14px;line-height:1.55;color:#11161b;transform:none;filter:none}
  .pp-anno-root *{box-sizing:border-box;margin:0;padding:0}
  .pp-anno-ic{display:inline-flex}.pp-anno-ic svg{display:block}
  .pp-anno-mode-on:not(.pp-anno-paused){cursor:crosshair}
  .pp-anno-mode-on:not(.pp-anno-paused) *:not(.pp-anno-root, .pp-anno-root *){cursor:crosshair!important}
  /* 意图跟随:指针压在文字字形上 → I-beam(可选字暗示),盖过十字 */
  .pp-anno-mode-on.pp-anno-text-intent:not(.pp-anno-paused){cursor:text}
  .pp-anno-mode-on.pp-anno-text-intent:not(.pp-anno-paused) *:not(.pp-anno-root, .pp-anno-root *){cursor:text!important}
  /* 评论模式的选区染潮色:选中时看到的 = 发布后高亮条的同一视觉语言 */
  .pp-anno-mode-on ::selection{background:rgba(20,149,138,.28)}
  /* 评论/AIM 模式下触屏在图片上拖拽 = 框选而非滚页（Pointer Events 框选的触屏前提） */
  .pp-anno-mode-on:not(.pp-anno-paused) img{touch-action:none!important}
  .pp-anno-hover-hint{outline:2px solid #14958a!important;outline-offset:3px!important;
    box-shadow:0 0 0 6px rgba(61,175,164,.14),0 0 26px 2px rgba(61,175,164,.26)!important;
    border-radius:6px;transition:box-shadow .2s ease,outline-color .2s ease!important}
  .pp-anno-bound{outline:2px solid rgba(15,124,114,.85)!important;outline-offset:2px!important;box-shadow:0 0 0 5px rgba(15,124,114,.12)!important}
  /* ── pin（泪滴，kind 上色，白圈在任意宿主色上都清晰） ── */
  .pp-anno-layer{position:absolute;top:0;left:0;width:100%;height:0;z-index:2147482000;transform:none;filter:none}
  .pp-anno-pin{position:absolute;z-index:2147482600;width:28px;height:28px;border-radius:50% 50% 50% 4px;display:grid;place-items:center;color:#fff;font:700 12px/1 ${LUM_SANS};cursor:pointer;transform:translate(-4px,-24px);border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25);user-select:none;transition:transform .15s,box-shadow .15s}
  .pp-anno-pin:hover{transform:translate(-4px,-24px) scale(1.12)}
  .pp-anno-pin.pp-anno-pulse{animation:lumPinPop .32s cubic-bezier(.2,.8,.3,1) both}
  @keyframes lumPinPop{0%{opacity:0;transform:translate(-4px,-24px) scale(.3)}
    65%{transform:translate(-4px,-24px) scale(1.12)}
    100%{opacity:1;transform:translate(-4px,-24px) scale(1)}}
  .pp-anno-pin.pp-anno-pulse::after{content:'';position:absolute;inset:-3px;border-radius:inherit;
    border:2px solid rgba(20,149,138,.7);animation:ppPinRing .7s cubic-bezier(.2,.8,.3,1) .12s both;pointer-events:none}
  @keyframes ppPinRing{0%{transform:scale(.7);opacity:.9}100%{transform:scale(2.1);opacity:0}}
  .pp-anno-pin.pp-anno-resolved{filter:saturate(.4);box-shadow:0 2px 6px rgba(28,26,23,.2)}
  .pp-anno-pin.pp-anno-current{transform:translate(-4px,-24px) scale(1.16);z-index:2147482650;box-shadow:0 0 0 4px rgba(20,149,138,.2),0 3px 8px rgba(0,0,0,.28)}
  .pp-anno-pin.pp-anno-current:hover{transform:translate(-4px,-24px) scale(1.16)}
  /* 模式外随选随评浮钮(Docs 式):选区尾浮出,泪滴形与 pin 同语言 */
  .pp-anno-qchip{position:absolute;z-index:2147482600;margin-top:-14px;width:28px;height:28px;border-radius:999px 999px 999px 4px;border:2px solid #fff;background:#0f7c72;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;box-shadow:0 2px 6px rgba(0,0,0,.25);animation:lumBubbleIn .2s cubic-bezier(.2,.8,.3,1) both}
  .pp-anno-qchip:hover{background:#0b6358}
  .pp-anno-region{position:absolute;z-index:2147481900;border:2px solid;border-radius:5px;pointer-events:none;box-sizing:border-box}
  /* 文本锚点高亮条(quote 命中行;桌面 render 内联开 pointer-events) */
  .pp-anno-hlrect{position:absolute;z-index:2147481900;border-radius:2px;pointer-events:none;box-sizing:border-box;transition:background .18s}
  .pp-anno-hlrect.pp-anno-resolved{opacity:.6}
  /* 评论模式内高亮条/区域框让路:打点/选字直达底下的页面元素(阅读态仍可点它们聚焦线程) */
  .pp-anno-mode-on .pp-anno-hlrect,.pp-anno-mode-on .pp-anno-region{pointer-events:none!important}
  .pp-anno-region.pp-anno-resolved{opacity:.35;filter:saturate(.3)}
  /* 桌面 box 区域 = Lumen highlight（底部 2px line；可点=聚焦线程）——移动端保持原全框，勿改 */
  .pp-anno-root:not(.pp-anno-mobile) .pp-anno-region{border:none;border-bottom:2px solid;border-radius:2px;transition:background .18s}
  .pp-anno-root:not(.pp-anno-mobile) .pp-anno-region.pp-anno-resolved{opacity:.7}
  .pp-anno-rubber{position:absolute;z-index:2147482700;border:2px dashed #0f7c72;background:rgba(15,124,114,.08);border-radius:5px;pointer-events:none;box-sizing:border-box}
  /* ── 发光相机：聚焦元素套发光环（不可交互） ── */
  .pp-anno-glow{position:absolute;z-index:2147481950;border-radius:8px;pointer-events:none;box-sizing:border-box;animation:ppBloom .6s cubic-bezier(.2,.8,.3,1) both}
  @keyframes ppBloom{0%{opacity:0;transform:scale(1.04)}40%{opacity:1}100%{opacity:.95;transform:scale(1)}}
  /* filterSeg（托盘与 sheet 共用的 All/Open 段） */
  .pp-anno-seg{display:inline-flex;align-items:center;border:1px solid #e1e4e6;border-radius:999px;padding:2px;gap:2px}
  .pp-anno-seg button{border:none;background:transparent;cursor:pointer;font:600 11px/1 ${LUM_SANS};color:#6b7480;padding:4px 11px;border-radius:999px}
  .pp-anno-seg button.pp-anno-on{background:rgba(230,244,242,.9);color:#0b6358}
  /* 对整页留言小钮（托盘头 + sheet bar 共用） */
  .pp-anno-wbtn{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px dashed #cdd3d9;cursor:pointer;border-radius:999px;background:transparent;color:#6b7480;font:600 12px/1 ${LUM_SANS};padding:6px 11px}
  .pp-anno-wbtn:hover{border-color:#0f7c72;color:#0f7c72}
  /* ── 线程卡（Tideline sheet 复用；桌面详情走 .pp-anno-pop popover） ── */
  .pp-anno-card{position:relative;margin-bottom:8px;border:1px solid #e7e9eb;border-radius:11px;background:#fff;overflow:hidden;cursor:pointer;box-shadow:0 1px 2px rgba(17,22,27,.04);transition:box-shadow .24s cubic-bezier(.2,.8,.3,1),border-color .2s,opacity .2s;animation:ppCard .2s cubic-bezier(.2,1.3,.4,1)}
  @keyframes ppCard{from{opacity:0;transform:translateY(6px) scale(.98)}}
  .pp-anno-card:hover{border-color:#d7dadd}
  .pp-anno-card.pp-anno-focused{cursor:default;border-color:#d7dadd;box-shadow:0 2px 8px rgba(17,22,27,.06),0 14px 30px -12px rgba(17,22,27,.14)}
  .pp-anno-card.pp-anno-dim{opacity:.66}
  .pp-anno-card-rail{position:absolute;top:0;bottom:0;left:0;width:3px}
  .pp-anno-card-bd{padding:9px 10px 9px 12px}
  .pp-anno-card-hd{display:flex;align-items:center;gap:8px}
  .pp-anno-num{flex:none;width:20px;height:20px;border-radius:50% 50% 50% 3px;display:grid;place-items:center;color:#fff;font:700 10.5px/1 ${LUM_SANS}}
  .pp-anno-ava{flex:none;border-radius:50%;display:grid;place-items:center;color:#fff;font:700 11px/1 ${LUM_SANS}}
  .pp-anno-who{font-size:12.5px;font-weight:600;color:#11161b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}
  .pp-anno-when{font-size:10.5px;color:#b3b9bf;font-weight:400}
  .pp-anno-anchor{font:600 10px/1 ${LUM_MONO};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}
  .pp-anno-stalebadge{font:600 10px/1 ${LUM_SANS};color:#b08423}
  .pp-anno-card-acts{margin-left:auto;display:flex;align-items:center;gap:2px;flex:none}
  .pp-anno-iconbtn{border:none;background:none;cursor:pointer;color:#9aa1a9;padding:5px;border-radius:6px;display:inline-flex}
  .pp-anno-iconbtn:hover{background:#f1f3f4;color:#0f7c72}
  .pp-anno-resolvebtn{border:1px solid #e1e4e6;background:#fff;cursor:pointer;color:#9aa1a9;width:24px;height:24px;border-radius:7px;display:grid;place-items:center}
  .pp-anno-resolvebtn:hover{border-color:#0f7c72;color:#0f7c72}
  .pp-anno-donechip{flex:none;display:inline-flex;align-items:center;gap:4px;font:700 9.5px/1 ${LUM_SANS};text-transform:uppercase;letter-spacing:.04em;color:#8a929b;background:#eef0f1;border-radius:999px;padding:3px 7px}
  .pp-anno-snippet{margin-top:6px;font-size:12px;line-height:1.45;color:#5c636b;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
  .pp-anno-card-ft{margin-top:7px;display:flex;align-items:center;gap:9px;font-size:10.5px;color:#b3b9bf}
  .pp-anno-kindlab{display:inline-flex;align-items:center;gap:4px;font-weight:600}
  .pp-anno-kindlab i{width:6px;height:6px;border-radius:50%;display:inline-block}
  /* 聚焦卡展开区 */
  .pp-anno-resolved-banner{display:flex;align-items:center;gap:6px;background:#f4f6f7;padding:6px 11px;font:700 10px/1 ${LUM_SANS};text-transform:uppercase;letter-spacing:.05em;color:#8a929b}
  .pp-anno-msgs{margin-top:9px;display:flex;flex-direction:column;gap:9px}
  .pp-anno-msg{display:flex;gap:8px}
  .pp-anno-msg>div:last-child{flex:1;min-width:0}
  .pp-anno-msg-line{display:flex;align-items:center;gap:6px}
  .pp-anno-txt{font-size:12.5px;line-height:1.5;margin-top:2px;color:#34302b;word-break:break-word;white-space:pre-wrap}
  .pp-anno-chips{display:flex;gap:5px;margin-top:9px;flex-wrap:wrap}
  .pp-anno-chip2{display:inline-flex;align-items:center;gap:5px;font:600 10.5px/1 ${LUM_SANS};padding:4px 8px;border-radius:999px;border:1px solid #e1e4e6;background:#fff;color:#8a929b;cursor:pointer;white-space:nowrap}
  .pp-anno-chip2 i{width:6px;height:6px;border-radius:50%;display:inline-block}
  .pp-anno-chip2.pp-anno-on{color:#fff;border-color:transparent}
  .pp-anno-chip2.pp-anno-on i{background:#fff!important}
  .pp-anno-replyarea{margin-top:9px}
  .pp-anno-replybtn{width:100%;display:flex;align-items:center;gap:7px;border:1px dashed #e1e4e6;background:#fff;cursor:pointer;border-radius:8px;padding:8px 10px;font:500 12px/1 ${LUM_SANS};color:#9aa1a9}
  .pp-anno-replybtn:hover{border-color:#0f7c72;color:#0f7c72}
  .pp-anno-replybtn kbd{margin-left:auto;font:700 9px/1 ${LUM_MONO};color:#9aa1a9;border:1px solid #e1e4e6;background:#fff;border-radius:4px;padding:1px 4px}
  .pp-anno-ta-wrap{border:1.5px solid #cdd3d9;border-radius:9px;background:#fafbfb;padding:6px;transition:border-color .15s}
  .pp-anno-ta-wrap:focus-within{border-color:#0f7c72;background:#fff}
  .pp-anno-ta-wrap textarea{width:100%;border:none;background:transparent;resize:none;font:400 12.5px/1.5 ${LUM_SANS};color:#11161b;outline:none}
  .pp-anno-nameinput{width:100%;border:none;border-bottom:1px dashed #e1e4e6;background:transparent;font:600 11.5px/1.4 ${LUM_SANS};color:#11161b;outline:none;padding:2px 2px 5px;margin-bottom:5px}
  .pp-anno-nameinput::placeholder{color:#b3b9bf;font-weight:400}
  .pp-anno-guestbadge{flex:none;font:600 9px/1 ${LUM_SANS};text-transform:uppercase;letter-spacing:.04em;color:#9aa1a9;border:1px solid #e1e4e6;border-radius:4px;padding:1.5px 4px}
  .pp-anno-ta-row{display:flex;align-items:center;gap:8px;margin-top:6px}
  .pp-anno-hint{font-size:10.5px;color:#b3b9bf}
  .pp-anno-send{margin-left:auto;background:#0f7c72;color:#fff;border:none;padding:6px 12px;border-radius:7px;font:600 11.5px/1 ${LUM_SANS};cursor:pointer;display:inline-flex;align-items:center;gap:5px}
  .pp-anno-send:hover{background:#0b6358}.pp-anno-send:disabled{opacity:.4;cursor:default}
  .pp-anno-ghost{background:#fff;border:1px solid #e1e4e6;color:#8a929b;padding:6px 11px;border-radius:7px;font:600 11.5px/1 ${LUM_SANS};cursor:pointer}
  .pp-anno-ghost:hover{border-color:#0f7c72;color:#0f7c72}
  .pp-anno-del{color:#b14a42!important}
  .pp-anno-del.pp-anno-armed{color:#fff!important;background:#c2361b!important;padding:5px 8px!important}
  /* 草稿卡 */
  .pp-anno-draft{border:2px solid #0f7c72;box-shadow:0 14px 30px -12px rgba(17,22,27,.18)}
  .pp-anno-draft.pp-anno-shaking{animation:ppShake .3s}
  @keyframes ppShake{0%,100%{margin-left:0}25%{margin-left:-7px}75%{margin-left:7px}}
  .pp-anno-seltag{margin-left:auto;font:600 10px/1 ${LUM_MONO};color:#8a929b;background:#f1f3f4;border-radius:6px;padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}
  /* 空态 */
  .pp-anno-empty{text-align:center;color:#9aa1a9;font-size:12px;padding:30px 18px;line-height:1.7}
  /* ── toast（Lumen：底部居中深色胶囊 + 青绿 ✓） ── */
  .pp-anno-toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);z-index:2147483100;background:rgba(17,22,27,.92);color:#fff;font-size:12.5px;font-weight:500;padding:8px 14px;border-radius:10px;box-shadow:0 12px 30px -10px rgba(0,0,0,.4);animation:lumToast .22s cubic-bezier(.2,.8,.3,1) both;display:inline-flex;align-items:center;gap:8px}
  .pp-anno-toast .pp-anno-ic{color:#7fe3d6}
  @keyframes ppPop{from{opacity:0;transform:translateX(-50%) translateY(6px)}}
  .pp-anno-aimhint{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:2147483100;background:rgba(17,22,27,.92);color:#fff;font:500 12px/1 ${LUM_SANS};padding:9px 14px;border-radius:9px;box-shadow:0 10px 28px -10px rgba(17,22,27,.5);animation:ppPop .2s}
  /* ── Tideline（移动端 bottom sheet 形态；激活条件见文件头，≤520px 的旧满宽抽屉规则已被本形态取代） ── */
  .pp-anno-sheet{position:fixed;left:0;right:0;z-index:2147483000;display:flex;flex-direction:column;
    background:rgba(255,255,255,.97);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
    border-top:1px solid #e1e4e6;border-radius:18px 18px 0 0;
    box-shadow:0 -10px 34px -16px rgba(17,22,27,.4);
    transition:top .28s cubic-bezier(.2,.8,.3,1),height .28s cubic-bezier(.2,.8,.3,1)}
  .pp-anno-sheet *{font-family:${LUM_SANS}}
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
  .pp-anno-sheetmeta-line{font:700 13px/1.2 ${LUM_SANS};color:#11161b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pp-anno-dots{display:flex;gap:4px;margin-top:5px;overflow:hidden}
  .pp-anno-dots i{flex:none;width:7px;height:7px;border-radius:50%;display:inline-block}
  .pp-anno-fab{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:10px 15px;border:none;cursor:pointer;border-radius:12px;background:#0f7c72;color:#fff;font:700 13px/1 ${LUM_SANS};box-shadow:0 6px 18px -6px rgba(15,124,114,.55)}
  .pp-anno-fab:active{transform:scale(.96)}
  .pp-anno-sheetlist{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:2px 12px 14px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:none;-ms-overflow-style:none}
  .pp-anno-sheetlist::-webkit-scrollbar{width:0;height:0}
  .pp-anno-sheetbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.95);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:4px 2px 8px;margin-bottom:6px}
  /* AIM 瞄准模式：整页压暗（SVG evenodd 挖洞=点亮可锚定元素）+ 点亮框 + 底部指令条 */
  .pp-anno-aimdim{position:absolute;left:0;top:0;z-index:2147482300;pointer-events:none}
  .pp-anno-aimbox{position:absolute;z-index:2147482400;pointer-events:none;border:1.5px dashed #14958a;border-radius:8px;background:rgba(20,149,138,.08);box-sizing:border-box}
  .pp-anno-aimchip{position:fixed;left:50%;transform:translateX(-50%);z-index:2147482950;display:flex;align-items:center;gap:8px;background:rgba(17,22,27,.95);color:#fff;border-radius:12px;padding:8px 8px 8px 14px;font:600 12.5px/1.35 ${LUM_SANS};box-shadow:0 12px 30px -10px rgba(17,22,27,.6);animation:ppPop .2s;max-width:calc(100vw - 24px)}
  .pp-anno-aimchip button{flex:none;border:none;cursor:pointer;border-radius:9px;background:rgba(255,255,255,.16);color:#fff;font:700 11.5px/1 ${LUM_SANS};padding:0 12px;min-height:40px}
  .pp-anno-aim .pp-anno-pin,.pp-anno-aim .pp-anno-region,.pp-anno-aim .pp-anno-hlrect,.pp-anno-aim .pp-anno-glow{display:none}
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
  .pp-anno-steppos{font:600 11.5px/1 ${LUM_MONO};color:#8a929b}
  /* ── 评论模式晕影(真实节点,避免与宿主页 html::after 冲突) ── */
  .pp-anno-vignette{position:fixed;inset:0;pointer-events:none;z-index:2147481700;
    box-shadow:inset 0 0 170px 24px rgba(11,99,88,.09);animation:ppVig .7s cubic-bezier(.2,.8,.3,1) both}
  @keyframes ppVig{from{opacity:0}to{opacity:1}}
  /* ── 循环时刻(克制档):新版本横幅 / 修复回执 / 收敛回执 ── */
  .pp-anno-mtbanner{position:fixed;top:14px;left:50%;z-index:2147483200;display:flex;align-items:center;gap:10px;
    padding:9px 10px 9px 14px;border-radius:999px;background:rgba(255,255,255,.96);border:1px solid #bfe5df;
    box-shadow:0 8px 30px -8px rgba(11,99,88,.35),0 1px 3px rgba(17,22,27,.08);
    font-family:${LUM_SANS};
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
    box-shadow:0 10px 32px -10px rgba(11,99,88,.4);font-family:${LUM_SANS};
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
    font-family:${LUM_SANS}}
  .pp-anno-mfinale .pp-anno-mfc{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;
    background:#0f7c72;color:#fff;transform:scale(0);animation:ppMStamp .4s cubic-bezier(.2,1.4,.4,1) .1s forwards}
  .pp-anno-mfinale .pp-anno-mfc svg{width:22px;height:22px}
  .pp-anno-mfinale b{font-size:14.5px;font-weight:800;color:#11161b;margin-top:12px;letter-spacing:-.01em}
  .pp-anno-mfinale span{font-size:12px;color:#57606a;margin-top:5px;line-height:1.6}
  .pp-anno-mfinale em{font-style:normal;font-weight:700;color:#0b6358}
  /* ── guest 首访一次性提示 ── */
  .pp-anno-firsthint{position:fixed;z-index:2147483100;max-width:230px;padding:9px 12px;border-radius:11px;
    background:#11161b;color:#fff;font:600 12px/1.5 ${LUM_SANS};
    box-shadow:0 10px 30px -8px rgba(17,22,27,.5);
    transform:translateY(4px);opacity:0;transition:transform .3s cubic-bezier(.2,1.3,.4,1),opacity .2s ease}
  .pp-anno-firsthint.pp-anno-min{transform:none;opacity:1}
  .pp-anno-firsthint::after{content:'';position:absolute;top:-5px;right:26px;width:10px;height:10px;
    background:#11161b;transform:rotate(45deg)}
  .pp-anno-firsthint.pp-anno-hint-up::after{top:auto;bottom:-5px}
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
  @media (prefers-reduced-motion:reduce){.pp-anno-root *,.pp-anno-root{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
  @media print{.pp-anno-root,.pp-anno-sheet{display:none!important}}

  /* ================= Lumen 桌面层 ================= */
  /* keyframes（原样抄自设计稿） */
  @keyframes lumBubbleIn{0%{opacity:0;transform:translateY(10px) scale(.92)}60%{transform:translateY(-2px) scale(1.01)}100%{opacity:1;transform:none}}
  @keyframes lumSweep{0%{transform:translateX(-100%);opacity:0}12%{opacity:1}88%{opacity:1}100%{transform:translateX(100%);opacity:0}}
  @keyframes lumBannerIn{from{opacity:0;transform:translate(-50%,-14px)}to{opacity:1;transform:translate(-50%,0)}}
  @keyframes lumSealIn{0%{opacity:0;transform:scale(.86)}55%{transform:scale(1.03)}100%{opacity:1;transform:scale(1)}}
  @keyframes lumSealBg{from{opacity:0}to{opacity:1}}
  @keyframes lumHalo{0%{opacity:0;transform:scale(.7)}45%{opacity:.8}100%{opacity:0;transform:scale(1.5)}}
  @keyframes lumBreathe{0%{transform:scale(.82);opacity:.55}70%,100%{transform:scale(1.32);opacity:0}}
  @keyframes lumRise{0%{opacity:.9;transform:translate(-4px,-24px) scale(1)}100%{opacity:0;transform:translate(-4px,-120px) scale(.55)}}
  @keyframes lumToast{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
  @keyframes lumDockIn{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
  @keyframes lumShimmerB{0%,100%{box-shadow:0 0 0 0 rgba(217,119,6,.16)}50%{box-shadow:0 0 0 5px rgba(217,119,6,.04)}}

  /* 聚焦 pin 呼吸环（桌面；移动端关） */
  .pp-anno-pin.pp-anno-current::after{content:'';position:absolute;inset:-7px;border-radius:999px;border:2px solid var(--pp-ring,#14958a);opacity:.55;animation:lumBreathe 2.2s ease-out infinite;pointer-events:none}
  .pp-anno-mobile .pp-anno-pin.pp-anno-current::after{display:none}
  /* 焦点 halo（一次性环） */
  .pp-anno-halo{position:absolute;z-index:2147481960;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:999px;border:2px solid;animation:lumHalo .65s ease-out both;pointer-events:none}
  /* resolve 泪滴升腾 */
  .pp-anno-riser{position:absolute;z-index:2147482550;width:28px;height:28px;border-radius:999px 999px 999px 4px;animation:lumRise .7s cubic-bezier(.3,.7,.4,1) both;pointer-events:none}

  /* ── 右下 pill 坞（常驻） ── */
  .pp-anno-dock{position:fixed;right:16px;bottom:16px;z-index:2147482440;display:flex;align-items:center;height:44px;border-radius:999px;border:1px solid rgba(17,22,27,.1);background:rgba(255,255,255,.96);box-shadow:0 12px 30px -12px rgba(17,22,27,.45);overflow:hidden;font-family:${LUM_SANS}}
  .pp-anno-dock-arm{display:flex;width:46px;height:44px;align-items:center;justify-content:center;border:none;background:transparent;color:#9aa1a9;cursor:pointer;transition:background .2s,color .2s}
  .pp-anno-dock-arm.pp-anno-on{background:#0f7c72;color:#fff}
  .pp-anno-dock-sep{width:1px;height:24px;background:rgba(17,22,27,.08)}
  .pp-anno-dock-count{display:flex;height:44px;align-items:center;gap:7px;border:none;background:transparent;padding:0 14px;font:700 13px/1 ${LUM_SANS};color:#11161b;cursor:pointer}
  .pp-anno-dock-count:focus-visible{outline:2px solid #0f7c72;outline-offset:-2px}
  .pp-anno-dock-dot{width:8px;height:8px;border-radius:999px;background:#0f7c72;box-shadow:0 0 0 3px rgba(15,124,114,.18)}

  /* ── 托盘（列表面） ── */
  .pp-anno-tray{position:fixed;right:16px;bottom:70px;z-index:2147482420;width:324px;border-radius:14px;border:1px solid rgba(17,22,27,.1);background:var(--lum-surface);box-shadow:0 24px 60px -20px rgba(17,22,27,.35);overflow:hidden;font-family:${LUM_SANS};animation:lumDockIn .24s cubic-bezier(.2,.8,.3,1) both}
  .pp-anno-tray-hd{display:flex;flex-wrap:wrap;align-items:center;gap:8px;border-bottom:1px solid rgba(17,22,27,.07);padding:9px 12px}
  .pp-anno-tray-brand{display:flex;align-items:center;gap:7px;font:700 12.5px/1 ${LUM_SANS};color:#11161b}
  .pp-anno-tray-ver{font:400 11px/1 ${LUM_MONO};color:#6b7480;background:rgba(17,22,27,.05);border-radius:999px;padding:3px 9px}
  .pp-anno-tray-open{font-size:12px;color:#4b535c}
  .pp-anno-tray-open b{color:#0f7c72}
  .pp-anno-tray-filters{display:flex;align-items:center;gap:6px;padding:8px 12px 0}
  .pp-anno-traylist{max-height:300px;overflow-y:auto;padding:6px;scrollbar-width:none;-ms-overflow-style:none;overscroll-behavior:contain}
  .pp-anno-traylist::-webkit-scrollbar{width:0;height:0}
  .pp-anno-tray-ft{display:flex;gap:10px;flex-wrap:wrap;border-top:1px solid rgba(17,22,27,.07);padding:7px 13px;font:400 10.5px/1.4 ${LUM_MONO};color:#9aa1a9}
  /* 托盘行 */
  .pp-anno-trow{display:flex;width:100%;align-items:flex-start;gap:9px;border:none;background:transparent;border-radius:10px;padding:9px 10px;text-align:left;cursor:pointer;transition:background .15s;font-family:${LUM_SANS}}
  .pp-anno-trow:hover{background:rgba(17,22,27,.04)}
  .pp-anno-trow.pp-anno-on{background:rgba(20,149,138,.14)}
  .pp-anno-trow-n{flex:none;display:flex;width:20px;height:20px;align-items:center;justify-content:center;border-radius:999px 999px 999px 3px;color:#fff;font:700 10.5px/1 ${LUM_SANS};margin-top:1px}
  .pp-anno-trow-bd{min-width:0;flex:1}
  .pp-anno-trow-l1{display:flex;align-items:center;gap:6px}
  .pp-anno-trow-lab{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 11px/1.3 ${LUM_MONO}}
  .pp-anno-trow-ex{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;font-size:12px;color:#6b7480}
  .pp-anno-badge-stale{flex:none;border-radius:999px;background:rgba(254,243,219,.9);border:1px solid #f3d9a4;color:#92600a;font:700 9px/1.4 ${LUM_SANS};padding:1px 6px}
  .pp-anno-badge-lost{flex:none;border-radius:999px;background:rgba(17,22,27,.05);border:1px dashed rgba(17,22,27,.22);color:#6b7480;font:700 9px/1.4 ${LUM_SANS};padding:1px 6px;animation:lumShimmerB 1.8s ease-in-out .4s 3}
  .pp-anno-badge-done{flex:none;display:inline-flex;align-items:center;gap:3px;border-radius:999px;background:rgba(230,244,242,.9);color:#0b6358;font:700 9px/1.4 ${LUM_SANS};padding:1px 6px}
  .pp-anno-tray-empty{padding:26px 16px;text-align:center;font-size:12px;color:#9aa1a9;line-height:1.7;white-space:pre-line}

  /* ── at-pin 线程卡 popover（详情面） ── */
  .pp-anno-card.pp-anno-pop{position:absolute;margin:0;width:312px;border:1px solid rgba(17,22,27,.1);border-radius:16px 16px 16px 4px;background:var(--lum-surface);box-shadow:0 4px 12px rgba(17,22,27,.08),0 26px 64px -20px rgba(17,22,27,.32);overflow:visible;cursor:default;z-index:2147482500;animation:lumBubbleIn .26s cubic-bezier(.2,.8,.3,1) both;font-family:${LUM_SANS}}
  .pp-anno-pop-hd{display:flex;align-items:center;gap:8px;padding:11px 14px 0}
  .pp-anno-pop-sel{font:400 11px/1.3 ${LUM_MONO};color:#6b7480;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}
  .pp-anno-pop-pos{margin-left:auto;flex:none;font:400 10.5px/1 ${LUM_MONO};color:#9aa1a9}
  .pp-anno-pop-ib{display:flex;flex:none;width:26px;height:26px;align-items:center;justify-content:center;border:none;background:transparent;border-radius:8px;color:#9aa1a9;cursor:pointer}
  .pp-anno-pop-ib:hover{background:rgba(17,22,27,.05);color:#0f7c72}
  .pp-anno-pop-ib.pp-anno-del:hover{background:rgba(194,54,27,.1)}
  .pp-anno-pop-ib.pp-anno-del.pp-anno-armed{width:auto;padding:0 8px;background:#c2361b;color:#fff;font:700 10.5px/1 ${LUM_SANS}}
  .pp-anno-pop-msgs{max-height:250px;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:11px;scrollbar-width:none;-ms-overflow-style:none}
  .pp-anno-pop-msgs::-webkit-scrollbar{width:0;height:0}
  .pp-anno-pop-ft{border-top:1px solid rgba(17,22,27,.07);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
  .pp-anno-pop .pp-anno-resolved-banner{display:flex;align-items:center;gap:6px;margin:8px 14px 0;border-radius:10px;background:rgba(230,244,242,.85);padding:6px 10px;font:700 11.5px/1 ${LUM_SANS};text-transform:none;letter-spacing:0;color:#0b6358}
  .pp-anno-pop-reopen{margin-left:auto;border:1px solid #bfe5df;background:rgba(255,255,255,.85);border-radius:999px;padding:2px 10px;font:600 10.5px/1 ${LUM_SANS};color:#0b6358;cursor:pointer}
  .pp-anno-pop-resolve{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(17,22,27,.12);background:rgba(255,255,255,.7);border-radius:10px;padding:8px 0;font:600 12px/1 ${LUM_SANS};color:#4b535c;cursor:pointer;width:100%}
  .pp-anno-pop-delbtn{display:flex;align-items:center;justify-content:center;gap:6px;border:none;background:transparent;border-radius:10px;padding:5px 0;font:600 11px/1 ${LUM_SANS};color:#b3b9bf;cursor:pointer}
  .pp-anno-pop-delbtn:hover{color:#b3423a;background:rgba(179,66,58,.06)}
  .pp-anno-pop-delbtn.pp-anno-armed{color:#b3423a}
  .pp-anno-pop-resolve:hover{border-color:#0f7c72;color:#0f7c72}
  /* popover 内回复框：把共享 .pp-anno-replyarea/.pp-anno-ta-wrap 收进 Lumen 皮 */
  .pp-anno-pop .pp-anno-replyarea{margin:0}
  .pp-anno-pop .pp-anno-ta-wrap{border:1px solid rgba(17,22,27,.12);border-radius:10px;background:rgba(255,255,255,.7)}
  .pp-anno-ta-row-lum{display:flex;align-items:flex-end;gap:6px}
  .pp-anno-ta-row-lum .pp-anno-ta-wrap{flex:1;min-width:0}
  .pp-anno-send-lum{flex:none;width:36px;height:36px;padding:0;border-radius:10px;display:flex;align-items:center;justify-content:center}
  .pp-anno-pop .pp-anno-ta-wrap:focus-within{border-color:#0f7c72;background:#fff}

  /* ── 就地草稿气泡 ── */
  .pp-anno-dbubble{position:absolute;width:300px;border:1px solid rgba(17,22,27,.1);border-radius:16px 16px 16px 4px;background:var(--lum-surface);box-shadow:0 4px 12px rgba(17,22,27,.08),0 24px 60px -20px rgba(17,22,27,.3);padding:12px 14px;z-index:2147482700;animation:lumBubbleIn .26s cubic-bezier(.2,.8,.3,1) both;font-family:${LUM_SANS}}
  .pp-anno-dbubble.pp-anno-shaking{animation:ppShake .3s}
  .pp-anno-dbubble-row{display:flex;align-items:flex-start;gap:8px}
  .pp-anno-dbubble textarea{flex:1;resize:none;border:none;background:transparent;font:400 13.5px/1.55 ${LUM_SANS};color:#11161b;outline:none;max-height:140px;overflow-y:auto;min-height:38px}
  .pp-anno-dbubble-foot{display:flex;align-items:center;justify-content:space-between;margin-top:8px;gap:8px}
  .pp-anno-dbubble-quote{font-size:11.5px;color:#0b6358;background:rgba(230,244,242,.8);border-radius:8px;padding:5px 9px;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pp-anno-dbubble-sel{font:400 10.5px/1.3 ${LUM_MONO};color:#9aa1a9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pp-anno-dbubble-acts{display:flex;align-items:center;gap:6px;flex:none}
  .pp-anno-dbubble-cancel{border:none;background:transparent;font-size:12px;color:#9aa1a9;cursor:pointer;padding:6px 8px}
  .pp-anno-dbubble-pub{display:flex;align-items:center;gap:6px;border:none;border-radius:999px;background:#0f7c72;color:#fff;font:600 12.5px/1 ${LUM_SANS};padding:7px 14px;cursor:pointer}
  .pp-anno-dbubble-pub:hover{background:#0b6358}
  .pp-anno-dbubble .pp-anno-chips{margin-top:8px}

  /* ── 顶部 strand 潮汐珠链 ── */
  .pp-anno-strand{position:fixed;top:0;left:0;right:0;height:16px;z-index:2147482300;pointer-events:none}
  .pp-anno-strand-rail{position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,rgba(20,149,138,.12),rgba(20,149,138,.45) 30%,rgba(20,149,138,.45) 70%,rgba(20,149,138,.12))}
  .pp-anno-bead{position:absolute;top:1.5px;transform:translate(-50%,-50%);width:22px;height:22px;border:none;background:transparent;padding:0;cursor:pointer;pointer-events:auto;display:flex;align-items:center;justify-content:center}
  .pp-anno-bead i{display:block;border-radius:999px;border:1.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25);transition:width .15s,height .15s}

  /* ── sweep 发布光带 ── */
  .pp-anno-sweep{position:fixed;inset:0;z-index:2147483055;pointer-events:none;overflow:hidden}
  .pp-anno-sweep i{position:absolute;top:0;bottom:0;left:0;width:100%;background:linear-gradient(100deg,transparent 30%,rgba(127,227,214,.16) 46%,rgba(20,149,138,.22) 50%,rgba(127,227,214,.16) 54%,transparent 70%);animation:lumSweep 1.1s cubic-bezier(.4,.1,.3,1) both}

  /* ── 全清封印 seal（全屏） ── */
  .pp-anno-seal{position:fixed;inset:0;z-index:2147483300;pointer-events:auto;cursor:pointer;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,rgba(230,244,242,.92) 0%,rgba(255,255,255,.86) 68%);animation:lumSealBg .5s ease both;font-family:${LUM_SANS}}
  .pp-anno-seal-in{text-align:center;padding:40px;animation:lumSealIn .5s cubic-bezier(.2,.8,.3,1) .15s both}
  .pp-anno-seal-mark{display:inline-flex;width:64px;height:64px;align-items:center;justify-content:center;border-radius:999px;background:#0f7c72;color:#fff;box-shadow:0 0 0 10px rgba(15,124,114,.12),0 0 0 22px rgba(15,124,114,.05),0 20px 50px -16px rgba(11,90,83,.6)}
  /* seal 内复用 .pp-anno-mfinale 钩子：清掉其卡片外观，只当文字容器 */
  .pp-anno-seal .pp-anno-mfinale{display:block;border:none;background:none;padding:0;margin:0}
  .pp-anno-seal-title{display:block;margin-top:20px;font-size:24px;font-weight:700;letter-spacing:-.01em;color:#08433d}
  .pp-anno-seal-body{margin-top:8px;font-size:14px;color:#4b535c}
  .pp-anno-seal-hint{margin-top:18px;font-size:11.5px;color:#9aa1a9}

  /* glass surface + 降级（配置位 glass=false 或不支持 backdrop-filter → 纯色） */
  .pp-anno-root{--lum-surface:#ffffff}
  @supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
    .pp-anno-glass .pp-anno-tray,.pp-anno-glass .pp-anno-card.pp-anno-pop,.pp-anno-glass .pp-anno-dbubble,.pp-anno-glass .pp-anno-mtbanner{
      background:rgba(255,255,255,.8);backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4)}
  }
  /* 移动端 sheet 的同款兜底：X5 等无 backdrop-filter 内核直接纯白，避免半透明糊字 */
  @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
    .pp-anno-sheet,.pp-anno-sheetbar{background:#fff}
  }
  /* Lumen 桌面件的 reduced-motion 静态降级 */
  @media (prefers-reduced-motion:reduce){
    .pp-anno-tray,.pp-anno-card.pp-anno-pop,.pp-anno-dbubble,.pp-anno-seal,.pp-anno-seal-in{animation:none}
    .pp-anno-pin.pp-anno-current::after,.pp-anno-halo,.pp-anno-riser,.pp-anno-sweep,.pp-anno-bead i,.pp-anno-badge-lost,.pp-anno-qchip{animation:none}
    .pp-anno-halo,.pp-anno-riser,.pp-anno-sweep{display:none}
  }
  `;

  /* ---------------- UI 骨架 ---------------- */
  let root, layer, listEl;
  let sheetEl, grabEl, sheetListEl; // Tideline
  let dockEl, trayEl, strandEl, popEl, draftEl; // Lumen 桌面
  // querySelector 统一容器：桌面=root（含 layer 内的 popover/草稿气泡 + 托盘），移动=sheet
  const panel = () => (MOBILE ? sheetEl : root);

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    root = el('div', 'pp-anno-root' + (MOBILE ? ' pp-anno-mobile' : '') + (!MOBILE && CFG.glass ? ' pp-anno-glass' : ''));
    root.dataset.ppAnno = '1';
    root.dataset.ppReady = '1'; // e2e「层就绪」门
    root.dataset.ppForm = MOBILE ? 'tideline' : 'lumen'; // e2e：当前形态
    layer = el('div', 'pp-anno-layer');

    if (MOBILE) {
      buildSheet();
      root.append(layer, sheetEl);
      document.body.appendChild(root);
      renderSheet();
      return;
    }

    // Lumen 桌面：坞（常驻）+ 托盘（列表）+ strand（珠链）在 root；popover/草稿气泡挂 layer（随页坐标滚动）
    dockEl = el('div', 'pp-anno-dock');
    dockEl.dataset.ppAnno = '1';
    dockEl.dataset.ppRole = 'dock';
    trayEl = el('aside', 'pp-anno-tray');
    trayEl.dataset.ppAnno = '1';
    trayEl.dataset.ppRole = 'tray';
    strandEl = el('div', 'pp-anno-strand');
    strandEl.dataset.ppAnno = '1';
    strandEl.dataset.ppRole = 'strand';

    root.append(layer, strandEl, trayEl, dockEl);
    document.body.appendChild(root);
    if (CFG.armed) enterComment();
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
  // 文本选区锚点(设计稿 _findQuote 移植):在宿主元素文本流里检索 quote 原文,返回 Range;找不到 → null
  function findQuoteRange(rootEl, quote) {
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    const nodes = []; let all = '';
    let nd;
    while ((nd = walker.nextNode())) { nodes.push({ node: nd, start: all.length }); all += nd.nodeValue; }
    const i = all.indexOf(quote);
    if (i < 0) return null;
    const locate = (pos) => {
      for (let k = nodes.length - 1; k >= 0; k--) if (nodes[k].start <= pos) return { node: nodes[k].node, off: pos - nodes[k].start };
      return null;
    };
    const qs = locate(i), qe = locate(i + quote.length);
    if (!qs || !qe) return null;
    const r = document.createRange();
    try { r.setStart(qs.node, qs.off); r.setEnd(qe.node, qe.off); } catch (err) { return null; }
    return r;
  }
  const quoteClientRects = (rootEl, quote) => {
    const r = findQuoteRange(rootEl, quote);
    return r ? Array.prototype.slice.call(r.getClientRects()).filter((x) => x.width > 0) : null;
  };
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
    if (t.quote) {
      // 文本锚点:quote 在宿主内检索;找不到 = 原文已改(锚点丢失口径),不再看元素指纹
      const rects = quoteClientRects(node, t.quote);
      if (!rects || !rects.length) return { status: 'changed', el: node, pos: null };
      const last = rects[rects.length - 1];
      const vx = last.right + 12, vy = last.top - 2; // pin 挂在最后一行末尾(设计稿 pinPos)
      const qpos = { x: vx + scrollX, y: vy + scrollY };
      if (!pointVisible(node, vx, vy)) return { status: 'clipped', el: node, pos: qpos, rects };
      return { status: 'ok', el: node, pos: qpos, rects };
    }
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
    layer.querySelectorAll('.pp-anno-pin, .pp-anno-region, .pp-anno-hlrect, .pp-anno-glow').forEach((n) => n.remove());
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
      const focused = state.focusedId === t.id;
      if (t.rw != null && t.rh != null && a.el) {
        const r = a.el.getBoundingClientRect();
        const reg = el('div', 'pp-anno-region' + (t.resolved ? ' pp-anno-resolved' : ''));
        reg.dataset.ppAnno = '1';
        reg.dataset.tid = t.id;
        reg.style.borderColor = col;
        // Lumen highlight：默认 12% / 聚焦 22% / 已解决 13%
        const mix = t.resolved ? 13 : (focused ? 22 : 12);
        reg.style.background = 'color-mix(in srgb, ' + col + ' ' + mix + '%, transparent)';
        reg.style.left = (r.left + scrollX + r.width * t.rx) + 'px';
        reg.style.top = (r.top + scrollY + r.height * t.ry) + 'px';
        reg.style.width = (r.width * t.rw) + 'px';
        reg.style.height = (r.height * t.rh) + 'px';
        // 桌面：点区域 = 聚焦线程（移动端保持 pointer-events:none，不改）
        if (!MOBILE) { reg.style.pointerEvents = 'auto'; reg.style.cursor = 'pointer'; reg.onclick = (e) => { e.stopPropagation(); focusThread(t.id, true); }; }
        layer.appendChild(reg);
      }
      // 文本锚点:quote 命中行画高亮条(底 2px line;桌面可点聚焦)
      if (t.quote && a.rects) {
        const mix = t.resolved ? 13 : (focused ? 22 : 12);
        for (const hr of a.rects) {
          const hl = el('span', 'pp-anno-hlrect' + (t.resolved ? ' pp-anno-resolved' : ''));
          hl.dataset.ppAnno = '1';
          hl.dataset.tid = t.id;
          hl.style.background = 'color-mix(in srgb, ' + col + ' ' + mix + '%, transparent)';
          hl.style.borderBottom = '2px solid ' + (t.resolved ? '#c9cdd2' : col);
          hl.style.left = (hr.left + scrollX) + 'px';
          hl.style.top = (hr.top + scrollY) + 'px';
          hl.style.width = hr.width + 'px';
          hl.style.height = hr.height + 'px';
          if (!MOBILE) { hl.style.pointerEvents = 'auto'; hl.style.cursor = 'pointer'; hl.onclick = (e) => { e.stopPropagation(); focusThread(t.id, true); }; }
          layer.appendChild(hl);
        }
      }
      const pin = el('div', 'pp-anno-pin' + (t.resolved ? ' pp-anno-resolved' : '')
        + (state.focusedId === t.id ? ' pp-anno-current' : ''));
      pin.dataset.ppAnno = '1';
      pin.dataset.ppRole = 'marker';
      pin.dataset.tid = t.id;
      pin.style.left = pos.x + 'px';
      pin.style.top = pos.y + 'px';
      pin.style.background = col;
      if (focused) pin.style.setProperty('--pp-ring', col); // 呼吸环取 kindColor
      pin.dataset.ppNum = String(n);
      pin.title = t.quote ? '\u201c' + t.quote + '\u201d' : t.selector;
      if (t.resolved) { pin.textContent = ''; pin.appendChild(svg(ICON.check, 13)); }
      else pin.textContent = initialOf(t.comments[0] && t.comments[0].author_name); // 首评作者缩写(设计稿 p.label)
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
    else if (!MOBILE) positionFloating(); // 桌面：popover/草稿气泡随滚动重摆
    syncDrawerCounts();
  }

  /* ---------------- Lumen 桌面：popover / 草稿气泡 定位（随页坐标滚动） ---------------- */
  // 返回线程锚点的页面坐标 pin 尖点（无锚点/@page → null）
  function anchorPin(t) { return anchorXY(t); }
  // popover 摆位：pin 右 16px；托盘开且会压到右下托盘带 → 翻到 pin 左侧；无锚点 → 视口上部居中
  function cardPos(pin, w) {
    w = w || 312;
    const vLeft = scrollX, vTop = scrollY, vw = innerWidth, vh = innerHeight;
    if (!pin) return { x: vLeft + Math.max(12, (vw - w) / 2), y: vTop + 96 };
    let cx = Math.min(pin.x + 16, vLeft + vw - w - 16);
    // 托盘占右下带（fixed right16 width324 bottom70）——卡会滑到托盘下方则翻到 pin 左侧
    if (state.railOpen) {
      const trayLeft = vLeft + vw - 16 - 324;
      const nearBottom = pin.y > vTop + vh - 380;
      if (nearBottom && cx + w > trayLeft - 12) cx = pin.x - w - 16;
    }
    return { x: Math.max(vLeft + 12, cx), y: pin.y + 12 };
  }
  function positionFloating() {
    if (popEl) {
      const t = byId(state.focusedId);
      const p = cardPos(t ? anchorPin(t) : null, 312);
      popEl.style.left = p.x + 'px';
      popEl.style.top = p.y + 'px';
    }
    if (draftEl && state.draft) {
      const p = cardPos(draftAnchorPin(state.draft), 300);
      draftEl.style.left = p.x + 'px';
      draftEl.style.top = p.y + 'px';
    }
  }
  // 草稿锚点页面坐标（point/box 用 selector+rx/ry；@page → null=居中）
  function draftAnchorPin(d) {
    if (!d || d.selector === PAGE_SELECTOR) return null;
    let node = null;
    try { node = document.querySelector(d.selector); } catch (e) { node = null; }
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.left + scrollX + r.width * d.rx, y: r.top + scrollY + r.height * d.ry };
  }

  /* ---------------- 抽屉渲染 ---------------- */
  const openCount = () => state.threads.filter((t) => !t.resolved).length;

  // 托盘开合（railOpen 语义迁移到托盘；\ 或坞计数钮切换）
  function setRail(open, opts) {
    if (MOBILE) return; // Tideline 无托盘
    opts = opts || {};
    if (open === state.railOpen) return;
    if (!open && !opts.force) {
      // 收起前清未发草稿（草稿保护：有稿则抖动拦截）
      if (state.draft && draftHasText() && !opts.discard) { shakeDraft(); return; }
    }
    state.railOpen = open;
    if (!opts.auto) persistRail();
    renderTray();
    renderDock();
    syncFlags();
    if (open) requestAnimationFrame(() => scrollFocusedCardIntoView());
  }

  // 桌面渲染入口：坞 + 托盘 + 珠链 + popover + 草稿气泡（MOBILE 走 sheet）
  function renderDrawer() {
    if (MOBILE) { renderSheet(); return; } // 移动端唯一面板是 sheet；保留函数名减少调用点分叉
    renderDock();
    renderTray();
    renderStrand();
    renderPopover();
    renderDraftBubble();
  }

  /* ---------------- 右下 pill 坞（常驻） ---------------- */
  function renderDock() {
    if (!dockEl) return;
    dockEl.textContent = '';
    const armed = state.mode === 'comment';
    const open = openCount();
    const arm = el('button', 'pp-anno-dock-arm' + (armed ? ' pp-anno-on' : ''));
    arm.dataset.ppAct = 'comment';
    arm.title = armed ? tr('dock.armed') : tr('dock.arm');
    arm.setAttribute('aria-label', armed ? tr('dock.armed') : tr('dock.arm'));
    arm.appendChild(svg(ICON.pen, 16));
    arm.onclick = () => (state.mode === 'comment' ? exitComment() : enterComment());
    const count = el('button', 'pp-anno-dock-count');
    count.dataset.ppRole = 'dock-count';
    count.dataset.ppAct = 'collapse';
    count.title = tr('dock.tray');
    count.setAttribute('aria-label', open > 0 ? tr('aria.openDrawerUnresolved', { open }) : tr('aria.openDrawerResolved'));
    count.appendChild(el('span', 'pp-anno-dock-dot'));
    if (open > 0) count.appendChild(document.createTextNode(String(open))); // 零未解决 → 无计数徽标
    count.onclick = () => setRail(!state.railOpen);
    dockEl.append(arm, el('span', 'pp-anno-dock-sep'), count);
  }

  /* ---------------- 托盘（列表面） ---------------- */
  function renderTray() {
    if (!trayEl) return;
    trayEl.style.display = state.railOpen ? '' : 'none';
    trayEl.classList.toggle('pp-anno-tray-closed', !state.railOpen);
    if (!state.railOpen) return;
    trayEl.textContent = '';
    const open = openCount();
    const total = state.threads.length;

    // 头：品牌点 + 版本徽章 + 未解决数 + 对整页留言
    const hd = el('div', 'pp-anno-tray-hd');
    const brand = el('span', 'pp-anno-tray-brand');
    brand.appendChild(el('span', 'pp-anno-dock-dot'));
    brand.appendChild(document.createTextNode('pagepin'));
    hd.appendChild(brand);
    if (verLabel()) hd.appendChild(el('span', 'pp-anno-tray-ver', verLabel()));
    hd.appendChild(el('span', 'pp-anno-tray-open', total ? tr('meta.openTotal', { open, total }) : tr('meta.noComments')));
    const wbtn = el('button', 'pp-anno-wbtn'); wbtn.dataset.ppAct = 'whole'; wbtn.title = tr('action.notePage');
    wbtn.style.marginLeft = 'auto';
    wbtn.appendChild(svg(ICON.msg, 13));
    wbtn.onclick = openDraftForPage;
    hd.appendChild(wbtn);
    trayEl.appendChild(hd);

    // 筛选段
    const filters = el('div', 'pp-anno-tray-filters');
    filters.appendChild(filterSeg());
    trayEl.appendChild(filters);

    // 列表
    const list = el('div', 'pp-anno-traylist');
    list.dataset.ppRole = 'list';
    const ordered = orderedVisible();
    if (!ordered.length) {
      list.appendChild(el('div', 'pp-anno-tray-empty', total ? tr('empty.noOpen') : tr('empty.none')));
    } else {
      for (const { t, a } of ordered) list.appendChild(trayRow(t, a));
    }
    trayEl.appendChild(list);

    // 脚注快捷键
    const ft = el('div', 'pp-anno-tray-ft');
    ft.appendChild(el('span', null, 'j/k ' + tr('hint.move')));
    if (!isGuest()) ft.appendChild(el('span', null, 'r ' + tr('hint.resolve')));
    ft.appendChild(el('span', null, '\\ ' + tr('hint.hide')));
    ft.appendChild(el('span', null, 'Esc ' + tr('hint.close')));
    trayEl.appendChild(ft);
  }

  // 托盘行（列表项，data-pp-role="card" 但不带 focused）
  function trayRow(t, a) {
    const focused = state.focusedId === t.id;
    const col = kindColor(t);
    const stale = a.status === 'lost' || a.status === 'changed';
    const row = el('button', 'pp-anno-trow' + (focused ? ' pp-anno-on' : ''));
    row.dataset.ppRole = 'card';
    row.dataset.tid = t.id;
    row.dataset.ppStatus = a.status;
    row.dataset.ppNum = isPage(t) ? 'page' : (stale ? 'stale' : (t._num != null ? String(t._num) : ''));
    if (t.kind) row.dataset.ppKind = t.kind;
    row.onclick = () => focusThread(t.id, true);

    const n = el('span', 'pp-anno-trow-n');
    n.style.background = t.resolved ? RESOLVED_COLOR : col;
    if (isPage(t)) n.textContent = '¶';
    else if (stale) n.textContent = '!';
    else if (t.resolved) n.appendChild(svg(ICON.check, 11));
    else n.textContent = initialOf(t.comments[0] && t.comments[0].author_name); // 首评作者缩写(设计稿 ti.n)
    row.appendChild(n);

    const bd = el('span', 'pp-anno-trow-bd');
    const l1 = el('span', 'pp-anno-trow-l1');
    const lab = el('span', 'pp-anno-trow-lab', isPage(t) ? '@page'
      : t.quote ? '\u201c' + (t.quote.length > 22 ? t.quote.slice(0, 22) + '\u2026' : t.quote) + '\u201d'
      : '#' + anchorLabel(t.selector));
    lab.style.color = t.resolved ? '#9aa1a9' : '#0b6358';
    l1.appendChild(lab);
    if (isGuestSub(t.comments[0].author_sub)) l1.appendChild(guestBadge());
    if (stale) l1.appendChild(el('span', 'pp-anno-badge-lost', tr(a.status === 'changed' ? 'badge.changed' : 'badge.lost')));
    if (t.resolved) {
      const dn = el('span', 'pp-anno-badge-done');
      dn.appendChild(svg(ICON.check, 9));
      dn.appendChild(document.createTextNode(tr('chip.done')));
      l1.appendChild(dn);
    }
    bd.appendChild(l1);
    bd.appendChild(el('span', 'pp-anno-trow-ex', t.comments[0].text));
    row.appendChild(bd);
    return row;
  }

  /* ---------------- 顶部 strand 潮汐珠链（配置位 CFG.strand） ---------------- */
  function renderStrand() {
    if (!strandEl) return;
    strandEl.style.display = CFG.strand ? '' : 'none';
    if (!CFG.strand) return;
    strandEl.textContent = '';
    strandEl.appendChild(el('div', 'pp-anno-strand-rail'));
    const docH = Math.max(1, document.documentElement.scrollHeight);
    const vw = innerWidth;
    for (const t of visibleThreads()) {
      const pos = anchorXY(t);
      if (!pos) continue; // lost/changed/@page 无珠
      const focused = state.focusedId === t.id;
      const bead = el('button', 'pp-anno-bead');
      bead.dataset.ppAnno = '1';
      bead.dataset.tid = t.id;
      bead.style.left = Math.max(14, Math.min(vw - 14, (pos.y / docH) * vw)) + 'px';
      bead.title = isPage(t) ? '@page' : anchorLabel(t.selector);
      const dot = el('i');
      const sz = focused ? 12 : 9;
      dot.style.width = dot.style.height = sz + 'px';
      dot.style.background = kindColor(t);
      bead.appendChild(dot);
      bead.onclick = (e) => { e.stopPropagation(); focusThread(t.id, true); };
      strandEl.appendChild(bead);
    }
  }

  /* ---------------- at-pin 线程卡 popover（详情面） ---------------- */
  function closeCard() {
    if (!state.focusedId) return;
    state.focusedId = null;
    renderDrawer();
    render();
  }
  function renderPopover() {
    if (MOBILE) return;
    const t = state.focusedId ? byId(state.focusedId) : null;
    if (!t) { if (popEl) { popEl.remove(); popEl = null; } return; }
    const a = resolveAnchor(t);
    const stale = a.status === 'lost' || a.status === 'changed';
    const pop = el('div', 'pp-anno-card pp-anno-pop');
    pop.dataset.ppAnno = '1';
    pop.dataset.ppRole = 'card';
    pop.dataset.ppFocused = '1';
    pop.dataset.tid = t.id;
    pop.dataset.ppStatus = a.status;
    pop.dataset.ppNum = isPage(t) ? 'page' : (stale ? 'stale' : (t._num != null ? String(t._num) : ''));
    if (t.kind) pop.dataset.ppKind = t.kind;

    // 头部
    const hd = el('div', 'pp-anno-pop-hd');
    hd.appendChild(el('span', 'pp-anno-pop-sel', isPage(t) ? '@page'
      : t.quote ? '\u201c' + t.quote + '\u201d' : '#' + anchorLabel(t.selector)));
    if (stale) hd.appendChild(el('span', 'pp-anno-badge-lost', tr(a.status === 'changed' ? 'badge.changed' : 'badge.lost')));
    // x/x 按文档序实时算(不依赖 render() 的 _num,新建线程立即有编号)
    const oks = orderedVisible().filter((x) => x.a.status === 'ok');
    const oi = oks.findIndex((x) => x.t.id === t.id);
    const posLabel = oi !== -1 ? tr('card.pos', { n: oi + 1, total: oks.length }) : '\u2014';
    hd.appendChild(el('span', 'pp-anno-pop-pos', posLabel));
    const copy = el('button', 'pp-anno-pop-ib'); copy.dataset.ppRole = 'copy-link'; copy.title = tr('action.copyLink');
    copy.appendChild(svg(ICON.link, 13));
    copy.onclick = (e) => { e.stopPropagation(); copyThreadLink(t); };
    hd.appendChild(copy);
    const close = el('button', 'pp-anno-pop-ib'); close.dataset.ppAct = 'close-card'; close.title = tr('action.closeCard');
    close.appendChild(svg(ICON.x, 13));
    close.onclick = (e) => { e.stopPropagation(); closeCard(); };
    hd.appendChild(close);
    pop.appendChild(hd);

    // 已解决横条
    if (t.resolved) {
      const banner = el('div', 'pp-anno-resolved-banner');
      banner.appendChild(svg(ICON.check, 12));
      banner.appendChild(document.createTextNode(verLabel() ? tr('card.resolvedAt', { v: verLabel() }) : tr('card.resolved')));
      if (!isGuest()) {
        const reopen = el('button', 'pp-anno-pop-reopen'); reopen.dataset.ppRole = 'reopen';
        reopen.textContent = tr('btn.reopen');
        reopen.onclick = (e) => { e.stopPropagation(); void doResolve(t.id); };
        banner.appendChild(reopen);
      }
      pop.appendChild(banner);
    }

    // 评论流
    const msgs = el('div', 'pp-anno-pop-msgs');
    t.comments.forEach((c) => {
      const m = el('div', 'pp-anno-msg');
      m.appendChild(avatar(c.author_name, 26));
      const right = el('div');
      const line = el('div', 'pp-anno-msg-line');
      line.appendChild(el('span', 'pp-anno-who', c.author_name));
      if (isGuestSub(c.author_sub)) line.appendChild(guestBadge());
      line.appendChild(el('span', 'pp-anno-when', fmtTime(c.created_at)));
      right.append(line, el('div', 'pp-anno-txt', c.text));
      m.appendChild(right);
      msgs.appendChild(m);
    });
    pop.appendChild(msgs);

    // kind chips（未解决 && 非 guest）
    if (!t.resolved && !isGuest()) { const kc = kindChipsFor(t); kc.style.padding = '0 12px 2px'; pop.appendChild(kc); }

    // 回复 + 标记解决
    const ft = el('div', 'pp-anno-pop-ft');
    ft.appendChild(replyArea(t, true));
    if (!t.resolved && !isGuest()) {
      const rb = el('button', 'pp-anno-pop-resolve'); rb.dataset.ppRole = 'resolve'; rb.title = tr('action.resolveNext');
      rb.appendChild(svg(ICON.check, 13));
      rb.appendChild(document.createTextNode(tr('action.resolve')));
      rb.onclick = (e) => { e.stopPropagation(); void doResolve(t.id); };
      ft.appendChild(rb);
    }
    // 删除(仅自己的线程):安静地放在底部,不占头部(设计稿头部只有 选择器/徽章/x-x/复制/关闭)
    const mine = state.viewer && t.comments[0].author_sub === state.viewer.sub;
    if (mine) { const db = deleteBtn(t); db.className = 'pp-anno-pop-delbtn'; ft.appendChild(db); }
    pop.appendChild(ft);

    if (popEl) popEl.remove();
    popEl = pop;
    layer.appendChild(popEl);
    positionFloating();
  }

  /* ---------------- 就地草稿气泡 ---------------- */
  function renderDraftBubble() {
    if (MOBILE) return;
    if (!state.draft) { if (draftEl) { draftEl.remove(); draftEl = null; } return; }
    const d = state.draft;
    const bubble = el('div', 'pp-anno-dbubble');
    bubble.dataset.ppAnno = '1';
    bubble.dataset.ppRole = 'draft';
    bubble.dataset.ppSelector = d.selector;

    const nameInp = isGuest() ? guestNameInput() : null;
    if (nameInp) bubble.appendChild(nameInp);

    // 文本锚点:引文条(设计稿 draftQuote,34 字截断)
    if (d.quote) {
      const q = d.quote.length > 34 ? d.quote.slice(0, 34) + '\u2026' : d.quote;
      bubble.appendChild(el('div', 'pp-anno-dbubble-quote', '\u201c' + q + '\u201d'));
    }

    const row = el('div', 'pp-anno-dbubble-row');
    row.appendChild(avatar(state.viewer ? (state.viewer.name || loadGuestName() || '?') : '?', 26));
    const ta = document.createElement('textarea');
    ta.rows = 2;
    ta.placeholder = d.selector === PAGE_SELECTOR ? tr('placeholder.pageNote') : tr('placeholder.comment');
    ta.value = d.text || '';
    ta.oninput = () => { d.text = ta.value; syncFlags(); };
    if (nameInp) nameInp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ta.focus(); } };
    row.appendChild(ta);
    bubble.appendChild(row);

    // kind chips（草稿态本地选择）
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
      };
      chips.appendChild(b);
    }
    bubble.appendChild(chips);

    // 脚：选择器标签 · 版本 + 取消 / 发布
    const foot = el('div', 'pp-anno-dbubble-foot');
    const selBase = d.selector === PAGE_SELECTOR ? '@page' : (d.quote ? tr('draft.textAnchor') : d.selector);
    const selTxt = selBase + (verLabel() ? ' · ' + verLabel() : '');
    foot.appendChild(el('span', 'pp-anno-dbubble-sel', selTxt));
    const acts = el('div', 'pp-anno-dbubble-acts');
    const cancel = el('button', 'pp-anno-dbubble-cancel', tr('btn.cancel'));
    cancel.onclick = (e) => { e.stopPropagation(); clearDraft(true); renderDrawer(); render(); syncFlags(); };
    const pub = el('button', 'pp-anno-dbubble-pub'); pub.dataset.ppRole = 'send';
    pub.appendChild(document.createTextNode(tr('draft.publish')));
    pub.appendChild(svg(ICON.arrowR, 12));
    acts.append(cancel, pub);
    foot.appendChild(acts);
    bubble.appendChild(foot);

    const submit = async () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      pub.disabled = true;
      try {
        let node = null;
        if (d.selector !== PAGE_SELECTOR) { try { node = document.querySelector(d.selector); } catch (e) { node = null; } }
        const anchor_text = node ? (fingerprint(node) || null) : null;
        const payload = {
          path: CFG.path, selector: d.selector, rx: d.rx, ry: d.ry,
          rw: d.box ? d.box.rw : null, rh: d.box ? d.box.rh : null, kind: d.kind, anchor_text,
          quote: d.quote || null, text,
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
      } catch (err) { toast(err.message || tr('toast.failed')); pub.disabled = false; }
    };
    pub.onclick = (e) => { e.stopPropagation(); void submit(); };
    ta.onkeydown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit(); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clearDraft(true); renderDrawer(); render(); syncFlags(); }
    };

    if (draftEl) draftEl.remove();
    draftEl = bubble;
    layer.appendChild(draftEl);
    positionFloating();
  }

  /* ---------------- Lumen 桌面装饰件（reduced-motion 跳过） ---------------- */
  function spawnHalo(t) {
    if (REDUCE() || !layer) return;
    const p = anchorXY(t);
    if (!p) return;
    const h = el('div', 'pp-anno-halo');
    h.dataset.ppAnno = '1';
    h.style.left = (p.x + 10) + 'px'; // pin 盒 translate(-4,-24) 28px → 视觉中心 (x+10, y-10)
    h.style.top = (p.y - 10) + 'px';
    h.style.borderColor = kindColor(t);
    layer.appendChild(h);
    setTimeout(() => h.remove(), 700);
  }
  function spawnRiser(t) {
    if (REDUCE() || !layer) return;
    const p = anchorXY(t);
    if (!p) return;
    const r = el('div', 'pp-anno-riser');
    r.dataset.ppAnno = '1';
    r.style.left = p.x + 'px';
    r.style.top = p.y + 'px';
    r.style.background = '#3dafa4';
    layer.appendChild(r);
    setTimeout(() => r.remove(), 720);
  }
  function spawnSweep() {
    if (REDUCE() || !root) return;
    const s = el('div', 'pp-anno-sweep'); s.dataset.ppAnno = '1';
    s.appendChild(el('i'));
    root.appendChild(s);
    setTimeout(() => s.remove(), 1200);
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

  // 计数轻量同步（render() 每帧调用；就地补文字，不重建 DOM）
  function syncDrawerCounts() {
    if (MOBILE) { syncSheetCounts(); return; }
    const open = openCount();
    if (dockEl) {
      const arm = dockEl.querySelector('.pp-anno-dock-arm');
      if (arm) arm.classList.toggle('pp-anno-on', state.mode === 'comment');
      const c = dockEl.querySelector('[data-pp-role="dock-count"]');
      if (c) {
        while (c.childNodes.length > 1) c.removeChild(c.lastChild); // 保留绿点，重写计数
        if (open > 0) c.appendChild(document.createTextNode(String(open)));
        c.setAttribute('aria-label', open > 0 ? tr('aria.openDrawerUnresolved', { open }) : tr('aria.openDrawerResolved'));
      }
    }
    if (trayEl && state.railOpen) {
      const total = state.threads.length;
      const o = trayEl.querySelector('.pp-anno-tray-open');
      if (o) o.textContent = total ? tr('meta.openTotal', { open, total }) : tr('meta.noComments');
      const so = trayEl.querySelector('[data-pp-filter="open"]');
      if (so) so.textContent = tr('filter.open', { open });
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
      const sb = el('span', 'pp-anno-stalebadge', tr(a.status === 'changed' ? 'card.anchorChanged' : 'card.anchorLost', { selector: t.selector }));
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
          renderTray(); // 托盘行序号点同步 kind 色
          renderStrand(); // strand 珠同步 kind 色
          const railEl = wrap.closest('.pp-anno-card')?.querySelector('.pp-anno-card-rail');
          if (railEl) railEl.style.background = kindColor(t);
        } catch (err) { toast(err.message || tr('toast.failed')); }
        kindInFlight = false;
      };
      wrap.appendChild(b);
    }
    return wrap;
  }

  function replyArea(t, compact) {
    const wrap = el('div', 'pp-anno-replyarea');
    const taWrap = el('div', 'pp-anno-ta-wrap');
    const nameInp = isGuest() ? guestNameInput() : null;
    if (nameInp) taWrap.appendChild(nameInp);
    const ta = document.createElement('textarea');
    ta.rows = compact ? 1 : 2;
    ta.dataset.ppRole = 'reply';
    ta.placeholder = t.resolved ? tr('placeholder.addNote') : tr('placeholder.reply');
    const stash = state.replyStash.get(t.id);
    if (stash) ta.value = stash;
    ta.oninput = () => { if (ta.value.trim()) state.replyStash.set(t.id, ta.value); else state.replyStash.delete(t.id); syncFlags(); };
    ta.onfocus = syncFlags;
    ta.onblur = syncFlags;
    if (nameInp) nameInp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ta.focus(); } };
    const send = el('button', 'pp-anno-send' + (compact ? ' pp-anno-send-lum' : ''));
    send.dataset.ppRole = 'send';
    if (compact) {
      // Lumen popover：单行输入 + 36×36 纸飞机钮并排（设计稿 E4d），↵ 提示挪进 title
      send.title = tr('hint.enterReply');
      send.appendChild(svg(ICON.send, 14));
      taWrap.appendChild(ta);
      const row = el('div', 'pp-anno-ta-row-lum');
      row.append(taWrap, send);
      wrap.appendChild(row);
    } else {
      const row = el('div', 'pp-anno-ta-row');
      row.appendChild(el('span', 'pp-anno-hint', tr('hint.enterReply')));
      send.appendChild(svg(ICON.enter, 13));
      send.appendChild(document.createTextNode(tr('btn.reply')));
      row.appendChild(send);
      taWrap.append(ta, row);
      wrap.appendChild(taWrap);
    }

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
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); state.replyStash.delete(t.id); ta.value = ''; ta.blur(); syncFlags(); }
    };
    return wrap;
  }

  /* ---------------- 聚焦（桌面=弹 popover + halo + 相机；移动=sheet 内联） ---------------- */
  function focusThread(id, scroll) {
    const t = byId(id);
    if (!t) return;
    // 有字草稿不被 pin/高亮/托盘点击静默吞掉:抖动示意,先发布或显式取消(桌面;移动端草稿住 sheet 内可共存)
    if (!MOBILE && state.draft && draftHasText()) { shakeDraft(); return; }
    state.focusedId = id;
    if (MOBILE) {
      // 选中线程时 sheet 至少抬到 HALF（peek 只够扫一眼）；已在 half/full 保持不动
      if (state.detent === 'peek') setDetent('half');
      renderDrawer();
    } else {
      state.draft = null; // 聚焦时收掉空草稿气泡（有稿也让位给 popover）
      renderDrawer(); // 弹 popover + 托盘行高亮（不强制展开托盘）
    }
    render();
    if (!MOBILE) spawnHalo(t); // 焦点 halo（reduced-motion 跳过）
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
    if (!state.focusedId) return;
    if (MOBILE) {
      if (!listEl) return;
      const card = listEl.querySelector('[data-pp-focused="1"]');
      if (card) card.scrollIntoView({ block: 'nearest' });
      return;
    }
    // 桌面：把聚焦线程的托盘行居中滚进托盘列表（托盘开时）
    if (!trayEl || !state.railOpen) return;
    const list = trayEl.querySelector('.pp-anno-traylist');
    const row = trayEl.querySelector('[data-pp-role="card"][data-tid="' + state.focusedId + '"]');
    if (list && row) {
      const top = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
      list.scrollTo({ top: Math.max(0, top), behavior: REDUCE() ? 'auto' : 'smooth' });
    }
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
    if (!wasResolved && !MOBILE) spawnRiser(t); // resolve 泪滴升腾（reduced-motion 跳过）
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
  function openDraftFor(selector, rx, ry, box, quote) {
    // 草稿搬家:已有草稿时,新的锚定手势把稿(文字+kind)原样搬到新锚点。
    // 丢字只发生在显式动作(取消钮/Esc)上,所以这里不再拦截/抖动。
    const carry = state.draft ? { text: state.draft.text || '', kind: state.draft.kind || null } : null;
    if (carry) clearDraft(true); // 旧稿清场(rubber 等一并清理),内容已带走
    // 桌面：不退出评论模式 —— 保留十字光标以便连续打点，并让评论模式下的「点空白关空草稿」两步式继续生效。
    // 移动（Tideline）：打完点即退出 AIM（压暗/点亮框/指令条撤掉），草稿落进 sheet。
    if (MOBILE && state.mode === 'comment') { state.mode = 'rest'; teardownAim(); }
    const d = { selector, rx: rx == null ? 0.5 : rx, ry: ry == null ? 0.5 : ry, box: box || null, quote: quote || null, kind: carry ? carry.kind : null, text: carry ? carry.text : '' };
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
    else renderDrawer(); // 桌面：草稿气泡浮在锚点旁（不强制展开托盘）
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
      if (ta) { ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* 忽略 */ } }
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
      if (data.site_version_n) versionN = data.site_version_n; // 先刷序数,横幅显示新版本号
      if (moments.lastVersion && data.site_version !== moments.lastVersion) {
        momentBanner(verLabel() || data.site_version.slice(0, 7));
      }
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
    if (!MOBILE) spawnSweep(); // E9 \u53d1\u5e03\u5149\u5e26\u5e76\u53d1\u626b\u8fc7\uff08reduced-motion \u8df3\u8fc7\uff09
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
    if (!MOBILE) { moments.finaleShown = true; showSeal(); return; } // 桌面：全屏封印 seal
    // 移动端：抽屉空态里的小卡（就地）
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
  // 桌面全屏封印 seal（保留 .pp-anno-mfinale + <b> 钩子；点击任意处 dismiss）
  function showSeal() {
    if (state.seal || !root) return;
    const seal = el('div', 'pp-anno-seal');
    seal.dataset.ppAnno = '1';
    seal.dataset.ppRole = 'seal';
    const inn = el('div', 'pp-anno-seal-in');
    const mark = el('span', 'pp-anno-seal-mark'); mark.appendChild(svg(ICON.seal, 30)); inn.appendChild(mark);
    const fin = el('div', 'pp-anno-mfinale'); // 钩子保留（moments M4）
    const b = document.createElement('b'); b.className = 'pp-anno-seal-title'; b.textContent = tr('seal.title'); fin.appendChild(b);
    fin.appendChild(el('div', 'pp-anno-seal-body', tr('seal.body', { n: state.threads.length })));
    inn.appendChild(fin);
    inn.appendChild(el('div', 'pp-anno-seal-hint', tr('seal.continue')));
    seal.appendChild(inn);
    seal.onclick = () => dismissSeal();
    root.appendChild(seal);
    state.seal = seal;
  }
  function dismissSeal() {
    if (!state.seal) return;
    state.seal.remove();
    state.seal = null;
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
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clearDraft(true); renderDrawer(); render(); syncFlags(); }
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
    state.mode = 'comment'; renderDrawer(); syncFlags(); // 坞画笔点亮（不强制展开托盘）
    if (!vignetteEl) { vignetteEl = el('div', 'pp-anno-vignette'); vignetteEl.dataset.ppAnno = '1'; document.body.appendChild(vignetteEl); }
  }
  function exitComment() {
    state.mode = 'rest';
    if (vignetteEl) { vignetteEl.remove(); vignetteEl = null; }
    if (MOBILE) { teardownAim(); syncFlags(); render(); return; }
    if (hoverHint) { hoverHint.classList.remove('pp-anno-hover-hint'); hoverHint = null; }
    clearHoverTimer();
    document.documentElement.classList.remove('pp-anno-text-intent');
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

  /* ---------------- 评论模式 hover + 意图跟随(指哪评哪) ----------------
   * 指针压在文字字形上 = 文本意图:撤元素描边、I-beam(拖一下就能选字);
   * 落在图片/按钮/留白/段间距上 = 元素意图:teal 描边 + 十字(点一下打点)。
   * 拖选进行中(选区未塌)一律按文本意图,让位给选区蓝。 */
  let hoverHint = null;
  let hoverRaf = 0;
  // 字形命中测试:caret API 找到最近文本节点后,再验证指针真的压在该节点的渲染矩形上
  function overTextGlyph(x, y) {
    let node = null;
    try {
      if (document.caretPositionFromPoint) {
        const cp = document.caretPositionFromPoint(x, y);
        node = cp && cp.offsetNode;
      } else if (document.caretRangeFromPoint) {
        const cr = document.caretRangeFromPoint(x, y);
        node = cr && cr.startContainer;
      }
    } catch (e) { return false; }
    if (!node || node.nodeType !== 3 || !norm(node.nodeValue || '')) return false;
    const r = document.createRange();
    r.selectNodeContents(node);
    const rects = r.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const rc = rects[i];
      if (x >= rc.left - 2 && x <= rc.right + 2 && y >= rc.top - 1 && y <= rc.bottom + 1) return true;
    }
    return false;
  }
  // 防闪烁:光标(text-intent 类)即时切换 —— I-beam/十字来回是浏览器原生手感;
  // 元素描边则要在同一目标上驻留 120ms 才亮 —— 扫过页面时描边永远不出现,停稳才亮,
  // 已亮的描边在切到文字意图/新目标提交前保持不动(不跟手抖)。
  let hoverTimer = 0;
  let hoverCand = null;
  function clearHoverTimer() { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = 0; } hoverCand = null; }
  function dropHint() { if (hoverHint) { hoverHint.classList.remove('pp-anno-hover-hint'); hoverHint = null; } }
  document.addEventListener('mousemove', (e) => {
    if (state.mode !== 'comment' || state.draft || MOBILE) return;
    if (hoverRaf) return; // rAF 节流:一帧最多测一次字形
    const cx = e.clientX, cy = e.clientY, rawTarget = e.target;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      if (state.mode !== 'comment' || state.draft) return;
      let sel = null;
      try { sel = window.getSelection(); } catch (err) { /* 忽略 */ }
      const text = (sel && !sel.isCollapsed) || overTextGlyph(cx, cy);
      document.documentElement.classList.toggle('pp-anno-text-intent', text);
      if (text) { clearHoverTimer(); dropHint(); return; }
      const target = rawTarget.closest && rawTarget.closest('[data-pp-anno]') ? null : rawTarget;
      if (!target || target === document.body) { clearHoverTimer(); dropHint(); return; }
      if (target === hoverHint) { clearHoverTimer(); return; } // 已亮且未移开:稳定
      if (target === hoverCand) return; // 同一候选驻留中:等计时器
      hoverCand = target;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        hoverTimer = 0;
        if (state.mode !== 'comment' || state.draft || !hoverCand) return;
        dropHint();
        hoverHint = hoverCand;
        hoverHint.classList.add('pp-anno-hover-hint');
      }, 120);
    });
  }, true);
  const modeArmed = (e) =>
    state.mode === 'comment' && !state.draft &&
    !(e.target.closest && e.target.closest('[data-pp-anno]'));
  document.addEventListener('dragstart', (e) => { if (modeArmed(e)) e.preventDefault(); }, true);
  // (设计稿 onPageMouseUp)评论模式允许选字 —— 选区在 click(mouseup 后)被 quoteSelectionDraft 消费

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

  // 评论模式 click 带着未塌缩选区 → 文本锚点草稿(设计稿 onPageMouseUp 移植);消费了返回 true
  function quoteSelectionDraft() {
    let sel = null;
    try { sel = window.getSelection(); } catch (e) { return false; }
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    const quote = sel.toString().trim();
    if (quote.length < 2 || quote.length > 200) return false;
    const range = sel.getRangeAt(0);
    let host = range.commonAncestorContainer;
    host = host.nodeType === 1 ? host : host.parentElement;
    if (!host || (host.closest && host.closest('[data-pp-anno]'))) return false;
    if (!findQuoteRange(host, quote)) return false; // 跨块选区拼不回连续原文 → 退回点评论
    const rects = range.getClientRects();
    const last = rects[rects.length - 1];
    const hr = host.getBoundingClientRect();
    if (!last || !hr.width || !hr.height) return false;
    const cl = (v) => Math.min(1, Math.max(0, v));
    sel.removeAllRanges();
    openDraftFor(cssPath(host), cl((last.right - hr.left) / hr.width), cl((last.top - hr.top) / hr.height), null, quote);
    return true;
  }

  /* ---------------- 模式外随选随评(Docs 式) ----------------
   * 普通阅读态选中一段文字 → 停 300ms 消抖后在选区尾浮出泪滴 💬 钮,点击进同一条
   * quote 草稿管线。选字复制的人不被打扰:钮不抢焦点(pointerdown preventDefault
   * 保住选区)、不挡 ⌘C;模式内不出钮(在模式里选完直通草稿)。 */
  let quoteChip = null;
  let chipTimer = 0;
  function removeQuoteChip() { if (quoteChip) { quoteChip.remove(); quoteChip = null; } }
  function maybeShowQuoteChip() {
    removeQuoteChip();
    if (MOBILE || !layer || !state.viewer) return;
    if (state.mode === 'comment' || state.draft) return;
    let sel = null;
    try { sel = window.getSelection(); } catch (e) { return; }
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const quote = sel.toString().trim();
    if (quote.length < 2 || quote.length > 200) return;
    const range = sel.getRangeAt(0);
    let host = range.commonAncestorContainer;
    host = host.nodeType === 1 ? host : host.parentElement;
    if (!host || (host.closest && host.closest('[data-pp-anno]'))) return;
    const ae = document.activeElement;
    if (ae && /INPUT|TEXTAREA/.test(ae.tagName || '')) return; // 输入框里的选字不打扰
    if (!findQuoteRange(host, quote)) return; // 跨块拼不回连续原文 → 不出钮
    const rects = range.getClientRects();
    const last = rects[rects.length - 1];
    const hr = host.getBoundingClientRect();
    if (!last || !hr.width || !hr.height) return;
    const cl = (v) => Math.min(1, Math.max(0, v));
    // mousedown 会塌选区 → 参数在出钮时就锁死,点击时不再读选区
    const args = [cssPath(host), cl((last.right - hr.left) / hr.width), cl((last.top - hr.top) / hr.height), null, quote];
    const chip = el('button', 'pp-anno-qchip');
    chip.dataset.ppAnno = '1';
    chip.dataset.ppRole = 'quote-chip';
    chip.title = tr('chip.quote');
    chip.setAttribute('aria-label', tr('chip.quote'));
    chip.appendChild(svg(ICON.msg, 13));
    chip.style.left = (last.right + scrollX + 6) + 'px';
    chip.style.top = (last.top + scrollY + last.height / 2) + 'px';
    chip.onpointerdown = (e) => e.preventDefault(); // 保住选区视觉到点击完成
    chip.onclick = (e) => {
      e.stopPropagation();
      removeQuoteChip();
      try { window.getSelection().removeAllRanges(); } catch (err) { /* 忽略 */ }
      openDraftFor.apply(null, args);
    };
    layer.appendChild(chip);
    quoteChip = chip;
  }
  document.addEventListener('selectionchange', () => {
    if (MOBILE) return;
    clearTimeout(chipTimer);
    removeQuoteChip(); // 选区一动即撤,停稳 300ms 再评估(拖选过程不闪)
    chipTimer = setTimeout(maybeShowQuoteChip, 300);
  });

  function composeAt(e) {
    const node = e.target;
    const r = node.getBoundingClientRect();
    const rx = r.width ? (e.clientX - r.left) / r.width : 0.5;
    const ry = r.height ? (e.clientY - r.top) / r.height : 0.5;
    openDraftFor(cssPath(node), Math.min(1, Math.max(0, rx)), Math.min(1, Math.max(0, ry)));
  }

  // 净点击才打点:pointerdown 记起点,click(=mouseup)位移 >5px 视为脏拖
  let modeDownAt = null;
  document.addEventListener('pointerdown', (e) => { if (e.isPrimary) modeDownAt = { x: e.clientX, y: e.clientY }; }, true);
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
      if (quoteSelectionDraft()) return; // 带着选区的 mouseup → 文本锚点草稿
      // 脏拖(拖了但选区塌了/跨块拼不回连续原文):什么都不发生 —— 不误打点,也不动现有草稿
      if (modeDownAt && Math.hypot(e.clientX - modeDownAt.x, e.clientY - modeDownAt.y) > 5) return;
      composeAt(e); // 已有草稿时 openDraftFor 会连字带 kind 搬家,不需要先清场
      return;
    }
  }, true);

  /* ---------------- 键盘（常驻 j/k + Walk-less） ---------------- */
  document.addEventListener('keydown', (e) => {
    const ae = document.activeElement || {};
    const typing = /INPUT|TEXTAREA|SELECT/.test(ae.tagName || '') || (ae && ae.isContentEditable);
    if (e.key === 'Escape') {
      if (typing) return; // textarea 自己的 onkeydown 处理 Esc
      // Esc 级联（桌面）：草稿 → 选区浮钮 → popover → seal → 横幅 → 托盘 → 退评论模式；命中一层即消费
      if (state.draft) { clearDraft(true); renderDrawer(); render(); syncFlags(); return; }
      if (!MOBILE) {
        if (quoteChip) { removeQuoteChip(); return; }
        if (state.focusedId) { closeCard(); return; }
        if (state.seal) { dismissSeal(); return; }
        if (moments.banner) { moments.banner.remove(); moments.banner = null; return; }
        if (state.railOpen) { setRail(false); return; }
      }
      if (state.mode === 'comment') { exitComment(); syncFlags(); return; }
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
        else setRail(!state.railOpen); // 桌面：\ 开合托盘
        break;
      default: break;
    }
  });

  addEventListener('resize', () => {
    render();
    if (MOBILE) applyDetent(); // 转屏/工具栏收放：half/full 档高度按新视口重算（形态本身不切换）
    else { renderStrand(); } // 桌面：珠链按新视口宽/文档高重排
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
  /* guest 首访一次性提示:挂在坞画笔按钮下方,8s 或任意点击后消失,只出现一次 */
  function firstOpenHint() {
    if (MOBILE || !isGuest()) return; // 移动端 FAB 自带自我教学(peek-bounce + 文字钮)
    try { if (localStorage.getItem('pp-hint-v1')) return; } catch (e) { return; }
    const btn = dockEl && dockEl.querySelector('.pp-anno-dock-arm');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const tip = el('div', 'pp-anno-firsthint pp-anno-hint-up', tr('hint.firstOpen'));
    tip.dataset.ppAnno = '1';
    // 坞在右下角：提示挂在画笔钮上方
    tip.style.bottom = (innerHeight - r.top + 10) + 'px';
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
