/* ==========================================================================
   真题完形补文词汇文库 · 应用逻辑
   纯静态、零依赖；进度保存在 localStorage。
   ========================================================================== */
(() => {
  "use strict";

  const DATA = window.LIBRARY;
  if (!DATA || !Array.isArray(DATA.papers)) {
    document.getElementById("view").innerHTML =
      '<div class="empty-state"><h3>数据未能载入</h3><p>请确认 assets/js/data.js 存在，或重新运行 scripts/build_data.py。</p></div>';
    return;
  }

  const PAPERS = DATA.papers;
  const ALL = [];
  PAPERS.forEach((p) => p.items.forEach((it) => ALL.push({ p, it })));

  const TONE = {
    "名词化": "noun",
    "名词复数": "noun",
    "动词": "verb",
    "过去式": "verb",
    "过去分词": "verb",
    "动名词": "verb",
    "现在分词": "verb",
    "第三人称单数": "verb",
    "形容词": "adj",
    "副词": "adv",
    "比较级": "comp",
    "否定前缀": "neg",
  };

  const STORE_KEY = "cloze-library-v1";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const view = $("#view");
  const sidebar = $("#sidebar");
  const scrim = $("#scrim");
  const menuBtn = $("#menuBtn");
  const themeBtn = $("#themeBtn");
  const toastEl = $("#toast");
  const paperNav = $("#paperNav");
  const overallPct = $("#overallPct");
  const overallFill = $("#overallFill");
  const globalForm = $("#globalSearch");
  const globalInput = $("#globalSearchInput");
  const searchPop = $("#searchPop");
  const voiceBtn = $("#voiceBtn");
  const voicePop = $("#voicePop");
  const voiceSelect = $("#voiceSelect");
  const speedSelect = $("#speedSelect");
  const autoSpeakInput = $("#autoSpeak");
  const voiceTestBtn = $("#voiceTest");

  /* ---------------- 存储 ---------------- */

  function readStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  let store = readStore();
  if (!store || typeof store !== "object") store = {};
  if (!store.revealed || typeof store.revealed !== "object") store.revealed = {};
  if (!store.tts || typeof store.tts !== "object") store.tts = {};

  /* ---------------- 发音配置（Edge TTS） ---------------- */

  const TTS_URL = "https://api.xiemojy.mom/v1/audio/speech";
  // Worker 的 CORS 允许 Content-Type 与 x-api-key；若启用了 API_KEY，填在这里。
  // 前端代码是公开的，只能起到访问控制作用，不能真正保密。
  const TTS_API_KEY = "";
  const TTS_DEFAULT_VOICE = "en-US-JennyNeural";
  const TTS_DEFAULT_SPEED = 0.9;
  const TTS_VOICES = [
    "en-US-JennyNeural",
    "en-US-AriaNeural",
    "en-US-GuyNeural",
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
    "en-AU-NatashaNeural",
  ];
  const TTS_SPEEDS = [0.8, 0.9, 1, 1.1];
  const TTS_SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

  const tts = {
    voice: TTS_VOICES.includes(store.tts.voice) ? store.tts.voice : TTS_DEFAULT_VOICE,
    speed: TTS_SPEEDS.includes(Number(store.tts.speed)) ? Number(store.tts.speed) : TTS_DEFAULT_SPEED,
    auto: Boolean(store.tts.auto),
  };

  let audioEl = null;
  let audioUnlocked = false;
  let audioPriming = false;
  let currentSpeakBtn = null;
  let currentAudioUrl = "";
  let speakToken = 0;
  const audioUrlCache = new Map();
  const audioPending = new Map();

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* 隐私模式或配额不足时静默失败 */ }
  }

  // 2018-10 已从 Workplace English Learning 更正为 Keeping Friendship Alive。
  // 旧版 2018-10 的进度是按旧题号记录的，升级时只清空这一卷，避免新题被误标为已揭示。
  const DATA_REV = "2018-10-friendship";
  if (store.dataRev !== DATA_REV) {
    if (store.revealed && store.revealed["2018-10"]) delete store.revealed["2018-10"];
    store.dataRev = DATA_REV;
    saveStore();
  }

  function isRevealed(pid, i) {
    const list = store.revealed[pid];
    return Array.isArray(list) && list.indexOf(i) !== -1;
  }

  function setRevealed(pid, i, on) {
    const list = new Set(Array.isArray(store.revealed[pid]) ? store.revealed[pid] : []);
    if (on) list.add(i);
    else list.delete(i);
    if (list.size) store.revealed[pid] = Array.from(list).sort((a, b) => a - b);
    else delete store.revealed[pid];
    saveStore();
  }

  function paperProgress(p) {
    let done = 0;
    p.items.forEach((it) => { if (isRevealed(p.id, it.i)) done += 1; });
    return { done, total: p.items.length };
  }

  function overallProgress() {
    let done = 0;
    let total = 0;
    PAPERS.forEach((p) => {
      const pr = paperProgress(p);
      done += pr.done;
      total += pr.total;
    });
    return { done, total };
  }

  /* ---------------- 工具 ---------------- */

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const pad2 = (n) => String(n).padStart(2, "0");
  const toneOf = (tag) => TONE[tag] || "other";
  const findPaper = (id) => PAPERS.find((p) => p.id === id) || null;

  function pctValue(done, total) {
    return total ? (done / total) * 100 : 0;
  }

  function pctText(done, total) {
    if (!total) return "0%";
    const value = pctValue(done, total);
    if (done > 0 && value < 10) return `${value.toFixed(1)}%`;
    return `${Math.round(value)}%`;
  }

  function highlight(text, q) {
    if (!q) return esc(text);
    const lower = String(text).toLowerCase();
    const needle = q.toLowerCase();
    let out = "";
    let i = 0;
    for (;;) {
      const at = lower.indexOf(needle, i);
      if (at === -1) break;
      out += esc(String(text).slice(i, at)) + "<mark>" + esc(String(text).slice(at, at + needle.length)) + "</mark>";
      i = at + needle.length;
    }
    return out + esc(String(text).slice(i));
  }

  function primaryTagCounts() {
    const map = {};
    ALL.forEach(({ it }) => {
      const tag = it.tags[0] || "其他";
      map[tag] = (map[tag] || 0) + 1;
    });
    return Object.keys(map)
      .map((name) => ({ name, count: map[name] }))
      .sort((a, b) => b.count - a.count);
  }

  function allTagCounts() {
    const map = {};
    ALL.forEach(({ it }) => it.tags.forEach((tag) => { map[tag] = (map[tag] || 0) + 1; }));
    return Object.keys(map)
      .map((name) => ({ name, count: map[name] }))
      .sort((a, b) => b.count - a.count);
  }

  function searchItems(q, tag) {
    const needle = q.trim().toLowerCase();
    return ALL.filter(({ p, it }) => {
      if (tag && it.tags.indexOf(tag) === -1) return false;
      if (!needle) return true;
      const hay = [
        it.base, it.answer, it.gloss, it.agloss, it.pos, it.apos, it.tags.join(" "),
        p.label, p.en, p.zh, p.range,
      ].join(" ").toLowerCase();
      return hay.indexOf(needle) !== -1;
    });
  }

  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-show"), 2400);
  }

  /* ---------------- 发音播放 ---------------- */

  function saveTtsSettings() {
    store.tts = { voice: tts.voice, speed: tts.speed, auto: tts.auto };
    saveStore();
  }

  function getAudio() {
    if (audioEl) return audioEl;
    audioEl = new Audio();
    audioEl.preload = "auto";
    audioEl.setAttribute("playsinline", "true");
    audioEl.setAttribute("webkit-playsinline", "true");
    audioEl.setAttribute("x5-playsinline", "true");
    audioEl.setAttribute("aria-hidden", "true");
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);

    audioEl.addEventListener("ended", () => {
      if (!currentSpeakBtn) return;
      currentSpeakBtn.classList.remove("is-playing");
      currentSpeakBtn = null;
    });

    audioEl.addEventListener("error", () => {
      if (!currentSpeakBtn) return;
      currentSpeakBtn.classList.remove("is-loading", "is-playing");
      currentSpeakBtn.removeAttribute("aria-busy");
      currentSpeakBtn = null;
    });

    return audioEl;
  }

  function stopSpeech() {
    speakToken += 1;
    const primingSilence =
      audioEl && !currentSpeakBtn && audioEl.src.indexOf("data:audio") === 0;
    if (audioEl && !primingSilence) {
      try {
        audioEl.pause();
        audioEl.currentTime = 0;
      } catch (e) { /* noop */ }
    }
    if (currentSpeakBtn) {
      currentSpeakBtn.classList.remove("is-loading", "is-playing");
      currentSpeakBtn.removeAttribute("aria-busy");
    }
    currentSpeakBtn = null;
  }

  // 微信 / iOS 需要一次用户手势内的 play() 来解锁音频。
  function primeAudio() {
    if (audioUnlocked || audioPriming) return;
    audioPriming = true;
    const audio = getAudio();
    try {
      audio.src = TTS_SILENT;
      const played = audio.play();
      if (played && typeof played.then === "function") {
        played.then(() => {
          audioUnlocked = true;
          audioPriming = false;
          setTimeout(() => {
            if (!currentSpeakBtn) {
              try {
                audio.pause();
                audio.currentTime = 0;
              } catch (e) { /* noop */ }
            }
          }, 280);
        }).catch(() => {
          audioPriming = false;
        });
      } else {
        audioUnlocked = true;
        audioPriming = false;
      }
    } catch (e) {
      audioPriming = false;
    }
  }

  function speechText(value) {
    return String(value || "").replace(/[【】]/g, "").replace(/\s*\/\s*/g, ", ").trim();
  }

  async function getAudioUrl(text) {
    const key = `${tts.voice}|${tts.speed}|${text}`;
    if (audioUrlCache.has(key)) {
      const cached = audioUrlCache.get(key);
      audioUrlCache.delete(key);
      audioUrlCache.set(key, cached);
      return cached;
    }
    if (audioPending.has(key)) return audioPending.get(key);

    const task = (async () => {
      const headers = { "Content-Type": "application/json" };
      if (TTS_API_KEY) headers["x-api-key"] = TTS_API_KEY;

      let response;
      try {
        response = await fetch(TTS_URL, {
          method: "POST",
          headers,
          body: JSON.stringify({ input: text, voice: tts.voice, speed: tts.speed }),
        });
      } catch (e) {
        throw new Error("网络异常，无法加载发音");
      }

      if (!response.ok) {
        let detail = "";
        try {
          const data = await response.json();
          detail = data && data.error && data.error.message ? data.error.message : "";
        } catch (e) { /* 非 JSON 错误体 */ }
        if (response.status === 401) throw new Error("接口需要 API Key");
        if (response.status >= 500) throw new Error("语音服务暂时不可用");
        throw new Error(detail || `语音请求失败（${response.status}）`);
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const blob = await response.blob();
      if (!blob.size) throw new Error("返回的音频为空");
      if (contentType.includes("json") || contentType.includes("text/")) {
        throw new Error("接口未返回音频");
      }
      const url = URL.createObjectURL(blob);
      audioUrlCache.set(key, url);

      if (audioUrlCache.size > 160) {
        const oldestKey = audioUrlCache.keys().next().value;
        const oldestUrl = audioUrlCache.get(oldestKey);
        audioUrlCache.delete(oldestKey);
        if (oldestUrl !== currentAudioUrl) URL.revokeObjectURL(oldestUrl);
      }
      return url;
    })();

    audioPending.set(key, task);
    try {
      return await task;
    } finally {
      audioPending.delete(key);
    }
  }

  async function playWord(rawText, btn) {
    const text = speechText(rawText);
    if (!text) return;

    if (
      currentSpeakBtn === btn && btn &&
      (btn.classList.contains("is-loading") || btn.classList.contains("is-playing"))
    ) {
      stopSpeech();
      return;
    }

    const audio = getAudio();
    stopSpeech();
    primeAudio();

    const token = ++speakToken;
    currentSpeakBtn = btn || null;
    if (btn) {
      btn.classList.add("is-loading");
      btn.classList.remove("is-playing");
      btn.setAttribute("aria-busy", "true");
    }

    try {
      const url = await getAudioUrl(text);
      if (token !== speakToken) return;

      audio.pause();
      audio.src = url;
      audio.currentTime = 0;
      currentAudioUrl = url;

      if (btn) {
        btn.classList.remove("is-loading");
        btn.classList.add("is-playing");
        btn.removeAttribute("aria-busy");
      }

      await audio.play();
      audioUnlocked = true;
    } catch (err) {
      if (token !== speakToken) return;
      if (btn) {
        btn.classList.remove("is-loading", "is-playing");
        btn.removeAttribute("aria-busy");
      }
      currentSpeakBtn = null;
      if (err && err.name === "NotAllowedError") {
        toast("请再点一次喇叭（微信 / iOS 需要授权音频）");
      } else {
        toast(`发音失败：${err && err.message ? err.message : "请稍后再试"}`);
      }
    }
  }

  function closeVoicePop() {
    if (voicePop.hidden) return;
    voicePop.hidden = true;
    voiceBtn.setAttribute("aria-expanded", "false");
    voiceBtn.classList.remove("is-open");
  }

  function openVoicePop() {
    closeSearchPop();
    voicePop.hidden = false;
    voiceBtn.setAttribute("aria-expanded", "true");
    voiceBtn.classList.add("is-open");
  }

  voiceSelect.value = tts.voice;
  speedSelect.value = String(tts.speed);
  autoSpeakInput.checked = tts.auto;

  voiceSelect.addEventListener("change", () => {
    tts.voice = voiceSelect.value;
    saveTtsSettings();
    stopSpeech();
  });

  speedSelect.addEventListener("change", () => {
    const value = Number(speedSelect.value);
    tts.speed = TTS_SPEEDS.includes(value) ? value : TTS_DEFAULT_SPEED;
    saveTtsSettings();
    stopSpeech();
  });

  autoSpeakInput.addEventListener("change", () => {
    tts.auto = autoSpeakInput.checked;
    saveTtsSettings();
  });

  voiceTestBtn.addEventListener("click", () => playWord("vocabulary", voiceTestBtn));

  voiceBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (voicePop.hidden) openVoicePop();
    else closeVoicePop();
  });

  $("#voiceClose").addEventListener("click", closeVoicePop);
  voicePop.addEventListener("click", (event) => event.stopPropagation());

  document.addEventListener("click", (event) => {
    if (voicePop.hidden) return;
    if (voicePop.contains(event.target) || voiceBtn.contains(event.target)) return;
    closeVoicePop();
  });

  document.addEventListener("click", (event) => {
    const btn = event.target.closest(".speak-btn[data-speak]");
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    playWord(btn.dataset.speak, btn);
  });

  ["pointerdown", "touchstart"].forEach((eventName) => {
    document.addEventListener(eventName, primeAudio, { once: true, passive: true });
  });
  document.addEventListener("WeixinJSBridgeReady", primeAudio, false);

  /* ---------------- 侧栏 ---------------- */

  const YEARS = [];
  PAPERS.forEach((p) => {
    let group = YEARS.find((y) => y.year === p.year);
    if (!group) {
      group = { year: p.year, papers: [] };
      YEARS.push(group);
    }
    group.papers.push(p);
  });

  function buildPaperNav() {
    let html = "";
    YEARS.forEach((group) => {
      html += `<div class="side-year"><span>${group.year}</span><em>${group.papers.length} 套</em></div>`;
      group.papers.forEach((p) => {
        html += `<a class="side-paper" href="#/paper/${p.id}" data-pid="${p.id}" title="${esc(p.en)}">
          <span>${p.month} 月</span>
          <span class="side-count">0/${p.items.length}</span>
        </a>`;
      });
    });
    paperNav.innerHTML = html;
    $("#paperCount").textContent = String(PAPERS.length);
  }

  function updateSidebar() {
    PAPERS.forEach((p) => {
      const link = document.querySelector(`.side-paper[data-pid="${p.id}"]`);
      if (!link) return;
      const pr = paperProgress(p);
      link.querySelector(".side-count").textContent = `${pr.done}/${pr.total}`;
      link.classList.toggle("is-complete", pr.done === pr.total);
    });

    const op = overallProgress();
    const pct = pctValue(op.done, op.total);
    overallPct.textContent = pctText(op.done, op.total);
    overallFill.style.width = `${pct}%`;
  }

  function updateProgressUI() {
    const pid = view.dataset.pid;
    if (pid) {
      const p = findPaper(pid);
      if (p) {
        const pr = paperProgress(p);
        const pct = pr.total ? Math.round((pr.done / pr.total) * 100) : 0;
        const fill = $("#paperFill");
        const text = $("#paperProgressText");
        if (fill) fill.style.width = `${pct}%`;
        if (text) text.innerHTML = `<b>${pr.done}</b> / ${pr.total} 已揭示`;
      }
    }
    updateSidebar();
  }

  function setActiveNav(name, id) {
    $$(".side-link").forEach((a) => {
      a.classList.toggle("is-active", a.dataset.nav === name);
    });
    $$(".side-paper").forEach((a) => {
      a.classList.toggle("is-active", name === "paper" && a.dataset.pid === id);
    });
    const active = document.querySelector(".side-paper.is-active");
    if (active) {
      try { active.scrollIntoView({ block: "nearest" }); } catch (e) { /* noop */ }
    }
  }

  /* ---------------- 卡片 ---------------- */

  function cardHTML(paper, it) {
    const on = isRevealed(paper.id, it.i);
    const label = on
      ? `第 ${it.i} 题答案 ${it.answer}，点击收起`
      : `揭示第 ${it.i} 题答案`;
    return `<article class="term-card${on ? " is-revealed" : ""}" id="item-${paper.id}-${it.i}" data-pid="${paper.id}" data-i="${it.i}">
      <div class="term-top">
        <span class="term-no">${pad2(it.i)}</span>
        <span class="tag" data-tone="${toneOf(it.tags[0])}">${esc(it.tags[0])}</span>
      </div>
      <div class="term-base">
        <span class="en">${esc(it.base)}</span>
        <button class="speak-btn speak-base" type="button" data-speak="${esc(it.base)}" aria-label="播放 ${esc(it.base)} 的发音" title="播放 ${esc(it.base)} 的发音">
          <svg class="icon" aria-hidden="true"><use href="#i-volume"></use></svg>
        </button>
        <span class="pos">${esc(it.pos)}</span>
        <span class="gloss">${esc(it.gloss)}</span>
      </div>
      <div class="term-answer">
        <span class="arrow" aria-hidden="true">→</span>
        <button class="blank${on ? " is-revealed" : ""}" type="button" data-reveal="${it.i}"
          aria-expanded="${on}" aria-label="${esc(label)}">
          <span class="blank-text" aria-hidden="true">${esc(it.answer)}</span>
          <span class="blank-hint" aria-hidden="true">点击</span>
        </button>
        <button class="speak-btn speak-answer" type="button" data-speak="${esc(it.answer)}" aria-label="播放 ${esc(it.answer)} 的发音" title="播放 ${esc(it.answer)} 的发音">
          <svg class="icon" aria-hidden="true"><use href="#i-volume"></use></svg>
        </button>
        <span class="apos">${esc(it.apos)}</span>
        <span class="agloss">${esc(it.agloss)}</span>
      </div>
    </article>`;
  }

  function paperCardHTML(p) {
    const pr = paperProgress(p);
    const pct = pr.total ? Math.round((pr.done / pr.total) * 100) : 0;
    const complete = pr.done === pr.total;
    return `<a class="paper-card${complete ? " is-complete" : ""}" href="#/paper/${p.id}">
      <div class="paper-card-top">
        <span class="paper-date">${p.year}.${pad2(p.month)}</span>
        <span class="paper-count">${pr.total} 个考点</span>
      </div>
      <h3>${esc(p.en)}</h3>
      <p class="paper-zh">${esc(p.zh)}</p>
      <div class="paper-card-foot">
        <span class="mini-track"><span class="mini-fill" style="width:${pct}%"></span></span>
        <span class="mini-text">${pr.done}/${pr.total}</span>
      </div>
    </a>`;
  }

  function pagerHTML(p, dir) {
    const isPrev = dir === "prev";
    return `<a class="pager-card ${isPrev ? "prev" : "next"}" href="#/paper/${p.id}">
      <span class="pager-label">
        ${isPrev ? '<svg class="icon" aria-hidden="true"><use href="#i-arrow-left"></use></svg>' : ""}
        ${isPrev ? "上一套" : "下一套"}
        ${isPrev ? "" : '<svg class="icon" aria-hidden="true"><use href="#i-arrow-right"></use></svg>'}
      </span>
      <span class="pager-title">${p.label}</span>
      <span class="pager-sub">${esc(p.en)}</span>
    </a>`;
  }

  /* ---------------- 首页 ---------------- */

  function renderHome() {
    delete view.dataset.pid;
    document.title = "真题完形补文词汇文库 · 自考英语（专升本）";

    const op = overallProgress();
    const pct = pctValue(op.done, op.total);
    const ring = pctText(op.done, op.total);
    const tags = primaryTagCounts();
    const maxTag = tags.reduce((m, t) => Math.max(m, t.count), 1);
    const firstYear = PAPERS[0].year;
    const lastYear = PAPERS[PAPERS.length - 1].year;
    const lastPaper = findPaper(store.last) || PAPERS[0];
    const continueLabel = store.last ? `继续学习 · ${lastPaper.label}` : `从 ${lastPaper.label} 开始`;

    const yearBlocks = YEARS.map((group) => {
      const total = group.papers.reduce((n, p) => n + p.items.length, 0);
      return `<section class="year-block" aria-label="${group.year} 年">
        <div class="year-label">${group.year}<small>${group.papers.length} 套 · ${total} 个考点</small></div>
        <div class="paper-grid">${group.papers.map(paperCardHTML).join("")}</div>
      </section>`;
    }).join("");

    const distRows = tags.map((t) => `<a class="dist-row" href="#/search?tag=${encodeURIComponent(t.name)}">
      <span class="dist-name">${esc(t.name)}</span>
      <span class="dist-bar"><span style="width:${Math.round((t.count / maxTag) * 100)}%"></span></span>
      <span class="dist-count">${t.count}</span>
    </a>`).join("");

    view.innerHTML = `
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">自考英语（专升本） · 历年真题</p>
          <h1>真题完形补文<span>词汇文库</span></h1>
          <p class="lede">收录 <b>${firstYear}—${lastYear}</b> 年 <b>${PAPERS.length}</b> 套真题、<b>${DATA.meta.totalItems}</b> 个词形考点。原文答案一律挖空，<b>点击虚线处</b>才会揭示——先回想，再核对，进度会自动留在你的浏览器里。</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="#/paper/${lastPaper.id}">
              ${continueLabel}
              <svg class="icon" aria-hidden="true"><use href="#i-arrow-right"></use></svg>
            </a>
            <a class="btn btn-ghost" href="#/quiz">
              <svg class="icon" aria-hidden="true"><use href="#i-shuffle"></use></svg>
              随机自测
            </a>
          </div>
        </div>

        <aside class="hero-card" aria-label="馆藏统计">
          <div class="hero-card-head"><span>ARCHIVE&nbsp;/&nbsp;馆藏</span><b>${firstYear}—${lastYear}</b></div>
          <div class="stats-grid">
            <div class="stat"><b>${PAPERS.length}</b><span>套真题</span></div>
            <div class="stat"><b>${DATA.meta.totalItems}</b><span>个考点</span></div>
            <div class="stat"><b>${YEARS.length}</b><span>个年份</span></div>
            <div class="stat"><b>${tags.length}</b><span>类词形变化</span></div>
          </div>
          <div class="hero-progress">
            <div class="ring" style="--pct:${(Math.round(pct * 100) / 100)}"><div class="ring-inner">${ring}</div></div>
            <div class="hero-progress-text">
              <b>已揭示 ${op.done} / ${op.total}</b>
              <span>进度自动保存在本机浏览器</span>
            </div>
          </div>
        </aside>
      </section>

      <section class="method" id="method" aria-labelledby="methodTitle">
        <div class="section-head">
          <h2 id="methodTitle">做题方法 <small>HOW TO SOLVE</small></h2>
          <p>四步定位 · 三查收尾</p>
        </div>

        <div class="method-grid">
          <article class="method-card">
            <span class="method-no">01</span>
            <h3>定时态语态</h3>
            <p>先圈 <b>have / be / will / ago / now / since</b>，判断主动还是被动、现在还是过去。</p>
          </article>
          <article class="method-card">
            <span class="method-no">02</span>
            <h3>看前后定词性</h3>
            <p>冠词、介词后多为名词；名词前多为形容词；动词、形容词、句首多为副词。</p>
          </article>
          <article class="method-card">
            <span class="method-no">03</span>
            <h3>定具体形式</h3>
            <p>时态、语态、单复数、比较级、否定前缀；一个空只改一个核心形式。</p>
          </article>
          <article class="method-card">
            <span class="method-no">04</span>
            <h3>拼写回读</h3>
            <p>双写、y→i、去 e、句首大写；把答案放回原句读一遍，语法语义都通才保留。</p>
          </article>
        </div>

        <div class="method-panels">
          <div class="method-panel">
            <h3>空格定位速查</h3>
            <ul class="method-list">
              <li><b>冠词 / 介词后</b><span>名词</span></li>
              <li><b>名词前</b><span>形容词</span></li>
              <li><b>be 后</b><span>形容词 / 分词</span></li>
              <li><b>have / has / had 后</b><span>过去分词</span></li>
              <li><b>动词 / 句首</b><span>副词</span></li>
              <li><b>主语后</b><span>谓语动词</span></li>
              <li><b>than</b><span>比较级</span></li>
              <li><b>these / many</b><span>复数名词</span></li>
            </ul>
          </div>
          <div class="method-panel">
            <h3>最容易错的 6 组</h3>
            <ul class="method-traps">
              <li><b>interested / interesting</b>：人感到 / 物令人</li>
              <li><b>hard / hardly</b>：努力、猛烈 / 几乎不</li>
              <li><b>true → truth</b>；wide → width</li>
              <li><b>explain → explanation</b>；decide → decision</li>
              <li><b>succeed → success → successful</b></li>
              <li><b>effect（名词） / affect（动词）</b></li>
            </ul>
          </div>
        </div>

        <div class="method-cta">
          <div>
            <b>一页 A4 速查表</b>
            <span>四步法 · 空格定位 · 词形后缀 · 高频词族 · 易错点</span>
          </div>
          <a class="btn btn-primary btn-sm" href="完形补文做题技巧-一页速查.pdf" download>
            <svg class="icon" aria-hidden="true"><use href="#i-arrow-down"></use></svg>
            下载 PDF
          </a>
        </div>
      </section>

      <div class="section-head">
        <h2>藏卷 <small>THE COLLECTION</small></h2>
        <p>按年份排列 · 共 ${PAPERS.length} 套</p>
      </div>
      ${yearBlocks}

      <div class="section-head">
        <h2>考点分布 <small>BY TRANSFORMATION</small></h2>
        <p>点击标签检索同类考点</p>
      </div>
      <div class="dist">${distRows}</div>

      <p class="source-note">
        <b>数据来源</b>《${esc(DATA.meta.source)}》，共 ${PAPERS.length} 个考期，按时间顺序排列；答案词在原文档中以【】标注，本站在此基础上将其处理为点击揭示的挖空。
        <a href="source/真题完形补文词汇总表.docx" download>下载原始 DOCX</a><br>
        <b>关于发音</b>单词音频由 Edge TTS 在线合成，需要联网；可在右上角喇叭按钮中切换音色、语速与“揭示后自动发音”。<br>
        <b>关于进度</b>揭示记录仅保存在当前浏览器的 localStorage 中，不上传任何服务器；清除浏览器数据后需要重新开始。
      </p>
    `;
  }

  /* ---------------- 试卷页 ---------------- */

  function setCardDOM(pid, i, on) {
    const card = document.getElementById(`item-${pid}-${i}`);
    if (!card) return;
    card.classList.toggle("is-revealed", on);
    const btn = card.querySelector(".blank");
    if (!btn) return;
    const text = btn.querySelector(".blank-text");
    const answer = text ? text.textContent : "";
    btn.classList.toggle("is-revealed", on);
    btn.setAttribute("aria-expanded", String(on));
    btn.setAttribute("aria-label", on ? `第 ${i} 题答案 ${answer}，点击收起` : `揭示第 ${i} 题答案`);
  }

  function applyItemState(pid, i, on, autoSpeak) {
    setRevealed(pid, i, on);
    setCardDOM(pid, i, on);
    updateProgressUI();

    const card = document.getElementById(`item-${pid}-${i}`);
    if (!card) return;
    const answerBtn = card.querySelector(".speak-answer");

    if (!on) {
      if (answerBtn && currentSpeakBtn === answerBtn) stopSpeech();
      return;
    }
    if (autoSpeak && tts.auto && answerBtn) {
      playWord(answerBtn.dataset.speak, answerBtn);
    }
  }

  function renderPaper(id, itemParam) {
    const paper = findPaper(id);
    if (!paper) {
      renderNotFound();
      return;
    }

    store.last = id;
    saveStore();

    view.dataset.pid = id;
    document.title = `${paper.label} ${paper.en} · 完形文库`;

    const pr = paperProgress(paper);
    const pct = pr.total ? Math.round((pr.done / pr.total) * 100) : 0;
    const idx = PAPERS.indexOf(paper);
    const prev = PAPERS[idx - 1] || null;
    const next = PAPERS[idx + 1] || null;

    view.innerHTML = `
      <nav class="crumbs" aria-label="位置">
        <a href="#/">馆藏总览</a><span class="sep">/</span><span>${paper.label}</span>
      </nav>

      <header class="paper-head">
        <p class="paper-kicker">${paper.year} 年 ${paper.month} 月 · ${esc(paper.range)}</p>
        <h1>${esc(paper.en)}</h1>
        <p class="paper-zh"><b>${esc(paper.zh)}</b> · 完形补文词汇对照 · 共 ${pr.total} 个考点</p>
        <div class="paper-tools">
          <div class="progress-box">
            <div class="p-track"><div class="p-fill" id="paperFill" style="width:${pct}%"></div></div>
            <span class="progress-text" id="paperProgressText"><b>${pr.done}</b> / ${pr.total} 已揭示</span>
          </div>
          <div class="tool-actions">
            <button class="btn btn-ghost btn-sm" id="revealAll" type="button">显示全部</button>
            <button class="btn btn-ghost btn-sm" id="resetPaper" type="button">重新开始</button>
          </div>
        </div>
      </header>

      <div class="tip">
        <svg class="icon" aria-hidden="true"><use href="#i-eye"></use></svg>
        点击虚线揭示答案，再点可收起；点击喇叭听发音
      </div>

      <div class="cards">${paper.items.map((it) => cardHTML(paper, it)).join("")}</div>

      <nav class="paper-pager" aria-label="翻卷">
        ${prev ? pagerHTML(prev, "prev") : "<span></span>"}
        ${next ? pagerHTML(next, "next") : "<span></span>"}
      </nav>
    `;

    $("#revealAll").addEventListener("click", () => {
      if (paperProgress(paper).done === pr.total) {
        toast("本卷已全部揭示");
        return;
      }
      store.revealed[paper.id] = paper.items.map((it) => it.i);
      saveStore();
      paper.items.forEach((it) => setCardDOM(paper.id, it.i, true));
      updateProgressUI();
      toast(`已揭示本卷全部 ${pr.total} 个考点`);
    });

    $("#resetPaper").addEventListener("click", () => {
      const done = paperProgress(paper).done;
      if (done === 0) {
        toast("本卷还没有揭示记录");
        return;
      }
      if (!window.confirm(`重新开始本卷？已揭示的 ${done} 条记录将被清除。`)) return;
      stopSpeech();
      delete store.revealed[paper.id];
      saveStore();
      paper.items.forEach((it) => setCardDOM(paper.id, it.i, false));
      updateProgressUI();
      toast("已重新开始本卷");
    });

    if (itemParam) {
      const n = Number(itemParam);
      if (paper.items.some((it) => it.i === n)) {
        applyItemState(paper.id, n, true);
        const el = document.getElementById(`item-${paper.id}-${n}`);
        if (el) {
          el.classList.add("is-target");
          setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
          setTimeout(() => el.classList.remove("is-target"), 2300);
        }
      }
    }
  }

  /* ---------------- 检索页 ---------------- */

  let searchTag = "";

  function setSearchHash(q, tag) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (tag) params.set("tag", tag);
    const qs = params.toString();
    try {
      history.replaceState(null, "", `#/search${qs ? `?${qs}` : ""}`);
    } catch (e) { /* 某些 file:// 或沙箱环境禁止修改历史记录 */ }
  }

  function rowHTML(x, q) {
    return `<a class="result-row" href="#/paper/${x.p.id}?item=${x.it.i}">
      <span class="result-paper">${x.p.label}</span>
      <span class="result-word"><b>${highlight(x.it.base, q)}</b><span class="to">→</span><span class="ans">${highlight(x.it.answer, q)}</span></span>
      <span class="result-gloss">${highlight(x.it.apos, q)} · ${highlight(x.it.gloss, q)}${x.it.agloss ? ` · ${highlight(x.it.agloss, q)}` : ""}</span>
    </a>`;
  }

  function renderSearch(params) {
    delete view.dataset.pid;
    const q = params.get("q") || "";
    const tagParam = params.get("tag") || "";
    const tagExists = allTagCounts().some((t) => t.name === tagParam);
    searchTag = tagExists ? tagParam : "";

    document.title = "全库检索 · 完形文库";
    globalInput.value = q;

    const chips = [
      `<button class="chip${searchTag === "" ? " is-active" : ""}" type="button" data-tag="">全部 <small>${ALL.length}</small></button>`,
      ...allTagCounts().map((t) => `<button class="chip${searchTag === t.name ? " is-active" : ""}" type="button" data-tag="${esc(t.name)}">${esc(t.name)} <small>${t.count}</small></button>`),
    ].join("");

    view.innerHTML = `
      <header class="page-head">
        <p class="eyebrow">检索 · INDEX</p>
        <h1>在文库中查找</h1>
        <p>支持英文原词、答案、词性、中文释义与考期，例如 used、过去分词、2019。</p>
      </header>

      <div class="search-field${q ? " has-value" : ""}" id="searchField">
        <svg class="icon" aria-hidden="true"><use href="#i-search"></use></svg>
        <input id="pageSearch" type="search" value="${esc(q)}" placeholder="输入关键词…" aria-label="检索考点" autocomplete="off" spellcheck="false">
        <button class="clear-search" id="clearSearch" type="button" aria-label="清空搜索">
          <svg class="icon" aria-hidden="true"><use href="#i-close"></use></svg>
        </button>
      </div>

      <div class="chips" id="tagChips" aria-label="按变化类型筛选">${chips}</div>

      <div class="search-summary">
        <span id="searchSummary"></span>
        <button class="clear-filter" id="clearFilter" type="button" hidden>清除筛选</button>
      </div>
      <div class="result-list" id="resultList"></div>
    `;

    const pageInput = $("#pageSearch");
    const field = $("#searchField");
    const list = $("#resultList");
    const summary = $("#searchSummary");
    const clearFilter = $("#clearFilter");

    function syncClear() {
      field.classList.toggle("has-value", pageInput.value.length > 0);
    }

    function run() {
      const term = pageInput.value.trim();
      const results = searchItems(term, searchTag);
      syncClear();

      if (term || searchTag) {
        summary.innerHTML = `找到 <b>${results.length}</b> 个考点` +
          (term ? ` · 关键词「${esc(term)}」` : "") +
          (searchTag ? ` · 标签「${esc(searchTag)}」` : "");
        clearFilter.hidden = false;
      } else {
        summary.innerHTML = `全库 <b>${ALL.length}</b> 个考点 · 按考期排列`;
        clearFilter.hidden = true;
      }

      globalInput.value = pageInput.value;
      setSearchHash(term, searchTag);

      if (!results.length) {
        list.innerHTML = `<div class="empty-state">
          <svg class="icon" aria-hidden="true"><use href="#i-search"></use></svg>
          <h3>没有匹配的考点</h3>
          <p>试试更短的关键词，或点击上方标签浏览同类词形变化。</p>
        </div>`;
        return;
      }

      list.innerHTML = results.map((x) => rowHTML(x, term)).join("");
    }

    pageInput.addEventListener("input", run);

    pageInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        pageInput.value = "";
        run();
      }
    });

    $("#clearSearch").addEventListener("click", () => {
      pageInput.value = "";
      run();
      pageInput.focus();
    });

    clearFilter.addEventListener("click", () => {
      pageInput.value = "";
      searchTag = "";
      syncClear();
      $$(".chip", $("#tagChips")).forEach((c) => c.classList.toggle("is-active", c.dataset.tag === ""));
      run();
    });

    $("#tagChips").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const nextTag = chip.dataset.tag || "";
      searchTag = searchTag === nextTag ? "" : nextTag;
      $$(".chip", $("#tagChips")).forEach((c) => c.classList.toggle("is-active", c.dataset.tag === searchTag));
      run();
    });

    run();
  }

  /* ---------------- 自测页 ---------------- */

  const quizState = { item: null, revealed: false, answered: 0 };

  function pickQuizItem(exclude) {
    let pool = ALL;
    if (exclude) {
      pool = ALL.filter((x) => !(x.p.id === exclude.p.id && x.it.i === exclude.it.i));
    }
    const unseen = pool.filter((x) => !isRevealed(x.p.id, x.it.i));
    const picked = unseen.length ? unseen : pool;
    return picked[Math.floor(Math.random() * picked.length)];
  }

  function renderQuiz() {
    delete view.dataset.pid;
    if (!quizState.item) quizState.item = pickQuizItem(null);
    document.title = "随机自测 · 完形文库";

    view.innerHTML = `
      <div class="quiz-wrap">
        <header class="quiz-head">
          <p class="eyebrow">随机自测 · FLASHCARD</p>
          <h1>先回想，再揭示</h1>
          <p>从 ${ALL.length} 个真题考点中随机抽题。点击空白揭示答案，揭示即计为一次练习并计入总进度。</p>
        </header>

        <div class="quiz-card">
          <div class="quiz-top">
            <span class="quiz-paper" id="quizPaper"></span>
            <span id="quizNo"></span>
          </div>
          <p class="quiz-instruction">请写出括号内单词的正确形式</p>
          <div class="quiz-prompt">
            <span class="quiz-word" id="quizWord"></span>
            <button class="speak-btn speak-lg" id="quizSpeakBase" type="button" aria-label="播放单词发音" title="播放单词发音">
              <svg class="icon" aria-hidden="true"><use href="#i-volume"></use></svg>
            </button>
            <span class="quiz-pos" id="quizPos"></span>
            <span class="quiz-gloss" id="quizGloss"></span>
          </div>

          <button class="quiz-blank" id="quizBlank" type="button" aria-expanded="false" aria-label="揭示答案">
            <span class="quiz-blank-label">点击揭示答案</span>
            <span class="quiz-blank-answer" id="quizAnswer"></span>
          </button>

          <div class="quiz-answer-meta" id="quizMeta" hidden>
            <span class="apos" id="quizApos"></span>
            <span id="quizAgloss"></span>
            <button class="speak-btn speak-lg" id="quizSpeakAnswer" type="button" aria-label="播放答案发音" title="播放答案发音" hidden>
              <svg class="icon" aria-hidden="true"><use href="#i-volume"></use></svg>
            </button>
          </div>

          <div class="quiz-actions">
            <button class="btn btn-primary" id="quizReveal" type="button">显示答案</button>
            <button class="btn btn-ghost" id="quizNext" type="button">
              下一题
              <svg class="icon" aria-hidden="true"><use href="#i-arrow-right"></use></svg>
            </button>
          </div>
        </div>

        <div class="quiz-foot">本次已练 <b id="quizCount">${quizState.answered}</b> 题 · 进度自动保存</div>
      </div>
    `;

    const blank = $("#quizBlank");
    const meta = $("#quizMeta");
    const revealBtn = $("#quizReveal");
    const nextBtn = $("#quizNext");
    const countEl = $("#quizCount");
    const speakBase = $("#quizSpeakBase");
    const speakAnswer = $("#quizSpeakAnswer");

    function fill() {
      const { p, it } = quizState.item;
      stopSpeech();

      $("#quizPaper").textContent = `${p.label} · ${p.en}`;
      $("#quizNo").textContent = `第 ${it.i} 题 · ${it.tags[0]}`;
      $("#quizWord").textContent = it.base;
      $("#quizPos").textContent = it.pos;
      $("#quizGloss").textContent = it.gloss;
      $("#quizAnswer").textContent = it.answer;
      $("#quizApos").textContent = it.apos;
      $("#quizAgloss").textContent = it.agloss;

      speakBase.dataset.speak = it.base;
      speakBase.setAttribute("aria-label", `播放 ${it.base} 的发音`);
      speakAnswer.dataset.speak = it.answer;
      speakAnswer.setAttribute("aria-label", `播放 ${it.answer} 的发音`);
      speakAnswer.hidden = true;

      quizState.revealed = false;
      blank.classList.remove("is-revealed");
      blank.setAttribute("aria-expanded", "false");
      blank.setAttribute("aria-label", "揭示答案");
      meta.hidden = true;
      revealBtn.style.display = "";
      nextBtn.className = "btn btn-ghost";
    }

    function reveal() {
      if (quizState.revealed) return;
      quizState.revealed = true;
      blank.classList.add("is-revealed");
      blank.setAttribute("aria-expanded", "true");
      blank.setAttribute("aria-label", `答案 ${quizState.item.it.answer}`);
      meta.hidden = false;
      speakAnswer.hidden = false;
      revealBtn.style.display = "none";
      nextBtn.className = "btn btn-primary";

      quizState.answered += 1;
      countEl.textContent = String(quizState.answered);

      setRevealed(quizState.item.p.id, quizState.item.it.i, true);
      updateSidebar();

      if (tts.auto) {
        playWord(quizState.item.it.answer, speakAnswer);
      }
    }

    blank.addEventListener("click", reveal);
    revealBtn.addEventListener("click", reveal);
    nextBtn.addEventListener("click", () => {
      stopSpeech();
      quizState.item = pickQuizItem(quizState.item);
      fill();
    });

    fill();
  }

  /* ---------------- 404 ---------------- */

  function renderNotFound() {
    delete view.dataset.pid;
    document.title = "未找到 · 完形文库";
    view.innerHTML = `<div class="empty-state" style="padding:100px 20px">
      <h3>没有找到这一页</h3>
      <p>链接可能已经失效，回到馆藏重新选择一套真题吧。</p>
      <p style="margin-top:22px"><a class="btn btn-primary" href="#/">返回馆藏总览</a></p>
    </div>`;
  }

  /* ---------------- 路由 ---------------- */

  function parseRoute() {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw || raw === "/") return { name: "home" };
    const [pathPart, queryPart] = raw.split("?");
    const path = pathPart.replace(/\/+$/, "");
    const params = new URLSearchParams(queryPart || "");
    const m = path.match(/^\/paper\/([\w-]+)$/);
    if (m) return { name: "paper", id: m[1], params };
    if (path === "/search") return { name: "search", params };
    if (path === "/quiz") return { name: "quiz" };
    return { name: "notfound" };
  }

  function route() {
    const r = parseRoute();
    stopSpeech();
    closeVoicePop();
    closeNav();
    closeSearchPop();
    if (r.name !== "search") globalInput.value = "";
    delete view.dataset.pid;
    window.scrollTo(0, 0);

    if (r.name === "paper") renderPaper(r.id, r.params.get("item"));
    else if (r.name === "search") renderSearch(r.params);
    else if (r.name === "quiz") renderQuiz();
    else if (r.name === "home") renderHome();
    else renderNotFound();

    setActiveNav(r.name, r.id);
    updateSidebar();
  }

  /* ---------------- 顶栏交互 ---------------- */

  function closeSearchPop() {
    searchPop.hidden = true;
    searchPop.innerHTML = "";
  }

  function renderSearchPop() {
    const q = globalInput.value.trim();
    closeVoicePop();
    if (!q) {
      closeSearchPop();
      return;
    }
    const results = searchItems(q, "");
    if (!results.length) {
      searchPop.innerHTML = `<div class="pop-empty">没有找到「${esc(q)}」相关考点</div>`;
      searchPop.hidden = false;
      return;
    }
    const rows = results.slice(0, 6).map((x) => `<a class="pop-row" href="#/paper/${x.p.id}?item=${x.it.i}">
      <span class="pop-paper">${x.p.label}</span>
      <span class="pop-word">${highlight(x.it.base, q)}<i>→</i><b>${highlight(x.it.answer, q)}</b></span>
      <span class="pop-gloss">${highlight(x.it.apos, q)}${x.it.agloss ? ` · ${highlight(x.it.agloss, q)}` : ""}</span>
    </a>`).join("");

    searchPop.innerHTML = `<div class="pop-head">共 ${results.length} 个考点</div>${rows}
      <a class="pop-all" href="#/search?q=${encodeURIComponent(q)}"><span>查看全部 ${results.length} 条结果</span><span aria-hidden="true">→</span></a>`;
    searchPop.hidden = false;
  }

  globalInput.addEventListener("input", renderSearchPop);
  globalInput.addEventListener("focus", () => {
    closeVoicePop();
    if (globalInput.value.trim()) renderSearchPop();
  });

  function syncSearchPlaceholder() {
    globalInput.placeholder = window.innerWidth < 380 ? "搜索单词…" : "搜索单词、释义或考期…";
  }
  window.addEventListener("resize", syncSearchPlaceholder);
  syncSearchPlaceholder();

  globalForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = globalInput.value.trim();
    if (!q) {
      globalInput.focus();
      return;
    }
    closeSearchPop();
    globalInput.blur();
    window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });

  document.addEventListener("click", (e) => {
    if (!globalForm.contains(e.target)) closeSearchPop();
  });

  document.addEventListener("keydown", (e) => {
    const target = e.target;
    const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      globalInput.focus();
      globalInput.select();
    }
    if (e.key === "Escape") {
      closeSearchPop();
      closeVoicePop();
      closeNav();
    }
  });

  /* ---------------- 导航 ---------------- */

  function openNav() {
    document.body.classList.add("nav-open");
    menuBtn.setAttribute("aria-expanded", "true");
  }

  function closeNav() {
    document.body.classList.remove("nav-open");
    menuBtn.setAttribute("aria-expanded", "false");
  }

  menuBtn.addEventListener("click", () => {
    if (document.body.classList.contains("nav-open")) closeNav();
    else openNav();
  });

  scrim.addEventListener("click", closeNav);

  /* ---------------- 主题 ---------------- */

  function applyTheme(theme, persist) {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#131519" : "#f4efe4");
    themeBtn.setAttribute("aria-label", theme === "dark" ? "切换浅色模式" : "切换深色模式");
    themeBtn.setAttribute("title", theme === "dark" ? "切换浅色模式" : "切换深色模式");
    if (persist) {
      store.theme = theme;
      saveStore();
    }
  }

  applyTheme(document.documentElement.dataset.theme || "light", false);

  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next, true);
  });

  /* ---------------- 卡片点击（事件委托） ---------------- */

  view.addEventListener("click", (e) => {
    const blank = e.target.closest(".blank[data-reveal]");
    if (!blank) return;
    const card = blank.closest(".term-card");
    if (!card) return;
    const pid = card.dataset.pid;
    const i = Number(card.dataset.i);
    const on = !blank.classList.contains("is-revealed");
    applyItemState(pid, i, on, true);
  });

  /* ---------------- 清除记录 ---------------- */

  $("#resetAll").addEventListener("click", () => {
    const op = overallProgress();
    if (op.done === 0) {
      toast("暂时还没有学习记录");
      return;
    }
    if (!window.confirm(`确定清除全部学习记录？${PAPERS.length} 套试卷中已揭示的 ${op.done} 条记录都会归零。`)) return;
    store.revealed = {};
    saveStore();
    quizState.answered = 0;
    updateSidebar();
    route();
    toast("已清除全部学习记录");
  });

  /* ---------------- 启动 ---------------- */

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  $("#skipLink").addEventListener("click", (e) => {
    e.preventDefault();
    view.focus();
  });

  buildPaperNav();
  updateSidebar();
  window.addEventListener("hashchange", route);
  route();
})();
