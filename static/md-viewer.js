/* pagepin markdown viewer runtime — mdShell(serving.ts)在 marked/hljs 之后加载,调用
 * ppMdViewer.render(raw, { strings }) 完成整条渲染管线:
 *   frontmatter 元数据卡 → marked 解析 → 标题锚点 → GitHub Alerts → 代码块(高亮+语言标签+复制)
 *   → 表格横滚包裹 → 任务清单 → 外链新开 → 左栏 TOC(scroll-spy) → mermaid 按需加载 → hash 落位。
 * 原则:每个增强各自 try/catch —— 任何一步失败都不能吞掉正文;正文由 marked 一次性产出。
 * 样式全部在 md-viewer.css;本文件不写内联样式(深浅色交给 CSS 变量)。 */
(function () {
  'use strict';

  var S = {}; // 服务端注入的本地化文案(viewer.md.* 键)
  var str = function (k, fb) { return S[k] || fb; };

  /* ---------------- frontmatter:文首 --- 块切出,渲染成元数据卡 ---------------- */
  function splitFrontmatter(raw) {
    var m = /^﻿?---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(raw);
    if (!m) return { data: null, body: raw };
    var data = [];
    var lines = m[1].split('\n');
    for (var i = 0; i < lines.length; i++) {
      var km = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
      if (km) {
        data.push([km[1], km[2]]);
      } else if (data.length && /^\s+\S/.test(lines[i])) {
        // 缩进续行(列表/多行值):原样折进上一个键,保持可读
        data[data.length - 1][1] += (data[data.length - 1][1] ? ' ' : '') + lines[i].trim();
      }
    }
    if (!data.length) return { data: null, body: raw }; // 不像 YAML —— 当正文处理
    return { data: data, body: raw.slice(m[0].length) };
  }

  function frontmatterCard(data) {
    var card = document.createElement('section');
    card.className = 'pp-md-fm';
    var dl = document.createElement('dl');
    for (var i = 0; i < data.length; i++) {
      var dt = document.createElement('dt');
      dt.textContent = data[i][0];
      var dd = document.createElement('dd');
      dd.textContent = data[i][1] || '—';
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    card.appendChild(dl);
    return card;
  }

  /* ---------------- 标题锚点:GitHub 风格 slug(保留 CJK),hover 出 # ---------------- */
  function slugify(text, seen) {
    var s = text
      .trim()
      .toLowerCase()
      .replace(/[^\w一-鿿぀-ヿ가-힯\- ]+/g, '')
      .replace(/\s+/g, '-');
    if (!s) s = 'section';
    var n = seen.get(s) || 0;
    seen.set(s, n + 1);
    return n ? s + '-' + n : s;
  }

  function headingAnchors(root) {
    var seen = new Map();
    var hs = root.querySelectorAll('h1,h2,h3,h4');
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (!h.id) h.id = slugify(h.textContent || '', seen);
      var a = document.createElement('a');
      a.className = 'pp-md-hl';
      a.href = '#' + encodeURIComponent(h.id);
      a.setAttribute('aria-hidden', 'true');
      a.textContent = '#';
      h.appendChild(a);
    }
  }

  /* ---------------- GitHub Alerts:> [!NOTE] 等五类 ---------------- */
  var ALERTS = {
    note: ['alertNote', 'Note', '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'],
    tip: ['alertTip', 'Tip', '<path d="M9 18h6M10 22h4M15.09 14c.26-1.3 1-2 1.91-3a6 6 0 1 0-10 0c.9 1 1.65 1.7 1.91 3"/>'],
    important: ['alertImportant', 'Important', '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v4M12 15h.01"/>'],
    warning: ['alertWarning', 'Warning', '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>'],
    caution: ['alertCaution', 'Caution', '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'],
  };

  function alertIcon(paths) {
    return (
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>'
    );
  }

  function alerts(root) {
    var bqs = root.querySelectorAll('blockquote');
    for (var i = 0; i < bqs.length; i++) {
      var bq = bqs[i];
      var p = bq.firstElementChild;
      if (!p || p.tagName !== 'P' || !p.firstChild) continue;
      var t = p.firstChild.nodeType === 3 ? p.firstChild.nodeValue : '';
      var m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(t || '');
      if (!m) continue;
      var kind = m[1].toLowerCase();
      var meta = ALERTS[kind];
      p.firstChild.nodeValue = (t || '').slice(m[0].length);
      if (p.firstChild.nodeValue === '' && p.firstElementChild && p.firstElementChild.tagName === 'BR') {
        p.removeChild(p.firstChild);
        p.removeChild(p.firstElementChild);
      }
      var box = document.createElement('div');
      box.className = 'pp-md-alert pp-md-alert-' + kind;
      var head = document.createElement('p');
      head.className = 'pp-md-alert-t';
      head.innerHTML = alertIcon(meta[2]);
      head.appendChild(document.createTextNode(str(meta[0], meta[1])));
      box.appendChild(head);
      while (bq.firstChild) {
        if (bq.firstElementChild === bq.firstChild && !bq.firstChild.textContent && bq.firstChild.nodeType === 1) {
          bq.removeChild(bq.firstChild); // 标记行清空后残留的空 <p>
          continue;
        }
        box.appendChild(bq.firstChild);
      }
      bq.parentNode.replaceChild(box, bq);
    }
  }

  /* ---------------- 代码块:hljs 高亮(仅显式语言)+ 语言标签 + 复制 ---------------- */
  function codeBlocks(root) {
    var pres = root.querySelectorAll('pre');
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      var code = pre.querySelector('code');
      if (!code) continue;
      var lm = /language-([\w+-]+)/.exec(code.className || '');
      var lang = lm ? lm[1].toLowerCase() : '';
      if (lang === 'mermaid') continue; // mermaid() 接手
      if (lang && window.hljs && window.hljs.getLanguage(lang)) {
        try { window.hljs.highlightElement(code); } catch (e) { /* 保持素文本 */ }
      }
      var fig = document.createElement('figure');
      fig.className = 'pp-md-code';
      var head = document.createElement('div');
      head.className = 'pp-md-code-h';
      var label = document.createElement('span');
      label.textContent = lang;
      head.appendChild(label);
      head.appendChild(copyButton(code));
      pre.parentNode.replaceChild(fig, pre);
      fig.appendChild(head);
      fig.appendChild(pre);
    }
  }

  // http 自托管实例没有 navigator.clipboard(非安全上下文)—— 回退 execCommand
  function doCopy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy'));
      } catch (e) {
        reject(e);
      } finally {
        ta.remove();
      }
    });
  }

  function copyButton(code) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pp-md-copy';
    btn.textContent = str('copy', 'Copy');
    btn.onclick = function () {
      doCopy(code.textContent || '').then(function () {
        btn.textContent = str('copied', 'Copied');
        btn.classList.add('pp-md-copied');
        setTimeout(function () {
          btn.textContent = str('copy', 'Copy');
          btn.classList.remove('pp-md-copied');
        }, 1600);
      }, function () { /* 剪贴板被策略拒绝:保持原样 */ });
    };
    return btn;
  }

  /* ---------------- 表格横滚包裹 / 任务清单 / 外链新开 ---------------- */
  function tables(root) {
    var ts = root.querySelectorAll('table');
    for (var i = 0; i < ts.length; i++) {
      var w = document.createElement('div');
      w.className = 'pp-md-tw';
      ts[i].parentNode.replaceChild(w, ts[i]);
      w.appendChild(ts[i]);
    }
  }

  function taskLists(root) {
    var boxes = root.querySelectorAll('li > input[type="checkbox"]');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].parentElement.classList.add('pp-md-task');
      boxes[i].closest('ul,ol') && boxes[i].closest('ul,ol').classList.add('pp-md-tasks');
    }
  }

  function externalLinks(root) {
    var as = root.querySelectorAll('a[href^="http"]');
    for (var i = 0; i < as.length; i++) {
      try {
        if (new URL(as[i].href).origin !== location.origin) {
          as[i].target = '_blank';
          as[i].rel = 'noopener';
        }
      } catch (e) { /* 无效 URL:不动 */ }
    }
  }

  /* ---------------- 左栏 TOC + scroll-spy(≥1240px 由 CSS 决定显隐) ---------------- */
  function buildToc(root) {
    var hs = root.querySelectorAll('h2,h3');
    if (hs.length < 2) return;
    var nav = document.createElement('nav');
    nav.className = 'pp-md-toc';
    var title = document.createElement('div');
    title.className = 'pp-md-toc-t';
    title.textContent = str('toc', 'Contents');
    nav.appendChild(title);
    var ol = document.createElement('ol');
    var links = [];
    for (var i = 0; i < hs.length; i++) {
      var li = document.createElement('li');
      li.className = 'pp-md-toc-' + hs[i].tagName.toLowerCase();
      var a = document.createElement('a');
      a.href = '#' + encodeURIComponent(hs[i].id);
      a.textContent = (hs[i].textContent || '').replace(/#$/, '');
      li.appendChild(a);
      ol.appendChild(li);
      links.push([hs[i], a]);
    }
    nav.appendChild(ol);
    document.body.appendChild(nav);

    var active = null;
    var spy = function () {
      var cur = null;
      for (var i = 0; i < links.length; i++) {
        if (links[i][0].getBoundingClientRect().top <= 96) cur = links[i][1];
        else break;
      }
      cur = cur || links[0][1];
      if (cur !== active) {
        if (active) active.classList.remove('pp-on');
        cur.classList.add('pp-on');
        active = cur;
      }
    };
    var ticking = false;
    addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; spy(); });
    }, { passive: true });
    spy();
  }

  /* ---------------- mermaid:出现 ```mermaid 才从 CDN 拉(自托管离线时保持代码块) ---------------- */
  function mermaid(root) {
    var blocks = root.querySelectorAll('pre > code.language-mermaid');
    if (!blocks.length) return;
    var dark = matchMedia('(prefers-color-scheme: dark)').matches;
    import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')
      .then(function (mod) {
        var mm = mod.default;
        mm.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral' });
        var jobs = [];
        for (var i = 0; i < blocks.length; i++) {
          (function (code, i) {
            jobs.push(
              mm.render('pp-mmd-' + i, code.textContent || '').then(function (out) {
                var box = document.createElement('div');
                box.className = 'pp-md-mermaid';
                box.innerHTML = out.svg;
                var pre = code.parentElement;
                pre.parentNode.replaceChild(box, pre);
              }).catch(function () { /* 语法错:保留代码块 */ })
            );
          })(blocks[i], i);
        }
        return Promise.all(jobs);
      })
      .catch(function () { /* 离线/CDN 不可达:保留代码块 */ });
  }

  function hashScroll() {
    if (!location.hash) return;
    var id = decodeURIComponent(location.hash.slice(1));
    var el = document.getElementById(id);
    if (el) el.scrollIntoView();
  }

  /* ---------------- 入口 ---------------- */
  function render(raw, opts) {
    opts = opts || {};
    S = opts.strings || {};
    var mount = document.getElementById(opts.mount || 'pp-md-content');
    if (!mount) return;
    var fm = { data: null, body: raw };
    try { fm = splitFrontmatter(raw); } catch (e) { /* 当无 frontmatter */ }
    mount.innerHTML = window.marked.parse(fm.body, { gfm: true, breaks: false });
    try { if (fm.data) mount.insertBefore(frontmatterCard(fm.data), mount.firstChild); } catch (e) {}
    try { headingAnchors(mount); } catch (e) {}
    try { alerts(mount); } catch (e) {}
    try { codeBlocks(mount); } catch (e) {}
    try { tables(mount); } catch (e) {}
    try { taskLists(mount); } catch (e) {}
    try { externalLinks(mount); } catch (e) {}
    try { buildToc(mount); } catch (e) {}
    try { mermaid(mount); } catch (e) {}
    try { hashScroll(); } catch (e) {}
  }

  window.ppMdViewer = { render: render };
})();
