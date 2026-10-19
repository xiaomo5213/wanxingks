/* ==========================================================================
   Edge TTS 发音模块
   接口：POST https://api.xiemojy.mom/v1/audio/speech  → audio/mpeg
   特性：WeChat / iOS 音频解锁、Blob 缓存、请求去重、本机语音兜底
   ========================================================================== */
(function () {
  "use strict";

  var ENDPOINT = "https://api.xiemojy.mom/v1/audio/speech";
  var STORE_KEY = "cloze-flashcards-tts";
  var DEFAULT_VOICE = "en-US-JennyNeural";
  var DEFAULT_SPEED = 0.9;

  var VOICES = [
    ["en-US-JennyNeural", "美式女声 · Jenny"],
    ["en-US-AriaNeural", "美式女声 · Aria"],
    ["en-US-GuyNeural", "美式男声 · Guy"],
    ["en-GB-SoniaNeural", "英式女声 · Sonia"],
    ["en-GB-RyanNeural", "英式男声 · Ryan"],
    ["en-AU-NatashaNeural", "澳式女声 · Natasha"]
  ];
  var SPEEDS = [0.8, 0.9, 1, 1.1];

  // 静音 WAV，用于在一次用户手势里解锁 <audio>（iOS / 微信）
  var SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

  var cfg = { voice: DEFAULT_VOICE, speed: DEFAULT_SPEED };
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      var saved = JSON.parse(raw);
      if (saved && VOICES.some(function (v) { return v[0] === saved.voice; })) cfg.voice = saved.voice;
      if (saved && SPEEDS.indexOf(Number(saved.speed)) !== -1) cfg.speed = Number(saved.speed);
    }
  } catch (e) { /* 隐私模式 */ }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* 忽略 */ }
  }

  var audioEl = null;
  var unlocked = false;
  var priming = false;
  var currentBtn = null;
  var currentUrl = "";
  var token = 0;
  var cache = new Map();      // key -> objectURL
  var pending = new Map();    // key -> Promise<url>

  var api = {
    VOICES: VOICES,
    SPEEDS: SPEEDS,
    onNotice: null,
    speak: speak,
    stop: stop,
    prime: prime,
    prefetch: prefetch,
    voice: function () { return cfg.voice; },
    speed: function () { return cfg.speed; },
    setVoice: function (v) {
      if (!VOICES.some(function (x) { return x[0] === v; })) return;
      cfg.voice = v; save(); stop();
    },
    setSpeed: function (s) {
      var n = Number(s);
      if (SPEEDS.indexOf(n) === -1) return;
      cfg.speed = n; save(); stop();
    }
  };

  function notice(msg, silent) {
    if (silent) return;
    if (typeof api.onNotice === "function") api.onNotice(msg);
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

    audioEl.addEventListener("ended", clearBtn);
    audioEl.addEventListener("error", clearBtn);
    return audioEl;
  }

  function clearBtn() {
    if (!currentBtn) return;
    currentBtn.classList.remove("is-loading", "is-playing");
    currentBtn.removeAttribute("aria-busy");
    currentBtn = null;
  }

  function stop() {
    token += 1;
    var primingSilence = audioEl && !currentBtn && audioEl.src.indexOf("data:audio") === 0;
    if (audioEl && !primingSilence) {
      try { audioEl.pause(); audioEl.currentTime = 0; } catch (e) { /* noop */ }
    }
    clearBtn();
  }

  // 必须在用户手势（click / touch）里同步调用
  function prime() {
    if (unlocked || priming) return;
    priming = true;
    var audio = getAudio();
    try {
      audio.src = SILENT;
      var played = audio.play();
      if (played && typeof played.then === "function") {
        played.then(function () {
          unlocked = true;
          priming = false;
          setTimeout(function () {
            if (!currentBtn) {
              try { audio.pause(); audio.currentTime = 0; } catch (e) { /* noop */ }
            }
          }, 260);
        }).catch(function () { priming = false; });
      } else {
        unlocked = true;
        priming = false;
      }
    } catch (e) { priming = false; }
  }

  function keyOf(text) { return cfg.voice + "|" + cfg.speed + "|" + text; }

  function getUrl(text) {
    var key = keyOf(text);
    if (cache.has(key)) {
      var hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit);   // LRU：命中后移到队尾
      return Promise.resolve(hit);
    }
    if (pending.has(key)) return pending.get(key);

    var task = fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, voice: cfg.voice, speed: cfg.speed })
    }).then(function (response) {
      if (!response.ok) {
        if (response.status === 401) throw new Error("接口需要 API Key");
        if (response.status >= 500) throw new Error("语音服务暂时不可用");
        throw new Error("语音请求失败（" + response.status + "）");
      }
      var type = (response.headers.get("content-type") || "").toLowerCase();
      if (type.indexOf("json") !== -1 || type.indexOf("text/") !== -1) throw new Error("接口未返回音频");
      return response.blob();
    }).then(function (blob) {
      if (!blob || !blob.size) throw new Error("返回的音频为空");
      var url = URL.createObjectURL(blob);
      cache.set(key, url);
      if (cache.size > 160) {
        var oldestKey = cache.keys().next().value;
        var oldestUrl = cache.get(oldestKey);
        cache.delete(oldestKey);
        if (oldestUrl !== currentUrl) URL.revokeObjectURL(oldestUrl);
      }
      return url;
    });

    pending.set(key, task);
    task.catch(function () { /* 由调用方处理 */ }).then(function () { pending.delete(key); });
    return task;
  }

  function prefetch(text) {
    var t = String(text || "").trim();
    if (!t) return;
    getUrl(t).catch(function () { /* 预取失败不影响正常使用 */ });
  }

  // 接口不可用时的兜底：浏览器自带语音（桌面 Chrome / 安卓可用）
  function webSpeak(text) {
    if (!("speechSynthesis" in window)) return false;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = Math.min(1.3, cfg.speed * 1.05);
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  function speak(rawText, btn, opts) {
    var text = String(rawText || "").replace(/[【】]/g, "").trim();
    if (!text) return Promise.resolve();
    opts = opts || {};
    var silent = !!opts.silent;

    // 同一个喇叭再点一次 => 停止
    if (btn && currentBtn === btn &&
        (btn.classList.contains("is-loading") || btn.classList.contains("is-playing"))) {
      stop();
      return Promise.resolve();
    }

    var audio = getAudio();
    stop();
    prime();

    var myToken = ++token;
    currentBtn = btn || null;
    if (btn) {
      btn.classList.add("is-loading");
      btn.classList.remove("is-playing");
      btn.setAttribute("aria-busy", "true");
    }

    return getUrl(text).then(function (url) {
      if (myToken !== token) return;
      audio.pause();
      audio.src = url;
      audio.currentTime = 0;
      currentUrl = url;

      if (btn) {
        btn.classList.remove("is-loading");
        btn.classList.add("is-playing");
        btn.removeAttribute("aria-busy");
      }
      return audio.play().then(function () {
        unlocked = true;
      });
    }).catch(function (err) {
      if (myToken !== token) return;
      clearBtn();
      if (err && err.name === "NotAllowedError") {
        notice("请再点一次喇叭（微信 / iOS 需要解锁音频）", silent);
        return;
      }
      if (webSpeak(text)) {
        notice("已切换本机发音", silent);
        return;
      }
      notice("发音失败：" + (err && err.message ? err.message : "请检查网络"), silent);
    });
  }

  // 首次触摸 / 点击时解锁音频；微信另有 WeixinJSBridgeReady
  function unlockOnce() {
    prime();
    document.removeEventListener("pointerdown", unlockOnce, true);
    document.removeEventListener("touchstart", unlockOnce, true);
  }
  document.addEventListener("pointerdown", unlockOnce, true);
  document.addEventListener("touchstart", unlockOnce, true);
  document.addEventListener("WeixinJSBridgeReady", function () { prime(); }, false);

  window.FlashTTS = api;
})();
