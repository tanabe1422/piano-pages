(function (root) {
  var THRESHOLD = 0.15;
  var MIN_HZ = 80;
  var MAX_HZ = 1000;
  var RMS_GATE = 0.012;

  function rms(samples) {
    var sum = 0;
    var i;
    for (i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  function pitch(samples, sampleRate, opts) {
    opts = opts || {};
    var minHz = opts.minHz != null ? opts.minHz : MIN_HZ;
    var maxHz = opts.maxHz != null ? opts.maxHz : MAX_HZ;
    var rmsGate = opts.rmsGate != null ? opts.rmsGate : RMS_GATE;
    if (rms(samples) < rmsGate) return { hz: 0, prob: 0 };

    var n = samples.length;
    var tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
    var tauMax = Math.min(n - 2, Math.floor(sampleRate / minHz));
    if (tauMax <= tauMin) return { hz: 0, prob: 0 };

    var d = new Float32Array(tauMax + 1);
    var tau;
    var j;
    var sum;
    var delta;
    for (tau = 1; tau <= tauMax; tau++) {
      sum = 0;
      for (j = 0; j < n - tau; j++) {
        delta = samples[j] - samples[j + tau];
        sum += delta * delta;
      }
      d[tau] = sum;
    }

    var running = 0;
    var cmnd = new Float32Array(tauMax + 1);
    cmnd[0] = 1;
    for (tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      cmnd[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
    }

    var best = 0;
    for (tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < THRESHOLD) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau += 1;
        best = tau;
        break;
      }
    }

    if (!best) {
      var minVal = 1;
      for (tau = tauMin; tau <= tauMax; tau++) {
        if (cmnd[tau] < minVal) {
          minVal = cmnd[tau];
          best = tau;
        }
      }
      if (minVal > 0.28) return { hz: 0, prob: 0 };
    }

    var better = best;
    if (best > 1 && best < tauMax) {
      var s0 = cmnd[best - 1];
      var s1 = cmnd[best];
      var s2 = cmnd[best + 1];
      var denom = 2 * (2 * s1 - s2 - s0);
      if (denom !== 0) better = best + (s2 - s0) / denom;
    }
    if (better <= 0) return { hz: 0, prob: 0 };

    var hz = sampleRate / better;
    var prob = 1 - cmnd[best];
    if (hz < minHz || hz > maxHz || prob < 0.2) return { hz: 0, prob: 0 };
    return { hz: hz, prob: prob };
  }

  function framesToNotes(frames, hopMs, opts) {
    opts = opts || {};
    var minDur = opts.minDurationMs || 80;
    var minProb = opts.minProb || 0.42;
    var stable = opts.stableFrames || 2;
    var notes = [];
    var cur = null;
    var pendingMidi = null;
    var pendingCount = 0;

    function close(endMs) {
      if (!cur) return;
      cur.durationMs = endMs - cur.startMs;
      if (cur.durationMs >= minDur) notes.push(cur);
      cur = null;
    }

    frames.forEach(function (frame, i) {
      var t = i * hopMs;
      var midi = null;
      if (frame.hz > 0 && frame.prob >= minProb) {
        midi = Math.round(69 + 12 * Math.log(frame.hz / 440) / Math.log(2));
        if (midi < 0 || midi > 127) midi = null;
      }

      if (midi == null) {
        pendingMidi = null;
        pendingCount = 0;
        close(t);
        return;
      }

      if (cur && midi === cur.midi) {
        pendingMidi = null;
        pendingCount = 0;
        return;
      }

      if (pendingMidi === midi) pendingCount += 1;
      else {
        pendingMidi = midi;
        pendingCount = 1;
      }

      if (pendingCount < stable) return;

      var startMs = t - (stable - 1) * hopMs;
      if (startMs < 0) startMs = 0;
      close(startMs);
      cur = { midi: midi, startMs: startMs, durationMs: 0 };
      pendingMidi = null;
      pendingCount = 0;
    });

    close(frames.length * hopMs);
    return notes;
  }

  root.PianoPitch = {
    pitch: pitch,
    framesToNotes: framesToNotes,
    MIN_HZ: MIN_HZ,
    MAX_HZ: MAX_HZ
  };
})(window);
