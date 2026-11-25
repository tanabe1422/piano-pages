(function () {
  var START_MIDI = 41;
  var END_MIDI = 84;
  var STEP = 0.125;
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var SOLFA = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];
  var BLACK_PC = { 1: true, 3: true, 6: true, 8: true, 10: true };
  var DENOMS = { 2: true, 4: true, 8: true, 16: true };
  var STORAGE_KEY = "piano-editor";
  var NUM_WIDTH = 36;

  var state = {
    title: "無題",
    bpm: 120,
    numerator: 4,
    denominator: 4,
    measures: 4,
    pitch: 60,
    lengthQuarters: 1,
    notes: [],
    selected: null,
    seq: 1
  };

  var playing = false;
  var playMode = null;
  var playToken = 0;
  var timers = [];
  var voices = [];
  var audioCtx = null;
  var keysByMidi = {};
  var drag = null;
  var blockClickUntil = 0;
  var ROW_H = 18;
  var keyBoxes = [];
  var viewReady = false;
  var syncingScroll = false;

  var keyboardEl = document.getElementById("keyboard");
  var wrapEl = document.getElementById("keyboard-wrap");
  var spacerEl = document.getElementById("keyboard-spacer");
  var statusEl = document.getElementById("status");
  var titleInput = document.getElementById("title");
  var bpmInput = document.getElementById("bpm");
  var numeratorInput = document.getElementById("numerator");
  var denominatorInput = document.getElementById("denominator");
  var measuresInput = document.getElementById("measures");
  var midiInput = document.getElementById("note-midi");
  var lengthInput = document.getElementById("note-length");
  var addLengthInput = document.getElementById("add-length");
  var noteNameEl = document.getElementById("note-name");
  var lengthNameEl = document.getElementById("length-name");
  var addLengthNameEl = document.getElementById("add-length-name");
  var scoreEl = document.getElementById("score");
  var scoreScroll = document.getElementById("score-scroll");
  var jsonArea = document.getElementById("json-area");
  var btnPlay = document.getElementById("btn-play");
  var btnFrom = document.getElementById("btn-play-from");
  var btnDelete = document.getElementById("btn-delete");
  var btnExtend = document.getElementById("btn-extend");
  var btnSnapEnd = document.getElementById("btn-snap-end");
  var lengthPreset = document.getElementById("length-preset");
  var addLengthPreset = document.getElementById("add-length-preset");
  var btnApply = document.getElementById("btn-apply");
  var btnSave = document.getElementById("btn-save");
  var btnCopy = document.getElementById("btn-copy");
  var jsonInput = document.getElementById("json-input");

  function isBlack(midi) {
    return BLACK_PC[midi % 12] === true;
  }

  function midiName(midi) {
    return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  function midiLabel(midi) {
    return midiName(midi) + " " + SOLFA[midi % 12];
  }

  function snap(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return NaN;
    return Math.round(n * 8) / 8;
  }

  function musicalTime(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return NaN;
    if (n < 0) n = 0;
    var grid = Math.round(n * 8) / 8;
    var sixth = Math.round(n * 6) / 6;
    var sixthDist = Math.abs(n - sixth);
    var gridDist = Math.abs(n - grid);
    if (sixthDist <= 0.02 && sixthDist <= gridDist + 1e-9) return sixth;
    return grid;
  }

  function formatQuarters(quarters) {
    var shown = Math.round(Number(quarters) * 1000) / 1000;
    if (!Number.isFinite(shown)) return "";
    return String(shown);
  }

  function snapTime(quarters, ignoreId, hold) {
    if (!Number.isFinite(quarters) || quarters < 0) quarters = 0;
    var grid = snap(quarters);
    var best = grid;
    var bestDist = Math.abs(quarters - grid);
    function consider(target) {
      if (!Number.isFinite(target) || target < 0) return;
      var dist = Math.abs(quarters - target);
      if (dist + 1e-9 < bestDist) {
        best = target;
        bestDist = dist;
      }
    }
    if (hold != null) consider(hold);
    var i;
    for (i = 0; i < state.notes.length; i++) {
      if (ignoreId != null && state.notes[i].id === ignoreId) continue;
      consider(noteAbs(state.notes[i]) + state.notes[i].quarters);
    }
    return best;
  }

  function noteIdsEndingAt(abs, ignoreId) {
    var ids = {};
    var i;
    for (i = 0; i < state.notes.length; i++) {
      var note = state.notes[i];
      if (ignoreId != null && note.id === ignoreId) continue;
      if (Math.abs(noteAbs(note) + note.quarters - abs) < 1e-4) ids[note.id] = true;
    }
    return ids;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function lengthName(quarters) {
    var table = [
      [0.125, "32分音符"],
      [1 / 6, "3連符/8分音符"],
      [0.25, "16分音符"],
      [1 / 3, "3連符/4分音符"],
      [0.375, "付点16分音符"],
      [0.5, "8分音符"],
      [2 / 3, "3連符/2分音符"],
      [0.75, "付点8分音符"],
      [5 / 6, "8分+8分の3連符"],
      [1, "4分音符"],
      [1.5, "付点4分音符"],
      [2, "2分音符"],
      [3, "付点2分音符"],
      [4, "全音符"]
    ];
    var i;
    for (i = 0; i < table.length; i++) {
      if (Math.abs(table[i][0] - quarters) < 1e-4) return table[i][1];
    }
    return formatQuarters(quarters) + "拍";
  }

  function setStatus(text) {
    statusEl.textContent = text || "";
  }

  function beatsPerMeasure() {
    return state.numerator * (4 / state.denominator);
  }

  function cellCount() {
    return Math.max(1, Math.round(beatsPerMeasure() / STEP));
  }

  function maxBeat() {
    return snap(1 + (cellCount() - 1) * STEP);
  }

  function quarterMs() {
    return 60000 / state.bpm;
  }

  function findNote(id) {
    id = Number(id);
    var i;
    for (i = 0; i < state.notes.length; i++) {
      if (state.notes[i].id === id) return state.notes[i];
    }
    return null;
  }

  function selectedNote() {
    if (state.selected == null) return null;
    return findNote(state.selected);
  }

  function noteAbs(note) {
    return (note.measure - 1) * beatsPerMeasure() + (note.beat - 1);
  }

  function applyAbs(note, abs, nb) {
    if (!(nb > 0)) nb = 4;
    abs = musicalTime(abs);
    if (!Number.isFinite(abs) || abs < 0) abs = 0;
    var measureIndex = Math.floor((abs + 1e-6) / nb);
    var offset = musicalTime(abs - measureIndex * nb);
    if (offset >= nb - 1e-6) {
      measureIndex += 1;
      offset = 0;
    }
    note.measure = measureIndex + 1;
    note.beat = musicalTime(offset + 1);
    if (note.measure > 64) {
      note.measure = 64;
      note.beat = 1;
    }
  }

  function occupiedMeasures() {
    var m = 0;
    var nb = beatsPerMeasure();
    state.notes.forEach(function (note) {
      if (note.measure > m) m = note.measure;
      var end = noteAbs(note) + note.quarters;
      var last = Math.ceil(end / nb - 1e-9);
      if (last > m) m = last;
    });
    return m;
  }

  function fitMeasures() {
    var need = Math.max(state.measures, occupiedMeasures(), 1);
    if (need > 64) need = 64;
    state.measures = need;
    if (measuresInput.value !== String(need)) measuresInput.value = String(need);
  }

  function rebar(oldNb) {
    var nb = beatsPerMeasure();
    state.notes.forEach(function (note) {
      var abs = (note.measure - 1) * oldNb + (note.beat - 1);
      applyAbs(note, abs, nb);
    });
  }

  function playbackObject() {
    var qms = quarterMs();
    var notes = state.notes.map(function (note) {
      return {
        midi: note.midi,
        startMs: round1(noteAbs(note) * qms),
        durationMs: round1(note.quarters * qms)
      };
    });
    notes.sort(function (a, b) {
      return a.startMs - b.startMs || a.midi - b.midi;
    });
    return {
      title: state.title || "無題",
      bpm: state.bpm,
      numerator: state.numerator,
      denominator: state.denominator,
      notes: notes
    };
  }

  function refreshJson() {
    jsonArea.value = JSON.stringify(playbackObject(), null, 2);
  }

  function saveStore() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          title: state.title,
          bpm: state.bpm,
          numerator: state.numerator,
          denominator: state.denominator,
          measures: state.measures,
          pitch: state.pitch,
          lengthQuarters: state.lengthQuarters,
          notes: state.notes.map(function (note) {
            return {
              id: note.id,
              midi: note.midi,
              measure: note.measure,
              beat: note.beat,
              quarters: note.quarters
            };
          })
        })
      );
    } catch (e) {}
  }

  function measureKeys() {
    var origin = keyboardEl.getBoundingClientRect();
    var list = [];
    Object.keys(keysByMidi).forEach(function (midi) {
      var el = keysByMidi[midi];
      var rect = el.getBoundingClientRect();
      list.push({
        midi: Number(midi),
        left: rect.left - origin.left,
        width: rect.width,
        black: el.classList.contains("black-key")
      });
    });
    list.sort(function (a, b) {
      return a.midi - b.midi;
    });
    keyBoxes = list;
    return keyboardEl.offsetWidth;
  }

  function boxFor(midi) {
    var i;
    for (i = 0; i < keyBoxes.length; i++) {
      if (keyBoxes[i].midi === midi) return keyBoxes[i];
    }
    return null;
  }

  function gridEl() {
    return document.getElementById("roll-grid");
  }

  function timeFromClientY(clientY) {
    var grid = gridEl();
    if (!grid) return 0;
    var rect = grid.getBoundingClientRect();
    var rows = rect.height / ROW_H;
    if (!(rows > 0)) return 0;
    if (clientY >= rect.bottom) return 0;
    if (clientY <= rect.top) {
      return rows * STEP + ((rect.top - clientY) / ROW_H) * STEP;
    }
    return ((rect.bottom - clientY) / ROW_H) * STEP;
  }

  function midiFromClientX(clientX) {
    var grid = gridEl();
    if (!grid || !keyBoxes.length) return state.pitch;
    var x = clientX - grid.getBoundingClientRect().left;
    var i;
    for (i = 0; i < keyBoxes.length; i++) {
      var black = keyBoxes[i];
      if (!black.black) continue;
      if (x >= black.left - 1 && x <= black.left + black.width + 1) return black.midi;
    }
    var whites = [];
    for (i = 0; i < keyBoxes.length; i++) {
      if (!keyBoxes[i].black) whites.push(keyBoxes[i]);
    }
    if (!whites.length) return state.pitch;
    for (i = 0; i < whites.length; i++) {
      if (x >= whites[i].left && x < whites[i].left + whites[i].width) return whites[i].midi;
    }
    if (x < whites[0].left) return whites[0].midi;
    return whites[whites.length - 1].midi;
  }

  function scrollTimeIntoView(quarters) {
    var grid = gridEl();
    if (!grid) return;
    var fromBottom = (quarters / STEP) * ROW_H;
    var gridRect = grid.getBoundingClientRect();
    var scrollRect = scoreScroll.getBoundingClientRect();
    var yInView = gridRect.bottom - scrollRect.top - fromBottom;
    scoreScroll.scrollTop += yInView - (scrollRect.height - 72);
  }

  function renderGrid() {
    var stickBottom = scoreScroll.scrollHeight - scoreScroll.scrollTop - scoreScroll.clientHeight;
    var width = measureKeys();
    var nb = beatsPerMeasure();
    var rows = Math.max(1, Math.round((state.measures * nb) / STEP));
    var beatRows = Math.max(1, Math.round((4 / state.denominator) / STEP));
    var rowsPerMeasure = Math.max(1, Math.round(nb / STEP));
    scoreEl.textContent = "";
    var roll = document.createElement("div");
    roll.className = "roll";
    var gutter = document.createElement("div");
    gutter.className = "roll-gutter";
    gutter.style.width = NUM_WIDTH + "px";
    var grid = document.createElement("div");
    grid.className = "roll-grid";
    grid.id = "roll-grid";
    grid.style.height = rows * ROW_H + "px";
    grid.style.setProperty("--row", ROW_H + "px");
    if (width > 0) grid.style.width = width + "px";
    var i;
    for (i = 0; i < keyBoxes.length; i++) {
      var box = keyBoxes[i];
      var col = document.createElement("div");
      col.className = "roll-col" + (box.black ? " is-black" : "");
      col.dataset.midi = String(box.midi);
      col.style.left = box.left + "px";
      col.style.width = box.width + "px";
      grid.appendChild(col);
    }
    for (i = beatRows; i <= rows; i += beatRows) {
      var line = document.createElement("div");
      line.className = "roll-line" + (i % rowsPerMeasure === 0 ? " is-measure" : "");
      line.style.bottom = i * ROW_H + "px";
      grid.appendChild(line);
    }
    var m;
    var beatQuarters = 4 / state.denominator;
    for (m = 1; m <= state.measures; m++) {
      var b;
      for (b = 0; b < state.numerator; b++) {
        var mark = document.createElement("span");
        mark.className = b === 0 ? "roll-measure-no" : "roll-beat-no";
        mark.textContent = b === 0 ? String(m) : String(b + 1);
        mark.style.bottom = (((m - 1) * nb + b * beatQuarters) / STEP) * ROW_H + "px";
        gutter.appendChild(mark);
      }
    }
    var snapIds = null;
    if (drag && drag.mode !== "end") {
      var moving = findNote(drag.id);
      if (moving) snapIds = noteIdsEndingAt(noteAbs(moving), drag.id);
    }
    state.notes.forEach(function (note) {
      var noteBox = boxFor(note.midi);
      var abs = noteAbs(note);
      var block = document.createElement("div");
      block.className = "score-note";
      if (noteBox && noteBox.black) block.classList.add("is-black");
      if (note.id === state.selected) block.classList.add("is-selected");
      if (drag && drag.id === note.id) block.classList.add("is-dragging");
      if (snapIds && snapIds[note.id]) block.classList.add("is-snap-target");
      block.dataset.id = String(note.id);
      block.style.left = (noteBox ? noteBox.left : 0) + "px";
      block.style.width = (noteBox ? noteBox.width : 22) + "px";
      block.style.bottom = (abs / STEP) * ROW_H + "px";
      block.style.height = Math.max(ROW_H, (note.quarters / STEP) * ROW_H) + "px";
      block.setAttribute("role", "button");
      block.tabIndex = 0;
      block.setAttribute("aria-label", midiLabel(note.midi) + "、" + note.measure + "小節、拍" + note.beat);
      var endEdge = document.createElement("span");
      endEdge.className = "score-note-edge";
      endEdge.dataset.edge = "end";
      endEdge.setAttribute("aria-hidden", "true");
      var label = document.createElement("span");
      label.className = "score-note-label";
      label.textContent = midiName(note.midi);
      var startEdge = document.createElement("span");
      startEdge.className = "score-note-edge";
      startEdge.dataset.edge = "start";
      startEdge.setAttribute("aria-hidden", "true");
      block.appendChild(endEdge);
      block.appendChild(label);
      block.appendChild(startEdge);
      grid.appendChild(block);
    });
    var head = document.createElement("div");
    head.className = "roll-playhead";
    head.id = "roll-playhead";
    head.hidden = true;
    grid.appendChild(head);
    roll.appendChild(gutter);
    roll.appendChild(grid);
    scoreEl.appendChild(roll);
    spacerEl.style.flex = "0 0 " + NUM_WIDTH + "px";
    spacerEl.style.width = NUM_WIDTH + "px";
    if (!viewReady) {
      scoreScroll.scrollTop = scoreScroll.scrollHeight;
      viewReady = true;
    } else {
      var next = scoreScroll.scrollHeight - scoreScroll.clientHeight - stickBottom;
      if (next < 0) next = 0;
      scoreScroll.scrollTop = next;
    }
    matchScrollBar();
  }

  function alignGrid() {
    var width = measureKeys();
    if (!(width > 0)) return;
    var grid = gridEl();
    if (!grid) return;
    grid.style.width = width + "px";
    spacerEl.style.flex = "0 0 " + NUM_WIDTH + "px";
    spacerEl.style.width = NUM_WIDTH + "px";
    grid.querySelectorAll(".roll-col").forEach(function (col) {
      var box = boxFor(Number(col.dataset.midi));
      if (!box) return;
      col.style.left = box.left + "px";
      col.style.width = box.width + "px";
    });
    grid.querySelectorAll(".score-note").forEach(function (el) {
      var note = findNote(el.dataset.id);
      if (!note) return;
      var box = boxFor(note.midi);
      el.style.left = (box ? box.left : 0) + "px";
      el.style.width = (box ? box.width : 22) + "px";
    });
    matchScrollBar();
  }

  function matchScrollBar() {
    var bar = scoreScroll.offsetWidth - scoreScroll.clientWidth;
    if (bar < 0) bar = 0;
    wrapEl.style.paddingRight = bar + "px";
  }

  function setIfIdle(input, value) {
    if (document.activeElement === input) return;
    if (input.value !== value) input.value = value;
  }

  function syncSelectionFields() {
    var note = selectedNote();
    var midi = note ? note.midi : state.pitch;
    setIfIdle(midiInput, String(midi));
    noteNameEl.textContent = midiLabel(midi);
    if (note) {
      setIfIdle(lengthInput, formatQuarters(note.quarters));
      lengthNameEl.textContent = lengthName(note.quarters);
      lengthInput.disabled = false;
      lengthPreset.disabled = false;
    } else {
      lengthInput.value = "";
      lengthNameEl.textContent = "未選択";
      lengthInput.disabled = true;
      lengthPreset.disabled = true;
    }
    setIfIdle(addLengthInput, formatQuarters(state.lengthQuarters));
    addLengthNameEl.textContent = lengthName(state.lengthQuarters);
    btnDelete.disabled = !note;
  }

  function markPitch(scrollKey) {
    Object.keys(keysByMidi).forEach(function (key) {
      keysByMidi[key].classList.toggle("is-start", Number(key) === state.pitch);
    });
    if (!scrollKey) return;
    var el = keysByMidi[state.pitch];
    if (!el) return;
    var wrap = wrapEl.getBoundingClientRect();
    var key = el.getBoundingClientRect();
    if (key.left < wrap.left) wrapEl.scrollLeft -= wrap.left - key.left + 12;
    else if (key.right > wrap.right) wrapEl.scrollLeft += key.right - wrap.right + 12;
  }

  function updatePlayButtons() {
    btnPlay.textContent = playing && playMode === "start" ? "停止" : "最初から";
    btnFrom.textContent = playing && playMode === "from" ? "停止" : "選択から";
    btnPlay.classList.toggle("is-playing", playing && playMode === "start");
    btnFrom.classList.toggle("is-playing", playing && playMode === "from");
    btnPlay.setAttribute("aria-pressed", playing && playMode === "start" ? "true" : "false");
    btnFrom.setAttribute("aria-pressed", playing && playMode === "from" ? "true" : "false");
    btnPlay.disabled = state.notes.length === 0;
    btnFrom.disabled = !selectedNote() || state.notes.length === 0;
    btnExtend.disabled = !selectedNote();
    btnSnapEnd.disabled = !selectedNote() || state.notes.length < 2;
  }

  function updateChrome() {
    if (!state.notes.length && playing) stopPlayback();
    syncSelectionFields();
    markPitch(false);
    updatePlayButtons();
  }

  function renderAll() {
    fitMeasures();
    renderGrid();
    refreshJson();
    updateChrome();
    saveStore();
  }

  function renderDrag() {
    fitMeasures();
    renderGrid();
    syncSelectionFields();
    markPitch(false);
  }

  function syncForm() {
    titleInput.value = state.title;
    bpmInput.value = String(state.bpm);
    numeratorInput.value = String(state.numerator);
    denominatorInput.value = String(state.denominator);
    measuresInput.value = String(state.measures);
    syncSelectionFields();
  }

  function addNote(measure, beat) {
    if (state.notes.length >= 500) {
      setStatus("音は500まで。");
      return;
    }
    beat = musicalTime(beat);
    var max = maxBeat();
    if (!Number.isFinite(beat) || beat < 1 || beat > max + 1e-6) return;
    if (measure < 1 || measure > 64) return;
    var id = state.seq++;
    state.notes.push({
      id: id,
      midi: state.pitch,
      measure: measure,
      beat: beat,
      quarters: state.lengthQuarters
    });
    state.selected = id;
    if (measure > state.measures) state.measures = measure;
    stopPlayback();
    renderAll();
  }

  function removeNote(id) {
    id = Number(id);
    state.notes = state.notes.filter(function (note) {
      return note.id !== id;
    });
    if (state.selected === id) state.selected = null;
    stopPlayback();
    renderAll();
  }

  function parsePlayback(data) {
    if (typeof data === "string") data = JSON.parse(data);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("オブジェクトではない");
    }
    if (!Array.isArray(data.notes)) throw new Error("notes がない");
    var title = typeof data.title === "string" && data.title ? data.title : "無題";
    var notes = data.notes.map(function (n, i) {
      if (!n || typeof n !== "object") throw new Error(i + 1 + "音目がオブジェクトではない");
      var midi = Number(n.midi);
      var startMs = Number(n.startMs);
      var durationMs = Number(n.durationMs);
      if (!Number.isFinite(midi) || midi < 0 || midi > 127) {
        throw new Error(i + 1 + "音目の midi が 0〜127 ではない");
      }
      if (!Number.isFinite(startMs) || startMs < 0) {
        throw new Error(i + 1 + "音目の startMs が 0 以上ではない");
      }
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        throw new Error(i + 1 + "音目の durationMs が正の数ではない");
      }
      return {
        midi: Math.round(midi),
        startMs: startMs,
        durationMs: durationMs
      };
    });
    return {
      title: title,
      bpm: Number(data.bpm),
      numerator: Number(data.numerator),
      denominator: Number(data.denominator),
      notes: notes
    };
  }

  function validTempo(bpm) {
    return Number.isFinite(bpm) && bpm >= 40 && bpm <= 240;
  }

  function validMeter(numerator, denominator) {
    return Number.isInteger(numerator) && numerator >= 1 && numerator <= 16 && DENOMS[denominator] === true;
  }

  function applyPlayback(data, fromFileTempo) {
    var snapped = false;
    var qms = quarterMs();
    var nb = beatsPerMeasure();
    state.notes = data.notes.map(function (n, i) {
      var quarters = musicalTime(n.durationMs / qms);
      if (!Number.isFinite(quarters) || quarters < STEP) quarters = STEP;
      if (Math.abs(n.durationMs / qms - quarters) > 0.02) snapped = true;
      var abs = musicalTime(n.startMs / qms);
      if (Math.abs(n.startMs / qms - abs) > 0.02) snapped = true;
      if (!Number.isFinite(abs) || abs < 0) abs = 0;
      var note = { id: i + 1, midi: n.midi, measure: 1, beat: 1, quarters: quarters };
      applyAbs(note, abs, nb);
      return note;
    });
    state.seq = state.notes.length + 1;
    state.selected = null;
    state.title = data.title;
    var need = occupiedMeasures();
    if (need > state.measures) state.measures = need;
    if (state.measures < 1) state.measures = 1;
    syncForm();
    stopPlayback();
    renderAll();
    var where = fromFileTempo ? "ファイルのBPMと拍子で" : "画面のBPMと拍子で";
    var msg = where + data.notes.length + "音を小節に置いた。";
    if (snapped) msg += "長さと位置は、32分音符か3連符に合わせた。";
    setStatus(msg);
  }

  function readEditorJson() {
    var data = parsePlayback(jsonArea.value);
    var fromFile = false;
    if (validTempo(data.bpm) || validMeter(data.numerator, data.denominator)) {
      if (validTempo(data.bpm)) state.bpm = Math.round(data.bpm);
      if (validMeter(data.numerator, data.denominator)) {
        state.numerator = data.numerator;
        state.denominator = data.denominator;
      }
      fromFile = validTempo(data.bpm) && validMeter(data.numerator, data.denominator);
    }
    applyPlayback(data, fromFile);
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;
      if (typeof data.title === "string" && data.title) state.title = data.title;
      if (validTempo(Number(data.bpm))) state.bpm = Math.round(Number(data.bpm));
      if (validMeter(Number(data.numerator), Number(data.denominator))) {
        state.numerator = Number(data.numerator);
        state.denominator = Number(data.denominator);
      }
      var measures = Number(data.measures);
      if (Number.isInteger(measures) && measures >= 1 && measures <= 64) state.measures = measures;
      var pitch = Number(data.pitch);
      if (Number.isInteger(pitch) && pitch >= 0 && pitch <= 127) state.pitch = pitch;
      var len = musicalTime(data.lengthQuarters);
      if (Number.isFinite(len) && len >= STEP && len <= 16) state.lengthQuarters = len;
      if (!Array.isArray(data.notes)) return;
      var maxId = 0;
      state.notes = [];
      data.notes.forEach(function (n) {
        if (!n) return;
        var midi = Math.round(Number(n.midi));
        var measure = Math.round(Number(n.measure));
        var beat = musicalTime(n.beat);
        var quarters = musicalTime(n.quarters);
        if (midi < 0 || midi > 127) return;
        if (measure < 1 || measure > 64) return;
        if (!Number.isFinite(beat) || beat < 1) return;
        if (!Number.isFinite(quarters) || quarters < STEP) return;
        var id = Number(n.id);
        if (!Number.isInteger(id) || id < 1) id = state.notes.length + 1;
        if (id > maxId) maxId = id;
        var note = { id: id, midi: midi, measure: measure, beat: beat, quarters: quarters };
        applyAbs(note, (measure - 1) * beatsPerMeasure() + (beat - 1), beatsPerMeasure());
        note.quarters = quarters;
        state.notes.push(note);
      });
      state.seq = maxId + 1;
    } catch (e) {}
  }

  function buildKeyboard() {
    var whites = [];
    var midi;
    for (midi = START_MIDI; midi <= END_MIDI; midi++) {
      if (!isBlack(midi)) whites.push(midi);
    }
    whites.forEach(function (white) {
      var key = document.createElement("div");
      key.className = "white-key";
      key.dataset.midi = String(white);
      if (white % 12 === 0) {
        var label = document.createElement("span");
        label.className = "key-name";
        label.textContent = midiName(white);
        key.appendChild(label);
      }
      keyboardEl.appendChild(key);
      keysByMidi[white] = key;
    });
    whites.forEach(function (white, index) {
      var next = white + 1;
      if (next > END_MIDI || !isBlack(next)) return;
      var black = document.createElement("div");
      black.className = "black-key";
      black.dataset.midi = String(next);
      black.style.left = ((index + 1) / whites.length) * 100 + "%";
      keyboardEl.appendChild(black);
      keysByMidi[next] = black;
    });
  }

  function ensureAudio() {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
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

  function clearSounding() {
    Object.keys(keysByMidi).forEach(function (key) {
      keysByMidi[key].classList.remove("is-on");
    });
    scoreEl.querySelectorAll(".score-note").forEach(function (el) {
      el.classList.remove("is-sounding");
    });
    var head = document.getElementById("roll-playhead");
    if (head) head.hidden = true;
  }

  function stopPlayback() {
    playToken += 1;
    playing = false;
    playMode = null;
    timers.forEach(function (id) {
      clearTimeout(id);
    });
    timers = [];
    stopVoices();
    clearSounding();
    updatePlayButtons();
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

  function showSounding(ms) {
    clearSounding();
    var head = document.getElementById("roll-playhead");
    if (head) {
      head.hidden = false;
      head.style.bottom = (ms / quarterMs() / STEP) * ROW_H + "px";
    }
    scrollTimeIntoView(ms / quarterMs());
    state.notes.forEach(function (note) {
      var start = noteAbs(note) * quarterMs();
      var dur = note.quarters * quarterMs();
      if (ms + 1 < start || ms > start + dur - 1) return;
      var key = keysByMidi[note.midi];
      if (key) key.classList.add("is-on");
      scoreEl.querySelectorAll('.score-note[data-id="' + note.id + '"]').forEach(function (el) {
        el.classList.add("is-sounding");
      });
    });
  }

  function playMelody(fromMs, mode) {
    if (!state.notes.length) return;
    if (fromMs == null || fromMs < 0) fromMs = 0;
    var ctx = ensureAudio();
    stopPlayback();
    var token = playToken;
    playing = true;
    playMode = mode === "from" ? "from" : "start";
    updatePlayButtons();
    scrollTimeIntoView(fromMs / quarterMs());
    var data = playbackObject();
    var startAt = ctx.currentTime + 0.04;
    var lastEnd = 0;
    var any = false;
    data.notes.forEach(function (note) {
      if (note.startMs + 0.05 < fromMs) return;
      any = true;
      var rel = note.startMs - fromMs;
      if (rel < 0) rel = 0;
      var t = startAt + rel / 1000;
      var dur = note.durationMs / 1000;
      var end = rel + note.durationMs;
      if (end > lastEnd) lastEnd = end;
      scheduleNote(ctx, note.midi, t, dur);
      timers.push(
        setTimeout(function () {
          if (token !== playToken) return;
          showSounding(note.startMs);
        }, Math.max(0, (t - ctx.currentTime) * 1000))
      );
      timers.push(
        setTimeout(function () {
          if (token !== playToken) return;
          showSounding(note.startMs + note.durationMs);
        }, Math.max(0, (t + dur - ctx.currentTime) * 1000))
      );
    });
    if (!any) {
      stopPlayback();
      return;
    }
    timers.push(
      setTimeout(function () {
        if (token !== playToken) return;
        playing = false;
        playMode = null;
        clearSounding();
        updatePlayButtons();
      }, 80 + lastEnd)
    );
  }

  function preview(midi) {
    stopPlayback();
    var ctx = ensureAudio();
    scheduleNote(ctx, midi, ctx.currentTime + 0.02, 0.18);
  }

  function setPitch(midi, doPreview) {
    midi = Number(midi);
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) return;
    state.pitch = midi;
    var note = selectedNote();
    if (note) note.midi = midi;
    midiInput.value = String(midi);
    noteNameEl.textContent = midiLabel(midi);
    if (note) {
      renderGrid();
      refreshJson();
      saveStore();
    } else {
      saveStore();
    }
    markPitch(true);
    updatePlayButtons();
    if (doPreview) preview(midi);
  }

  function readInt(el, min, max) {
    var n = Number(el.value);
    if (!Number.isInteger(n) || n < min || n > max) return null;
    return n;
  }

  function autoScroll(e) {
    var rect = scoreScroll.getBoundingClientRect();
    if (e.clientY < rect.top + 28) scoreScroll.scrollTop -= 18;
    else if (e.clientY > rect.bottom - 28) scoreScroll.scrollTop += 18;
    if (e.clientX < rect.left + 28) scoreScroll.scrollLeft -= 18;
    else if (e.clientX > rect.right - 28) scoreScroll.scrollLeft += 18;
  }

  function onScoreDown(e) {
    var noteEl = e.target.closest(".score-note");
    if (!noteEl || !scoreEl.contains(noteEl)) return;
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    var note = findNote(noteEl.dataset.id);
    if (!note) return;
    state.selected = note.id;
    state.pitch = note.midi;
    blockClickUntil = Date.now() + 400;
    syncSelectionFields();
    updatePlayButtons();
    var edge = e.target.closest("[data-edge]");
    drag = {
      pointerId: e.pointerId,
      mode: edge ? edge.dataset.edge : "move",
      id: note.id,
      startAbs: noteAbs(note),
      startQuarters: note.quarters,
      grab: timeFromClientY(e.clientY) - noteAbs(note),
      moved: false
    };
    if (scoreEl.setPointerCapture) scoreEl.setPointerCapture(e.pointerId);
    stopPlayback();
    renderDrag();
  }

  function onScoreMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var note = findNote(drag.id);
    if (!note) return;
    var nb = beatsPerMeasure();
    var abs = timeFromClientY(e.clientY);
    if (drag.mode === "move") {
      var start = snapTime(abs - drag.grab, note.id, drag.startAbs);
      if (start < 0) start = 0;
      var maxStart = 64 * nb;
      if (start > maxStart) start = maxStart;
      if (Math.abs(start - noteAbs(note)) > 1e-6) drag.moved = true;
      applyAbs(note, start, nb);
      var midi = midiFromClientX(e.clientX);
      if (midi !== note.midi) drag.moved = true;
      note.midi = midi;
      state.pitch = midi;
    } else if (drag.mode === "end") {
      var end = snapTime(abs, note.id, drag.startAbs + drag.startQuarters);
      var quarters = end - drag.startAbs;
      if (quarters < STEP) quarters = STEP;
      if (Math.abs(quarters - note.quarters) > 1e-6) drag.moved = true;
      note.quarters = quarters;
    } else if (drag.mode === "start") {
      var endAbs = drag.startAbs + drag.startQuarters;
      var next = snapTime(abs, note.id, drag.startAbs);
      if (next < 0) next = 0;
      if (next > endAbs - STEP) next = endAbs - STEP;
      var nextQuarters = endAbs - next;
      if (nextQuarters < STEP) nextQuarters = STEP;
      if (Math.abs(next - noteAbs(note)) > 1e-6 || Math.abs(nextQuarters - note.quarters) > 1e-6) drag.moved = true;
      applyAbs(note, next, nb);
      note.quarters = nextQuarters;
    }
    autoScroll(e);
    renderDrag();
  }

  function onScoreUp(e) {
    if (!drag || (e.pointerId != null && e.pointerId !== drag.pointerId)) return;
    drag = null;
    if (scoreEl.releasePointerCapture) {
      try {
        scoreEl.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
    renderAll();
  }

  function commitMidi() {
    var midi = readInt(midiInput, 0, 127);
    if (midi == null) {
      var note = selectedNote();
      midiInput.value = String(note ? note.midi : state.pitch);
      setStatus("高さは 0 から 127 まで。");
      return;
    }
    setStatus("");
    setPitch(midi, true);
  }

  function lengthStatus(raw, quarters) {
    if (!(Number.isFinite(raw) && Math.abs(raw - quarters) > 0.001)) return "";
    var onSixth = Math.abs(quarters * 6 - Math.round(quarters * 6)) < 1e-4;
    var onGrid = Math.abs(quarters * 8 - Math.round(quarters * 8)) < 1e-4;
    if (onSixth && !onGrid) return "3連符の長さに合わせた。";
    return "32分音符に合わせた。";
  }

  function readLength(input) {
    var raw = Number(input.value);
    var quarters = musicalTime(input.value);
    if (!Number.isFinite(quarters) || quarters < STEP || quarters > 16) return null;
    return { raw: raw, quarters: quarters };
  }

  function commitSelectedLength() {
    var note = selectedNote();
    if (!note) {
      lengthInput.value = "";
      return;
    }
    var read = readLength(lengthInput);
    if (!read) {
      lengthInput.value = formatQuarters(note.quarters);
      setStatus("長さは32分音符（0.125拍）から16拍まで。");
      return;
    }
    setStatus(lengthStatus(read.raw, read.quarters));
    note.quarters = read.quarters;
    stopPlayback();
    renderAll();
  }

  function commitAddLength() {
    var read = readLength(addLengthInput);
    if (!read) {
      addLengthInput.value = formatQuarters(state.lengthQuarters);
      setStatus("長さは32分音符（0.125拍）から16拍まで。");
      return;
    }
    setStatus(lengthStatus(read.raw, read.quarters));
    state.lengthQuarters = read.quarters;
    syncSelectionFields();
    saveStore();
  }

  function applyPreset(select, input, commit) {
    var raw = select.value;
    select.value = "";
    if (raw === "") return;
    input.value = raw;
    commit();
  }

  function extendSelected() {
    var note = selectedNote();
    if (!note) return;
    var quarters = musicalTime(note.quarters + 1 / 6);
    if (quarters > 16) quarters = 16;
    if (quarters < STEP) quarters = STEP;
    note.quarters = quarters;
    stopPlayback();
    renderAll();
    setStatus("8分の3連符を1つ足して、" + formatQuarters(quarters) + "拍。");
  }

  function snapSelectionToEnd() {
    var note = selectedNote();
    if (!note) return;
    var best = null;
    var i;
    for (i = 0; i < state.notes.length; i++) {
      if (state.notes[i].id === note.id) continue;
      var end = noteAbs(state.notes[i]) + state.notes[i].quarters;
      if (best == null || end > best) best = end;
    }
    if (best == null) {
      setStatus("合わせる音がない。");
      return;
    }
    if (best < 0) best = 0;
    applyAbs(note, best, beatsPerMeasure());
    stopPlayback();
    renderAll();
    setStatus("いちばん遅い音の終わりに合わせた。");
  }

  buildKeyboard();
  loadStore();
  syncForm();
  renderAll();
  markPitch(true);
  requestAnimationFrame(function () {
    scoreScroll.scrollTop = scoreScroll.scrollHeight;
    matchScrollBar();
  });

  titleInput.addEventListener("input", function () {
    state.title = titleInput.value.trim() || "無題";
    refreshJson();
    saveStore();
  });

  bpmInput.addEventListener("input", function () {
    var bpm = readInt(bpmInput, 40, 240);
    if (bpm == null) return;
    if (bpm === state.bpm) return;
    state.bpm = bpm;
    stopPlayback();
    refreshJson();
    saveStore();
  });

  bpmInput.addEventListener("change", function () {
    if (readInt(bpmInput, 40, 240) == null) {
      bpmInput.value = String(state.bpm);
      setStatus("BPMは40から240まで。");
    }
  });

  function onMeterInput() {
    var numerator = readInt(numeratorInput, 1, 16);
    var denominator = Number(denominatorInput.value);
    if (numerator == null || !DENOMS[denominator]) return;
    if (numerator === state.numerator && denominator === state.denominator) return;
    var old = beatsPerMeasure();
    state.numerator = numerator;
    state.denominator = denominator;
    rebar(old);
    stopPlayback();
    renderAll();
  }

  numeratorInput.addEventListener("input", onMeterInput);
  numeratorInput.addEventListener("change", function () {
    if (readInt(numeratorInput, 1, 16) == null) {
      numeratorInput.value = String(state.numerator);
      setStatus("拍子の分子は1から16まで。");
    }
  });
  denominatorInput.addEventListener("change", onMeterInput);

  measuresInput.addEventListener("input", function () {
    var n = readInt(measuresInput, 1, 64);
    if (n == null) return;
    var need = Math.max(occupiedMeasures(), 1);
    if (n < need) {
      state.measures = need;
      measuresInput.value = String(need);
      setStatus("音がある小節まで表示している。");
    } else {
      state.measures = n;
      setStatus("");
    }
    renderGrid();
    saveStore();
  });

  measuresInput.addEventListener("change", function () {
    if (readInt(measuresInput, 1, 64) == null) {
      measuresInput.value = String(state.measures);
      setStatus("小節数は1から64まで。");
    }
  });

  midiInput.addEventListener("change", commitMidi);
  lengthInput.addEventListener("change", commitSelectedLength);
  addLengthInput.addEventListener("change", commitAddLength);

  btnDelete.addEventListener("click", function () {
    if (state.selected == null) return;
    removeNote(state.selected);
  });

  lengthPreset.addEventListener("change", function () {
    applyPreset(lengthPreset, lengthInput, commitSelectedLength);
  });
  addLengthPreset.addEventListener("change", function () {
    applyPreset(addLengthPreset, addLengthInput, commitAddLength);
  });

  btnExtend.addEventListener("click", extendSelected);
  btnSnapEnd.addEventListener("click", snapSelectionToEnd);

  scoreEl.addEventListener("pointerdown", onScoreDown);
  window.addEventListener("pointermove", onScoreMove);
  window.addEventListener("pointerup", onScoreUp);
  window.addEventListener("pointercancel", onScoreUp);

  scoreEl.addEventListener("click", function (e) {
    if (Date.now() < blockClickUntil) {
      e.preventDefault();
      return;
    }
    if (e.target.closest(".score-note")) return;
    if (!e.target.closest(".roll-grid")) return;
    var quarters = snapTime(timeFromClientY(e.clientY), null, null);
    if (!Number.isFinite(quarters) || quarters < 0) quarters = 0;
    var nb = beatsPerMeasure();
    var maxStart = 64 * nb;
    if (quarters > maxStart) quarters = maxStart;
    var measure = Math.floor((quarters + 1e-6) / nb) + 1;
    if (measure > 64) measure = 64;
    var beat = musicalTime(quarters - (measure - 1) * nb + 1);
    if (beat < 1) beat = 1;
    state.pitch = midiFromClientX(e.clientX);
    setStatus("");
    addNote(measure, beat);
  });

  btnPlay.addEventListener("click", function () {
    if (playing && playMode === "start") stopPlayback();
    else playMelody(0, "start");
  });

  btnFrom.addEventListener("click", function () {
    if (playing && playMode === "from") stopPlayback();
    else {
      var note = selectedNote();
      if (!note) return;
      scrollTimeIntoView(noteAbs(note));
      playMelody(noteAbs(note) * quarterMs(), "from");
    }
  });

  btnApply.addEventListener("click", function () {
    try {
      readEditorJson();
    } catch (err) {
      setStatus("JSONが読めない。" + (err && err.message ? err.message : ""));
    }
  });

  btnSave.addEventListener("click", function () {
    var blob = new Blob([jsonArea.value], { type: "application/json" });
    var a = document.createElement("a");
    var name = (state.title || "melody").replace(/[\\/:*?"<>|]/g, "_");
    a.href = URL.createObjectURL(blob);
    a.download = name + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  btnCopy.addEventListener("click", function () {
    var text = jsonArea.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          setStatus("JSONをコピーした。");
        },
        function () {
          jsonArea.focus();
          jsonArea.select();
          setStatus("コピーできない。JSONの文字を選んだ。");
        }
      );
      return;
    }
    jsonArea.focus();
    jsonArea.select();
    setStatus("JSONの文字を選んだ。");
  });

  jsonInput.addEventListener("change", function () {
    var file = jsonInput.files && jsonInput.files[0];
    jsonInput.value = "";
    if (!file) return;
    file.text().then(
      function (text) {
        jsonArea.value = text;
        readEditorJson();
      },
      function () {
        setStatus("JSONが読めない。");
      }
    );
  });

  keyboardEl.addEventListener("click", function (e) {
    var key = e.target.closest("[data-midi]");
    if (!key || !keyboardEl.contains(key)) return;
    setPitch(Number(key.dataset.midi), true);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (state.selected == null) return;
    e.preventDefault();
    removeNote(state.selected);
  });

  scoreScroll.addEventListener("scroll", function () {
    if (syncingScroll) return;
    syncingScroll = true;
    wrapEl.scrollLeft = scoreScroll.scrollLeft;
    syncingScroll = false;
  });

  wrapEl.addEventListener("scroll", function () {
    if (syncingScroll) return;
    syncingScroll = true;
    scoreScroll.scrollLeft = wrapEl.scrollLeft;
    syncingScroll = false;
  });

  window.addEventListener("resize", function () {
    alignGrid();
    matchScrollBar();
  });
  if (window.ResizeObserver) {
    var observer = new ResizeObserver(function () {
      alignGrid();
      matchScrollBar();
    });
    observer.observe(keyboardEl);
    observer.observe(scoreScroll);
  }
})();
