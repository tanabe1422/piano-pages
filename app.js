(function () {
  var START_MIDI = 48;
  var END_MIDI = 84;
  var TONIC_MIN = 48;
  var TONIC_MAX = 72;
  var SKIP_UP = {
    step: [0, 2, 4, 5, 7],
    chromatic: [0, 1, 2, 3, 4],
    skip1: [0, 2, 4, 6, 8],
    skip2: [0, 3, 6, 9, 12]
  };
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var SOLFA = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];
  var SPEEDS = { slow: 1000, normal: 600, fast: 350 };
  var BLACK_PC = { 1: true, 3: true, 6: true, 8: true, 10: true };

  var tonic = 60;
  var direction = "low-high-low";
  var skip = "step";
  var speed = "normal";
  var TAP_MS = 600;
  var playing = false;
  var playToken = 0;
  var timers = [];
  var voices = [];
  var liveByPointer = {};
  var liveByMidi = {};
  var audioCtx = null;
  var keysByMidi = {};

  var keyboardEl = document.getElementById("keyboard");
  var wrapEl = document.getElementById("keyboard-wrap");
  var rangeEl = document.getElementById("range-label");
  var btnPlay = document.getElementById("btn-play");
  var btnLower = document.getElementById("btn-lower");
  var btnHigher = document.getElementById("btn-higher");

  function isBlack(midi) {
    return BLACK_PC[midi % 12] === true;
  }

  function midiName(midi) {
    return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  function karaoke(midi) {
    var pc = midi % 12;
    var reg = midi < 48 ? "low" : midi < 60 ? "mid1" : midi < 72 ? "mid2" : midi < 84 ? "hi" : "hihi";
    return reg + " の" + SOLFA[pc];
  }

  function sequence() {
    var up = SKIP_UP[skip];
    var down = up.slice().reverse();
    if (direction === "high-low-high") {
      return down.concat(up.slice(1));
    }
    return up.concat(down.slice(1));
  }

  function buildKeyboard() {
    var whites = [];
    var midi;
    for (midi = START_MIDI; midi <= END_MIDI; midi++) {
      if (!isBlack(midi)) whites.push(midi);
    }

    whites.forEach(function (midi) {
      var key = document.createElement("div");
      key.className = "white-key";
      key.dataset.midi = String(midi);
      if (midi % 12 === 0) {
        var label = document.createElement("span");
        label.className = "key-name";
        label.textContent = midiName(midi);
        key.appendChild(label);
      }
      keyboardEl.appendChild(key);
      keysByMidi[midi] = key;
    });

    whites.forEach(function (midi, index) {
      var next = midi + 1;
      if (next > END_MIDI || !isBlack(next)) return;
      var black = document.createElement("div");
      black.className = "black-key";
      black.dataset.midi = String(next);
      black.style.left = ((index + 1) / whites.length) * 100 + "%";
      keyboardEl.appendChild(black);
      keysByMidi[next] = black;
    });
  }

  function highlight(midi) {
    Object.keys(keysByMidi).forEach(function (key) {
      keysByMidi[key].classList.remove("is-on");
    });
    if (midi == null) return;
    var el = keysByMidi[midi];
    if (!el) return;
    el.classList.add("is-on");
    ensureVisible(el);
  }

  function ensureVisible(el) {
    var wrap = wrapEl.getBoundingClientRect();
    var key = el.getBoundingClientRect();
    if (key.left >= wrap.left + 12 && key.right <= wrap.right - 12) return;
    wrapEl.scrollLeft += key.left - wrap.left - wrap.width / 2 + key.width / 2;
  }

  function updateMarks() {
    Object.keys(keysByMidi).forEach(function (key) {
      keysByMidi[key].classList.remove("is-start", "is-planned");
    });
    SKIP_UP[skip].forEach(function (semi) {
      var midi = tonic + semi;
      var el = keysByMidi[midi];
      if (!el) return;
      if (midi === tonic) el.classList.add("is-start");
      else el.classList.add("is-planned");
    });
  }

  function updateRange() {
    var top = tonic + SKIP_UP[skip][SKIP_UP[skip].length - 1];
    rangeEl.innerHTML =
      midiName(tonic) +
      " 〜 " +
      midiName(top) +
      '<span class="karaoke">' +
      karaoke(tonic) +
      " 〜 " +
      karaoke(top) +
      "</span>";
    btnLower.disabled = tonic <= TONIC_MIN;
    btnHigher.disabled = tonic >= TONIC_MAX;
    updateMarks();
  }

  function updatePlayButton() {
    btnPlay.textContent = playing ? "停止" : "再生";
    btnPlay.classList.toggle("is-playing", playing);
    btnPlay.setAttribute("aria-pressed", playing ? "true" : "false");
  }

  function ensureAudio() {
    if (navigator.audioSession) {
      navigator.audioSession.type = "playback";
    }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function stopVoices() {
    var ctx = audioCtx;
    var now = ctx ? ctx.currentTime : 0;
    voices.forEach(function (voice) {
      try {
        voice.master.gain.cancelScheduledValues(now);
        voice.master.gain.setValueAtTime(voice.master.gain.value, now);
        voice.master.gain.linearRampToValueAtTime(0, now + 0.03);
        voice.sine.stop(now + 0.04);
        voice.tri.stop(now + 0.04);
      } catch (e) {}
    });
    voices = [];
  }

  function stopPlayback() {
    playToken += 1;
    playing = false;
    timers.forEach(function (id) {
      clearTimeout(id);
    });
    timers = [];
    stopVoices();
    highlight(null);
    updatePlayButton();
  }

  function scheduleNote(ctx, midi, start, duration) {
    var freq = 440 * Math.pow(2, (midi - 69) / 12);
    var sine = ctx.createOscillator();
    var tri = ctx.createOscillator();
    var sineGain = ctx.createGain();
    var triGain = ctx.createGain();
    var master = ctx.createGain();

    sine.type = "sine";
    tri.type = "triangle";
    sine.frequency.setValueAtTime(freq, start);
    tri.frequency.setValueAtTime(freq, start);
    sineGain.gain.value = 0.72;
    triGain.gain.value = 0.16;

    var attack = 0.018;
    var release = 0.045;
    var peak = 0.2;
    master.gain.setValueAtTime(0, start);
    master.gain.linearRampToValueAtTime(peak, start + attack);
    master.gain.setValueAtTime(peak, start + duration - release);
    master.gain.linearRampToValueAtTime(0, start + duration);

    sine.connect(sineGain);
    tri.connect(triGain);
    sineGain.connect(master);
    triGain.connect(master);
    master.connect(ctx.destination);

    sine.start(start);
    tri.start(start);
    sine.stop(start + duration + 0.02);
    tri.stop(start + duration + 0.02);

    voices.push({ sine: sine, tri: tri, master: master });
  }

  function startLiveNote(midi) {
    var ctx = ensureAudio();
    var now = ctx.currentTime;
    var freq = 440 * Math.pow(2, (midi - 69) / 12);
    var sine = ctx.createOscillator();
    var tri = ctx.createOscillator();
    var sineGain = ctx.createGain();
    var triGain = ctx.createGain();
    var master = ctx.createGain();

    sine.type = "sine";
    tri.type = "triangle";
    sine.frequency.setValueAtTime(freq, now);
    tri.frequency.setValueAtTime(freq, now);
    sineGain.gain.value = 0.72;
    triGain.gain.value = 0.16;
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.2, now + 0.018);

    sine.connect(sineGain);
    tri.connect(triGain);
    sineGain.connect(master);
    triGain.connect(master);
    master.connect(ctx.destination);

    sine.start(now);
    tri.start(now);
    return { sine: sine, tri: tri, master: master };
  }

  function stopLiveNote(voice) {
    if (!audioCtx) return;
    var now = audioCtx.currentTime;
    try {
      voice.master.gain.cancelScheduledValues(now);
      voice.master.gain.setValueAtTime(voice.master.gain.value, now);
      voice.master.gain.linearRampToValueAtTime(0, now + 0.045);
      voice.sine.stop(now + 0.06);
      voice.tri.stop(now + 0.06);
    } catch (e) {}
  }

  function highlightLive(midi, on) {
    var el = keysByMidi[midi];
    if (!el) return;
    el.classList.toggle("is-on", on);
  }

  function startLive(midi, pointerId) {
    if (playing) stopPlayback();
    liveByPointer[pointerId] = midi;
    var entry = liveByMidi[midi];
    if (entry) {
      entry.pointers[pointerId] = true;
      if (entry.releaseTimer) {
        clearTimeout(entry.releaseTimer);
        entry.releaseTimer = null;
      }
      highlightLive(midi, true);
      return;
    }
    liveByMidi[midi] = {
      voice: startLiveNote(midi),
      pointers: {},
      startedAt: performance.now(),
      releaseTimer: null
    };
    liveByMidi[midi].pointers[pointerId] = true;
    highlightLive(midi, true);
  }

  function pointerCount(pointers) {
    var n = 0;
    var id;
    for (id in pointers) {
      if (Object.prototype.hasOwnProperty.call(pointers, id)) n += 1;
    }
    return n;
  }

  function finishLive(midi) {
    var entry = liveByMidi[midi];
    if (!entry) return;
    if (entry.releaseTimer) {
      clearTimeout(entry.releaseTimer);
      entry.releaseTimer = null;
    }
    stopLiveNote(entry.voice);
    delete liveByMidi[midi];
    if (!playing) highlightLive(midi, false);
  }

  function releaseLive(pointerId, immediate) {
    var midi = liveByPointer[pointerId];
    if (midi == null) return;
    delete liveByPointer[pointerId];
    var entry = liveByMidi[midi];
    if (!entry) return;
    delete entry.pointers[pointerId];
    if (pointerCount(entry.pointers) > 0) return;
    var remain = TAP_MS - (performance.now() - entry.startedAt);
    if (!immediate && remain > 20) {
      entry.releaseTimer = setTimeout(function () {
        finishLive(midi);
      }, remain);
    } else {
      finishLive(midi);
    }
  }

  function stopAllLive() {
    var id;
    for (id in liveByPointer) {
      if (Object.prototype.hasOwnProperty.call(liveByPointer, id)) {
        delete liveByPointer[id];
      }
    }
    Object.keys(liveByMidi).forEach(function (midi) {
      finishLive(Number(midi));
    });
  }

  function midiFromEvent(e) {
    var el = e.target.closest("[data-midi]");
    if (!el || !keyboardEl.contains(el)) return null;
    return Number(el.dataset.midi);
  }

  function playScale() {
    var ctx = ensureAudio();
    stopAllLive();
    stopPlayback();
    var token = playToken;
    playing = true;
    updatePlayButton();

    var notes = sequence().map(function (semi) {
      return tonic + semi;
    });
    var noteMs = SPEEDS[speed];
    var noteSec = noteMs / 1000;
    var hold = noteSec - 0.03;
    if (hold < 0.12) hold = noteSec * 0.88;
    var startAt = ctx.currentTime + 0.04;

    notes.forEach(function (midi, i) {
      var t = startAt + i * noteSec;
      scheduleNote(ctx, midi, t, hold);
      timers.push(
        setTimeout(function () {
          if (token !== playToken) return;
          highlight(midi);
        }, Math.max(0, (t - ctx.currentTime) * 1000))
      );
    });

    timers.push(
      setTimeout(function () {
        if (token !== playToken) return;
        playing = false;
        highlight(null);
        updatePlayButton();
      }, 40 + notes.length * noteMs)
    );
  }

  function setDirection(next) {
    if (direction === next) return;
    direction = next;
    document.querySelectorAll("[data-dir]").forEach(function (btn) {
      var on = btn.getAttribute("data-dir") === next;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    if (playing) playScale();
  }

  function setSpeed(next) {
    if (speed === next) return;
    speed = next;
    document.querySelectorAll("[data-speed]").forEach(function (btn) {
      var on = btn.getAttribute("data-speed") === next;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    if (playing) playScale();
  }

  function setSkip(next) {
    if (skip === next) return;
    skip = next;
    document.querySelectorAll("[data-skip]").forEach(function (btn) {
      var on = btn.getAttribute("data-skip") === next;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    updateRange();
    if (playing) playScale();
  }

  function shift(delta) {
    var next = tonic + delta;
    if (next < TONIC_MIN || next > TONIC_MAX) return;
    tonic = next;
    updateRange();
    playScale();
  }

  document.querySelectorAll("[data-dir]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setDirection(btn.getAttribute("data-dir"));
    });
  });

  document.querySelectorAll("[data-speed]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setSpeed(btn.getAttribute("data-speed"));
    });
  });

  document.querySelectorAll("[data-skip]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setSkip(btn.getAttribute("data-skip"));
    });
  });

  btnPlay.addEventListener("click", function () {
    if (playing) stopPlayback();
    else playScale();
  });

  btnLower.addEventListener("click", function () {
    shift(-1);
  });

  btnHigher.addEventListener("click", function () {
    shift(1);
  });

  keyboardEl.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var midi = midiFromEvent(e);
    if (midi == null) return;
    e.preventDefault();
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch (err) {}
    startLive(midi, e.pointerId);
  });

  keyboardEl.addEventListener("pointerup", function (e) {
    releaseLive(e.pointerId, false);
  });

  keyboardEl.addEventListener("pointercancel", function (e) {
    releaseLive(e.pointerId, true);
  });

  keyboardEl.addEventListener("lostpointercapture", function (e) {
    releaseLive(e.pointerId, false);
  });

  keyboardEl.addEventListener("contextmenu", function (e) {
    if (e.target.closest("[data-midi]")) e.preventDefault();
  });

  buildKeyboard();
  updateRange();
  updatePlayButton();
})();
