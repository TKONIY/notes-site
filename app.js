/* ============================================================================
   笔记库前端逻辑：Markdown 渲染 + 路由 + 搜索 + 目录 + 主题
   纯原生 JS，无依赖，可直接以 file:// 打开。
   ========================================================================== */
(function () {
  "use strict";

  const ALL_NOTES = (window.NOTES || []).slice();
  const TAG_ALL = "全部";

  const state = { query: "", tag: TAG_ALL };

  // 正文可存为 Markdown 明文(content)或 Base64(contentB64，避开模板字符串里的反引号冲突)。
  function decodeB64(b64) {
    try {
      const bin = atob(String(b64).replace(/\s+/g, ""));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder("utf-8").decode(bytes);
    } catch (e) {
      return "";
    }
  }
  function noteMarkdown(n) {
    if (n._md != null) return n._md;
    n._md = n.contentB64 ? decodeB64(n.contentB64) : n.content || "";
    return n._md;
  }

  const app = document.getElementById("app");
  const progressEl = document.getElementById("progress");
  const searchInput = document.getElementById("search-input");

  /* ------------------------------------------------------------------ utils */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  let usedIds = {};
  function slugify(s) {
    return (
      s
        .toLowerCase()
        .trim()
        .replace(/[`*_~]/g, "")
        .replace(/[^\w一-龥\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "section"
    );
  }
  function uniqueSlug(s) {
    const base = slugify(s);
    if (usedIds[base] === undefined) {
      usedIds[base] = 0;
      return base;
    }
    usedIds[base] += 1;
    return base + "-" + usedIds[base];
  }

  function formatDate(iso) {
    const parts = String(iso).split("-").map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
      return `${parts[0]}年${parts[1]}月${parts[2]}日`;
    }
    return iso;
  }

  function readingTime(md) {
    const text = md
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#>*`_\-|]/g, " ");
    const cjk = (text.match(/[一-龥]/g) || []).length;
    const words = (
      text.replace(/[一-龥]/g, " ").match(/\b[\w']+\b/g) || []
    ).length;
    return Math.max(1, Math.round((words + cjk / 2.5) / 220));
  }

  function plainExcerpt(md, n) {
    const text = md
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[`*_>#\-|]/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > n ? text.slice(0, n).trim() + "…" : text;
  }

  /* -------------------------------------------------------- markdown inline */
  function parseInline(text) {
    return text
      .split(/(`[^`]+`)/g)
      .map((part) => {
        if (/^`[^`]+`$/.test(part)) {
          return "<code>" + escapeHtml(part.slice(1, -1)) + "</code>";
        }
        let s = escapeHtml(part);
        s = s.replace(
          /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
          '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
        );
        s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
        s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
        s = s.replace(/(^|[^\w_])_([^_]+)_(?![\w_])/g, "$1<em>$2</em>");
        s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
        return s;
      })
      .join("");
  }

  /* --------------------------------------------------------- markdown lists */
  function buildList(items, start, baseIndent) {
    const type = items[start].ordered ? "ol" : "ul";
    let html = "<" + type + ">";
    let i = start;
    while (i < items.length) {
      const it = items[i];
      if (it.indent < baseIndent) break;
      let child = "";
      if (i + 1 < items.length && items[i + 1].indent > baseIndent) {
        const res = buildList(items, i + 1, items[i + 1].indent);
        child = res[0];
        i = res[1] - 1;
      }
      html += "<li>" + parseInline(it.text) + child + "</li>";
      i += 1;
    }
    html += "</" + type + ">";
    return [html, i];
  }

  function renderListBlock(lines) {
    const items = lines.map((l) => {
      const m = l.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      return {
        indent: m[1].replace(/\t/g, "  ").length,
        ordered: /\d+\./.test(m[2]),
        text: m[3],
      };
    });
    return buildList(items, 0, items[0].indent)[0];
  }

  function splitRow(line) {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  }

  function isBlockStart(line, next) {
    if (/^```/.test(line)) return true;
    if (/^#{1,6}\s/.test(line)) return true;
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
    if (/^\s*>/.test(line)) return true;
    if (/^(\s*)([-*+]|\d+\.)\s+/.test(line)) return true;
    if (line.indexOf("|") !== -1 && next && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(next))
      return true;
    return false;
  }

  /* --------------------------------------------------------- markdown block */
  function renderMarkdown(md) {
    const lines = md.replace(/\r\n?/g, "\n").split("\n");
    let html = "";
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (line.trim() === "") {
        i += 1;
        continue;
      }

      // 代码块
      if (/^```/.test(line)) {
        const lang = line.replace(/^```/, "").trim();
        const buf = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i += 1;
        }
        i += 1;
        html +=
          '<div class="code-block" data-lang="' +
          escapeHtml(lang || "code") +
          '"><button class="copy-btn" type="button">复制</button><pre><code>' +
          escapeHtml(buf.join("\n")) +
          "</code></pre></div>";
        continue;
      }

      // 标题
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const lvl = h[1].length;
        const raw = h[2].trim().replace(/\s+#+\s*$/, "");
        html +=
          "<h" + lvl + ' id="' + uniqueSlug(raw) + '">' + parseInline(raw) + "</h" + lvl + ">";
        i += 1;
        continue;
      }

      // 分隔线
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html += "<hr/>";
        i += 1;
        continue;
      }

      // 引用
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ""));
          i += 1;
        }
        html += "<blockquote>" + renderMarkdown(buf.join("\n")) + "</blockquote>";
        continue;
      }

      // 表格
      if (
        line.indexOf("|") !== -1 &&
        i + 1 < lines.length &&
        /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])
      ) {
        const header = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].indexOf("|") !== -1 && lines[i].trim() !== "") {
          rows.push(splitRow(lines[i]));
          i += 1;
        }
        let t = '<div class="table-wrap"><table><thead><tr>';
        t += header.map((c) => "<th>" + parseInline(c) + "</th>").join("");
        t += "</tr></thead><tbody>";
        rows.forEach((r) => {
          t +=
            "<tr>" +
            header.map((_, idx) => "<td>" + parseInline(r[idx] || "") + "</td>").join("") +
            "</tr>";
        });
        t += "</tbody></table></div>";
        html += t;
        continue;
      }

      // 列表
      if (/^(\s*)([-*+]|\d+\.)\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^(\s*)([-*+]|\d+\.)\s+/.test(lines[i])) {
          buf.push(lines[i]);
          i += 1;
        }
        html += renderListBlock(buf);
        continue;
      }

      // 段落
      const buf = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !isBlockStart(lines[i], lines[i + 1])
      ) {
        buf.push(lines[i].trim());
        i += 1;
      }
      if (buf.length) html += "<p>" + parseInline(buf.join(" ")) + "</p>";
      else i += 1;
    }
    return html;
  }

  /* --------------------------------------------------------------- data ops */
  function sortedNotes() {
    return ALL_NOTES.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  function uniqueTags() {
    const set = new Set();
    ALL_NOTES.forEach((n) => (n.tags || []).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }
  function filterNotes() {
    const q = state.query.trim().toLowerCase();
    return sortedNotes().filter((n) => {
      const tagOk = state.tag === TAG_ALL || (n.tags || []).includes(state.tag);
      const hay = [n.title, n.summary, n.category, (n.tags || []).join(" "), noteMarkdown(n)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return tagOk && (!q || hay.indexOf(q) !== -1);
    });
  }

  /* ------------------------------------------------------------ render home */
  function renderHome(animate) {
    const notes = filterNotes();
    const tags = [TAG_ALL].concat(uniqueTags());
    const latest = sortedNotes()[0];
    const anim = animate !== false;

    let html = '<section class="view view--home' + (anim ? "" : " no-anim") + '">';
    html +=
      '<header class="hero">' +
      '<span class="eyebrow"><span class="dot"></span>个人知识库 · KNOWLEDGE BASE</span>' +
      '<h1>我的<span class="grad-text">笔记库</span></h1>' +
      "<p>记录、整理、随时回看 —— 由 Claude 协助维护的笔记空间。</p>" +
      '<div class="stat">共 <b>' +
      ALL_NOTES.length +
      "</b> 篇笔记" +
      (latest ? " · 最近更新 " + formatDate(latest.date) : "") +
      "</div>" +
      "</header>";

    // 标签过滤
    html += '<div class="filters">';
    tags.forEach((t) => {
      html +=
        '<button class="chip' +
        (state.tag === t ? " active" : "") +
        '" data-tag="' +
        escapeHtml(t) +
        '">' +
        escapeHtml(t) +
        "</button>";
    });
    html += "</div>";

    // 卡片
    if (!notes.length) {
      html +=
        '<div class="empty"><div class="big">🔍</div><p>没有匹配的笔记。换个关键词或标签试试。</p></div>';
    } else {
      html += '<div class="grid">';
      notes.forEach((n, idx) => {
        const excerpt = n.summary || plainExcerpt(noteMarkdown(n), 150);
        html +=
          '<article class="card" data-id="' +
          escapeHtml(n.id) +
          '" style="animation-delay:' +
          Math.min(idx * 60, 480) +
          'ms">' +
          (n.category ? '<span class="badge">' + escapeHtml(n.category) + "</span>" : "") +
          "<h3>" +
          escapeHtml(n.title) +
          "</h3>" +
          '<p class="excerpt">' +
          escapeHtml(excerpt) +
          "</p>" +
          '<div class="tags">' +
          (n.tags || [])
            .slice(0, 4)
            .map((t) => "<span>" + escapeHtml(t) + "</span>")
            .join("") +
          "</div>" +
          '<div class="meta"><span>' +
          formatDate(n.date) +
          "</span><span>约 " +
          readingTime(noteMarkdown(n)) +
          ' 分钟</span><span class="read-on">阅读 <span aria-hidden="true">→</span></span></div>' +
          "</article>";
      });
      html += "</div>";
    }

    html +=
      '<footer class="footer">由 <span class="grad-text">Claude</span> 协助整理 · 双击 index.html 即可离线查看</footer>';
    html += "</section>";

    app.innerHTML = html;
    progressEl.style.width = "0%";
  }

  /* ------------------------------------------------------------ render note */
  function renderNote(id) {
    const note = ALL_NOTES.find((n) => n.id === id);
    if (!note) {
      location.hash = "#/";
      return;
    }
    usedIds = {};
    const body = renderMarkdown(noteMarkdown(note));

    let meta =
      '<div class="meta">' +
      "<span>" +
      formatDate(note.date) +
      "</span>" +
      '<span class="sep"></span>' +
      "<span>约 " +
      readingTime(noteMarkdown(note)) +
      " 分钟阅读</span>";
    if (note.source) {
      meta +=
        '<span class="sep"></span><a href="' +
        escapeHtml(note.source) +
        '" target="_blank" rel="noopener noreferrer">查看原文 <span aria-hidden="true">↗</span></a>';
    }
    meta += "</div>";

    const tags = (note.tags || [])
      .map((t) => "<span>" + escapeHtml(t) + "</span>")
      .join("");

    app.innerHTML =
      '<section class="view reader">' +
      '<div class="article-col">' +
      '<button class="back" type="button">← 返回全部笔记</button>' +
      '<header class="article-head">' +
      (note.category ? '<span class="badge">' + escapeHtml(note.category) + "</span>" : "") +
      "<h1>" +
      escapeHtml(note.title) +
      "</h1>" +
      meta +
      (tags ? '<div class="tags">' + tags + "</div>" : "") +
      "</header>" +
      '<div class="prose">' +
      body +
      "</div>" +
      "</div>" +
      '<nav class="toc" aria-label="目录"></nav>' +
      "</section>";

    buildTOC();
    window.scrollTo(0, 0);
    requestAnimationFrame(updateProgress);
  }

  /* -------------------------------------------------------------------- TOC */
  function buildTOC() {
    const tocEl = app.querySelector(".toc");
    const heads = Array.from(app.querySelectorAll(".prose h2, .prose h3"));
    if (!tocEl || heads.length < 2) {
      if (tocEl) tocEl.style.display = "none";
      return;
    }
    let html = '<div class="toc-title">目录</div><ul>';
    heads.forEach((h) => {
      const lvl = h.tagName === "H3" ? "lvl-3" : "lvl-2";
      html +=
        '<li class="' +
        lvl +
        '"><a href="#' +
        h.id +
        '">' +
        h.textContent +
        "</a></li>";
    });
    html += "</ul>";
    tocEl.innerHTML = html;

    const links = Array.from(tocEl.querySelectorAll("a"));
    const byId = {};
    links.forEach((a) => (byId[a.getAttribute("href").slice(1)] = a));

    if ("IntersectionObserver" in window) {
      const visible = new Set();
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) visible.add(e.target.id);
            else visible.delete(e.target.id);
          });
          let active = null;
          for (const h of heads) {
            if (visible.has(h.id)) {
              active = h.id;
              break;
            }
          }
          links.forEach((a) => a.classList.remove("active"));
          if (active && byId[active]) byId[active].classList.add("active");
        },
        { rootMargin: "-80px 0px -68% 0px", threshold: 0 }
      );
      heads.forEach((h) => obs.observe(h));
    }
  }

  /* --------------------------------------------------------------- progress */
  function updateProgress() {
    const el = document.documentElement;
    const max = el.scrollHeight - el.clientHeight;
    progressEl.style.width = (max > 0 ? (el.scrollTop / max) * 100 : 0) + "%";
  }

  /* --------------------------------------------------------------- clipboard */
  function copyText(text, btn) {
    const done = () => {
      const old = btn.textContent;
      btn.textContent = "已复制";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = old;
        btn.classList.remove("copied");
      }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) {
      /* noop */
    }
    document.body.removeChild(ta);
  }

  /* ----------------------------------------------------------------- router */
  function router() {
    const hash = location.hash || "#/";
    const m = hash.match(/^#\/note\/(.+)$/);
    if (m) renderNote(decodeURIComponent(m[1]));
    else renderHome();
  }

  /* ------------------------------------------------------------------ theme */
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("notes-theme", t);
    } catch (e) {
      /* noop */
    }
  }

  /* --------------------------------------------------------------- listeners */
  app.addEventListener("click", (e) => {
    const card = e.target.closest("[data-id]");
    const chip = e.target.closest("[data-tag]");
    const copy = e.target.closest(".copy-btn");
    const back = e.target.closest(".back");
    const tocLink = e.target.closest(".toc a");

    if (copy) {
      const code = copy.parentElement.querySelector("code");
      if (code) copyText(code.textContent, copy);
      return;
    }
    if (tocLink) {
      e.preventDefault();
      const target = document.getElementById(tocLink.getAttribute("href").slice(1));
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (back) {
      location.hash = "#/";
      return;
    }
    if (chip) {
      state.tag = chip.getAttribute("data-tag");
      renderHome(false);
      return;
    }
    if (card) {
      location.hash = "#/note/" + encodeURIComponent(card.getAttribute("data-id"));
    }
  });

  searchInput.addEventListener("input", (e) => {
    state.query = e.target.value;
    if (location.hash && location.hash !== "#/" && location.hash !== "") {
      location.hash = "#/"; // 触发 router → renderHome
    } else {
      renderHome(false);
    }
  });

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(cur === "dark" ? "light" : "dark");
  });

  document.getElementById("brand").addEventListener("click", () => {
    location.hash = "#/";
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    } else if (e.key === "Escape" && document.activeElement === searchInput) {
      searchInput.value = "";
      state.query = "";
      searchInput.blur();
      if (location.hash.startsWith("#/note/")) location.hash = "#/";
      else renderHome(false);
    }
  });

  window.addEventListener("hashchange", router);
  window.addEventListener("scroll", updateProgress, { passive: true });

  router();
})();
