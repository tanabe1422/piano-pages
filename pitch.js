(function () {
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var SOLFA = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];
  var BLACK_PC = { 1: true, 3: true, 6: true, 8: true, 10: true };
  var TOLERANCE = {
    tight: { ok: 18, near: 40, okHold: 24, nearHold: 48 },
    normal: { ok: 25, near: 50, okHold: 32, nearHold: 58 },
    wide: { ok: 40, near: 75, okHold: 48, nearHold: 85 }
  };
  var LEVEL_HOLD_MS = 280;
  var GUIDE_ONSET_MAX_MS = 100;
  var LEVEL_TOP = {
    "sharp-far": "12%",
    "sharp-near": "31%",
    ok: "50%",
    "flat-near": "69%",
    "flat-far": "88%"
  };
  var WINDOW = 4096;
  var DETECT_OPTS = { minHz: 55, maxHz: 1100, rmsGate: 0.0025 };
  var STABLE_MS = 55;
  var SILENCE_MS = 150;
  var RESUME_MS = 160;
  var JUMP_CENTS = 35;
  var TRAIL_MS = 8000;
  var PX_PER_MS = 0.08;
  var PLAYHEAD_X = 0.5;
  var START_MIDI = 41;
  var END_MIDI = 84;
  var TONIC_MIN = 48;
  var TONIC_MAX = 72;
  var SCALE_UP = [0, 2, 4, 5, 7];
  var MAJOR_PCS = [0, 2, 4, 5, 7, 9, 11];
  var LEAP_LOW = [1, 2, 3, 4];
  var LEAP_MID = [5, 6, 7, 8];
  var LEAP_HIGH = [9, 10, 11, 12];
  var SECTION_GAP_MS = 2000;
  var SPEEDS = { slow: 1000, normal: 600, fast: 350 };
  var CUE_NOTE_MS = 1000;
  var CUE_GAP_MS = 1000;
  var SKEW_MS = { early: 50, normal: 0, late: -50 };
  var HIC_MIDI = 72;
  var PATTERNS = [
    { id: "scale-up", label: "音階 下→上→下" },
    { id: "scale-down", label: "音階 上→下→上" },
    { id: "leap-up", label: "半音往復 低いほうから" },
    { id: "leap-down", label: "半音往復 高いほうから" },
    { id: "leap-hic-down", label: "半音往復 高いドから下", root: HIC_MIDI },
    { id: "leap-hic-up", label: "半音往復 高いドから上", root: HIC_MIDI }
  ];
  var LABEL_KEY = "piano-pitch-label";
  var MIC_KEY = "piano-pitch-mic";
  var SPEED_KEY = "piano-pitch-speed";
  var SKEW_KEY = "piano-pitch-skew";
  var TOLERANCE_KEY = "piano-pitch-tolerance";
  var PATTERN_KEY = "piano-pitch-pattern";
  var SONG_KEY = "piano-pitch-song";
  var SCRIPT_BUFFER = 4096;

  function cssVar(name, fallback) {
    var value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function cssRgba(name, alpha, fallbackRgb) {
    var rgb = cssVar(name, fallbackRgb);
    return "rgba(" + rgb + ", " + alpha + ")";
  }

  var labelMode = "letter";
  var tonic = 60;
  var speed = "normal";
  var skew = "normal";
  var patternId = "scale-up";
  var song = null;
  var songShift = 0;
  var phraseIndex = -1;
  var tolerance = "wide";
  var centsOk = TOLERANCE.wide.ok;
  var centsNear = TOLERANCE.wide.near;
  var centsOkHold = TOLERANCE.wide.okHold;
  var centsNearHold = TOLERANCE.wide.nearHold;
  var playing = false;
  var playToken = 0;
  var activePlayToken = 0;
  var guideNotes = [];
  var timers = [];
  var voices = [];
  var audioCtx = null;
  var micStream = null;
  var micProc = null;
  var micSource = null;
  var micSilent = null;
  var micOn = false;
  var sampleBuf = new Float32Array(WINDOW);
  var samplePos = 0;
  var trail = [];
  var rafId = 0;
  var lastDetect = null;
  var gaugeLevel = null;
  var pendingLevel = null;
  var pendingLevelSince = 0;
  var heldNearest = null;
  var heldMidi = null;
  var guideJudgeId = "";
  var guideHeldMidi = null;
  var guideHeard = false;
  var guideOnsetUntil = 0;
  var pendingMidi = null;
  var pendingSince = 0;
  var silenceSince = 0;
  var voiceResumeSince = 0;
  var uiPaused = false;
  var keysByMidi = {};
  var sustainMidi = null;
  var sustainVoice = null;
  var sungMidi = null;

  var nowEl = document.getElementById("pitch-now");
  var gaugeEl = document.getElementById("pitch-gauge");
  var needleEl = document.getElementById("pitch-needle");
  var liveEl = document.getElementById("pitch-live");
  var canvas = document.getElementById("pitch-scroll");
  var ctx2d = canvas.getContext("2d");
  var keyboardEl = document.getElementById("keyboard");
  var wrapEl = document.getElementById("keyboard-wrap");
  var btnMic = document.getElementById("btn-mic");
  var btnMicStart = document.getElementById("btn-mic-start");
  var micStartBackdrop = document.getElementById("mic-start-backdrop");
  var micSelect = document.getElementById("mic-select");
  var btnSettings = document.getElementById("btn-settings");
  var btnSettingsClose = document.getElementById("btn-settings-close");
  var settingsDialog = document.getElementById("settings-dialog");
  var settingsBackdrop = document.getElementById("settings-backdrop");
  var btnPlay = document.getElementById("btn-play");
  var btnPlayLabel = document.getElementById("btn-play-label");
  var btnPlayTonic = document.getElementById("btn-play-tonic");
  var btnScaleLower = document.getElementById("btn-scale-lower");
  var btnScaleHigher = document.getElementById("btn-scale-higher");
  var btnSemiLower = document.getElementById("btn-semi-lower");
  var btnSemiHigher = document.getElementById("btn-semi-higher");
  var btnOctLower = document.getElementById("btn-oct-lower");
  var btnOctHigher = document.getElementById("btn-oct-higher");
  var btnPattern = document.getElementById("btn-pattern");
  var btnSong = document.getElementById("btn-song");
  var songFile = document.getElementById("song-file");
  var phraseWrap = document.getElementById("phrase-wrap");
  var phraseSelect = document.getElementById("phrase-select");
  var patternMenu = document.getElementById("pattern-menu");
  var preferredMicId = "";

  try {
    preferredMicId = localStorage.getItem(MIC_KEY) || "";
  } catch (e) {
    preferredMicId = "";
  }

  function isBlack(midi) {
    return BLACK_PC[midi % 12] === true;
  }

  function noteLetter(midi) {
    var m = Math.round(midi);
    return NOTE_NAMES[((m % 12) + 12) % 12];
  }

  function noteReg(midi) {
    var m = Math.round(midi);
    if (m < 48) return "low";
    if (m < 60) return "mid1";
    if (m < 72) return "mid2";
    if (m < 84) return "hi";
    return "hihi";
  }

  function karaokeLetter(midi) {
    return noteReg(midi) + noteLetter(midi);
  }

  function karaokeSolfa(midi) {
    var m = Math.round(midi);
    var pc = ((m % 12) + 12) % 12;
    return noteReg(midi) + " の" + SOLFA[pc];
  }

  function formatNote(midi) {
    var letter = karaokeLetter(midi);
    var solfa = karaokeSolfa(midi);
    if (labelMode === "solfa") return solfa;
    if (labelMode === "both") return letter + "　" + solfa;
    return letter;
  }

  function stableNearest(midi) {
    var rounded = Math.round(midi);
    if (heldNearest == null) {
      heldNearest = rounded;
      return heldNearest;
    }
    var centsFromHeld = (midi - heldNearest) * 100;
    if (Math.abs(centsFromHeld) < 52) return heldNearest;
    heldNearest = rounded;
    return heldNearest;
  }

  function centsLevel(cents, prev) {
    var a = Math.abs(cents);
    var side = cents < 0 ? "flat" : "sharp";
    if (prev === "ok") {
      if (a <= centsOkHold) return "ok";
      if (a <= centsNear) return side + "-near";
      return side + "-far";
    }
    if (prev === "flat-near" || prev === "sharp-near") {
      if (a <= centsOk) return "ok";
      if (a <= centsNearHold) {
        if (cents === 0) return prev;
        return side + "-near";
      }
      return side + "-far";
    }
    if (prev === "flat-far" || prev === "sharp-far") {
      if (a <= centsOk) return "ok";
      if (a <= centsNear) return side + "-near";
      return side + "-far";
    }
    if (a <= centsOk) return "ok";
    if (a <= centsNear) return side + "-near";
    return side + "-far";
  }

  function applyTolerance(next) {
    var t = TOLERANCE[next] || TOLERANCE.wide;
    centsOk = t.ok;
    centsNear = t.near;
    centsOkHold = t.okHold;
    centsNearHold = t.nearHold;
  }

  function stabilizeLevel(rawLevel, now, holdMs, guideKey) {
    var hold = holdMs == null ? LEVEL_HOLD_MS : holdMs;
    if (gaugeLevel == null) {
      gaugeLevel = rawLevel;
      pendingLevel = null;
      pendingLevelSince = 0;
      return gaugeLevel;
    }
    if (rawLevel === gaugeLevel) {
      pendingLevel = null;
      pendingLevelSince = 0;
      return gaugeLevel;
    }
    if (pendingLevel !== rawLevel) {
      pendingLevel = rawLevel;
      pendingLevelSince = now;
      if (hold > 0) return gaugeLevel;
    }
    if (now - pendingLevelSince >= hold) {
      var from = pendingLevelSince;
      var next = pendingLevel;
      gaugeLevel = next;
      pendingLevel = null;
      pendingLevelSince = 0;
      var i;
      for (i = 0; i < trail.length; i++) {
        if (trail[i].t < from) continue;
        if (guideKey && trail[i].guideKey !== guideKey) continue;
        trail[i].level = next;
      }
    }
    return gaugeLevel;
  }

  function guideKeyOf(guide) {
    return guide.token + ":" + guide.t0 + ":" + guide.midi;
  }

  function guideOnsetMs(guide) {
    var dur = guide.t1 - guide.t0;
    var onset = GUIDE_ONSET_MAX_MS;
    if (onset > dur * 0.45) onset = dur * 0.45;
    if (onset < 30) onset = 30;
    return onset;
  }

  function guideLevelHoldMs(guide) {
    var dur = guide.t1 - guide.t0;
    if (dur <= 280) return 40;
    if (dur <= 480) return 60;
    return 90;
  }

  function closeGuideJudge() {
    if (!guideJudgeId) return;
    guideJudgeId = "";
    guideHeldMidi = null;
    guideHeard = false;
    guideOnsetUntil = 0;
    pendingLevel = null;
    pendingLevelSince = 0;
  }

  function openGuideJudge(guide) {
    var key = guideKeyOf(guide);
    if (key === guideJudgeId) return;
    closeGuideJudge();
    guideJudgeId = key;
    gaugeLevel = null;
    pendingLevel = null;
    pendingLevelSince = 0;
    heldNearest = null;
    guideOnsetUntil = guide.t0 + guideOnsetMs(guide);
  }

  function midiAgainstGuide(rawMidi) {
    if (guideHeldMidi == null) {
      guideHeldMidi = rawMidi;
      return rawMidi;
    }
    if (Math.abs(rawMidi - guideHeldMidi) * 100 > 60) {
      guideHeldMidi = rawMidi;
      return rawMidi;
    }
    guideHeldMidi = guideHeldMidi * 0.4 + rawMidi * 0.6;
    return guideHeldMidi;
  }

  function hzToMidi(hz) {
    return 69 + 12 * Math.log(hz / 440) / Math.LN2;
  }

  function ensureAudio() {
    if (navigator.audioSession) {
      navigator.audioSession.type = micOn ? "play-and-record" : "playback";
    }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function startLiveNote(midi) {
    var ctx = ensureAudio();
    var now = ctx.currentTime;
    var freq = 440 * Math.pow(2, (midi - 69) / 12);
    var master = ctx.createGain();
    var filter = ctx.createBiquadFilter();
    var partials = [
      { mul: 1, amp: 0.5, detune: 0 },
      { mul: 2, amp: 0.2, detune: -3 },
      { mul: 3, amp: 0.09, detune: 4 },
      { mul: 4, amp: 0.035, detune: -2 },
      { mul: 5, amp: 0.018, detune: 3 }
    ];
    var oscs = [];

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(3800, freq * 5.5 + 800), now);
    filter.Q.setValueAtTime(0.55, now);

    partials.forEach(function (partial) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * partial.mul, now);
      osc.detune.setValueAtTime(partial.detune, now);
      gain.gain.value = partial.amp;
      osc.connect(gain);
      gain.connect(filter);
      osc.start(now);
      oscs.push(osc);
    });

    filter.connect(master);
    master.connect(ctx.destination);
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.15, now + 0.07);
    master.gain.linearRampToValueAtTime(0.11, now + 0.55);

    return { oscs: oscs, filter: filter, master: master };
  }

  function stopLiveNote(voice) {
    if (!audioCtx || !voice) return;
    var now = audioCtx.currentTime;
    try {
      voice.master.gain.cancelScheduledValues(now);
      voice.master.gain.setValueAtTime(voice.master.gain.value, now);
      voice.master.gain.linearRampToValueAtTime(0, now + 0.2);
      voice.oscs.forEach(function (osc) {
        osc.stop(now + 0.24);
      });
    } catch (e) {}
  }

  function setSustainHighlight(midi, on) {
    var el = keysByMidi[midi];
    if (!el) return;
    el.classList.toggle("is-sustain", on);
  }

  function stopSustain() {
    if (sustainMidi != null) {
      setSustainHighlight(sustainMidi, false);
      stopLiveNote(sustainVoice);
      sustainMidi = null;
      sustainVoice = null;
    }
  }

  function toggleSustain(midi) {
    if (sustainMidi === midi) {
      stopSustain();
      return;
    }
    stopSustain();
    sustainVoice = startLiveNote(midi);
    sustainMidi = midi;
    setSustainHighlight(midi, true);
  }

  function sequenceScaleUp() {
    var up = SCALE_UP;
    var down = up.slice().reverse();
    return up.concat(down.slice(1));
  }

  function sequenceScaleDown() {
    var up = SCALE_UP;
    var down = up.slice().reverse();
    return down.concat(up.slice(1));
  }

  function pushLeapSection(events, base, targets, noteMs, longMs) {
    var i;
    for (i = 0; i < targets.length; i++) {
      events.push({ midi: base, durationMs: noteMs, guide: true });
      events.push({ midi: base + targets[i], durationMs: noteMs, guide: true });
    }
    events.push({ midi: base, durationMs: longMs, guide: true });
  }

  function patternRoot() {
    var meta = patternMeta(patternId);
    if (meta && typeof meta.root === "number") return meta.root;
    return null;
  }

  function patternBase() {
    var root = patternRoot();
    return root == null ? tonic : root;
  }

  function signedLeaps(list, sign) {
    var out = [];
    var i;
    for (i = 0; i < list.length; i++) out.push(list[i] * sign);
    return out;
  }

  function pushLeapRun(events, base, sign, noteMs, longMs) {
    pushLeapSection(events, base, signedLeaps(LEAP_LOW, sign), noteMs, longMs);
    events.push({ midi: null, durationMs: SECTION_GAP_MS, guide: false });
    pushLeapSection(events, base, signedLeaps(LEAP_MID, sign), noteMs, longMs);
    events.push({ midi: null, durationMs: SECTION_GAP_MS, guide: false });
    pushLeapSection(events, base, signedLeaps(LEAP_HIGH, sign), noteMs, longMs);
  }

  function buildPatternEvents() {
    var noteMs = SPEEDS[speed] || SPEEDS.normal;
    var longMs = noteMs * 2;
    var events = [];
    var semis;
    var i;

    if (patternId === "scale-down") {
      semis = sequenceScaleDown();
      for (i = 0; i < semis.length; i++) {
        events.push({ midi: tonic + semis[i], durationMs: noteMs, guide: true });
      }
      return events;
    }

    if (patternId === "leap-up") {
      pushLeapRun(events, tonic, 1, noteMs, longMs);
      return events;
    }

    if (patternId === "leap-down") {
      pushLeapSection(events, tonic, LEAP_HIGH.slice().reverse(), noteMs, longMs);
      events.push({ midi: null, durationMs: SECTION_GAP_MS, guide: false });
      pushLeapSection(events, tonic, LEAP_MID.slice().reverse(), noteMs, longMs);
      events.push({ midi: null, durationMs: SECTION_GAP_MS, guide: false });
      pushLeapSection(events, tonic, LEAP_LOW.slice().reverse(), noteMs, longMs);
      return events;
    }

    if (patternId === "leap-hic-down") {
      pushLeapRun(events, HIC_MIDI, -1, noteMs, longMs);
      return events;
    }

    if (patternId === "leap-hic-up") {
      pushLeapRun(events, HIC_MIDI, 1, noteMs, longMs);
      return events;
    }

    semis = sequenceScaleUp();
    for (i = 0; i < semis.length; i++) {
      events.push({ midi: tonic + semis[i], durationMs: noteMs, guide: true });
    }
    return events;
  }

  function firstPatternMidi(events) {
    var i;
    for (i = 0; i < events.length; i++) {
      if (events[i].midi != null) return events[i].midi;
    }
    return tonic;
  }

  function patternMeta(id) {
    if (id === "song" && song) return { id: "song", label: song.title };
    var i;
    for (i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i].id === id) return PATTERNS[i];
    }
    return PATTERNS[0];
  }

  function songMode() {
    return patternId === "song" && song && song.notes.length > 0;
  }

  function parseSong(data) {
    if (typeof data === "string") data = JSON.parse(data);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("オブジェクトではない");
    }
    if (!Array.isArray(data.notes) || !data.notes.length) {
      throw new Error("notes がない");
    }
    var title = typeof data.title === "string" && data.title ? data.title : "無題";
    var notes = data.notes.map(function (n, i) {
      if (!n || typeof n !== "object") throw new Error((i + 1) + "音目がオブジェクトではない");
      var midi = Number(n.midi);
      var startMs = Number(n.startMs);
      var durationMs = Number(n.durationMs);
      if (!Number.isFinite(midi) || midi < 0 || midi > 127) {
        throw new Error((i + 1) + "音目の midi が 0〜127 ではない");
      }
      if (!Number.isFinite(startMs) || startMs < 0) {
        throw new Error((i + 1) + "音目の startMs が 0 以上ではない");
      }
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        throw new Error((i + 1) + "音目の durationMs が正の数ではない");
      }
      return {
        midi: Math.round(midi),
        startMs: startMs,
        durationMs: durationMs
      };
    });
    notes.sort(function (a, b) {
      return a.startMs - b.startMs;
    });
    var phrases = parsePhrases(data.phrases);
    var songData = { title: title, notes: notes };
    if (phrases.length) songData.phrases = phrases;
    return songData;
  }

  function parsePhrases(raw) {
    if (!Array.isArray(raw)) return [];
    var list = [];
    raw.forEach(function (p) {
      if (!p || typeof p !== "object") return;
      var name = typeof p.name === "string" ? p.name.trim() : "";
      var startMs = Number(p.startMs);
      var endMs = Number(p.endMs);
      if (!name) return;
      if (!Number.isFinite(startMs) || startMs < 0) return;
      if (!Number.isFinite(endMs) || endMs <= startMs) return;
      list.push({ name: name, startMs: startMs, endMs: endMs });
    });
    list.sort(function (a, b) {
      return a.startMs - b.startMs || a.endMs - b.endMs;
    });
    var out = [];
    list.forEach(function (p) {
      if (out.length >= 99) return;
      if (out.length && p.startMs <= out[out.length - 1].startMs) return;
      out.push(p);
    });
    return out;
  }

  function selectedPhrase() {
    if (!song || !Array.isArray(song.phrases)) return null;
    if (phraseIndex < 0 || phraseIndex >= song.phrases.length) return null;
    return song.phrases[phraseIndex];
  }

  function songPlayNotes() {
    if (!song) return [];
    var phrase = selectedPhrase();
    if (!phrase) return song.notes;
    return song.notes.filter(function (n) {
      return n.startMs >= phrase.startMs && n.startMs < phrase.endMs;
    });
  }

  function songPlayBase() {
    var playNotes = songPlayNotes();
    var head = playNotes.length ? playNotes[0] : song.notes[0];
    return head.midi + songShift;
  }

  function refreshPhraseSelect() {
    var phrases = song && Array.isArray(song.phrases) ? song.phrases : [];
    var show = songMode() && phrases.length > 0;
    phraseWrap.hidden = !show;
    if (!show) return;
    if (phraseIndex >= phrases.length) phraseIndex = -1;
    var signature = phrases.map(function (p) {
      return p.name + "\t" + p.startMs + "\t" + p.endMs;
    }).join("\n");
    if (phraseSelect.dataset.signature !== signature) {
      phraseSelect.dataset.signature = signature;
      phraseSelect.innerHTML = "";
      var all = document.createElement("option");
      all.value = "all";
      all.textContent = "全部";
      phraseSelect.appendChild(all);
      phrases.forEach(function (p, i) {
        var opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = p.name;
        phraseSelect.appendChild(opt);
      });
    }
    phraseSelect.value = phraseIndex < 0 ? "all" : String(phraseIndex);
  }

  function rememberSong() {
    try {
      localStorage.setItem(SONG_KEY, JSON.stringify(song));
    } catch (e) {}
  }

  function speedRate() {
    return (SPEEDS[speed] || SPEEDS.normal) / SPEEDS.normal;
  }

  function songEvents() {
    var rate = speedRate();
    var phrase = selectedPhrase();
    var origin = phrase ? phrase.startMs : 0;
    return songPlayNotes().map(function (n) {
      return {
        midi: n.midi + songShift,
        startMs: (n.startMs - origin) * rate,
        durationMs: n.durationMs * rate,
        guide: true
      };
    }).filter(function (n) {
      return n.midi >= 0 && n.midi <= 127 && n.durationMs > 0;
    });
  }

  function songBounds(extra) {
    var notes = songPlayNotes();
    if (!notes.length) return { min: -1, max: 128 };
    var min = 127;
    var max = 0;
    notes.forEach(function (n) {
      var m = n.midi + songShift + extra;
      if (m < min) min = m;
      if (m > max) max = m;
    });
    return { min: min, max: max };
  }

  function updatePlayButton() {
    btnPlayLabel.textContent = playing ? "停止" : "再生";
    if (songMode()) {
      var phrase = selectedPhrase();
      var name = phrase ? phrase.name : song.title;
      btnPlayTonic.textContent = name + (songShift ? (songShift > 0 ? " +" : " ") + songShift : "");
    } else {
      btnPlayTonic.textContent = formatNote(patternBase());
    }
    refreshPhraseSelect();
    btnPlay.classList.toggle("is-playing", playing);
    btnPlay.setAttribute("aria-pressed", playing ? "true" : "false");
  }

  function updateTonicMark() {
    var mark = patternBase();
    if (songMode()) mark = songPlayBase();
    Object.keys(keysByMidi).forEach(function (key) {
      keysByMidi[key].classList.toggle("is-start", Number(key) === mark);
    });
  }

  function majorDegreeIndex(midi) {
    var pc = ((midi % 12) + 12) % 12;
    var i;
    var best = 0;
    var bestDist = 12;
    for (i = 0; i < MAJOR_PCS.length; i++) {
      var d = Math.abs(MAJOR_PCS[i] - pc);
      if (d > 6) d = 12 - d;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  function tonicFromDegree(oct, degIdx) {
    var idx = degIdx;
    var o = oct;
    while (idx < 0) {
      idx += 7;
      o -= 1;
    }
    while (idx >= 7) {
      idx -= 7;
      o += 1;
    }
    return o * 12 + MAJOR_PCS[idx];
  }

  function nextScaleTonic(dir) {
    var deg = majorDegreeIndex(tonic);
    var oct = Math.floor(tonic / 12);
    var pc = ((tonic % 12) + 12) % 12;
    if (MAJOR_PCS[deg] !== pc) {
      var snapped = tonicFromDegree(oct, deg);
      oct = Math.floor(snapped / 12);
      deg = majorDegreeIndex(snapped);
    }
    return tonicFromDegree(oct, deg + dir);
  }

  function updateTransposeButtons() {
    if (patternRoot() != null) {
      btnScaleLower.disabled = true;
      btnScaleHigher.disabled = true;
      btnSemiLower.disabled = true;
      btnSemiHigher.disabled = true;
      btnOctLower.disabled = true;
      btnOctHigher.disabled = true;
      return;
    }
    if (songMode()) {
      var semiDown = songBounds(-1);
      var semiUp = songBounds(1);
      var octDown = songBounds(-12);
      var octUp = songBounds(12);
      btnSemiLower.disabled = semiDown.min < 0;
      btnSemiHigher.disabled = semiUp.max > 127;
      btnOctLower.disabled = octDown.min < 0;
      btnOctHigher.disabled = octUp.max > 127;
      var base = songPlayBase();
      var saved = tonic;
      tonic = base;
      var scaleDown = base + (nextScaleTonic(-1) - base);
      var scaleUp = base + (nextScaleTonic(1) - base);
      tonic = saved;
      btnScaleLower.disabled = songBounds(scaleDown - base).min < 0;
      btnScaleHigher.disabled = songBounds(scaleUp - base).max > 127;
      return;
    }
    var scaleDown = nextScaleTonic(-1);
    var scaleUp = nextScaleTonic(1);
    btnScaleLower.disabled = scaleDown < TONIC_MIN;
    btnScaleHigher.disabled = scaleUp > TONIC_MAX;
    btnSemiLower.disabled = tonic - 1 < TONIC_MIN;
    btnSemiHigher.disabled = tonic + 1 > TONIC_MAX;
    btnOctLower.disabled = tonic - 12 < TONIC_MIN;
    btnOctHigher.disabled = tonic + 12 > TONIC_MAX;
  }

  function highlightGuide(midi) {
    var list = [];
    if (Array.isArray(midi)) list = midi;
    else if (midi != null) list = [midi];
    Object.keys(keysByMidi).forEach(function (key) {
      keysByMidi[key].classList.remove("is-on");
    });
    var last = null;
    list.forEach(function (m) {
      var el = keysByMidi[m];
      if (!el) return;
      el.classList.add("is-on");
      last = el;
    });
    if (last) ensureKeyVisible(last);
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
    highlightGuide(null);
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

  function detectLagMs() {
    var sr = audioCtx && audioCtx.sampleRate ? audioCtx.sampleRate : 48000;
    var base = ((SCRIPT_BUFFER + WINDOW * 0.5) / sr) * 1000;
    return base + (SKEW_MS[skew] || 0);
  }

  function audioOutputLagSec(ctx) {
    var lag = 0;
    if (typeof ctx.baseLatency === "number") lag += ctx.baseLatency;
    if (typeof ctx.outputLatency === "number") lag += ctx.outputLatency;
    return lag;
  }

  function wallFromAudio(ctx, audioTime) {
    return performance.now() + (audioTime - ctx.currentTime) * 1000;
  }

  function dropUnplayedGuides(now) {
    var kept = [];
    var i;
    for (i = 0; i < guideNotes.length; i++) {
      var note = guideNotes[i];
      if (note.t1 <= now) {
        kept.push(note);
      } else if (note.t0 < now) {
        kept.push({
          midi: note.midi,
          t0: note.t0,
          t1: now,
          token: note.token
        });
      }
    }
    guideNotes = kept;
  }

  function noteHoldSec(durationMs) {
    var sec = durationMs / 1000;
    var hold = sec - 0.03;
    if (hold < 0.12) hold = sec * 0.88;
    return hold;
  }

  function playScale() {
    var ctx = ensureAudio();
    stopSustain();
    var nowWall = performance.now();
    dropUnplayedGuides(nowWall);
    stopPlayback();
    var token = playToken;
    activePlayToken = token;
    playing = true;
    updatePlayButton();

    if (songMode()) {
      playTimeline(ctx, token, songEvents());
      return;
    }

    var events = buildPatternEvents();
    var cueMidi = firstPatternMidi(events);
    var delaySec = 0.04;
    var cueSec = CUE_NOTE_MS / 1000;
    var gapSec = CUE_GAP_MS / 1000;
    var hearLag = audioOutputLagSec(ctx);
    var cueAt = ctx.currentTime + delaySec;
    var cursor = cueAt + cueSec + gapSec;
    var totalMs = delaySec * 1000 + CUE_NOTE_MS + CUE_GAP_MS;

    scheduleNote(ctx, cueMidi, cueAt, noteHoldSec(CUE_NOTE_MS));
    timers.push(
      setTimeout(function () {
        if (token !== playToken) return;
        highlightGuide(cueMidi);
      }, Math.max(0, (cueAt - ctx.currentTime) * 1000))
    );
    timers.push(
      setTimeout(function () {
        if (token !== playToken) return;
        highlightGuide(null);
      }, Math.max(0, (cueAt + cueSec - ctx.currentTime) * 1000))
    );

    events.forEach(function (ev) {
      var durSec = ev.durationMs / 1000;
      if (ev.midi != null) {
        scheduleNote(ctx, ev.midi, cursor, noteHoldSec(ev.durationMs));
        if (ev.guide) {
          guideNotes.push({
            midi: ev.midi,
            t0: wallFromAudio(ctx, cursor + hearLag),
            t1: wallFromAudio(ctx, cursor + durSec + hearLag),
            token: token
          });
        }
        (function (midi, audioStart) {
          timers.push(
            setTimeout(function () {
              if (token !== playToken) return;
              highlightGuide(midi);
            }, Math.max(0, (audioStart - ctx.currentTime) * 1000))
          );
        })(ev.midi, cursor);
      } else {
        (function (audioStart) {
          timers.push(
            setTimeout(function () {
              if (token !== playToken) return;
              highlightGuide(null);
            }, Math.max(0, (audioStart - ctx.currentTime) * 1000))
          );
        })(cursor);
      }
      cursor += durSec;
      totalMs += ev.durationMs;
    });
    pruneGuideNotes(nowWall);

    timers.push(
      setTimeout(function () {
        if (token !== playToken) return;
        playing = false;
        highlightGuide(null);
        updatePlayButton();
      }, totalMs)
    );
  }

  function playTimeline(ctx, token, events) {
    var hearLag = audioOutputLagSec(ctx);
    var origin = ctx.currentTime + 0.05;
    var onCount = {};
    var endAt = origin;

    function shown() {
      return Object.keys(onCount).map(function (key) {
        return Number(key);
      });
    }

    events.forEach(function (ev) {
      var start = origin + ev.startMs / 1000;
      var durSec = ev.durationMs / 1000;
      scheduleNote(ctx, ev.midi, start, noteHoldSec(ev.durationMs));
      guideNotes.push({
        midi: ev.midi,
        t0: wallFromAudio(ctx, start + hearLag),
        t1: wallFromAudio(ctx, start + durSec + hearLag),
        token: token
      });
      if (start + durSec > endAt) endAt = start + durSec;
      (function (midi, audioStart, audioEnd) {
        timers.push(
          setTimeout(function () {
            if (token !== playToken) return;
            onCount[midi] = (onCount[midi] || 0) + 1;
            highlightGuide(shown());
          }, Math.max(0, (audioStart - ctx.currentTime) * 1000))
        );
        timers.push(
          setTimeout(function () {
            if (token !== playToken) return;
            onCount[midi] -= 1;
            if (onCount[midi] <= 0) delete onCount[midi];
            highlightGuide(shown());
          }, Math.max(0, (audioEnd - ctx.currentTime) * 1000))
        );
      })(ev.midi, start, start + durSec);
    });
    pruneGuideNotes(performance.now());

    timers.push(
      setTimeout(function () {
        if (token !== playToken) return;
        playing = false;
        highlightGuide(null);
        updatePlayButton();
      }, Math.max(0, (endAt - ctx.currentTime) * 1000 + 40))
    );
  }

  function guideAt(at, midi, token) {
    var best = null;
    var bestDist = Infinity;
    var i;
    for (i = 0; i < guideNotes.length; i++) {
      var note = guideNotes[i];
      if (token != null && note.token !== token) continue;
      if (at < note.t0 || at >= note.t1) continue;
      var dist = midi == null ? -note.midi : Math.abs(midi - note.midi);
      if (dist < bestDist) {
        best = note;
        bestDist = dist;
      }
    }
    return best;
  }

  function activeGuide(at, midi) {
    if (!playing || !guideNotes.length) return null;
    return guideAt(at, midi, activePlayToken);
  }

  function pruneGuideNotes(now) {
    var cutoff = now - TRAIL_MS - 500;
    while (guideNotes.length && guideNotes[0].t1 < cutoff) guideNotes.shift();
  }

  function setSpeed(next) {
    if (speed === next) return;
    if (!SPEEDS[next]) return;
    speed = next;
    document.querySelectorAll("[data-speed]").forEach(function (btn) {
      var on = btn.getAttribute("data-speed") === next;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    try {
      localStorage.setItem(SPEED_KEY, next);
    } catch (e) {}
    if (playing) playScale();
  }

  function setSkew(next) {
    if (skew === next) return;
    if (!SKEW_MS.hasOwnProperty(next)) return;
    skew = next;
    document.querySelectorAll("[data-skew]").forEach(function (btn) {
      var on = btn.getAttribute("data-skew") === next;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    try {
      localStorage.setItem(SKEW_KEY, next);
    } catch (e) {}
  }

  function setTolerance(next) {
    if (tolerance === next) return;
    if (!TOLERANCE[next]) return;
    tolerance = next;
    applyTolerance(next);
    document.querySelectorAll("[data-tolerance]").forEach(function (btn) {
      var on = btn.getAttribute("data-tolerance") === next;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    try {
      localStorage.setItem(TOLERANCE_KEY, next);
    } catch (e) {}
  }

  function patternLabel(id) {
    if (id === "song" && song) return song.title;
    var i;
    for (i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i].id === id) return PATTERNS[i].label;
    }
    return PATTERNS[0].label;
  }

  function refreshPatternMenu() {
    patternMenu.innerHTML = "";
    var items = PATTERNS.slice();
    if (song && song.notes.length) items.unshift({ id: "song", label: song.title });
    items.forEach(function (item) {
      var li = document.createElement("li");
      li.setAttribute("role", "none");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pitch-pattern-option" + (item.id === patternId ? " is-on" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", item.id === patternId ? "true" : "false");
      btn.dataset.pattern = item.id;
      btn.textContent = item.label;
      btn.addEventListener("click", function () {
        setPattern(item.id);
        closePatternMenu();
      });
      li.appendChild(btn);
      patternMenu.appendChild(li);
    });
  }

  function openPatternMenu() {
    refreshPatternMenu();
    patternMenu.hidden = false;
    btnPattern.setAttribute("aria-expanded", "true");
  }

  function closePatternMenu() {
    patternMenu.hidden = true;
    btnPattern.setAttribute("aria-expanded", "false");
  }

  function togglePatternMenu() {
    if (patternMenu.hidden) openPatternMenu();
    else closePatternMenu();
  }

  function setPattern(next) {
    if (next === "song" && !songMode() && !(song && song.notes.length)) return;
    var meta = patternMeta(next);
    if (!meta || meta.id !== next) return;
    if (patternId === next) return;
    patternId = next;
    updateTransposeButtons();
    updateTonicMark();
    updatePlayButton();
    try {
      localStorage.setItem(PATTERN_KEY, next);
    } catch (e) {}
    btnPattern.title = patternLabel(next);
    if (playing) playScale();
  }

  function shiftSongBy(delta) {
    if (!delta || !songMode()) return;
    var bounds = songBounds(delta);
    if (bounds.min < 0 || bounds.max > 127) return;
    songShift += delta;
    updateTransposeButtons();
    updateTonicMark();
    updatePlayButton();
    if (playing) playScale();
  }

  function shiftTonicTo(next) {
    if (songMode() || patternRoot() != null) return;
    if (next < TONIC_MIN || next > TONIC_MAX) return;
    if (next === tonic) return;
    tonic = next;
    updateTransposeButtons();
    updateTonicMark();
    updatePlayButton();
    playScale();
  }

  function shiftScale(dir) {
    if (songMode()) {
      var base = songPlayBase();
      var saved = tonic;
      tonic = base;
      var next = nextScaleTonic(dir);
      tonic = saved;
      shiftSongBy(next - base);
      return;
    }
    shiftTonicTo(nextScaleTonic(dir));
  }

  function shiftSemitone(dir) {
    if (songMode()) {
      shiftSongBy(dir);
      return;
    }
    shiftTonicTo(tonic + dir);
  }

  function shiftOctave(dir) {
    if (songMode()) {
      shiftSongBy(dir * 12);
      return;
    }
    shiftTonicTo(tonic + dir * 12);
  }

  var SUNG_CLASSES = [
    "is-sung-ok",
    "is-sung-flat-near",
    "is-sung-sharp-near",
    "is-sung-flat-far",
    "is-sung-sharp-far"
  ];

  function clearSungHighlight() {
    Object.keys(keysByMidi).forEach(function (key) {
      SUNG_CLASSES.forEach(function (cls) {
        keysByMidi[key].classList.remove(cls);
      });
    });
    sungMidi = null;
  }

  function sungClassForLevel(level) {
    if (level === "ok") return "is-sung-ok";
    if (level === "flat-near") return "is-sung-flat-near";
    if (level === "sharp-near") return "is-sung-sharp-near";
    if (level === "flat-far") return "is-sung-flat-far";
    if (level === "sharp-far") return "is-sung-sharp-far";
    return "is-sung-flat-far";
  }

  function updateSungHighlight(midi, level) {
    if (midi == null) {
      clearSungHighlight();
      return;
    }
    var cls = sungClassForLevel(level);

    if (sungMidi === midi) {
      var el = keysByMidi[midi];
      if (!el) return;
      SUNG_CLASSES.forEach(function (name) {
        el.classList.remove(name);
      });
      el.classList.add(cls);
      return;
    }

    clearSungHighlight();
    var next = keysByMidi[midi];
    if (!next) return;
    next.classList.add(cls);
    sungMidi = midi;
    ensureKeyVisible(next);
  }

  function ensureKeyVisible(el) {
    var wrap = wrapEl.getBoundingClientRect();
    var key = el.getBoundingClientRect();
    if (key.left >= wrap.left + 12 && key.right <= wrap.right - 12) return;
    wrapEl.scrollLeft += key.left - wrap.left - wrap.width / 2 + key.width / 2;
  }

  function buildKeyboard() {
    var whites = [];
    var midi;
    for (midi = START_MIDI; midi <= END_MIDI; midi++) {
      if (!isBlack(midi)) whites.push(midi);
    }

    whites.forEach(function (m) {
      var key = document.createElement("div");
      key.className = "white-key";
      key.dataset.midi = String(m);
      if (m % 12 === 0) {
        var label = document.createElement("span");
        label.className = "key-name";
        label.textContent = karaokeLetter(m);
        key.appendChild(label);
      }
      keyboardEl.appendChild(key);
      keysByMidi[m] = key;
    });

    whites.forEach(function (m, index) {
      var next = m + 1;
      if (next > END_MIDI || !isBlack(next)) return;
      var black = document.createElement("div");
      black.className = "black-key";
      black.dataset.midi = String(next);
      black.style.left = ((index + 1) / whites.length) * 100 + "%";
      keyboardEl.appendChild(black);
      keysByMidi[next] = black;
    });
  }

  function clearPitchHold() {
    lastDetect = null;
    gaugeLevel = null;
    pendingLevel = null;
    pendingLevelSince = 0;
    heldNearest = null;
    heldMidi = null;
    guideHeldMidi = null;
    guideHeard = false;
    pendingMidi = null;
    pendingSince = 0;
    silenceSince = 0;
    voiceResumeSince = 0;
    uiPaused = false;
    clearSungHighlight();
  }

  function showSilentUi() {
    uiPaused = true;
    nowEl.textContent = "—";
    gaugeEl.classList.remove(
      "is-ok",
      "is-flat-near",
      "is-sharp-near",
      "is-flat-far",
      "is-sharp-far",
      "is-silent",
      "is-wait"
    );
    gaugeEl.classList.add("is-silent");
    needleEl.style.top = "50%";
    liveEl.hidden = true;
    clearSungHighlight();
  }

  function stabilizeMidi(rawMidi, now) {
    if (heldMidi == null) {
      heldMidi = rawMidi;
      pendingMidi = null;
      pendingSince = 0;
      return heldMidi;
    }
    var jump = Math.abs(rawMidi - heldMidi) * 100;
    if (jump <= JUMP_CENTS) {
      heldMidi = heldMidi * 0.4 + rawMidi * 0.6;
      pendingMidi = null;
      pendingSince = 0;
      return heldMidi;
    }
    if (pendingMidi == null || Math.abs(rawMidi - pendingMidi) * 100 > JUMP_CENTS) {
      pendingMidi = rawMidi;
      pendingSince = now;
      return heldMidi;
    }
    pendingMidi = pendingMidi * 0.35 + rawMidi * 0.65;
    var pendingReady = now - pendingSince >= STABLE_MS;
    var noteChanged =
      Math.round(pendingMidi) !== Math.round(heldMidi) &&
      now - pendingSince >= STABLE_MS * 0.7;
    if (pendingReady || noteChanged) {
      heldMidi = pendingMidi;
      pendingMidi = null;
      pendingSince = 0;
      heldNearest = null;
    }
    return heldMidi;
  }

  function pushDetect(hz, prob) {
    var now = performance.now();
    if (!hz || hz <= 0) {
      voiceResumeSince = 0;
      if (heldMidi == null) {
        pruneTrail(now);
        return;
      }
      if (!silenceSince) {
        silenceSince = now;
        pendingLevel = null;
        pendingLevelSince = 0;
        showSilentUi();
      }
      if (now - silenceSince < SILENCE_MS) {
        pruneTrail(now);
        return;
      }
      clearPitchHold();
      refreshNowDisplay();
      pruneTrail(now);
      return;
    }
    if (silenceSince) {
      if (!voiceResumeSince) voiceResumeSince = now;
      if (now - voiceResumeSince < RESUME_MS) {
        pruneTrail(now);
        return;
      }
      silenceSince = 0;
      voiceResumeSince = 0;
      uiPaused = false;
    }
    var detectAt = now - detectLagMs();
    var rawMidi = hzToMidi(hz);
    stabilizeMidi(rawMidi, now);
    var guide = activeGuide(detectAt, rawMidi);
    var midi;
    var provisional = false;
    var level;
    if (guide) {
      openGuideJudge(guide);
      midi = midiAgainstGuide(rawMidi);
    } else {
      closeGuideJudge();
      midi = heldMidi;
    }
    var nearest = stableNearest(midi);
    var target = guide ? guide.midi : nearest;
    var cents = (midi - target) * 100;
    if (guide) {
      var inOnset = detectAt < guideOnsetUntil;
      var rawLevel = centsLevel(cents, guideHeard ? gaugeLevel : null);
      var far = rawLevel === "flat-far" || rawLevel === "sharp-far";
      if (inOnset && far && !guideHeard) {
        provisional = true;
        level = null;
      } else {
        if (!far || !inOnset) guideHeard = true;
        var holdMs = gaugeLevel == null || rawLevel === "ok" ? 0 : guideLevelHoldMs(guide);
        level = stabilizeLevel(rawLevel, now, holdMs, guideJudgeId);
      }
    } else {
      level = stabilizeLevel(centsLevel(cents, gaugeLevel), now, LEVEL_HOLD_MS, "");
    }

    lastDetect = {
      midi: midi,
      nearest: nearest,
      target: target,
      guide: guide ? guide.midi : null,
      cents: cents,
      level: level,
      prob: prob,
      t: detectAt
    };
    trail.push({
      t: detectAt,
      midi: midi,
      nearest: nearest,
      target: target,
      guideMidi: guide ? guide.midi : null,
      guideKey: guide ? guideJudgeId : "",
      cents: cents,
      level: level || "flat-far",
      provisional: provisional
    });
    pruneTrail(now);
    pruneGuideNotes(now);
    refreshNowDisplay();
  }

  function pruneTrail(now) {
    var cutoff = now - TRAIL_MS - 500;
    while (trail.length && trail[0].t < cutoff) trail.shift();
  }

  function refreshNowDisplay() {
    if (uiPaused) {
      showSilentUi();
      return;
    }
    gaugeEl.classList.remove(
      "is-ok",
      "is-flat-near",
      "is-sharp-near",
      "is-flat-far",
      "is-sharp-far",
      "is-silent",
      "is-wait"
    );
    if (!lastDetect) {
      nowEl.textContent = "—";
      gaugeEl.classList.add("is-silent");
      needleEl.style.top = "50%";
      liveEl.hidden = true;
      clearSungHighlight();
      return;
    }
    nowEl.textContent = formatNote(lastDetect.nearest);
    if (!lastDetect.level) {
      gaugeEl.classList.add("is-wait");
      needleEl.style.top = "50%";
      var waitCents = Math.max(-50, Math.min(50, lastDetect.cents));
      liveEl.hidden = false;
      liveEl.style.top = 50 - (waitCents / 50) * 50 + "%";
      clearSungHighlight();
      return;
    }
    var level = lastDetect.level || gaugeLevel || "ok";
    gaugeEl.classList.add("is-" + level);
    needleEl.style.top = LEVEL_TOP[level] || "50%";
    var liveCents = Math.max(-50, Math.min(50, lastDetect.cents));
    liveEl.hidden = false;
    liveEl.style.top = 50 - (liveCents / 50) * 50 + "%";
    updateSungHighlight(lastDetect.nearest, level);
  }

  function midiToY(midi, height) {
    var span = END_MIDI - START_MIDI;
    var t = (midi - START_MIDI) / span;
    return height - 16 - t * (height - 32);
  }

  function timeToX(item, now, width) {
    return width * PLAYHEAD_X + (item.t - now) * PX_PER_MS;
  }

  function colorForLevel(level, alpha) {
    var a = alpha == null ? 1 : alpha;
    if (level === "ok") return cssRgba("--ok-rgb", a, "45, 122, 79");
    if (level === "flat-near") return cssRgba("--near-flat-rgb", a, "184, 122, 24");
    if (level === "sharp-near") return cssRgba("--near-sharp-rgb", a, "47, 95, 138");
    if (level === "flat-far") return cssRgba("--far-flat-rgb", a, "110, 115, 128");
    if (level === "sharp-far") return cssRgba("--far-sharp-rgb", a, "110, 115, 128");
    return cssRgba("--ok-rgb", a, "45, 122, 79");
  }

  function trailLevel(p) {
    return p.level || "ok";
  }

  function levelYOffset(level) {
    if (level === "flat-near") return 8;
    if (level === "sharp-near") return -8;
    if (level === "flat-far") return 16;
    if (level === "sharp-far") return -16;
    return 0;
  }

  function trailAppearance(p) {
    var guide = guideAt(p.t, p.midi);
    if (guide) {
      var cents = (p.midi - guide.midi) * 100;
      var level = centsLevel(cents, null);
      var far = level === "flat-far" || level === "sharp-far";
      if (p.provisional && far) return null;
      return { level: level, vsGuide: true, mark: guide.t0 + ":" + guide.midi };
    }
    if (p.provisional) return null;
    return { level: trailLevel(p), vsGuide: false, mark: "" };
  }

  function buildVoiceSegments() {
    var segs = [];
    var cur = null;
    var i;
    for (i = 0; i < trail.length; i++) {
      var p = trail[i];
      var look = trailAppearance(p);
      if (!look) {
        if (cur) segs.push(cur);
        cur = null;
        continue;
      }
      var level = look.level;
      var vsGuide = look.vsGuide;
      var key = look.mark + ":" + p.nearest + ":" + level + ":" + (vsGuide ? "g" : "n");
      if (!cur || cur.key !== key || p.t - cur.lastT > 160) {
        if (cur) segs.push(cur);
        cur = {
          key: key,
          nearest: p.nearest,
          midiSum: p.midi,
          midiCount: 1,
          level: level,
          vsGuide: vsGuide,
          cents: p.cents,
          i0: i,
          i1: i,
          lastT: p.t
        };
      } else {
        cur.i1 = i;
        cur.lastT = p.t;
        cur.midiSum += p.midi;
        cur.midiCount += 1;
        cur.cents = (cur.cents + p.cents) / 2;
      }
    }
    if (cur) segs.push(cur);
    return segs;
  }

  function drawRoundBar(x0, x1, y, barH, fill, stroke) {
    var left = Math.min(x0, x1);
    var right = Math.max(x0, x1);
    var width = Math.max(barH, right - left);
    var radius = barH / 2;
    var top = y - radius;
    ctx2d.beginPath();
    if (typeof ctx2d.roundRect === "function") {
      ctx2d.roundRect(left, top, width, barH, radius);
    } else {
      ctx2d.moveTo(left + radius, top);
      ctx2d.arcTo(left + width, top, left + width, top + barH, radius);
      ctx2d.arcTo(left + width, top + barH, left, top + barH, radius);
      ctx2d.arcTo(left, top + barH, left, top, radius);
      ctx2d.arcTo(left, top, left + width, top, radius);
      ctx2d.closePath();
    }
    if (fill) {
      ctx2d.fillStyle = fill;
      ctx2d.fill();
    }
    if (stroke) {
      ctx2d.strokeStyle = stroke;
      ctx2d.lineWidth = 2;
      ctx2d.stroke();
    }
  }

  function resizeCanvas() {
    var wrap = canvas.parentElement;
    var w = Math.max(320, Math.floor(wrap.clientWidth));
    var h = Math.max(180, Math.floor(Math.min(260, window.innerHeight * 0.3)));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function drawFrame() {
    resizeCanvas();
    var w = canvas.width;
    var h = canvas.height;
    var now = performance.now();
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.fillStyle = cssVar("--canvas-bg", "#1e2229");
    ctx2d.fillRect(0, 0, w, h);

    var midi;
    for (midi = START_MIDI; midi <= END_MIDI; midi++) {
      var y = midiToY(midi, h);
      var isC = midi % 12 === 0;
      ctx2d.strokeStyle = isC
        ? cssVar("--canvas-grid-strong", "rgba(240, 242, 245, 0.22)")
        : cssVar("--canvas-grid-weak", "rgba(240, 242, 245, 0.08)");
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(0, y);
      ctx2d.lineTo(w, y);
      ctx2d.stroke();
      if (isC) {
        ctx2d.fillStyle = cssVar("--canvas-label", "rgba(240, 242, 245, 0.45)");
        ctx2d.font = "11px sans-serif";
        ctx2d.fillText(karaokeLetter(midi), 6, y - 3);
      }
    }

    var playhead = w * PLAYHEAD_X;
    ctx2d.strokeStyle = cssVar("--canvas-playhead", "rgba(142, 180, 216, 0.9)");
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.moveTo(playhead, 0);
    ctx2d.lineTo(playhead, h);
    ctx2d.stroke();

    pruneGuideNotes(now);
    guideNotes.forEach(function (note) {
      var x0 = timeToX({ t: note.t0 }, now, w);
      var x1 = timeToX({ t: note.t1 }, now, w);
      if (Math.max(x0, x1) < -20 || Math.min(x0, x1) > w + 20) return;
      drawRoundBar(
        x0,
        x1,
        midiToY(note.midi, h),
        14,
        null,
        cssVar("--canvas-guide", "rgba(240, 242, 245, 0.9)")
      );
    });

    buildVoiceSegments().forEach(function (seg) {
      var a = trail[seg.i0];
      var b = trail[seg.i1];
      var x0 = timeToX(a, now, w);
      var x1 = timeToX(b, now, w);
      if (Math.max(x0, x1) < -20 || Math.min(x0, x1) > w + 20) return;
      var yBar;
      if (seg.vsGuide) {
        yBar = midiToY(seg.midiSum / seg.midiCount, h);
      } else {
        yBar = midiToY(seg.nearest, h) + levelYOffset(seg.level);
      }
      var barH = seg.level === "ok" ? 12 : seg.level.indexOf("near") >= 0 ? 10 : 8;
      if (seg.level === "ok") {
        drawRoundBar(x0, x1, yBar, barH, colorForLevel(seg.level, 0.9), null);
      } else {
        drawRoundBar(x0, x1, yBar, barH, null, colorForLevel(seg.level, 0.92));
      }
    });

    ctx2d.beginPath();
    ctx2d.strokeStyle = cssVar("--canvas-trail", "rgba(240, 242, 245, 0.7)");
    ctx2d.lineWidth = 1.5;
    ctx2d.lineJoin = "round";
    ctx2d.lineCap = "round";
    var started = false;
    var i;
    for (i = 0; i < trail.length; i++) {
      var p = trail[i];
      var x = timeToX(p, now, w);
      var yLive = midiToY(p.midi, h);
      if (x < -20 || x > w + 20) {
        started = false;
        continue;
      }
      if (i > 0 && p.t - trail[i - 1].t > 160) started = false;
      if (!started) {
        ctx2d.moveTo(x, yLive);
        started = true;
      } else {
        ctx2d.lineTo(x, yLive);
      }
    }
    if (started) ctx2d.stroke();

    rafId = requestAnimationFrame(drawFrame);
  }

  function onMicAudio(e) {
    var input = e.inputBuffer.getChannelData(0);
    var i;
    for (i = 0; i < input.length; i++) {
      sampleBuf[samplePos++] = input[i];
      if (samplePos >= WINDOW) {
        var frame = PianoPitch.pitch(sampleBuf, audioCtx.sampleRate, DETECT_OPTS);
        pushDetect(frame.hz, frame.prob);
        var keep = Math.floor(WINDOW / 2);
        sampleBuf.copyWithin(0, WINDOW - keep);
        samplePos = keep;
      }
    }
  }

  function selectedMicId() {
    return micSelect && micSelect.value ? micSelect.value : preferredMicId;
  }

  function refreshMicList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      micSelect.innerHTML = "";
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "取得できない";
      micSelect.appendChild(opt);
      return Promise.resolve();
    }
    return navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var inputs = devices.filter(function (d) {
        return d.kind === "audioinput";
      });
      var current = selectedMicId();
      micSelect.innerHTML = "";
      if (!inputs.length) {
        var empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "見つからない";
        micSelect.appendChild(empty);
        return;
      }
      inputs.forEach(function (d, i) {
        var option = document.createElement("option");
        option.value = d.deviceId;
        option.textContent = d.label || "マイク " + (i + 1);
        micSelect.appendChild(option);
      });
      var ids = inputs.map(function (d) {
        return d.deviceId;
      });
      if (current && ids.indexOf(current) >= 0) micSelect.value = current;
      else {
        micSelect.value = inputs[0].deviceId;
        preferredMicId = micSelect.value;
      }
    });
  }

  function saveMicChoice() {
    preferredMicId = micSelect.value || "";
    try {
      if (preferredMicId) localStorage.setItem(MIC_KEY, preferredMicId);
    } catch (e) {}
  }

  function setMicStartVisible(on) {
    micStartBackdrop.hidden = !on;
  }

  function teardownMic() {
    if (micProc) {
      try {
        micProc.onaudioprocess = null;
        micProc.disconnect();
      } catch (e) {}
      micProc = null;
    }
    if (micSource) {
      try {
        micSource.disconnect();
      } catch (e) {}
      micSource = null;
    }
    if (micSilent) {
      try {
        micSilent.disconnect();
      } catch (e) {}
      micSilent = null;
    }
    if (micStream) {
      micStream.getTracks().forEach(function (t) {
        t.stop();
      });
      micStream = null;
    }
  }

  function stopMic() {
    micOn = false;
    btnMic.textContent = "マイクを開始";
    btnMic.classList.remove("is-recording");
    teardownMic();
    clearPitchHold();
    refreshNowDisplay();
    setMicStartVisible(true);
  }

  function micConstraints() {
    var audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      channelCount: 1
    };
    var id = selectedMicId();
    if (id) audio.deviceId = { exact: id };
    return { audio: audio };
  }

  function startMic() {
    if (!window.PianoPitch) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    ensureAudio();
    saveMicChoice();
    var constraints = micConstraints();
    navigator.mediaDevices
      .getUserMedia(constraints)
      .catch(function (err) {
        if (constraints.audio.deviceId) {
          delete constraints.audio.deviceId;
          return navigator.mediaDevices.getUserMedia(constraints);
        }
        throw err;
      })
      .then(function (stream) {
        teardownMic();
        micStream = stream;
        micOn = true;
        samplePos = 0;
        trail = [];
        btnMic.textContent = "マイクを止める";
        btnMic.classList.add("is-recording");
        setMicStartVisible(false);

        micSource = audioCtx.createMediaStreamSource(stream);
        micProc = audioCtx.createScriptProcessor(4096, 1, 1);
        micSilent = audioCtx.createGain();
        micSilent.gain.value = 0;
        micProc.onaudioprocess = onMicAudio;
        micSource.connect(micProc);
        micProc.connect(micSilent);
        micSilent.connect(audioCtx.destination);
        refreshNowDisplay();
        return refreshMicList();
      })
      .catch(function () {
        setMicStartVisible(true);
      });
  }

  function toggleMic() {
    if (micOn) stopMic();
    else startMic();
  }

  function setLabelMode(next) {
    labelMode = next;
    document.querySelectorAll("[data-label]").forEach(function (btn) {
      var on = btn.getAttribute("data-label") === next;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    try {
      localStorage.setItem(LABEL_KEY, next);
    } catch (e) {}
    refreshNowDisplay();
    updatePlayButton();
  }

  function openSettings() {
    settingsDialog.hidden = false;
    settingsBackdrop.hidden = false;
    btnSettings.setAttribute("aria-expanded", "true");
  }

  function closeSettings() {
    settingsDialog.hidden = true;
    settingsBackdrop.hidden = true;
    btnSettings.setAttribute("aria-expanded", "false");
  }

  document.querySelectorAll("[data-label]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setLabelMode(btn.getAttribute("data-label"));
    });
  });

  document.querySelectorAll("[data-speed]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setSpeed(btn.getAttribute("data-speed"));
    });
  });

  document.querySelectorAll("[data-skew]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setSkew(btn.getAttribute("data-skew"));
    });
  });

  document.querySelectorAll("[data-tolerance]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setTolerance(btn.getAttribute("data-tolerance"));
    });
  });

  btnPlay.addEventListener("click", function () {
    if (playing) stopPlayback();
    else playScale();
  });
  phraseSelect.addEventListener("change", function () {
    var next = phraseSelect.value === "all" ? -1 : Number(phraseSelect.value);
    if (!Number.isInteger(next) || next < 0) next = -1;
    if (next === phraseIndex) return;
    phraseIndex = next;
    if (playing) stopPlayback();
    updateTransposeButtons();
    updateTonicMark();
    updatePlayButton();
  });
  btnSong.addEventListener("click", function () {
    songFile.value = "";
    songFile.click();
    ensureAudio();
  });
  songFile.addEventListener("change", function () {
    var file = songFile.files && songFile.files[0];
    songFile.value = "";
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        song = parseSong(String(reader.result));
        songShift = 0;
        phraseIndex = -1;
        patternId = "song";
        rememberSong();
        try {
          localStorage.setItem(PATTERN_KEY, "song");
        } catch (e) {}
        btnPattern.title = song.title;
        updateTransposeButtons();
        updateTonicMark();
        updatePlayButton();
        refreshPatternMenu();
        playScale();
      } catch (e) {
        btnPlayTonic.textContent = "読めない";
      }
    };
    reader.readAsText(file);
  });
  btnScaleLower.addEventListener("click", function () {
    shiftScale(-1);
  });
  btnScaleHigher.addEventListener("click", function () {
    shiftScale(1);
  });
  btnSemiLower.addEventListener("click", function () {
    shiftSemitone(-1);
  });
  btnSemiHigher.addEventListener("click", function () {
    shiftSemitone(1);
  });
  btnOctLower.addEventListener("click", function () {
    shiftOctave(-1);
  });
  btnOctHigher.addEventListener("click", function () {
    shiftOctave(1);
  });

  btnPattern.addEventListener("click", function (e) {
    e.stopPropagation();
    togglePatternMenu();
  });
  document.addEventListener("click", function (e) {
    if (patternMenu.hidden) return;
    if (e.target.closest(".pitch-pattern-wrap")) return;
    closePatternMenu();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closePatternMenu();
  });

  btnMic.addEventListener("click", toggleMic);
  btnMicStart.addEventListener("click", function () {
    startMic();
  });
  micSelect.addEventListener("change", function () {
    saveMicChoice();
    if (micOn) startMic();
  });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", function () {
      refreshMicList();
    });
  }

  btnSettings.addEventListener("click", function () {
    if (settingsDialog.hidden) openSettings();
    else closeSettings();
  });
  btnSettingsClose.addEventListener("click", closeSettings);
  settingsBackdrop.addEventListener("click", closeSettings);

  keyboardEl.addEventListener("pointerdown", function (e) {
    var el = e.target.closest("[data-midi]");
    if (!el || !keyboardEl.contains(el)) return;
    e.preventDefault();
    e.stopPropagation();
    toggleSustain(Number(el.dataset.midi));
  });

  document.addEventListener("pointerdown", function (e) {
    if (sustainMidi == null) return;
    if (e.target.closest("#keyboard")) return;
    stopSustain();
  });

  try {
    var savedLabel = localStorage.getItem(LABEL_KEY);
    if (savedLabel === "letter" || savedLabel === "solfa" || savedLabel === "both") {
      setLabelMode(savedLabel);
    }
  } catch (e) {}

  try {
    var savedSpeed = localStorage.getItem(SPEED_KEY);
    if (savedSpeed === "slow" || savedSpeed === "normal" || savedSpeed === "fast") {
      setSpeed(savedSpeed);
    }
  } catch (e) {}

  try {
    var savedSkew = localStorage.getItem(SKEW_KEY);
    if (savedSkew === "early" || savedSkew === "normal" || savedSkew === "late") {
      setSkew(savedSkew);
    }
  } catch (e) {}

  try {
    var savedTolerance = localStorage.getItem(TOLERANCE_KEY);
    if (savedTolerance === "tight" || savedTolerance === "normal" || savedTolerance === "wide") {
      setTolerance(savedTolerance);
    }
  } catch (e) {}

  try {
    var savedSong = localStorage.getItem(SONG_KEY);
    if (savedSong) song = parseSong(savedSong);
  } catch (e) {
    song = null;
  }

  try {
    var savedPattern = localStorage.getItem(PATTERN_KEY);
    if (patternMeta(savedPattern).id === savedPattern) {
      patternId = savedPattern;
    }
  } catch (e) {}
  btnPattern.title = patternLabel(patternId);
  refreshPatternMenu();
  closePatternMenu();

  buildKeyboard();
  updateTonicMark();
  updateTransposeButtons();
  updatePlayButton();
  refreshNowDisplay();
  refreshMicList();
  drawFrame();
  window.addEventListener("beforeunload", function () {
    stopMic();
    stopSustain();
    stopPlayback();
    if (rafId) cancelAnimationFrame(rafId);
  });
})();
