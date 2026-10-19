/* ==========================================================================
   填词补文 120 词闪卡 · 交互
   数据在 data/words.js（window.VOCAB_DATA），本文件不含词表。
   ========================================================================== */
(function () {
  "use strict";

  var DATA = window.VOCAB_DATA;
  var KEY = "cloze-flashcards-v1";
  var RATE = { again: "again", fuzzy: "fuzzy", know: "know" };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var els = {
    progress: $("#progressFill"),
    daySeg: $("#daySeg"),
    dirSeg: $("#dirSeg"),
    orderBtn: $("#orderBtn"),
    scopeBtn: $("#scopeBtn"),
    speakToggle: $("#speakToggle"),
    posTag: $("#posTag"),
    starBtn: $("#starBtn"),
    speakBtn: $("#speakBtn"),
    card: $("#card"),
    frontWord: $("#frontWord"),
    backMain: $("#backMain"),
    backAlt: $("#backAlt"),
    tip: $("#tip"),
    example: $("#example"),
    exText: $("#exText"),
    exSrc: $("#exSrc"),
    rate: $("#rate"),
    counter: $("#counter"),
    stats: $("#stats"),
    resetBtn: $("#resetBtn"),
    done: $("#done"),
    doneTitle: $("#doneTitle"),
    doneSub: $("#doneSub"),
    doneStats: $("#doneStats"),
    againWrong: $("#againWrong"),
    restart: $("#restart"),
    themeBtn: $("#themeBtn"),
    listBtn: $("#listBtn"),
    settingsBtn: $("#settingsBtn"),
    settingsPop: $("#settingsPop"),
    popBackdrop: $("#popBackdrop"),
    popClose: $("#popClose"),
    voiceSelect: $("#voiceSelect"),
    speedSelect: $("#speedSelect"),
    autoSpeakCheck: $("#autoSpeakCheck"),
    voiceTest: $("#voiceTest"),
    toast: $("#toast"),
    sheet: $("#sheet"),
    sheetBody: $("#sheetBody"),
    sheetClose: $("#sheetClose"),
    sheetBackdrop: $("#sheetBackdrop"),
    sheetCount: $("#sheetCount"),
    stage: $("#stage")
  };

  if (!DATA || !Array.isArray(DATA.words) || !DATA.words.length) {
    els.stage.innerHTML = '<div class="done-inner"><h2>数据没有加载</h2>' +
      '<p class="done-sub">请确认 <code>data/words.js</code> 与 <code>index.html</code> 在同一个站点目录下。</p></div>';
    return;
  }

  var WORDS = DATA.words;
  var BY_ID = {};
  WORDS.forEach(function (w) { BY_ID[w.id] = w; });

  /* ---------------- 状态 ---------------- */

  var store = {
    stats: {},          // id -> "know" | "fuzzy" | "again"
    stars: {},          // id -> true
    prefs: { theme: "light", autoSpeak: true },
    filters: { day: "all", dir: "en2cn", order: "seq", scope: "all" }
  };

  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var saved = JSON.parse(raw);
      if (saved && typeof saved === "object") {
        store.stats = saved.stats || {};
        store.stars = saved.stars || {};
        store.prefs = Object.assign(store.prefs, saved.prefs || {});
        store.filters = Object.assign(store.filters, saved.filters || {});
      }
    }
  } catch (e) { /* 隐私模式：不影响使用 */ }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* 忽略 */ }
  }

  var queue = [];
  var pos = 0;
  var flipped = false;
  var current = null;
  var emptyPool = false;
  var prefetchTimer = 0;
  var toastTimer = 0;

  /* ---------------- 队列 ---------------- */

  function dayWords() {
    var day = store.filters.day;
    return WORDS.filter(function (w) { return day === "all" || w.day === Number(day); });
  }

  function pool() {
    var list = dayWords();
    var scope = store.filters.scope;
    if (scope === "wrong") {
      list = list.filter(function (w) { return store.stats[w.id] && store.stats[w.id] !== "know"; });
    } else if (scope === "star") {
      list = list.filter(function (w) { return !!store.stars[w.id]; });
    }
    return list;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function buildQueue() {
    var list = pool();
    emptyPool = list.length === 0;
    if (store.filters.order === "shuffle") shuffle(list);
    queue = list.map(function (w) { return w.id; });
    pos = 0;
    flipped = false;
    current = queue.length ? BY_ID[queue[0]] : null;
    render();
  }

  /* ---------------- 渲染 ---------------- */

  function countKnown(list) {
    return list.filter(function (w) { return store.stats[w.id] === "know"; }).length;
  }

  function render() {
    var all = dayWords();
    var known = countKnown(all);
    els.progress.style.width = (all.length ? (known / all.length) * 100 : 0) + "%";

    if (!queue.length || pos >= queue.length || !BY_ID[queue[pos]]) { showDone(); return; }
    els.done.hidden = true;
    els.card.style.display = "";
    els.rate.style.display = "";
    $(".card-top").style.display = "";
    $(".meta").style.display = "";

    var w = BY_ID[queue[pos]];
    current = w;
    var isEn = store.filters.dir === "en2cn";

    els.posTag.textContent = w.pos;
    els.posTag.hidden = !w.pos;

    els.frontWord.textContent = isEn ? w.en : w.cn;
    els.frontWord.classList.toggle("is-cn", !isEn);
    els.backMain.textContent = isEn ? w.cn : w.en;
    els.backMain.classList.toggle("is-en", !isEn);
    if (!isEn) {
      els.backAlt.textContent = w.cn;
      els.backAlt.hidden = false;
    } else {
      els.backAlt.hidden = true;
    }

    if (w.tip) { els.tip.textContent = w.tip; els.tip.hidden = false; } else { els.tip.hidden = true; }

    if (w.ex) {
      els.exText.innerHTML = highlight(w.ex, w.en);
      els.exSrc.textContent = w.src ? "真题原句 · " + w.src : "";
      els.exSrc.hidden = !w.src;
      els.example.hidden = false;
    } else {
      els.example.hidden = true;
    }

    els.starBtn.setAttribute("aria-pressed", store.stars[w.id] ? "true" : "false");
    els.starBtn.setAttribute("aria-label", store.stars[w.id] ? "取消收藏" : "收藏这个单词");

    els.card.classList.toggle("is-flipped", flipped);
    els.card.setAttribute("aria-label", flipped
      ? (isEn ? "答案：" + w.cn + "，点击翻回" : "答案：" + w.en + "，点击翻回")
      : "点击翻面查看答案");

    els.counter.textContent = (pos + 1) + " / " + queue.length;

    var k = 0, f = 0, a = 0;
    all.forEach(function (x) {
      var s = store.stats[x.id];
      if (s === "know") k++; else if (s === "fuzzy") f++; else if (s === "again") a++;
    });
    els.stats.textContent = "认识 " + k + " · 模糊 " + f + " · 不认识 " + a;

    updateChips();

    // 预热当前单词的音频，点喇叭时几乎零等待
    if (window.FlashTTS) {
      window.clearTimeout(prefetchTimer);
      prefetchTimer = window.setTimeout(function () { window.FlashTTS.prefetch(w.en); }, 350);
    }
  }

  function highlight(text, word) {
    var esc = function (s) {
      return s.replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    };
    var base = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var forms = [word, word + "s", word + "es", word + "ed", word + "d", word + "ing"];
    var pattern = forms.map(function (f) {
      return f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).sort(function (a, b) { return b.length - a.length; }).join("|");
    var re = new RegExp("\\b(" + pattern + ")\\b", "gi");
    var out = "", last = 0, m;
    while ((m = re.exec(text)) !== null) {
      out += esc(text.slice(last, m.index)) + "<mark>" + esc(m[0]) + "</mark>";
      last = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out + esc(text.slice(last));
  }

  function showDone() {
    els.card.style.display = "none";
    els.rate.style.display = "none";
    $(".card-top").style.display = "none";
    $(".meta").style.display = "none";
    els.done.hidden = false;

    var seal = $(".done-seal");
    var all = dayWords();
    var k = 0, f = 0, a = 0;
    all.forEach(function (x) {
      var s = store.stats[x.id];
      if (s === "know") k++; else if (s === "fuzzy") f++; else if (s === "again") a++;
    });

    if (emptyPool) {
      if (seal) seal.hidden = true;
      els.doneStats.textContent = "";
      els.doneTitle.textContent = "这里还没有单词";
      els.doneSub.textContent = store.filters.scope === "star"
        ? "还没有收藏的单词。点卡片右上角的星标，就能把难词收进来。"
        : "当前分组里没有「未掌握」的词，换个分组继续。";
      els.againWrong.textContent = "看全部词";
      els.restart.textContent = "回到第 1 天";
    } else {
      if (seal) seal.hidden = false;
      var total = all.length;
      var known = countKnown(all);
      var weak = f + a;
      els.doneTitle.textContent = (store.filters.day === "all" ? "全部 " : "第 " + store.filters.day + " 天 ") +
        total + " 个词过完了";
      els.doneSub.textContent = weak === 0
        ? "已标记认识 " + known + " 个，全部拿下。"
        : "已标记认识 " + known + " 个，还有 " + weak + " 个没记住——再来一轮，或者只刷错词。";
      els.doneStats.textContent = "认识 " + k + " · 模糊 " + f + " · 不认识 " + a;
      els.againWrong.hidden = weak === 0;
      els.againWrong.textContent = "复习错词";
      els.restart.textContent = "再来一轮";
    }
  }

  /* ---------------- 操作 ---------------- */

  function flip() {
    if (!queue.length || !current) return;
    flipped = !flipped;
    els.card.classList.toggle("is-flipped", flipped);
    var w = current;

    if (flipped && store.prefs.autoSpeak && store.filters.dir === "cn2en") speakWord(w.en, null, true);

    var isEn = store.filters.dir === "en2cn";
    els.card.setAttribute("aria-label", flipped
      ? (isEn ? "答案：" + w.cn + "，点击翻回" : "答案：" + w.en + "，点击翻回")
      : "点击翻面查看答案");
  }

  function rate(kind) {
    if (!queue.length) return;
    var id = queue[pos];
    store.stats[id] = kind;
    save();

    if (kind === "know") {
      queue.splice(pos, 1);
    } else if (kind === "fuzzy") {
      queue.splice(pos, 1);
      queue.push(id);
    } else {
      queue.splice(pos, 1);
      var at = Math.min(pos + 3, queue.length);
      queue.splice(at, 0, id);
    }

    if (pos >= queue.length) pos = 0;
    flipped = false;
    render();

    if (queue.length && store.prefs.autoSpeak && store.filters.dir === "en2cn") speakWord(current.en, null, true);
    if (document.activeElement && document.activeElement.closest &&
        document.activeElement.closest(".rate")) document.activeElement.blur();
  }

  function jump(id) {
    var i = queue.indexOf(id);
    if (i === -1) {
      store.filters.day = "all";
      store.filters.scope = "all";
      buildQueue();
      i = queue.indexOf(id);
    }
    if (i >= 0) { pos = i; flipped = false; render(); }
    closeSheet();
  }

  function speakWord(text, btn, silent) {
    if (!text) return;
    if (window.FlashTTS && typeof window.FlashTTS.speak === "function") {
      window.FlashTTS.speak(text, btn || null, { silent: !!silent });
    }
  }

  /* ---------------- 工具栏 ---------------- */

  function updateChips() {
    els.orderBtn.textContent = store.filters.order === "shuffle" ? "乱序" : "顺序";
    els.orderBtn.setAttribute("aria-pressed", store.filters.order === "shuffle" ? "true" : "false");

    var scopes = { all: "全部词", wrong: "错词", star: "收藏" };
    els.scopeBtn.textContent = scopes[store.filters.scope];
    els.scopeBtn.setAttribute("aria-pressed", store.filters.scope === "all" ? "false" : "true");

    els.speakToggle.textContent = store.prefs.autoSpeak ? "发音 开" : "发音 关";
    els.speakToggle.setAttribute("aria-pressed", store.prefs.autoSpeak ? "true" : "false");

    $$("button", els.daySeg).forEach(function (b) {
      b.classList.toggle("is-on", String(store.filters.day) === b.dataset.day);
    });
    $$("button", els.dirSeg).forEach(function (b) {
      b.classList.toggle("is-on", store.filters.dir === b.dataset.dir);
    });

    var theme = document.documentElement.dataset.theme;
    els.themeBtn.setAttribute("aria-label", theme === "dark" ? "切换浅色模式" : "切换深色模式");
  }

  function setDay(day) {
    store.filters.day = day;
    save(); buildQueue();
  }

  function setDir(dir) {
    if (store.filters.dir === dir) return;
    store.filters.dir = dir;
    save(); flipped = false; render();
    if (store.prefs.autoSpeak && dir === "en2cn") speakWord(current.en, null, true);
  }

  function cycleScope() {
    var order = ["all", "wrong", "star"];
    var i = order.indexOf(store.filters.scope);
    store.filters.scope = order[(i + 1) % order.length];
    save(); buildQueue();
  }

  function toggleOrder() {
    store.filters.order = store.filters.order === "seq" ? "shuffle" : "seq";
    save(); buildQueue();
  }

  /* ---------------- 词表 ---------------- */

  function openSheet() {
    renderSheet();
    els.sheet.hidden = false;
    document.body.style.overflow = "hidden";
    var panel = $(".sheet-panel");
    if (panel) panel.focus();
  }

  function closeSheet() {
    els.sheet.hidden = true;
    document.body.style.overflow = "";
    els.listBtn.focus();
  }

  function renderSheet() {
    els.sheetCount.textContent = WORDS.length + " 个";
    els.sheetBody.innerHTML = "";
    WORDS.slice().sort(function (a, b) {
      return a.day - b.day || a.en.localeCompare(b.en);
    }).forEach(function (w) {
      var status = store.stats[w.id] || "new";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "word-chip";
      btn.dataset.s = status;
      btn.dataset.id = w.id;
      var dot = document.createElement("i");
      var body = document.createElement("span");
      body.style.minWidth = "0";
      var w1 = document.createElement("span");
      w1.className = "w";
      w1.textContent = w.en;
      var w2 = document.createElement("span");
      w2.className = "c";
      w2.textContent = " " + w.cn;
      body.appendChild(w1); body.appendChild(w2);
      btn.appendChild(dot); btn.appendChild(body);
      btn.addEventListener("click", function () { jump(w.id); });
      els.sheetBody.appendChild(btn);
    });
  }

  /* ---------------- 主题 / 重置 ---------------- */

  function toggleTheme() {
    var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.prefs.theme = next;
    save();
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#131519" : "#f4efe4");
    updateChips();
  }

  function resetProgress() {
    if (!window.confirm("清空所有「认识 / 模糊 / 不认识」记录？收藏会保留。")) return;
    store.stats = {};
    save();
    buildQueue();
  }

  /* ---------------- 提示 / 发音设置 ---------------- */

  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add("is-show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { els.toast.classList.remove("is-show"); }, 2800);
  }

  function initTtsUI() {
    var tts = window.FlashTTS;
    if (!tts) {
      if (els.settingsBtn) els.settingsBtn.hidden = true;
      return;
    }
    tts.onNotice = toast;

    tts.VOICES.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v[0];
      o.textContent = v[1];
      els.voiceSelect.appendChild(o);
    });
    tts.SPEEDS.forEach(function (s) {
      var o = document.createElement("option");
      o.value = String(s);
      o.textContent = s.toFixed(1) + "×" + (s < 0.9 ? "（慢）" : s > 1 ? "（快）" : "");
      els.speedSelect.appendChild(o);
    });

    els.voiceSelect.value = tts.voice();
    els.speedSelect.value = String(tts.speed());
    els.autoSpeakCheck.checked = !!store.prefs.autoSpeak;

    els.voiceSelect.addEventListener("change", function () {
      tts.setVoice(els.voiceSelect.value);
    });
    els.speedSelect.addEventListener("change", function () {
      tts.setSpeed(Number(els.speedSelect.value));
    });
    els.autoSpeakCheck.addEventListener("change", function () {
      store.prefs.autoSpeak = els.autoSpeakCheck.checked;
      save();
      updateChips();
    });
    els.voiceTest.addEventListener("click", function () {
      tts.speak("vocabulary", els.voiceTest);
    });
  }

  function openSettings() {
    if (!window.FlashTTS) return;
    els.settingsPop.hidden = false;
    els.popBackdrop.hidden = false;
    els.settingsBtn.setAttribute("aria-expanded", "true");
  }

  function closeSettings() {
    if (els.settingsPop.hidden) return;
    els.settingsPop.hidden = true;
    els.popBackdrop.hidden = true;
    els.settingsBtn.setAttribute("aria-expanded", "false");
  }

  /* ---------------- 事件 ---------------- */

  els.card.addEventListener("click", flip);

  els.rate.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-rate]");
    if (btn) rate(btn.dataset.rate);
  });

  els.daySeg.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-day]");
    if (btn) setDay(btn.dataset.day);
  });

  els.dirSeg.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-dir]");
    if (btn) setDir(btn.dataset.dir);
  });

  els.orderBtn.addEventListener("click", toggleOrder);
  els.scopeBtn.addEventListener("click", cycleScope);

  els.speakToggle.addEventListener("click", function () {
    store.prefs.autoSpeak = !store.prefs.autoSpeak;
    save(); updateChips();
  });

  els.speakBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (current) speakWord(current.en, els.speakBtn);
  });

  els.starBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!current) return;
    if (store.stars[current.id]) delete store.stars[current.id];
    else store.stars[current.id] = true;
    save();
    render();
    if (store.filters.scope === "star") buildQueue();
  });

  els.themeBtn.addEventListener("click", toggleTheme);
  els.resetBtn.addEventListener("click", resetProgress);

  els.settingsBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (els.settingsPop.hidden) openSettings();
    else closeSettings();
  });
  els.popBackdrop.addEventListener("click", closeSettings);
  els.popClose.addEventListener("click", closeSettings);

  els.listBtn.addEventListener("click", openSheet);
  els.sheetClose.addEventListener("click", closeSheet);
  els.sheetBackdrop.addEventListener("click", closeSheet);

  els.againWrong.addEventListener("click", function () {
    if (emptyPool) { store.filters.scope = "all"; store.filters.day = "all"; }
    else { store.filters.scope = "wrong"; }
    save(); buildQueue();
  });

  els.restart.addEventListener("click", function () {
    if (emptyPool) { store.filters.scope = "all"; store.filters.day = "1"; }
    else { store.filters.scope = "all"; }
    save(); buildQueue();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !els.settingsPop.hidden) { closeSettings(); return; }
    if (e.key === "Escape" && !els.sheet.hidden) { closeSheet(); return; }
    if (!els.sheet.hidden || !els.settingsPop.hidden) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    var tag = (e.target.tagName || "").toLowerCase();
    var typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
    if (typing) return;

    // 让聚焦的按钮自己响应空格/回车，避免双触发
    var onButton = tag === "button" || tag === "a";
    if ((e.key === " " || e.key === "Enter") && onButton) return;

    if (els.done.hidden === false) return;

    if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); rate("again"); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); rate("fuzzy"); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); rate("know"); return; }
    if (e.key === "s" || e.key === "S") { els.starBtn.click(); }
  });

  // 触屏左右滑：左滑不认识，右滑认识
  var touchX = null, touchY = null;
  els.card.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) return;
    touchX = e.touches[0].clientX; touchY = e.touches[0].clientY;
  }, { passive: true });
  els.card.addEventListener("touchend", function (e) {
    if (touchX === null) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touchX, dy = t.clientY - touchY;
    touchX = touchY = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) rate(dx < 0 ? "again" : "know");
  }, { passive: true });

  /* ---------------- 启动 ---------------- */

  initTtsUI();
  updateChips();
  buildQueue();
})();


