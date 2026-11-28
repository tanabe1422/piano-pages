(function () {
  var START_MIDI = 48;
  var END_MIDI = 84;
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var SOLFA = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];
  var SPEED_RATE = { slow: 1.5, normal: 1, fast: 0.65 };
  var BLACK_PC = { 1: true, 3: true, 6: true, 8: true, 10: true };
  var TAP_MS = 600;
  var DETECT_RATE = 16000;
  var WINDOW = 1024;
  var HOP = 256;
  var STORAGE_KEY = "piano-melody";

  var melody = { title: "無題", notes: [] };
  var transpose = 0;
  var speed = "normal";
  var playing = false;
  var playToken = 0;
  var timers = [];
  var voices = [];
  var liveByPointer = {};
  var liveByMidi = {};
  var audioCtx = null;
  var keysByMidi = {};
  var recording = false;
  var recChunks = [];
  var recProc = null;
  var recSource = null;
  var recSilent = null;
  var recStream = null;
  var recSampleRate = 44100;
  var analyzing = false;

  var keyboardEl = document.getElementById("keyboard");
  var wrapEl = document.getElementById("keyboard-wrap");
  var rangeEl = document.getElementById("range-label");
  var statusEl = document.getElementById("status");
  var jsonArea = document.getElementById("json-area");
  var btnPlay = document.getElementById("btn-play");
  var btnLower = document.getElementById("btn-lower");
  var btnHigher = document.getElementById("btn-higher");
  var btnRecord = document.getElementById("btn-record");
  var btnRecordStop = document.getElementById("btn-record-stop");
  var btnApplyJson = document.getElementById("btn-apply-json");
  var btnSaveJson = document.getElementById("btn-save-json");
  var fileInput = document.getElementById("file-input");
  var jsonInput = document.getElementById("json-input");
  var tabBlock = document.getElementById("tab-block");
  var tabHint = document.getElementById("tab-hint");

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

  function setStatus(text) {
    statusEl.textContent = text || "";
  }

  function parseMelody(data) {
    if (typeof data === "string") data = JSON.parse(data);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("オブジェクトではない");
    }
    if (!Array.isArray(data.notes)) throw new Error("notes がない");
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
    var melodyData = { title: title, notes: notes };
    var phrases = parsePhrases(data.phrases);
    if (phrases.length) melodyData.phrases = phrases;
    return melodyData;
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
      list.push({
        name: name,
        startMs: Math.round(startMs * 10) / 10,
        endMs: Math.round(endMs * 10) / 10
      });
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

  function melodyJson(data) {
    var body = {
      title: data.title,
      notes: data.notes.map(function (n) {
        return {
          midi: n.midi,
          startMs: Math.round(n.startMs * 10) / 10,
          durationMs: Math.round(n.durationMs * 10) / 10
        };
      })
    };
    if (data.phrases && data.phrases.length) {
      body.phrases = data.phrases.map(function (p) {
        return {
          name: p.name,
          startMs: Math.round(p.startMs * 10) / 10,
          endMs: Math.round(p.endMs * 10) / 10
        };
      });
    }
    return JSON.stringify(body, null, 2);
  }

  function setMelody(next, opts) {
    opts = opts || {};
    melody = next;
    transpose = 0;
    if (!opts.keepEditor) jsonArea.value = melodyJson(melody);
    if (!opts.skipStore) {
      try {
        localStorage.setItem(STORAGE_KEY, melodyJson(melody));
      } catch (e) {}
    }
    updateRange();
  }

  function soundingNotes() {
    return melody.notes.map(function (n) {
      return {
        midi: n.midi + transpose,
        startMs: n.startMs,
        durationMs: n.durationMs
      };
    });
  }

  function midiBounds() {
    if (!melody.notes.length) return null;
    var min = 127;
    var max = 0;
    melody.notes.forEach(function (n) {
      var m = n.midi + transpose;
      if (m < min) min = m;
      if (m > max) max = m;
    });
    return { min: min, max: max };
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
    var seen = {};
    soundingNotes().forEach(function (n) {
      var el = keysByMidi[n.midi];
      if (!el || seen[n.midi]) return;
      seen[n.midi] = true;
      el.classList.add("is-planned");
    });
    if (melody.notes.length) {
      var first = keysByMidi[melody.notes[0].midi + transpose];
      if (first) {
        first.classList.remove("is-planned");
        first.classList.add("is-start");
      }
    }
  }

  function updateRange() {
    var bounds = midiBounds();
    if (!melody.notes.length || !bounds) {
      rangeEl.innerHTML = "メロディなし";
    } else {
      rangeEl.innerHTML =
        melody.title +
        '<span class="karaoke">' +
        melody.notes.length +
        "音　" +
        midiName(bounds.min) +
        " 〜 " +
        midiName(bounds.max) +
        "　" +
        karaoke(bounds.min) +
        " 〜 " +
        karaoke(bounds.max) +
        "</span>";
    }
    btnLower.disabled = !melody.notes.length || (bounds && bounds.min <= 21);
    btnHigher.disabled = !melody.notes.length || (bounds && bounds.max >= 108);
    btnPlay.disabled = !melody.notes.length;
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
    if (duration < 0.04) duration = 0.04;
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

    var attack = Math.min(0.018, duration * 0.2);
    var release = Math.min(0.045, duration * 0.3);
    var peak = 0.2;
    var holdEnd = start + duration - release;
    if (holdEnd < start + attack) holdEnd = start + attack;
    master.gain.setValueAtTime(0, start);
    master.gain.linearRampToValueAtTime(peak, start + attack);
    master.gain.setValueAtTime(peak, holdEnd);
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

  function playMelody() {
    if (!melody.notes.length) return;
    var ctx = ensureAudio();
    stopAllLive();
    stopPlayback();
    var token = playToken;
    playing = true;
    updatePlayButton();

    var rate = SPEED_RATE[speed];
    var notes = soundingNotes();
    var startAt = ctx.currentTime + 0.04;
    var lastEnd = 0;

    notes.forEach(function (note) {
      var t = startAt + (note.startMs / 1000) * rate;
      var dur = (note.durationMs / 1000) * rate;
      var end = (note.startMs + note.durationMs) * rate;
      if (end > lastEnd) lastEnd = end;
      scheduleNote(ctx, note.midi, t, dur);
      timers.push(
        setTimeout(function () {
          if (token !== playToken) return;
          highlight(note.midi);
        }, Math.max(0, (t - ctx.currentTime) * 1000))
      );
    });

    timers.push(
      setTimeout(function () {
        if (token !== playToken) return;
        playing = false;
        highlight(null);
        updatePlayButton();
      }, 80 + lastEnd)
    );
  }

  function setSpeed(next) {
    if (speed === next) return;
    speed = next;
    document.querySelectorAll("[data-speed]").forEach(function (btn) {
      var on = btn.getAttribute("data-speed") === next;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    if (playing) playMelody();
  }

  function shift(delta) {
    if (!melody.notes.length) return;
    var nextMin = midiBounds().min + delta;
    var nextMax = midiBounds().max + delta;
    if (nextMin < 21 || nextMax > 108) return;
    transpose += delta;
    updateRange();
    playMelody();
  }

  function mixMono(buffer) {
    var channels = buffer.numberOfChannels;
    var length = buffer.length;
    var out = new Float32Array(length);
    var c;
    var i;
    var data;
    for (c = 0; c < channels; c++) {
      data = buffer.getChannelData(c);
      for (i = 0; i < length; i++) out[i] += data[i];
    }
    if (channels > 1) {
      for (i = 0; i < length; i++) out[i] /= channels;
    }
    return { samples: out, sampleRate: buffer.sampleRate };
  }

  function downsample(samples, fromRate, toRate) {
    if (fromRate === toRate) return samples;
    var ratio = fromRate / toRate;
    var outLen = Math.floor(samples.length / ratio);
    var out = new Float32Array(outLen);
    var i;
    var start;
    var end;
    var j;
    var sum;
    var count;
    for (i = 0; i < outLen; i++) {
      start = Math.floor(i * ratio);
      end = Math.floor((i + 1) * ratio);
      if (end <= start) end = start + 1;
      sum = 0;
      count = 0;
      for (j = start; j < end && j < samples.length; j++) {
        sum += samples[j];
        count += 1;
      }
      out[i] = count ? sum / count : 0;
    }
    return out;
  }

  function concatChunks(chunks) {
    var total = 0;
    chunks.forEach(function (c) {
      total += c.length;
    });
    var out = new Float32Array(total);
    var offset = 0;
    chunks.forEach(function (c) {
      out.set(c, offset);
      offset += c.length;
    });
    return out;
  }

  function waitTick() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  function analyzeSamples(samples, sampleRate, title) {
    analyzing = true;
    setStatus("高さを取っている");
    var pitched = downsample(samples, sampleRate, DETECT_RATE);
    var frames = [];
    var hopMs = (HOP / DETECT_RATE) * 1000;
    var i = 0;
    var win = new Float32Array(WINDOW);

    function step() {
      var budget = 80;
      while (budget-- && i + WINDOW < pitched.length) {
        win.set(pitched.subarray(i, i + WINDOW));
        frames.push(PianoPitch.pitch(win, DETECT_RATE));
        i += HOP;
      }
      if (i + WINDOW < pitched.length) {
        var pct = Math.floor((i / pitched.length) * 100);
        setStatus("高さを取っている　" + pct + "%");
        return waitTick().then(step);
      }
      var notes = PianoPitch.framesToNotes(frames, hopMs);
      analyzing = false;
      if (!notes.length) {
        setStatus("高さが取れなかった。帯の音が混ざっているか、音が小さい。");
        return;
      }
      setMelody({ title: title || "練習用", notes: notes });
      setStatus(notes.length + "音取れた。おかしい音は JSON を直して「このJSONで再生」。");
    }

    return step();
  }

  function decodeArrayBuffer(ctx, buf) {
    return ctx.decodeAudioData(buf.slice ? buf.slice(0) : buf);
  }

  function recordMediaElement(el, ctx) {
    return new Promise(function (resolve, reject) {
      var source = ctx.createMediaElementSource(el);
      var proc = ctx.createScriptProcessor(4096, 1, 1);
      var silent = ctx.createGain();
      silent.gain.value = 0;
      var chunks = [];
      proc.onaudioprocess = function (e) {
        chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(proc);
      proc.connect(silent);
      silent.connect(ctx.destination);

      function cleanup() {
        try {
          proc.disconnect();
          source.disconnect();
          silent.disconnect();
        } catch (e) {}
      }

      el.onended = function () {
        cleanup();
        resolve({ samples: concatChunks(chunks), sampleRate: ctx.sampleRate });
      };
      el.onerror = function () {
        cleanup();
        reject(new Error("再生できない"));
      };
      var play = el.play();
      if (play && play.catch) play.catch(reject);
    });
  }

  function decodeFile(file) {
    var ctx = ensureAudio();
    return file.arrayBuffer().then(function (buf) {
      return decodeArrayBuffer(ctx, buf);
    }).then(function (audioBuffer) {
      return mixMono(audioBuffer);
    }).catch(function () {
      setStatus("音声として読めないので、再生しながら取る。長さと同じ時間がかかる。");
      var url = URL.createObjectURL(file);
      var el = document.createElement(file.type.indexOf("video") === 0 ? "video" : "audio");
      el.preload = "auto";
      el.playsInline = true;
      el.src = url;
      return new Promise(function (resolve, reject) {
        el.onloadedmetadata = function () {
          recordMediaElement(el, ctx)
            .then(function (result) {
              URL.revokeObjectURL(url);
              resolve(result);
            })
            .catch(function (err) {
              URL.revokeObjectURL(url);
              reject(err);
            });
        };
        el.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error("このファイルは読めない。音声ファイルを渡す。"));
        };
      });
    });
  }

  function canTabAudio() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  }

  function startTabRecord() {
    if (recording || analyzing) return;
    var ctx = ensureAudio();
    navigator.mediaDevices
      .getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
      .then(function (stream) {
        if (!stream.getAudioTracks().length) {
          stream.getTracks().forEach(function (t) {
            t.stop();
          });
          setStatus("音声トラックがない。タブを選び、音声の共有にチェックを入れる。");
          return;
        }
        recStream = stream;
        recChunks = [];
        recSampleRate = ctx.sampleRate;
        recSource = ctx.createMediaStreamSource(stream);
        recProc = ctx.createScriptProcessor(4096, 1, 1);
        recSilent = ctx.createGain();
        recSilent.gain.value = 0;
        recProc.onaudioprocess = function (e) {
          if (!recording) return;
          recChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        recSource.connect(recProc);
        recProc.connect(recSilent);
        recSilent.connect(ctx.destination);
        recording = true;
        btnRecord.disabled = true;
        btnRecordStop.disabled = false;
        btnRecord.classList.add("is-recording");
        setStatus("録音中。終わったら「録音を止めて解析」。");
        stream.getVideoTracks().forEach(function (t) {
          t.addEventListener("ended", function () {
            if (recording) stopTabRecord(true);
          });
        });
      })
      .catch(function (err) {
        if (err && err.name === "NotAllowedError") {
          setStatus("共有が取り消された。");
          return;
        }
        setStatus("タブの音が取れない。ファイルを渡す。");
      });
  }

  function stopTabRecord(andAnalyze) {
    if (!recording) return;
    recording = false;
    btnRecord.disabled = false;
    btnRecordStop.disabled = true;
    btnRecord.classList.remove("is-recording");
    try {
      if (recProc) recProc.disconnect();
      if (recSource) recSource.disconnect();
      if (recSilent) recSilent.disconnect();
    } catch (e) {}
    recProc = null;
    recSource = null;
    recSilent = null;
    if (recStream) {
      recStream.getTracks().forEach(function (t) {
        t.stop();
      });
      recStream = null;
    }
    var samples = concatChunks(recChunks);
    recChunks = [];
    if (!andAnalyze) return;
    if (samples.length < DETECT_RATE * 0.3) {
      setStatus("録音が短すぎる。");
      return;
    }
    analyzeSamples(samples, recSampleRate, "タブの音");
  }

  function applyJsonFromEditor() {
    try {
      var next = parseMelody(jsonArea.value);
      setMelody(next, { keepEditor: true });
      setStatus(next.notes.length + "音を読み込んだ。");
    } catch (e) {
      setStatus("JSONが読めない。" + (e && e.message ? e.message : ""));
    }
  }

  function saveJson() {
    var blob = new Blob([melodyJson(melody)], { type: "application/json" });
    var a = document.createElement("a");
    var name = (melody.title || "melody").replace(/[\\/:*?"<>|]/g, "_");
    a.href = URL.createObjectURL(blob);
    a.download = name + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function loadStored() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setMelody(parseMelody(raw), { skipStore: true });
        return;
      }
    } catch (e) {}
    fetch("melody.example.json")
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        setMelody(parseMelody(data), { skipStore: true });
        setStatus("動作確認用のドミソが入っている。ファイルかタブの音で作り直せる。");
      })
      .catch(function () {
        jsonArea.value = melodyJson(melody);
        updateRange();
      });
  }

  document.querySelectorAll("[data-speed]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setSpeed(btn.getAttribute("data-speed"));
    });
  });

  btnPlay.addEventListener("click", function () {
    if (playing) stopPlayback();
    else playMelody();
  });

  btnLower.addEventListener("click", function () {
    shift(-1);
  });

  btnHigher.addEventListener("click", function () {
    shift(1);
  });

  btnApplyJson.addEventListener("click", applyJsonFromEditor);
  btnSaveJson.addEventListener("click", saveJson);

  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file || analyzing || recording) return;
    var title = file.name.replace(/\.[^.]+$/, "");
    setStatus("ファイルを読んでいる");
    decodeFile(file)
      .then(function (pcm) {
        return analyzeSamples(pcm.samples, pcm.sampleRate, title);
      })
      .catch(function (err) {
        analyzing = false;
        setStatus(err && err.message ? err.message : "ファイルが読めない。");
      });
  });

  jsonInput.addEventListener("change", function () {
    var file = jsonInput.files && jsonInput.files[0];
    jsonInput.value = "";
    if (!file) return;
    file
      .text()
      .then(function (text) {
        setMelody(parseMelody(text));
        setStatus(melody.notes.length + "音を読み込んだ。");
      })
      .catch(function (err) {
        setStatus("JSONが読めない。" + (err && err.message ? err.message : ""));
      });
  });

  if (!canTabAudio()) {
    tabBlock.hidden = true;
  } else {
    btnRecord.addEventListener("click", startTabRecord);
    btnRecordStop.addEventListener("click", function () {
      stopTabRecord(true);
    });
  }

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
  updatePlayButton();
  loadStored();
})();
