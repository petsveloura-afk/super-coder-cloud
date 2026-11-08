/* Super Coder Cloud (in-app copy, wave 23) — interactive guide: a row of pages (one step each), real screenshots with
   numbered markers, labels and arrows, chapter chips, search, keyboard and swipe. */
(function () {
  "use strict";
  const DATA = window.SCC_GUIDE;
  if (!DATA) return;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const norm = (s) => String(s).toLowerCase().replace(/[֑-ׇ]/g, "").replace(/["'״׳`]/g, "").replace(/\s+/g, " ").trim();
  const ICON = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    tip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z"/></svg>',
    out: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  };
  const chapterOf = (id) => DATA.chapters.find((c) => c.id === id) || { name: "" };
  const steps = DATA.steps.map((s, i) => ({ ...s, i, key: s.img ? s.img.replace(/^.*\//, "").replace(/\.webp$/, "") : s.id, chName: chapterOf(s.ch).name }));
  steps.forEach((s) => (s.hay = norm([s.title, s.body, s.tip, s.chName, ...(s.list || [])].join(" "))));

  function markHTML(m, k) {
    // where to put the label: below the spot unless it is low in the picture; keep it inside the picture
    const cx = m.x + m.w / 2;
    const v = m.y + m.h > 74 ? "above" : "below";
    // RTL: x is measured from the left edge of the picture; inset-inline-* follows the page direction
    const near = cx > 78 ? " edge-s" : cx < 22 ? " edge-e" : "";
    return `<div class="mk ${v}${near}" data-n="${m.n}" style="--i:${k};left:${m.x}%;top:${m.y}%;width:${m.w}%;height:${m.h}%"><span class="ring"></span><span class="badge" aria-hidden="true">${m.n}</span><span class="label"><span class="lk">${m.n}</span>${esc(m.text || "")}</span></div>`;
  }

  // ---- the voice-agent chapter: an animated phone stage instead of a screenshot (kind: "scene") ----
  const vplan = (d, l) => { const t = Math.max(d, l, 1); const a = []; for (let c = 1; c <= t; c++) a.push({ k: Math.ceil((c * d) / t), n: Math.ceil((c * l) / t) }); return a; };
  const vSplit = (t) => { const m = String(t).match(/^([^:]+):\s*(.+)$/); return m ? [m[1], m[2]] : [t, ""]; };
  // "📞 מפעילים" → ["📞", "מפעילים"]; a line with no leading symbol gets a neutral dot
  const vIcon = (t) => { const m = String(t).match(/^(\S+)\s+(.+)$/); return m && /^[^\p{L}\p{N}\s]+$/u.test(m[1]) ? [m[1], m[2]] : ["•", String(t)]; };
  const ARROW = '<svg class="v-arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v15M6 13l6 6 6-6"/></svg>';
  function voiceSlideHTML(s, total) {
    const L = s.list || [];
    const Dm = s.demo || [];
    const plan = vplan(Dm.length, L.length);
    const nOf = (j) => { const t = plan.find((x) => x.k >= j + 1); return t ? t.n : L.length; };
    const list = L.map((t, j) => `<li><button type="button" data-n="${j + 1}"><span class="k">${j + 1}</span><span>${esc(t)}</span></button></li>`).join("");
    const items = Dm.map((t, j) => {
      const n = nOf(j);
      const at = `class="v-it" data-n="${n}" style="--j:${j}"`;
      const badge = `<span class="v-n" aria-hidden="true">${n}</span>`;
      if (s.scene === "chat") return `<div class="v-it v-msg ${j % 2 ? "agent" : "cust"}" data-n="${n}" style="--j:${j}"><small>${j % 2 ? "הסוכן" : "הלקוח"}</small><p>${esc(t)}</p>${badge}</div>`;
      if (s.scene === "call") return `<div class="v-it v-cap" data-n="${n}" style="--j:${j}"><span class="v-dot"></span><span>${esc(t)}</span>${badge}</div>`;
      if (s.scene === "voices") { const ch = Array.from(String(t).replace(/[^\p{L}\p{N}]/gu, ""))[0] || "🎙️"; return `<div class="v-it v-voice" data-n="${n}" style="--j:${j}"><span class="v-av">${esc(ch)}</span><b>${esc(t)}</b><span class="v-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="v-play" aria-hidden="true">▶</span>${badge}</div>`; }
      if (s.scene === "card") { const kv = vSplit(t); return `<div class="v-it v-row" data-n="${n}" style="--j:${j}"><small>${esc(kv[0])}</small><b>${esc(kv[1] || kv[0])}</b><span class="v-ok" aria-hidden="true">✓</span>${badge}</div>`; }
      if (s.scene === "packs") return `<div class="v-it v-pack" data-n="${n}" style="--j:${j}"><b>${esc(String(t).replace(/^[^\d]*/, "") || t)}</b><small>דקות</small>${badge}</div>`;
      return `<div ${at.replace('class="v-it"', 'class="v-it v-node"')}>${j ? ARROW : ""}<span class="v-nd"><span class="v-ic" aria-hidden="true">${esc(vIcon(t)[0])}</span><span>${esc(vIcon(t)[1])}</span></span>${badge}</div>`;
    }).join("");
    const bars = Array.from({ length: 15 }, (_, j) => `<i style="--k:${j}"></i>`).join("");
    const url = LINKS && s.screen ? `/${LOC}/${s.screen}` : null;
    return `<article class="g-vslide v-${s.scene}" id="${s.key}" data-i="${s.i}" aria-roledescription="שלב" aria-label="שלב ${s.i + 1} מתוך ${total}: ${esc(s.title)}">
      <div class="g-text">
        <div class="g-meta"><span class="ch">${esc(s.chName)}</span><span class="of">שלב ${s.i + 1} / ${total}</span>${s.isNew ? '<span class="v-new">חדש</span>' : ""}</div>
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.body)}</p>
        <ol class="g-list">${list}</ol>
        ${s.tip ? `<div class="g-tip">${ICON.tip}<span><b>טיפ: </b>${esc(s.tip)}</span></div>` : ""}
        ${url ? `<a class="g-open" href="${url}">פתיחת המסך הזה במערכת ${ICON.out}</a>` : ""}
      </div>
      <figure class="g-fig v-fig">
        <div class="v-phone" aria-label="הדגמה חיה: ${esc(s.title)}">
          <div class="v-screen">
            <div class="v-head"><span class="v-orb" aria-hidden="true">${esc(s.icon || "🎙️")}</span><span class="v-ttl"><b>${esc(s.status || s.title)}</b><small>הסוכן הקולי</small></span><button type="button" class="v-pp" aria-label="השהיית ההדגמה" aria-pressed="false"><span class="p1">❚❚</span><span class="p2">▶</span></button></div>
            <div class="v-wave" aria-hidden="true">${bars}</div>
            <div class="v-body">${items}</div>
            <div class="v-foot" aria-hidden="true">${Dm.map(() => "<i></i>").join("")}</div>
          </div>
        </div>
      </figure>
    </article>`;
  }

  function slideHTML(s, total) {
    if (s.kind === "scene") return voiceSlideHTML(s, total);
    const marked = new Set((s.marks || []).map((m) => m.n));
    const list = (s.list || []).map((t, j) => `<li><button type="button" data-n="${j + 1}" class="${marked.has(j + 1) ? "" : "nomark"}"><span class="k">${j + 1}</span><span>${esc(t)}</span></button></li>`).join("");
    const url = LINKS ? LINKS[s.key] : s.key.startsWith("s01") ? `${DATA.app}/he/signup` : `${DATA.app}/he/login`;
    return `<article class="g-slide${s.phone ? " phone" : ""}" id="${s.key}" data-i="${s.i}" aria-roledescription="שלב" aria-label="שלב ${s.i + 1} מתוך ${total}: ${esc(s.title)}">
      <div class="g-text">
        <div class="g-meta"><span class="ch">${esc(s.chName)}</span><span class="of">שלב ${s.i + 1} / ${total}</span></div>
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.body)}</p>
        <ol class="g-list">${list}</ol>
        ${s.tip ? `<div class="g-tip">${ICON.tip}<span>${esc(s.tip)}</span></div>` : ""}
        ${!url ? "" : LINKS ? `<a class="g-open" href="${url}">פתיחת המסך הזה במערכת ${ICON.out}</a>` : `<a class="g-open" href="${url}" target="_blank" rel="noopener">לנסות עכשיו בפלטפורמה ${ICON.out}</a>`}
      </div>
      <figure class="g-fig">
        <div class="frame"><div class="bar"><i></i><i></i><i></i><span>super-coder-cloud.vercel.app</span></div>
          <div class="g-pic"><img src="${s.img}" width="${s.w}" height="${s.h}" alt="${esc(s.title)}: צילום מסך מהמערכת עם סימון של המקומות ללחוץ" loading="${s.i < 2 ? "eager" : "lazy"}" decoding="async">${(s.marks || []).map(markHTML).join("")}</div>
        </div>
      </figure>
    </article>`;
  }

  let LINKS = null;
  let LOC = "he";
  function mount(root, opts = {}) {
    LINKS = opts.links || null;
    LOC = opts.locale || "he";
    const offs = [];
    const on = (t, e, f) => { t.addEventListener(e, f); offs.push(() => t.removeEventListener(e, f)); };
    const embed = root.hasAttribute("data-embed");
    const total = steps.length;
    root.classList.add("guide");
    if (embed) root.classList.add("embed");
    root.innerHTML = `
      <div class="g-bar">
        <div class="g-row">
          <div class="g-search" role="combobox" aria-expanded="false" aria-haspopup="listbox">
            ${ICON.search}
            <label class="sr" for="g-q-${embed ? "e" : "p"}">חיפוש במדריך</label>
            <input id="g-q-${embed ? "e" : "p"}" type="search" autocomplete="off" placeholder="חיפוש במדריך: וואטסאפ, סוכן, תיבת הודעות, תשלום…" aria-controls="g-res-${embed ? "e" : "p"}">
            <kbd>/</kbd>
            <div class="g-results" id="g-res-${embed ? "e" : "p"}" role="listbox" hidden></div>
          </div>
          <div class="g-progress" aria-live="polite"><span class="pos">1 / ${total}</span><span class="track"><span class="fill"></span></span></div>
        </div>
        <div class="g-chapters" role="tablist" aria-label="פרקים">${DATA.chapters.map((c) => `<button type="button" role="tab" data-ch="${c.id}"><span>${esc(c.name)}</span><small>${esc(c.time)}</small></button>`).join("")}</div>
      </div>
      <div class="g-viewport"><div class="g-track" tabindex="0" aria-label="שלבי המדריך">${steps.map((s) => slideHTML(s, total)).join("")}</div></div>
      <div class="g-nav">
        <button type="button" class="btn btn-ghost g-prev" aria-label="השלב הקודם">${ICON.prev}<span class="t">הקודם</span></button>
        <div class="g-dots">${steps.map((s, i) => `<button type="button" aria-label="שלב ${i + 1}: ${esc(s.title)}" class="${i && steps[i - 1].ch !== s.ch ? "ch-start" : ""}"></button>`).join("")}</div>
        <button type="button" class="btn btn-primary g-next" aria-label="השלב הבא"><span class="t">הבא</span>${ICON.next}</button>
      </div>
      ${embed ? "" : `<div class="g-toc">${DATA.chapters.map((c) => `<section><h4>${esc(c.name)} <small>${esc(c.time)}</small></h4><ol>${steps.filter((s) => s.ch === c.id).map((s) => `<li><button type="button" data-go="${s.i}"><span>${s.i + 1}</span>${esc(s.title)}</button></li>`).join("")}</ol></section>`).join("")}</div>`}`;

    const track = root.querySelector(".g-track");
    const slides = [...root.querySelectorAll(".g-slide, .g-vslide")];
    const dots = [...root.querySelectorAll(".g-dots button")];
    const chips = [...root.querySelectorAll(".g-chapters button")];
    const pos = root.querySelector(".pos");
    const fill = root.querySelector(".fill");
    const prev = root.querySelector(".g-prev");
    const next = root.querySelector(".g-next");
    let cur = -1;
    let jumpUntil = 0;

    // the markers light up one after another: ring + number + label with an arrow, then the next
    let cycle = null;
    const focusers = [];
    function runCycle(i) {
      clearInterval(cycle);
      const f = focusers[i];
      if (!f || !f.ns.length) return;
      let k = 0;
      f.focus(f.ns[0]);
      if (f.ns.length > 1) cycle = setInterval(() => { k = (k + 1) % f.ns.length; f.focus(f.ns[k]); }, 2600);
    }
    // voice chapter: items appear one after another on the phone stage while the matching list line lights up
    const reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    let vtimer = null;
    let vpaused = false;
    const vShow = (i, k, n) => {
      const sl = slides[i];
      if (!sl) return;
      const its = [...sl.querySelectorAll(".v-it")];
      its.forEach((el, j) => { el.classList.toggle("show", j < k); el.classList.toggle("cur", j === k - 1); });
      sl.querySelectorAll(".v-foot i").forEach((d, j) => d.classList.toggle("on", j < k));
      sl.querySelectorAll(".g-list button").forEach((b) => b.classList.toggle("on", n > 0 && b.dataset.n === String(n)));
    };
    const vPP = (i) => { const b = slides[i] && slides[i].querySelector(".v-pp"); if (b) { b.setAttribute("aria-pressed", String(vpaused)); b.setAttribute("aria-label", vpaused ? "המשך ההדגמה" : "השהיית ההדגמה"); b.classList.toggle("paused", vpaused); } };
    function runVoice(i) {
      clearInterval(vtimer);
      const sl = slides[i];
      if (!sl || !sl.classList.contains("g-vslide")) return;
      const its = sl.querySelectorAll(".v-it");
      const plan = vplan(its.length, sl.querySelectorAll(".g-list button").length);
      vpaused = false;
      vPP(i);
      if (reduce) { vShow(i, its.length, 0); return; }
      let c = 0;
      const tick = () => {
        if (c < plan.length) vShow(i, plan[c].k, plan[c].n);
        else if (c === plan.length + 1) vShow(i, 0, 0);
        c += 1;
        if (c > plan.length + 1) c = 0;
      };
      tick();
      vtimer = setInterval(tick, 1800);
      sl._vresume = () => { clearInterval(vtimer); vtimer = setInterval(tick, 1800); };
    }
    function fitHeight(i) { const el = slides[i]; if (el) track.style.height = `${el.offsetHeight + 24}px`; }
    on(window, "resize", () => fitHeight(cur));
    on(window, "load", () => fitHeight(cur));
    if (document.fonts) document.fonts.ready.then(() => fitHeight(cur));
    function setActive(i, fromScroll) {
      if (i === cur || i < 0 || i >= total) return;
      cur = i;
      fitHeight(i);
      runCycle(i);
      slides.forEach((s, k) => s.classList.toggle("active", k === i));
      runVoice(i);
      dots.forEach((d, k) => d.classList.toggle("on", k === i));
      chips.forEach((c) => c.setAttribute("aria-current", String(c.dataset.ch === steps[i].ch)));
      const chip = chips.find((c) => c.dataset.ch === steps[i].ch);
      if (chip) { const bar = chip.parentElement, cr = chip.getBoundingClientRect(), br = bar.getBoundingClientRect(); if (cr.left < br.left || cr.right > br.right) bar.scrollBy({ left: cr.left - br.left - (br.width - cr.width) / 2, behavior: "smooth" }); }
      pos.textContent = `${i + 1} / ${total}`;
      fill.style.width = `${((i + 1) / total) * 100}%`;
      prev.disabled = i === 0;
      next.disabled = i === total - 1;
      if (!embed && fromScroll) {
        try { history.replaceState(null, "", `#${steps[i].key}`); } catch (e) { /* ignore */ }
      }
    }
    function go(i, smooth = true) {
      i = Math.max(0, Math.min(total - 1, i));
      const el = slides[i];
      // RTL scroll positions differ by browser; scrollIntoView on the track's own axis is reliable
      jumpUntil = Date.now() + (smooth ? 900 : 150);
      // relative scroll on the track only (never moves the page; works the same in RTL and LTR)
      track.scrollBy({ left: el.getBoundingClientRect().left - track.getBoundingClientRect().left, behavior: smooth ? "smooth" : "auto" });
      setActive(i, true);
      if (!embed) {
        const top = root.getBoundingClientRect().top + window.scrollY - 80;
        if (Math.abs(window.scrollY - top) > 260 && root.getBoundingClientRect().top < 0) window.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
      }
    }
    const io = new IntersectionObserver((es) => {
      if (Date.now() < jumpUntil) return; // a jump is under way: ignore the slides it passes
      es.forEach((e) => { if (e.isIntersecting && e.intersectionRatio > 0.55) setActive(+e.target.dataset.i, true); });
    }, { root: track, threshold: [0.55, 0.8] });
    slides.forEach((s) => io.observe(s));

    prev.addEventListener("click", () => go(cur - 1));
    next.addEventListener("click", () => go(cur + 1));
    dots.forEach((d, i) => d.addEventListener("click", () => go(i)));
    chips.forEach((c) => c.addEventListener("click", () => go(steps.find((s) => s.ch === c.dataset.ch).i)));
    root.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => { go(+b.dataset.go); root.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    track.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); go(cur + 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(cur - 1); }
    });

    // list item ↔ marker on the picture
    slides.forEach((sl) => {
      const items = [...sl.querySelectorAll(".g-list button")];
      const marks = [...sl.querySelectorAll(".mk")];
      const focus = (n) => { marks.forEach((m) => m.classList.toggle("focus", m.dataset.n === String(n))); items.forEach((b) => b.classList.toggle("on", b.dataset.n === String(n))); };
      focusers[+sl.dataset.i] = { focus, ns: marks.map((m) => m.dataset.n) };
      const hold = (n) => { clearInterval(cycle); focus(n); };
      items.forEach((b) => { b.addEventListener("mouseenter", () => hold(b.dataset.n)); b.addEventListener("focus", () => hold(b.dataset.n)); b.addEventListener("click", () => hold(b.dataset.n)); });
      marks.forEach((m) => m.querySelector(".badge").addEventListener("click", () => hold(m.dataset.n)));
      sl.querySelector(".g-list").addEventListener("mouseleave", () => runCycle(+sl.dataset.i));
    });

    // voice slides: hover or tap a line (or a bubble on the stage) to hold it; the pause button stops the demo
    slides.forEach((sl) => {
      if (!sl.classList.contains("g-vslide")) return;
      const idx = +sl.dataset.i;
      const its = [...sl.querySelectorAll(".v-it")];
      const hold = (k, n) => { clearInterval(vtimer); vpaused = true; vPP(idx); vShow(idx, k, n); };
      sl.querySelectorAll(".g-list button").forEach((b) => {
        const pick = () => { const n = +b.dataset.n; const k = its.filter((el) => +el.dataset.n <= n).length; hold(Math.max(k, 1), n); };
        b.addEventListener("mouseenter", pick);
        b.addEventListener("focus", pick);
        b.addEventListener("click", pick);
      });
      its.forEach((el, j) => el.addEventListener("click", () => hold(j + 1, +el.dataset.n)));
      sl.querySelector(".g-list").addEventListener("mouseleave", () => { if (cur === idx && !reduce) runVoice(idx); });
      sl.querySelector(".v-pp").addEventListener("click", () => {
        if (vpaused) runVoice(idx);
        else { clearInterval(vtimer); vpaused = true; vPP(idx); }
      });
    });

    // search
    const box = root.querySelector(".g-search");
    const q = box.querySelector("input");
    const res = box.querySelector(".g-results");
    let hits = [];
    let sel = 0;
    const hl = (text, words) => { let out = esc(text); words.forEach((w) => { if (w.length > 1) out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark>${m}</mark>`); }); return out; };
    function render() {
      const raw = q.value.trim();
      if (!raw) { res.hidden = true; box.setAttribute("aria-expanded", "false"); return; }
      const words = norm(raw).split(" ").filter(Boolean);
      hits = steps.map((s) => {
        let score = 0;
        for (const w of words) {
          if (!s.hay.includes(w)) return null;
          if (norm(s.title).includes(w)) score += 5;
          if (norm(s.chName).includes(w)) score += 2;
          score += 1;
        }
        return { s, score };
      }).filter(Boolean).sort((a, b) => b.score - a.score || a.s.i - b.s.i).slice(0, 8);
      sel = 0;
      res.innerHTML = hits.length ? hits.map((h, k) => {
        const where = [h.s.body, ...(h.s.list || []), h.s.tip].find((t) => words.some((w) => norm(t).includes(w))) || h.s.body;
        return `<button type="button" role="option" aria-selected="${k === 0}" data-i="${h.s.i}"><span class="num">${h.s.i + 1}</span><span><b>${hl(h.s.title, words)}</b><small>${esc(h.s.chName)} · ${hl(where, words)}</small></span></button>`;
      }).join("") : `<div class="empty">לא נמצא שלב שמתאים ל"${esc(raw)}". נסו מילה אחרת, למשל: וואטסאפ, לידים, צוות.</div>`;
      res.hidden = false;
      box.setAttribute("aria-expanded", "true");
      res.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => pick(+b.dataset.i)));
    }
    function pick(i) { res.hidden = true; box.setAttribute("aria-expanded", "false"); q.blur(); go(i); }
    q.addEventListener("input", render);
    q.addEventListener("focus", render);
    q.addEventListener("keydown", (e) => {
      const opts = [...res.querySelectorAll("button")];
      if (e.key === "ArrowDown" && opts.length) { e.preventDefault(); sel = (sel + 1) % opts.length; }
      else if (e.key === "ArrowUp" && opts.length) { e.preventDefault(); sel = (sel - 1 + opts.length) % opts.length; }
      else if (e.key === "Enter" && hits[sel]) { e.preventDefault(); pick(hits[sel].s.i); return; }
      else if (e.key === "Escape") { res.hidden = true; q.blur(); return; }
      else return;
      opts.forEach((o, k) => o.setAttribute("aria-selected", String(k === sel)));
      opts[sel]?.scrollIntoView({ block: "nearest" });
    });
    on(document, "click", (e) => { if (!box.contains(e.target)) res.hidden = true; });
    if (!embed) on(document, "keydown", (e) => { if (e.key === "/" && document.activeElement !== q && !/input|textarea/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); q.focus(); } });

    // open on #step-key (guide page)
    let start = 0;
    if (!embed) {
      const h = (location.hash || "").slice(1);
      const f = steps.find((s) => s.key === h);
      if (f) start = f.i;
    }
    requestAnimationFrame(() => { if (start) go(start, false); else setActive(0); });
    // links elsewhere on the page can open a specific step: <a href="#guide" data-step="s06-wa-qr">
    document.querySelectorAll("[data-step]").forEach((a) => a.addEventListener("click", () => {
      const f = steps.find((s) => s.key === a.dataset.step);
      if (f) setTimeout(() => go(f.i, false), 350);
    }));
    // the help button can open another step while the guide is already open
    if (!embed) on(window, "hashchange", () => { const f = steps.find((s) => s.key === (location.hash || "").slice(1)); if (f && f.i !== cur) go(f.i); });
    return () => { offs.forEach((f) => f()); io.disconnect(); clearInterval(cycle); clearInterval(vtimer); };
  }

  window.SCCGuide = { mount };
})();
