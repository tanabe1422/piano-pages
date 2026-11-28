(function () {
  var START_MIDI = 41;
  var END_MIDI = 84;
  var STEP = 0.125;
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var SOLFA = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];
  var BLACK_PC = { 1: true, 3: true, 6: true, 8: true, 10: true };
  var DENOMS = { 2: true, 4: true, 8: true, 16: true };
  var STORAGE_KEY = "piano-editor";
  var BREAK_WIDTH = 22;
  var PHRASE_WIDTH = 28;
  var NUM_WIDTH = 36;
  var PHRASE_MAX = 99;

  var state = {
    title: "無題",
    bpm: 120,
    numerator: 4,
    denominator: 4,
    measures: 4,
    pitch: 60,
    lengthQuarters: 0.5,
    extendQuarters: 1 / 6,
    breakAt: null,
    phrases: [],
    notes: [],
    selected: [],
    boundary: null,
    multi: false,
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
  var place = null;
  var hover = null;
  var blockClickUntil = 0;
  var ROW_H = 18;
  var keyBoxes = [];
  var viewReady = false;
  var syncingScroll = false;
  var copiedNotes = null;

  var keyboardEl = document.getElementById("keyboard");
  var wrapEl = document.getElementById("keyboard-wrap");
  var spacerEl = document.getElementById("keyboard-spacer");
  var titleInput = document.getElementById("title");
  var bpmInput = document.getElementById("bpm");
  var numeratorInput = document.getElementById("numerator");
  var denominatorInput = document.getElementById("denominator");
  var measuresInput = document.getElementById("measures");
  var midiInput = document.getElementById("note-midi");
  var lengthInput = document.getElementById("note-length");
  var addLengthInput = document.getElementById("add-length");
  var lengthNameEl = document.getElementById("length-name");
  var addLengthNameEl = document.getElementById("add-length-name");
  var scoreEl = document.getElementById("score");
  var scoreScroll = document.getElementById("score-scroll");
  var jsonArea = document.getElementById("json-area");
  var btnPlay = document.getElementById("btn-play");
  var btnFrom = document.getElementById("btn-play-from");
  var btnDelete = document.getElementById("btn-delete");
  var btnExtend = document.getElementById("btn-extend");
  var btnSetLength = document.getElementById("btn-set-length");
  var btnSnapEnd = document.getElementById("btn-snap-end");
  var btnShiftEarlier = document.getElementById("btn-shift-earlier");
  var btnShiftLater = document.getElementById("btn-shift-later");
  var btnBoundaryAdd = document.getElementById("btn-boundary-add");
  var btnBoundaryRemove = document.getElementById("btn-boundary-remove");
  var btnMulti = document.getElementById("btn-multi");
  var lengthPreset = document.getElementById("length-preset");
  var addLengthPreset = document.getElementById("add-length-preset");
  var extendPreset = document.getElementById("extend-preset");
  var btnApply = document.getElementById("btn-apply");
  var btnSave = document.getElementById("btn-save");
  var btnCopy = document.getElementById("btn-copy");
  var btnNew = document.getElementById("btn-new");
  var newBackdrop = document.getElementById("new-backdrop");
  var newDialog = document.getElementById("new-dialog");
  var btnNewSave = document.getElementById("btn-new-save");
  var btnNewDiscard = document.getElementById("btn-new-discard");
  var btnNewCancel = document.getElementById("btn-new-cancel");
  var jsonInput = document.getElementById("json-input");
  var newReturnFocus = null;

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

  function idIgnored(id, ignoreId) {
    if (ignoreId == null) return false;
    if (typeof ignoreId === "object" && typeof ignoreId.length === "number") {
      var i;
      for (i = 0; i < ignoreId.length; i++) {
        if (ignoreId[i] === id) return true;
      }
      return false;
    }
    return ignoreId === id;
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
      if (idIgnored(state.notes[i].id, ignoreId)) continue;
      consider(noteAbs(state.notes[i]) + state.notes[i].quarters);
    }
    return best;
  }

  function noteIdsEndingAt(abs, ignoreId) {
    var ids = {};
    var i;
    for (i = 0; i < state.notes.length; i++) {
      var note = state.notes[i];
      if (idIgnored(note.id, ignoreId)) continue;
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

  function setStatus() {}

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

  function selectedIds() {
    if (!Array.isArray(state.selected)) return [];
    return state.selected;
  }

  function isSelected(id) {
    id = Number(id);
    var ids = selectedIds();
    var i;
    for (i = 0; i < ids.length; i++) {
      if (ids[i] === id) return true;
    }
    return false;
  }

  function selectedNote() {
    var ids = selectedIds();
    if (!ids.length) return null;
    return findNote(ids[ids.length - 1]);
  }

  function selectedNotes() {
    var out = [];
    var i;
    var ids = selectedIds();
    for (i = 0; i < ids.length; i++) {
      var note = findNote(ids[i]);
      if (note) out.push(note);
    }
    return out;
  }

  function selectOnly(id) {
    state.selected = [Number(id)];
  }

  function addSelected(id) {
    id = Number(id);
    var ids = selectedIds().filter(function (item) {
      return item !== id;
    });
    ids.push(id);
    state.selected = ids;
  }

  function removeSelected(id) {
    id = Number(id);
    state.selected = selectedIds().filter(function (item) {
      return item !== id;
    });
  }

  function pruneSelection() {
    state.selected = selectedIds().filter(function (id) {
      return findNote(id) != null;
    });
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

  function writeAbs(note, abs, nb) {
    if (!(nb > 0)) nb = 4;
    if (!Number.isFinite(abs) || abs < 0) abs = 0;
    var measureIndex = Math.floor((abs + 1e-9) / nb);
    var offset = abs - measureIndex * nb;
    if (offset >= nb - 1e-9) {
      measureIndex += 1;
      offset = 0;
    }
    note.measure = measureIndex + 1;
    note.beat = offset + 1;
    if (note.measure > 64) {
      note.measure = 64;
      note.beat = 1;
    }
  }

  function absTooLate(abs, nb) {
    return abs > 64 * nb - 1e-4;
  }

  function endPastScore(end, nb) {
    return Math.ceil(end / nb - 1e-9) > 64;
  }

  function shiftBlockReason(delta) {
    var nb = beatsPerMeasure();
    var i;
    for (i = 0; i < state.notes.length; i++) {
      var start = noteAbs(state.notes[i]) + delta;
      var end = start + state.notes[i].quarters;
      if (start < -1e-9) return "0拍より前になるので、動かさなかった。";
      if (absTooLate(start, nb) || endPastScore(end, nb)) return "64小節を超えるので、動かさなかった。";
    }
    for (i = 0; i < state.phrases.length; i++) {
      var phrase = state.phrases[i] + delta;
      if (phrase < -1e-9) return "0拍より前になるので、動かさなかった。";
      if (absTooLate(phrase, nb)) return "64小節を超えるので、動かさなかった。";
    }
    if (state.breakAt != null) {
      var mark = state.breakAt + delta;
      if (mark < -1e-9) return "0拍より前になるので、動かさなかった。";
      if (absTooLate(mark, nb)) return "64小節を超えるので、動かさなかった。";
    }
    return "";
  }

  function clampDeltaTime(starts, lengths, ids, dTime, nb) {
    var startCap = 64 * nb - 1e-4;
    var endCap = 64 * nb;
    var minDelta = -Infinity;
    var maxDelta = Infinity;
    var i;
    for (i = 0; i < ids.length; i++) {
      var start = starts[ids[i]];
      var len = lengths[ids[i]];
      if (start == null) continue;
      if (len == null) len = 0;
      if (-start > minDelta) minDelta = -start;
      if (startCap - start < maxDelta) maxDelta = startCap - start;
      if (endCap - (start + len) < maxDelta) maxDelta = endCap - (start + len);
    }
    if (maxDelta < minDelta) return 0;
    if (dTime > maxDelta) dTime = maxDelta;
    if (dTime < minDelta) dTime = minDelta;
    return dTime;
  }

  function clampDeltaMidi(midis, ids, dMidi) {
    var minDelta = -Infinity;
    var maxDelta = Infinity;
    var i;
    for (i = 0; i < ids.length; i++) {
      var midi = midis[ids[i]];
      if (midi == null) continue;
      if (-midi > minDelta) minDelta = -midi;
      if (127 - midi < maxDelta) maxDelta = 127 - midi;
    }
    if (maxDelta < minDelta) return 0;
    if (dMidi > maxDelta) dMidi = maxDelta;
    if (dMidi < minDelta) dMidi = minDelta;
    return dMidi;
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
    state.phrases.forEach(function (abs) {
      var last = Math.ceil((abs + STEP) / nb - 1e-9);
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
    var body = {
      title: state.title || "無題",
      bpm: state.bpm,
      numerator: state.numerator,
      denominator: state.denominator,
      notes: notes
    };
    var phrases = exportedPhrases(qms);
    if (phrases.length) body.phrases = phrases;
    return body;
  }

  function exportedPhrases(qms) {
    var starts = state.phrases.slice().sort(function (a, b) {
      return a - b;
    });
    if (!starts.length) return [];
    var noteEnd = 0;
    var i;
    for (i = 0; i < state.notes.length; i++) {
      var end = noteAbs(state.notes[i]) + state.notes[i].quarters;
      if (end > noteEnd) noteEnd = end;
    }
    var stepMs = round1(STEP * qms);
    if (stepMs <= 0) stepMs = 1;
    return starts.map(function (start, index) {
      var endQ = index + 1 < starts.length ? starts[index + 1] : Math.max(noteEnd, start);
      var startMs = round1(start * qms);
      var endMs = round1(endQ * qms);
      if (endMs <= startMs) endMs = round1(startMs + stepMs);
      return {
        name: "フレーズ" + phraseNumber(index),
        startMs: startMs,
        endMs: endMs
      };
    });
  }

  function togglePhrase(abs) {
    var i;
    for (i = 0; i < state.phrases.length; i++) {
      if (samePhraseTime(state.phrases[i], abs)) {
        state.phrases.splice(i, 1);
        setStatus("");
        return;
      }
    }
    if (state.phrases.length >= PHRASE_MAX) {
      setStatus("フレーズは99まで。");
      return;
    }
    state.phrases.push(abs);
    sortPhrases();
    setStatus("");
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
          extendQuarters: state.extendQuarters,
          breakAt: state.breakAt,
          phrases: state.phrases.slice(),
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

  function sideWidth() {
    return BREAK_WIDTH + PHRASE_WIDTH + NUM_WIDTH;
  }

  function phraseNumber(index) {
    var n = index + 1;
    return (n < 10 ? "0" : "") + n;
  }

  function samePhraseTime(a, b) {
    return Math.abs(a - b) < 1e-4;
  }

  function sortPhrases() {
    state.phrases.sort(function (a, b) {
      return a - b;
    });
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

  function cellFloor(quarters) {
    if (!Number.isFinite(quarters) || quarters < 0) return 0;
    var n = Math.floor(quarters / STEP + 1e-9);
    if (n < 0) n = 0;
    var maxN = Math.round((64 * beatsPerMeasure()) / STEP) - 1;
    if (maxN < 0) maxN = 0;
    if (n > maxN) n = maxN;
    return snap(n * STEP);
  }

  function shownMeasures() {
    var n = state.measures;
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (n < 64) return n + 1;
    return 64;
  }

  function coversCell(midi, abs) {
    var i;
    for (i = 0; i < state.notes.length; i++) {
      var note = state.notes[i];
      if (note.midi !== midi) continue;
      var start = noteAbs(note);
      if (abs < start - 1e-6) continue;
      if (abs < start + note.quarters - 1e-6) return true;
    }
    return false;
  }

  function clampToShown(abs) {
    var max = snap(shownMeasures() * beatsPerMeasure() - STEP);
    if (!(max > 0)) max = 0;
    if (abs > max) return max;
    if (abs < 0) return 0;
    return abs;
  }

  function cellAt(clientX, clientY, outside) {
    var grid = gridEl();
    if (!grid) return null;
    var rect = grid.getBoundingClientRect();
    if (!outside) {
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    }
    var abs = cellFloor(timeFromClientY(clientY));
    if (!outside) abs = clampToShown(abs);
    return { midi: midiFromClientX(clientX), abs: abs };
  }

  function spanOf(origin, current) {
    var low = Math.min(origin, current);
    var high = Math.max(origin, current);
    var quarters = snap(high - low + STEP);
    var start = low;
    var capped = false;
    if (!Number.isFinite(quarters) || quarters < STEP) quarters = STEP;
    if (quarters > 16) {
      capped = true;
      quarters = 16;
      if (current >= origin) start = origin;
      else start = snap(origin + STEP - quarters);
      if (start < 0) start = 0;
    }
    return { start: start, quarters: quarters, capped: capped };
  }

  function hoverBoxes(midi) {
    var box = boxFor(midi);
    if (!box) return [];
    if (box.black) return [{ left: box.left, width: box.width }];
    var cuts = [];
    var i;
    for (i = 0; i < keyBoxes.length; i++) {
      var other = keyBoxes[i];
      if (!other.black) continue;
      var left = other.left > box.left ? other.left : box.left;
      var boxRight = box.left + box.width;
      var otherRight = other.left + other.width;
      var right = otherRight < boxRight ? otherRight : boxRight;
      if (right - left > 0.5) cuts.push({ left: left, right: right });
    }
    if (!cuts.length) return [{ left: box.left, width: box.width }];
    cuts.sort(function (a, b) {
      return a.left - b.left;
    });
    var segments = [];
    var x = box.left;
    var end = box.left + box.width;
    for (i = 0; i < cuts.length; i++) {
      if (cuts[i].left > x + 0.5) segments.push({ left: x, width: cuts[i].left - x });
      if (cuts[i].right > x) x = cuts[i].right;
    }
    if (end > x + 0.5) segments.push({ left: x, width: end - x });
    return segments;
  }

  function paintKeyHover() {
    var spanning = place && Math.abs(place.current - place.origin) > 1e-6;
    var midi = hover && !drag && !spanning ? hover.midi : null;
    Object.keys(keysByMidi).forEach(function (key) {
      keysByMidi[key].classList.toggle("is-roll-hover", Number(key) === midi);
    });
  }

  function paintHover() {
    paintKeyHover();
    var grid = gridEl();
    if (!grid) return;
    var nodes = grid.querySelectorAll(".roll-hover");
    var spanning = place && Math.abs(place.current - place.origin) > 1e-6;
    var show = hover && !drag && !spanning;
    if (!show) {
      nodes.forEach(function (el) {
        el.remove();
      });
      return;
    }
    var segments = hoverBoxes(hover.midi);
    var i;
    if (nodes.length !== segments.length) {
      nodes.forEach(function (el) {
        el.remove();
      });
      nodes = [];
      for (i = 0; i < segments.length; i++) {
        var created = document.createElement("div");
        created.className = "roll-hover";
        created.setAttribute("aria-hidden", "true");
        grid.appendChild(created);
        nodes.push(created);
      }
    }
    for (i = 0; i < segments.length; i++) {
      nodes[i].style.left = segments[i].left + "px";
      nodes[i].style.width = segments[i].width + "px";
      nodes[i].style.bottom = (hover.abs / STEP) * ROW_H + "px";
      nodes[i].style.height = ROW_H + "px";
    }
  }

  function updatePlacePreview() {
    var grid = gridEl();
    if (!grid) return;
    var el = document.getElementById("roll-place");
    if (!place || Math.abs(place.current - place.origin) < 1e-6) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = "roll-place";
      el.className = "roll-place";
      el.setAttribute("aria-hidden", "true");
      grid.appendChild(el);
    }
    var box = boxFor(place.midi);
    var span = spanOf(place.origin, place.current);
    el.style.left = (box ? box.left : 0) + "px";
    el.style.width = (box ? box.width : 22) + "px";
    el.style.bottom = (span.start / STEP) * ROW_H + "px";
    el.style.height = Math.max(ROW_H, (span.quarters / STEP) * ROW_H) + "px";
  }

  function syncOverlays() {
    paintHover();
    updatePlacePreview();
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
    var shown = shownMeasures();
    var rows = Math.max(1, Math.round((shown * nb) / STEP));
    var beatRows = Math.max(1, Math.round((4 / state.denominator) / STEP));
    var rowsPerMeasure = Math.max(1, Math.round(nb / STEP));
    scoreEl.textContent = "";
    var roll = document.createElement("div");
    roll.className = "roll";
    var breakCol = document.createElement("div");
    breakCol.className = "roll-break";
    breakCol.style.width = BREAK_WIDTH + "px";
    breakCol.setAttribute("role", "group");
    breakCol.setAttribute("aria-label", state.breakAt == null ? "再生を始める位置" : "再生を始める位置、" + formatQuarters(state.breakAt) + "拍");
    if (state.breakAt != null) {
      var breakMark = document.createElement("div");
      breakMark.className = "roll-break-mark";
      breakMark.style.bottom = ((state.breakAt / STEP) * ROW_H + (ROW_H - 12) / 2) + "px";
      breakMark.setAttribute("aria-hidden", "true");
      breakCol.appendChild(breakMark);
    }
    var phraseCol = document.createElement("div");
    phraseCol.className = "roll-phrase";
    phraseCol.style.width = PHRASE_WIDTH + "px";
    phraseCol.style.left = BREAK_WIDTH + "px";
    phraseCol.setAttribute("role", "group");
    var phraseLabel = "フレーズの開始";
    if (state.phrases.length) {
      phraseLabel += "。" + state.phrases.map(function (abs, index) {
        return "フレーズ" + phraseNumber(index) + "は" + formatQuarters(abs) + "拍";
      }).join("、");
    }
    phraseCol.setAttribute("aria-label", phraseLabel);
    state.phrases.forEach(function (abs, index) {
      var phraseMark = document.createElement("div");
      phraseMark.className = "roll-phrase-mark";
      phraseMark.style.bottom = ((abs / STEP) * ROW_H + (ROW_H - 16) / 2) + "px";
      phraseMark.textContent = phraseNumber(index);
      phraseMark.setAttribute("aria-hidden", "true");
      phraseCol.appendChild(phraseMark);
    });
    var gutter = document.createElement("div");
    gutter.className = "roll-gutter";
    gutter.style.width = NUM_WIDTH + "px";
    gutter.style.left = (BREAK_WIDTH + PHRASE_WIDTH) + "px";
    gutter.setAttribute("role", "group");
    gutter.setAttribute("aria-label", state.boundary == null ? "境目" : "境目、" + formatQuarters(state.boundary) + "拍");
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
    var eighthRows = Math.max(1, Math.round(0.5 / STEP));
    var halfRows = Math.round(rowsPerMeasure / 2);
    for (i = 1; i <= rows; i++) {
      var onMeasure = i % rowsPerMeasure === 0;
      var onHalf = halfRows > 0 && i % rowsPerMeasure === halfRows;
      var onBeat = i % beatRows === 0;
      var onEighth = i % eighthRows === 0;
      if (!onMeasure && !onHalf && !onBeat && !onEighth) continue;
      var line = document.createElement("div");
      var kind = "";
      if (onMeasure) kind = " is-measure";
      else if (onHalf) kind = " is-half";
      else if (onEighth && !onBeat) kind = " is-eighth";
      line.className = "roll-line" + kind;
      line.style.bottom = i * ROW_H + "px";
      grid.appendChild(line);
    }
    var m;
    for (m = 1; m <= shown; m++) {
      var mark = document.createElement("span");
      mark.className = "roll-measure-no";
      mark.textContent = String(m);
      mark.style.bottom = (((m - 1) * nb) / STEP) * ROW_H + "px";
      gutter.appendChild(mark);
    }
    if (state.boundary != null) {
      var gutterLine = document.createElement("div");
      gutterLine.className = "roll-gutter-boundary";
      gutterLine.style.bottom = (state.boundary / STEP) * ROW_H + "px";
      gutterLine.setAttribute("aria-hidden", "true");
      gutter.appendChild(gutterLine);
      var boundaryLine = document.createElement("div");
      boundaryLine.className = "roll-boundary";
      boundaryLine.style.bottom = (state.boundary / STEP) * ROW_H + "px";
      boundaryLine.setAttribute("aria-hidden", "true");
      grid.appendChild(boundaryLine);
    }
    var snapIds = null;
    if (drag && drag.moved && drag.mode !== "end") {
      var moving = findNote(drag.id);
      if (moving) snapIds = noteIdsEndingAt(noteAbs(moving), drag.ids || drag.id);
    }
    state.notes.forEach(function (note) {
      var noteBox = boxFor(note.midi);
      var abs = noteAbs(note);
      var block = document.createElement("div");
      block.className = "score-note";
      if (noteBox && noteBox.black) block.classList.add("is-black");
      if (isSelected(note.id)) block.classList.add("is-selected");
      if (drag && drag.mode === "move" && drag.ids && drag.ids.indexOf(note.id) >= 0) block.classList.add("is-dragging");
      else if (drag && drag.mode !== "move" && drag.id === note.id) block.classList.add("is-dragging");
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
    roll.appendChild(breakCol);
    roll.appendChild(phraseCol);
    roll.appendChild(gutter);
    roll.appendChild(grid);
    scoreEl.appendChild(roll);
    spacerEl.style.flex = "0 0 " + sideWidth() + "px";
    spacerEl.style.width = sideWidth() + "px";
    if (!viewReady) {
      scoreScroll.scrollTop = scoreScroll.scrollHeight;
      viewReady = true;
    } else {
      var next = scoreScroll.scrollHeight - scoreScroll.clientHeight - stickBottom;
      if (next < 0) next = 0;
      scoreScroll.scrollTop = next;
    }
    matchScrollBar();
    syncOverlays();
  }

  function alignGrid() {
    var width = measureKeys();
    if (!(width > 0)) return;
    var grid = gridEl();
    if (!grid) return;
    grid.style.width = width + "px";
    spacerEl.style.flex = "0 0 " + sideWidth() + "px";
    spacerEl.style.width = sideWidth() + "px";
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
    syncOverlays();
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
    if (lengthInput) {
      if (note) setIfIdle(lengthInput, formatQuarters(note.quarters));
      else lengthInput.value = "";
    }
    if (lengthPreset) lengthPreset.disabled = !note;
    syncLengthPreset(addLengthPreset, state.lengthQuarters);
    syncLengthPreset(extendPreset, state.extendQuarters);
    btnDelete.disabled = selectedIds().length === 0;
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
    var startLabel = playing && playMode === "start" ? "停止" : "最初から";
    var fromLabel = playing && playMode === "from" ? "停止" : "印から";
    btnPlay.setAttribute("aria-label", startLabel);
    btnFrom.setAttribute("aria-label", fromLabel);
    btnPlay.title = startLabel;
    btnFrom.title = fromLabel;
    btnPlay.classList.toggle("is-playing", playing && playMode === "start");
    btnFrom.classList.toggle("is-playing", playing && playMode === "from");
    btnPlay.setAttribute("aria-pressed", playing && playMode === "start" ? "true" : "false");
    btnFrom.setAttribute("aria-pressed", playing && playMode === "from" ? "true" : "false");
    btnPlay.disabled = state.notes.length === 0;
    btnFrom.disabled = state.breakAt == null || state.notes.length === 0;
    var hasSelection = selectedIds().length > 0;
    btnExtend.disabled = !hasSelection;
    btnSetLength.disabled = !hasSelection;
    btnSnapEnd.disabled = !hasSelection || state.notes.length < 2;
    var canShift = state.notes.length > 0 || state.phrases.length > 0 || state.breakAt != null;
    btnShiftEarlier.disabled = !canShift;
    btnShiftLater.disabled = !canShift;
    btnBoundaryAdd.disabled = state.boundary == null;
    btnBoundaryRemove.disabled = state.boundary == null;
    btnMulti.classList.toggle("is-on", state.multi);
    btnMulti.setAttribute("aria-pressed", state.multi ? "true" : "false");
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
    selectOnly(id);
    if (measure > state.measures) state.measures = measure;
    stopPlayback();
    renderAll();
  }

  function placeNote(abs, quarters, midi, capped) {
    if (state.notes.length >= 500) {
      setStatus("音は500まで。");
      renderGrid();
      return;
    }
    var nb = beatsPerMeasure();
    var maxStart = 64 * nb;
    if (!Number.isFinite(abs) || abs < 0) abs = 0;
    if (abs > maxStart) abs = maxStart;
    if (!Number.isFinite(quarters) || quarters < STEP) quarters = STEP;
    if (quarters > 16) {
      quarters = 16;
      capped = true;
    }
    quarters = musicalTime(quarters);
    if (quarters < STEP) quarters = STEP;
    if (quarters > 16) quarters = 16;
    midi = Math.round(Number(midi));
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) midi = state.pitch;
    var id = state.seq++;
    var note = { id: id, midi: midi, measure: 1, beat: 1, quarters: quarters };
    applyAbs(note, abs, nb);
    note.quarters = quarters;
    state.notes.push(note);
    selectOnly(id);
    state.pitch = midi;
    if (note.measure > state.measures) state.measures = note.measure;
    stopPlayback();
    renderAll();
    setStatus(capped ? "長さは16拍まで。" : "");
  }

  function placeAtPointer(clientX, clientY) {
    var cell = cellAt(clientX, clientY, false);
    if (!cell) return;
    var nb = beatsPerMeasure();
    var measure = Math.floor((cell.abs + 1e-6) / nb) + 1;
    if (measure > 64) measure = 64;
    var beat = musicalTime(cell.abs - (measure - 1) * nb + 1);
    if (beat < 1) beat = 1;
    state.pitch = cell.midi;
    setStatus("");
    addNote(measure, beat);
  }

  function removeNote(id) {
    id = Number(id);
    state.notes = state.notes.filter(function (note) {
      return note.id !== id;
    });
    removeSelected(id);
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
    var phraseStarts = [];
    if (Array.isArray(data.phrases)) {
      data.phrases.forEach(function (p) {
        if (!p || typeof p !== "object") return;
        var startMs = Number(p.startMs);
        if (!Number.isFinite(startMs) || startMs < 0) return;
        phraseStarts.push(startMs);
      });
    }
    return {
      title: title,
      bpm: Number(data.bpm),
      numerator: Number(data.numerator),
      denominator: Number(data.denominator),
      notes: notes,
      phraseStarts: phraseStarts
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
    state.selected = [];
    state.boundary = null;
    state.title = data.title;
    var starts = [];
    var maxAbs = snap(64 * nb - STEP);
    if (!(maxAbs > 0)) maxAbs = 0;
    (data.phraseStarts || []).forEach(function (ms) {
      var raw = ms / qms;
      var abs = musicalTime(raw);
      if (!Number.isFinite(abs) || abs < 0) return;
      if (Math.abs(raw - abs) > 0.02) snapped = true;
      if (abs > maxAbs) abs = maxAbs;
      var j;
      for (j = 0; j < starts.length; j++) {
        if (samePhraseTime(starts[j], abs)) return;
      }
      if (starts.length >= PHRASE_MAX) return;
      starts.push(abs);
    });
    starts.sort(function (a, b) {
      return a - b;
    });
    state.phrases = starts;
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
      var ext = musicalTime(data.extendQuarters);
      if (Number.isFinite(ext) && ext >= STEP && ext <= 16) state.extendQuarters = ext;
      if (data.breakAt == null || data.breakAt === "") state.breakAt = null;
      else {
        var br = musicalTime(Number(data.breakAt));
        if (Number.isFinite(br) && br >= 0) state.breakAt = br;
      }
      state.phrases = [];
      if (Array.isArray(data.phrases)) {
        data.phrases.forEach(function (q) {
          var abs = musicalTime(Number(q));
          if (!Number.isFinite(abs) || abs < 0) return;
          var j;
          for (j = 0; j < state.phrases.length; j++) {
            if (samePhraseTime(state.phrases[j], abs)) return;
          }
          if (state.phrases.length >= PHRASE_MAX) return;
          state.phrases.push(abs);
        });
        sortPhrases();
      }
      if (!Array.isArray(data.notes)) return;
      var maxId = 0;
      state.notes = [];
      data.notes.forEach(function (n) {
        if (!n) return;
        var midi = Math.round(Number(n.midi));
        var measure = Math.round(Number(n.measure));
        var beat = Number(n.beat);
        var quarters = Number(n.quarters);
        if (midi < 0 || midi > 127) return;
        if (measure < 1 || measure > 64) return;
        if (!Number.isFinite(beat) || beat < 1) return;
        if (!Number.isFinite(quarters) || quarters < STEP) return;
        if (quarters > 16) quarters = 16;
        var id = Number(n.id);
        if (!Number.isInteger(id) || id < 1) id = state.notes.length + 1;
        if (id > maxId) maxId = id;
        var note = { id: id, midi: midi, measure: measure, beat: beat, quarters: quarters };
        writeAbs(note, (measure - 1) * beatsPerMeasure() + (beat - 1), beatsPerMeasure());
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

  function pointerAdds(e) {
    return state.multi || e.shiftKey || e.ctrlKey || e.metaKey;
  }

  function onScoreDown(e) {
    var noteEl = e.target.closest(".score-note");
    if (!noteEl || !scoreEl.contains(noteEl)) return;
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    var note = findNote(noteEl.dataset.id);
    if (!note) return;
    var edge = e.target.closest("[data-edge]");
    var adds = pointerAdds(e);
    var already = isSelected(note.id);
    var toggleOff = false;
    if (edge) {
      if (already) addSelected(note.id);
      else selectOnly(note.id);
    } else if (adds) {
      if (already) {
        addSelected(note.id);
        toggleOff = true;
      } else addSelected(note.id);
    } else if (!already) {
      selectOnly(note.id);
    } else {
      addSelected(note.id);
    }
    state.pitch = note.midi;
    blockClickUntil = Date.now() + 400;
    syncSelectionFields();
    updatePlayButtons();
    var ids = edge ? [note.id] : selectedIds().slice();
    var starts = {};
    var midis = {};
    var lengths = {};
    var i;
    for (i = 0; i < ids.length; i++) {
      var item = findNote(ids[i]);
      if (!item) continue;
      starts[item.id] = noteAbs(item);
      midis[item.id] = item.midi;
      lengths[item.id] = item.quarters;
    }
    drag = {
      pointerId: e.pointerId,
      mode: edge ? edge.dataset.edge : "move",
      id: note.id,
      ids: ids,
      starts: starts,
      midis: midis,
      lengths: lengths,
      startAbs: noteAbs(note),
      startQuarters: note.quarters,
      grab: timeFromClientY(e.clientY) - noteAbs(note),
      originX: e.clientX,
      originY: e.clientY,
      moved: false,
      toggleOff: !edge && toggleOff,
      plainCollapse: !edge && !adds && already && selectedIds().length > 1
    };
    if (scoreEl.setPointerCapture) scoreEl.setPointerCapture(e.pointerId);
    hover = null;
    stopPlayback();
    renderDrag();
  }

  function onGridDown(e) {
    if (place || drag) return;
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest(".score-note")) return;
    var grid = e.target.closest(".roll-grid");
    if (!grid || !scoreEl.contains(grid)) return;
    var cell = cellAt(e.clientX, e.clientY, false);
    if (!cell) return;
    place = {
      pointerId: e.pointerId,
      midi: cell.midi,
      origin: cell.abs,
      current: cell.abs,
      measures: state.measures
    };
    if (scoreEl.setPointerCapture) scoreEl.setPointerCapture(e.pointerId);
  }

  function releasePlacePointer(e) {
    if (!scoreEl.releasePointerCapture || e.pointerId == null) return;
    try {
      scoreEl.releasePointerCapture(e.pointerId);
    } catch (err) {}
  }

  function restorePlaceMeasures() {
    if (!place) return;
    if (state.measures === place.measures) return;
    state.measures = place.measures;
    measuresInput.value = String(state.measures);
  }

  function onPlaceMove(e) {
    if (!place || e.pointerId !== place.pointerId) return;
    autoScroll(e);
    var cell = cellAt(e.clientX, e.clientY, true);
    if (!cell) return;
    place.current = cell.abs;
    if (Math.abs(place.current - place.origin) < 1e-6) hover = { midi: cell.midi, abs: cell.abs };
    else hover = null;
    var floorMeasures = place.measures;
    var nb = beatsPerMeasure();
    var span = spanOf(place.origin, place.current);
    var need = Math.ceil((span.start + span.quarters) / nb - 1e-9);
    if (need < floorMeasures) need = floorMeasures;
    if (need > 64) need = 64;
    if (need !== state.measures) {
      state.measures = need;
      measuresInput.value = String(need);
      renderGrid();
      return;
    }
    syncOverlays();
  }

  function onPlaceUp(e) {
    if (!place || (e.pointerId != null && e.pointerId !== place.pointerId)) return;
    var moved = Math.abs(place.current - place.origin) > 1e-6;
    var origin = place.origin;
    var current = place.current;
    var midi = place.midi;
    restorePlaceMeasures();
    place = null;
    releasePlacePointer(e);
    blockClickUntil = Date.now() + 400;
    if (!moved) {
      var grid = gridEl();
      var rect = grid ? grid.getBoundingClientRect() : null;
      var inside = rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) {
        renderGrid();
        return;
      }
      placeAtPointer(e.clientX, e.clientY);
      return;
    }
    var span = spanOf(origin, current);
    placeNote(span.start, span.quarters, midi, span.capped);
  }

  function onPlaceCancel(e) {
    if (!place || (e.pointerId != null && e.pointerId !== place.pointerId)) return;
    restorePlaceMeasures();
    place = null;
    releasePlacePointer(e);
    blockClickUntil = Date.now() + 400;
    renderGrid();
  }

  function onHoverMove(e) {
    if (drag || place) return;
    var cell = cellAt(e.clientX, e.clientY, false);
    if (!cell || coversCell(cell.midi, cell.abs)) {
      if (!hover) return;
      hover = null;
      paintHover();
      return;
    }
    if (hover && hover.midi === cell.midi && Math.abs(hover.abs - cell.abs) < 1e-6) return;
    hover = cell;
    paintHover();
  }

  function onScoreMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var note = findNote(drag.id);
    if (!note) return;
    if (Math.abs(e.clientX - drag.originX) > 3 || Math.abs(e.clientY - drag.originY) > 3) drag.moved = true;
    var nb = beatsPerMeasure();
    var abs = timeFromClientY(e.clientY);
    if (drag.mode === "move") {
      var snapped = snapTime(abs - drag.grab, drag.ids, drag.starts[drag.id]);
      var dTime = snapped - drag.starts[drag.id];
      var midi = midiFromClientX(e.clientX);
      var dMidi = midi - drag.midis[drag.id];
      dTime = clampDeltaTime(drag.starts, drag.lengths, drag.ids, dTime, nb);
      dMidi = clampDeltaMidi(drag.midis, drag.ids, dMidi);
      var k;
      for (k = 0; k < drag.ids.length; k++) {
        var item = findNote(drag.ids[k]);
        if (!item) continue;
        writeAbs(item, drag.starts[item.id] + dTime, nb);
        item.midi = drag.midis[item.id] + dMidi;
      }
      var primary = findNote(drag.id);
      if (primary) state.pitch = primary.midi;
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
    var info = drag;
    drag = null;
    if (scoreEl.releasePointerCapture) {
      try {
        scoreEl.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
    if (!info.moved && info.toggleOff) removeSelected(info.id);
    else if (!info.moved && info.plainCollapse) selectOnly(info.id);
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

  function syncLengthPreset(select, quarters) {
    var value = formatQuarters(quarters);
    var match = "";
    var i;
    for (i = 0; i < select.options.length; i++) {
      if (select.options[i].value === value) {
        match = value;
        break;
      }
    }
    if (select.value !== match) select.value = match;
  }

  function applyPreset(select, input, commit) {
    var raw = select.value;
    if (raw === "") return;
    if (select !== addLengthPreset && select !== extendPreset) select.value = "";
    input.value = raw;
    commit();
  }

  function setSelectedLength() {
    var notes = selectedNotes();
    if (!notes.length) return;
    var quarters = state.extendQuarters;
    if (quarters > 16) quarters = 16;
    if (quarters < STEP) quarters = STEP;
    var i;
    for (i = 0; i < notes.length; i++) notes[i].quarters = quarters;
    stopPlayback();
    renderAll();
    setStatus(lengthName(quarters) + "にした。");
  }

  function extendSelected() {
    var notes = selectedNotes();
    if (!notes.length) return;
    var i;
    var last = null;
    for (i = 0; i < notes.length; i++) {
      var quarters = musicalTime(notes[i].quarters + state.extendQuarters);
      if (quarters > 16) quarters = 16;
      if (quarters < STEP) quarters = STEP;
      notes[i].quarters = quarters;
      last = quarters;
    }
    stopPlayback();
    renderAll();
    if (notes.length === 1) setStatus(lengthName(state.extendQuarters) + "を足して、" + formatQuarters(last) + "拍。");
    else setStatus(lengthName(state.extendQuarters) + "を、選んだ音に足した。");
  }

  function snapSelectionToEnd() {
    var notes = selectedNotes();
    if (!notes.length) return;
    var nb = beatsPerMeasure();
    var targets = [];
    var i;
    for (i = 0; i < notes.length; i++) {
      var best = null;
      var j;
      for (j = 0; j < state.notes.length; j++) {
        if (state.notes[j].id === notes[i].id) continue;
        var end = noteAbs(state.notes[j]) + state.notes[j].quarters;
        if (best == null || end > best) best = end;
      }
      targets.push(best);
    }
    for (i = 0; i < notes.length; i++) {
      if (targets[i] == null) continue;
      var at = targets[i];
      if (at < 0) at = 0;
      if (absTooLate(at, nb) || endPastScore(at + notes[i].quarters, nb)) {
        setStatus("64小節を超えるので、動かさなかった。");
        return;
      }
    }
    var any = false;
    for (i = 0; i < notes.length; i++) {
      if (targets[i] == null) continue;
      var next = targets[i];
      if (next < 0) next = 0;
      writeAbs(notes[i], next, nb);
      any = true;
    }
    if (!any) {
      setStatus("合わせる音がない。");
      return;
    }
    stopPlayback();
    renderAll();
    setStatus("いちばん遅い音の終わりに合わせた。");
  }

  function hasTimeline() {
    return state.notes.length > 0 || state.phrases.length > 0 || state.breakAt != null;
  }

  function shiftAll(delta) {
    if (!hasTimeline()) return;
    var reason = shiftBlockReason(delta);
    if (reason) {
      setStatus(reason);
      return;
    }
    var nb = beatsPerMeasure();
    var i;
    for (i = 0; i < state.notes.length; i++) {
      writeAbs(state.notes[i], noteAbs(state.notes[i]) + delta, nb);
    }
    for (i = 0; i < state.phrases.length; i++) state.phrases[i] += delta;
    if (state.breakAt != null) state.breakAt += delta;
    stopPlayback();
    renderAll();
    setStatus(delta < 0 ? "音とフレーズと印を、32分音符1つ分早くした。" : "音とフレーズと印を、32分音符1つ分遅くした。");
  }

  function boundaryHasWork(cut) {
    var i;
    for (i = 0; i < state.notes.length; i++) {
      if (noteAbs(state.notes[i]) + state.notes[i].quarters > cut + 1e-4) return true;
    }
    for (i = 0; i < state.phrases.length; i++) {
      if (state.phrases[i] >= cut - 1e-4) return true;
    }
    return state.breakAt != null && state.breakAt >= cut - 1e-4;
  }

  function uniquePhrases(list) {
    var out = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var abs = list[i];
      var j;
      var found = false;
      for (j = 0; j < out.length; j++) {
        if (samePhraseTime(out[j], abs)) {
          found = true;
          break;
        }
      }
      if (found) continue;
      if (out.length >= PHRASE_MAX) break;
      out.push(abs);
    }
    out.sort(function (a, b) {
      return a - b;
    });
    return out;
  }

  function insertAtBoundary() {
    if (state.boundary == null) return;
    var cut = state.boundary;
    var nb = beatsPerMeasure();
    if (!boundaryHasWork(cut)) {
      setStatus("この境目より後に、動かす音がない。");
      return;
    }
    var i;
    for (i = 0; i < state.notes.length; i++) {
      var note = state.notes[i];
      var start = noteAbs(note);
      var end = start + note.quarters;
      if (end <= cut + 1e-4) continue;
      if (start >= cut - 1e-4) {
        if (absTooLate(start + STEP, nb) || endPastScore(end + STEP, nb)) {
          setStatus("64小節を超えるので、動かさなかった。");
          return;
        }
      } else if (note.quarters + STEP > 16 + 1e-9) {
        setStatus("長さは16拍まで。");
        return;
      } else if (endPastScore(end + STEP, nb)) {
        setStatus("64小節を超えるので、動かさなかった。");
        return;
      }
    }
    for (i = 0; i < state.phrases.length; i++) {
      if (state.phrases[i] < cut - 1e-4) continue;
      if (absTooLate(state.phrases[i] + STEP, nb)) {
        setStatus("64小節を超えるので、動かさなかった。");
        return;
      }
    }
    if (state.breakAt != null && state.breakAt >= cut - 1e-4 && absTooLate(state.breakAt + STEP, nb)) {
      setStatus("64小節を超えるので、動かさなかった。");
      return;
    }
    for (i = 0; i < state.notes.length; i++) {
      var item = state.notes[i];
      var itemStart = noteAbs(item);
      var itemEnd = itemStart + item.quarters;
      if (itemEnd <= cut + 1e-4) continue;
      if (itemStart >= cut - 1e-4) writeAbs(item, itemStart + STEP, nb);
      else item.quarters += STEP;
    }
    for (i = 0; i < state.phrases.length; i++) {
      if (state.phrases[i] >= cut - 1e-4) state.phrases[i] += STEP;
    }
    if (state.breakAt != null && state.breakAt >= cut - 1e-4) state.breakAt += STEP;
    stopPlayback();
    renderAll();
    setStatus("境目より後を、32分音符1つ分遅くした。");
  }

  function deleteAtBoundary() {
    if (state.boundary == null) return;
    var cut = state.boundary;
    var sliceEnd = cut + STEP;
    var nb = beatsPerMeasure();
    if (!boundaryHasWork(cut)) {
      setStatus("この境目より後に、動かす音がない。");
      return;
    }
    var kept = [];
    var removed = 0;
    var i;
    for (i = 0; i < state.notes.length; i++) {
      var note = state.notes[i];
      var start = noteAbs(note);
      var end = start + note.quarters;
      if (end <= cut + 1e-4) {
        kept.push(note);
        continue;
      }
      if (start >= sliceEnd - 1e-4) {
        writeAbs(note, start - STEP, nb);
        kept.push(note);
        continue;
      }
      if (start < cut - 1e-4 && end > sliceEnd + 1e-4) {
        var span = note.quarters - STEP;
        if (span < STEP - 1e-4) {
          removed += 1;
          continue;
        }
        note.quarters = span;
        kept.push(note);
        continue;
      }
      if (start >= cut - 1e-4 && start < sliceEnd - 1e-4 && end > sliceEnd + 1e-4) {
        var rest = end - sliceEnd;
        if (rest < STEP - 1e-4) {
          removed += 1;
          continue;
        }
        writeAbs(note, cut, nb);
        note.quarters = rest;
        kept.push(note);
        continue;
      }
      if (start < cut - 1e-4 && end > cut + 1e-4) {
        var head = cut - start;
        if (head < STEP - 1e-4) {
          removed += 1;
          continue;
        }
        note.quarters = head;
        kept.push(note);
        continue;
      }
      removed += 1;
    }
    state.notes = kept;
    var phrases = [];
    for (i = 0; i < state.phrases.length; i++) {
      var abs = state.phrases[i];
      if (abs >= sliceEnd - 1e-4) phrases.push(abs - STEP);
      else if (abs >= cut - 1e-4) phrases.push(cut);
      else phrases.push(abs);
    }
    state.phrases = uniquePhrases(phrases);
    if (state.breakAt != null) {
      if (state.breakAt >= sliceEnd - 1e-4) state.breakAt -= STEP;
      else if (state.breakAt >= cut - 1e-4) state.breakAt = cut;
    }
    pruneSelection();
    stopPlayback();
    renderAll();
    if (removed) setStatus("32分音符より短くなった音を消した。");
    else setStatus("境目より後を、32分音符1つ分早くした。");
  }

  function onGutterDown(e) {
    var gutter = e.target.closest(".roll-gutter");
    if (!gutter || !scoreEl.contains(gutter)) return;
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    var abs = clampToShown(cellFloor(timeFromClientY(e.clientY)));
    if (state.boundary != null && Math.abs(state.boundary - abs) < 1e-4) state.boundary = null;
    else state.boundary = abs;
    stopPlayback();
    renderGrid();
    updatePlayButtons();
    setStatus("");
  }

  function copySelectedNotes() {
    var notes = selectedNotes();
    if (!notes.length) return;
    var origin = noteAbs(notes[0]);
    var i;
    for (i = 1; i < notes.length; i++) {
      var abs = noteAbs(notes[i]);
      if (abs < origin) origin = abs;
    }
    copiedNotes = [];
    for (i = 0; i < notes.length; i++) {
      copiedNotes.push({
        midi: notes[i].midi,
        offset: noteAbs(notes[i]) - origin,
        quarters: notes[i].quarters
      });
    }
    setStatus(copiedNotes.length + "音をコピーした。");
  }

  function pasteCopiedNotes() {
    if (state.boundary == null) {
      setStatus("境目が選ばれていない。");
      return;
    }
    if (!copiedNotes || !copiedNotes.length) {
      setStatus("コピーした音がない。");
      return;
    }
    if (state.notes.length + copiedNotes.length > 500) {
      setStatus("音は500まで。");
      return;
    }
    var nb = beatsPerMeasure();
    var origin = state.boundary;
    var i;
    for (i = 0; i < copiedNotes.length; i++) {
      var start = origin + copiedNotes[i].offset;
      var end = start + copiedNotes[i].quarters;
      if (start < -1e-9) {
        setStatus("0拍より前になるので、動かさなかった。");
        return;
      }
      if (absTooLate(start, nb) || endPastScore(end, nb)) {
        setStatus("64小節を超えるので、動かさなかった。");
        return;
      }
    }
    var ids = [];
    for (i = 0; i < copiedNotes.length; i++) {
      var at = origin + copiedNotes[i].offset;
      var id = state.seq++;
      var note = {
        id: id,
        midi: copiedNotes[i].midi,
        measure: 1,
        beat: 1,
        quarters: copiedNotes[i].quarters
      };
      writeAbs(note, at, nb);
      state.notes.push(note);
      ids.push(id);
    }
    state.selected = ids;
    var last = findNote(ids[ids.length - 1]);
    if (last) state.pitch = last.midi;
    stopPlayback();
    renderAll();
    setStatus(ids.length + "音を、境目から置いた。");
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
  denominatorInput.addEventListener("input", onMeterInput);
  denominatorInput.addEventListener("change", function () {
    var denominator = Number(denominatorInput.value);
    if (!DENOMS[denominator]) {
      denominatorInput.value = String(state.denominator);
      setStatus("拍子の分母は2、4、8、16。");
    }
  });

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

  if (midiInput) midiInput.addEventListener("change", commitMidi);
  if (lengthInput) lengthInput.addEventListener("change", commitSelectedLength);
  if (addLengthInput) addLengthInput.addEventListener("change", commitAddLength);

  btnDelete.addEventListener("click", function () {
    if (!selectedIds().length) return;
    var drop = {};
    var ids = selectedIds();
    var i;
    for (i = 0; i < ids.length; i++) drop[ids[i]] = true;
    state.notes = state.notes.filter(function (note) {
      return !drop[note.id];
    });
    state.selected = [];
    stopPlayback();
    renderAll();
  });

  if (lengthPreset) {
    lengthPreset.addEventListener("change", function () {
      applyPreset(lengthPreset, lengthInput, commitSelectedLength);
    });
  }
  addLengthPreset.addEventListener("change", function () {
    var raw = addLengthPreset.value;
    if (raw === "") {
      syncLengthPreset(addLengthPreset, state.lengthQuarters);
      return;
    }
    var quarters = musicalTime(raw);
    if (!Number.isFinite(quarters) || quarters < STEP || quarters > 16) {
      syncLengthPreset(addLengthPreset, state.lengthQuarters);
      setStatus("長さは32分音符（0.125拍）から16拍まで。");
      return;
    }
    state.lengthQuarters = quarters;
    syncLengthPreset(addLengthPreset, state.lengthQuarters);
    setStatus("");
    saveStore();
  });
  extendPreset.addEventListener("change", commitExtendLength);

  btnSetLength.addEventListener("click", setSelectedLength);
  btnExtend.addEventListener("click", extendSelected);
  btnSnapEnd.addEventListener("click", snapSelectionToEnd);
  btnShiftEarlier.addEventListener("click", function () {
    shiftAll(-STEP);
  });
  btnShiftLater.addEventListener("click", function () {
    shiftAll(STEP);
  });
  btnBoundaryAdd.addEventListener("click", insertAtBoundary);
  btnBoundaryRemove.addEventListener("click", deleteAtBoundary);
  btnMulti.addEventListener("click", function () {
    state.multi = !state.multi;
    updatePlayButtons();
  });

  scoreEl.addEventListener("pointerdown", onScoreDown);
  scoreEl.addEventListener("pointerdown", onGridDown);
  scoreEl.addEventListener("pointerdown", onBreakDown);
  scoreEl.addEventListener("pointerdown", onPhraseDown);
  scoreEl.addEventListener("pointerdown", onGutterDown);
  window.addEventListener("pointermove", onScoreMove);
  window.addEventListener("pointermove", onPlaceMove);
  window.addEventListener("pointermove", onHoverMove);
  window.addEventListener("pointerup", onScoreUp);
  window.addEventListener("pointerup", onPlaceUp);
  window.addEventListener("pointercancel", onScoreUp);
  window.addEventListener("pointercancel", onPlaceCancel);

  scoreEl.addEventListener("click", function (e) {
    if (Date.now() < blockClickUntil) {
      e.preventDefault();
      return;
    }
    if (e.target.closest(".score-note")) return;
    if (!e.target.closest(".roll-grid")) return;
    placeAtPointer(e.clientX, e.clientY);
  });

  btnPlay.addEventListener("click", function () {
    if (playing && playMode === "start") stopPlayback();
    else playMelody(0, "start");
  });

  function onPhraseDown(e) {
    var col = e.target.closest(".roll-phrase");
    if (!col || !scoreEl.contains(col)) return;
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    var abs = clampToShown(cellFloor(timeFromClientY(e.clientY)));
    togglePhrase(abs);
    stopPlayback();
    renderAll();
  }

  function onBreakDown(e) {
    var col = e.target.closest(".roll-break");
    if (!col || !scoreEl.contains(col)) return;
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    var abs = clampToShown(cellFloor(timeFromClientY(e.clientY)));
    if (state.breakAt != null && Math.abs(state.breakAt - abs) < 1e-6) state.breakAt = null;
    else state.breakAt = abs;
    stopPlayback();
    saveStore();
    renderGrid();
    updatePlayButtons();
  }

  function commitExtendLength() {
    var raw = extendPreset.value;
    if (raw === "") {
      syncLengthPreset(extendPreset, state.extendQuarters);
      return;
    }
    var quarters = musicalTime(raw);
    if (!Number.isFinite(quarters) || quarters < STEP || quarters > 16) {
      syncLengthPreset(extendPreset, state.extendQuarters);
      setStatus("長さは32分音符（0.125拍）から16拍まで。");
      return;
    }
    state.extendQuarters = quarters;
    syncLengthPreset(extendPreset, state.extendQuarters);
    setStatus("");
    saveStore();
  }

  btnFrom.addEventListener("click", function () {
    if (playing && playMode === "from") stopPlayback();
    else {
      if (state.breakAt == null) return;
      var fromMs = state.breakAt * quarterMs();
      var has = false;
      var i;
      for (i = 0; i < state.notes.length; i++) {
        if (noteAbs(state.notes[i]) * quarterMs() + 0.05 >= fromMs) {
          has = true;
          break;
        }
      }
      if (!has) {
        setStatus("印より後に、始まる音がない。");
        return;
      }
      setStatus("");
      scrollTimeIntoView(state.breakAt);
      playMelody(fromMs, "from");
    }
  });

  if (btnApply) {
    btnApply.addEventListener("click", function () {
      try {
        readEditorJson();
      } catch (err) {
        setStatus("JSONが読めない。" + (err && err.message ? err.message : ""));
      }
    });
  }

  function downloadJson() {
    var blob = new Blob([melodyText()], { type: "application/json" });
    var a = document.createElement("a");
    var name = (state.title || "melody").replace(/[\\/:*?"<>|]/g, "_");
    a.href = URL.createObjectURL(blob);
    a.download = name + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function melodyText() {
    return JSON.stringify(playbackObject(), null, 2);
  }

  function isFresh() {
    if (state.notes.length) return false;
    if (state.phrases.length) return false;
    if ((state.title || "無題") !== "無題") return false;
    if (state.bpm !== 120 || state.numerator !== 4 || state.denominator !== 4) return false;
    if (state.measures !== 4) return false;
    return jsonArea.value === melodyText();
  }

  function resetDocument(message) {
    stopPlayback();
    state.title = "無題";
    state.bpm = 120;
    state.numerator = 4;
    state.denominator = 4;
    state.measures = 4;
    state.pitch = 60;
    state.lengthQuarters = 0.5;
    state.extendQuarters = 1 / 6;
    state.breakAt = null;
    state.phrases = [];
    state.notes = [];
    state.selected = [];
    state.boundary = null;
    state.seq = 1;
    viewReady = false;
    syncForm();
    renderAll();
    setStatus(message);
  }

  function openNewDialog() {
    newReturnFocus = document.activeElement;
    newBackdrop.hidden = false;
    btnNewSave.focus();
  }

  function closeNewDialog() {
    if (newBackdrop.hidden) return;
    newBackdrop.hidden = true;
    var back = newReturnFocus;
    newReturnFocus = null;
    if (back && back.focus) back.focus();
  }

  btnSave.addEventListener("click", downloadJson);

  btnNew.addEventListener("click", function () {
    if (isFresh()) setStatus("無題で、音はない。");
    else openNewDialog();
  });

  btnNewSave.addEventListener("click", function () {
    downloadJson();
    closeNewDialog();
    resetDocument("JSONを保存し、無題にして、音とフレーズを消した。");
  });

  btnNewDiscard.addEventListener("click", function () {
    closeNewDialog();
    resetDocument("保存せず、無題にして、音とフレーズを消した。");
  });

  btnNewCancel.addEventListener("click", closeNewDialog);

  newBackdrop.addEventListener("click", function (e) {
    if (e.target === newBackdrop) closeNewDialog();
  });

  document.addEventListener("keydown", function (e) {
    if (newBackdrop.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeNewDialog();
      return;
    }
    if (e.key !== "Tab") return;
    var buttons = newDialog.querySelectorAll("button");
    if (!buttons.length) return;
    var first = buttons[0];
    var last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  btnCopy.addEventListener("click", function () {
    var text = melodyText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          setStatus("JSONをコピーした。");
        },
        function () {
          setStatus("コピーできない。");
        }
      );
      return;
    }
    setStatus("コピーできない。");
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
    if (!newBackdrop.hidden) return;
    if (e.isComposing) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    var key = String(e.key || "").toLowerCase();
    var command = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    if (command && key === "c") {
      if (!selectedIds().length) return;
      e.preventDefault();
      copySelectedNotes();
      return;
    }
    if (command && key === "v") {
      e.preventDefault();
      if (e.repeat) return;
      pasteCopiedNotes();
      return;
    }
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (!selectedIds().length) return;
    e.preventDefault();
    btnDelete.click();
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
