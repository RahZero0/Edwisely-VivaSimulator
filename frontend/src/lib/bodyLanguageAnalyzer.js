let analyzer = null;

export async function initBodyLanguageAnalyzer(videoElement) {
  analyzer = createMockAnalyzer(videoElement);
  return analyzer;
}

export function startBodyLanguageTracking() {
  analyzer?.start();
}

export function stopBodyLanguageTracking() {
  analyzer?.stop();
}

export function getCurrentBodyLanguageSnapshot() {
  return analyzer?.snapshot() || emptySnapshot();
}

export function getBodyLanguageSummary() {
  return analyzer?.summary() || emptySnapshot();
}

export function disposeBodyLanguageAnalyzer() {
  analyzer?.dispose();
  analyzer = null;
}

function createMockAnalyzer(video) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let timer = null;
  let previousBrightness = null;
  let calibration = null;
  const state = {
    startedAt: null,
    samples: 0,
    faceVisible: 0,
    attention: 0,
    posture: 0,
    stabilityTotal: 0,
    lookedAwayEvents: 0,
    faceMissingEvents: 0,
    slouchingEvents: 0,
    current: emptySnapshot(),
    streaks: {
      missing: 0,
      away: 0,
      posture: 0,
    },
  };

  function start() {
    if (timer) return;
    state.startedAt = Date.now();
    timer = window.setInterval(sample, 1000);
    sample();
  }

  function stop() {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function dispose() {
    stop();
    previousBrightness = null;
  }

  function calibrate() {
    const frame = readFrame();
    calibration = frame ? { brightness: frame.brightness } : null;
  }

  function sample() {
    const frame = readFrame();
    if (!frame) {
      update(false, false, false, 40);
      return;
    }

    const movement = previousBrightness == null ? 0 : Math.abs(frame.brightness - previousBrightness);
    previousBrightness = frame.brightness;

    const faceVisible = frame.brightness > 18 && frame.contrast > 8;
    const stable = Math.max(0, Math.min(100, 100 - movement * 4));
    const postureOkay = calibration
      ? Math.abs(frame.brightness - calibration.brightness) < 45 && stable > 45
      : stable > 35;
    const facingCamera = faceVisible && stable > 35;
    update(faceVisible, facingCamera, postureOkay, stable);
  }

  function readFrame() {
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight || !context) {
      return null;
    }

    canvas.width = 96;
    canvas.height = 72;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0;
    let min = 255;
    let max = 0;
    for (let index = 0; index < data.length; index += 16) {
      const brightness = (data[index] + data[index + 1] + data[index + 2]) / 3;
      total += brightness;
      min = Math.min(min, brightness);
      max = Math.max(max, brightness);
    }
    const samples = data.length / 16;
    return { brightness: total / samples, contrast: max - min };
  }

  function update(faceVisible, facingCamera, postureOkay, stability) {
    state.samples += 1;
    state.faceVisible += faceVisible ? 1 : 0;
    state.attention += facingCamera ? 1 : 0;
    state.posture += postureOkay ? 1 : 0;
    state.stabilityTotal += stability;

    state.streaks.missing = faceVisible ? 0 : state.streaks.missing + 1;
    state.streaks.away = facingCamera ? 0 : state.streaks.away + 1;
    state.streaks.posture = postureOkay ? 0 : state.streaks.posture + 1;
    if (state.streaks.missing === 3) state.faceMissingEvents += 1;
    if (state.streaks.away === 3) state.lookedAwayEvents += 1;
    if (state.streaks.posture === 5) state.slouchingEvents += 1;

    state.current = makeSnapshot(faceVisible, facingCamera, postureOkay, stability);
  }

  function makeSnapshot(faceVisible, facingCamera, postureOkay, stability) {
    const summary = buildSummary();
    return {
      ...summary,
      faceVisible,
      facingCamera,
      postureOkay,
      movementStabilityScore: Math.round(stability),
    };
  }

  function buildSummary() {
    const samples = Math.max(state.samples, 1);
    const faceVisiblePercent = Math.round((state.faceVisible / samples) * 100);
    const cameraAttentionPercent = Math.round((state.attention / samples) * 100);
    const postureScore = Math.round((state.posture / samples) * 100);
    const movementStabilityScore = Math.round(state.stabilityTotal / samples);
    const communicationScore = Math.round(
      (faceVisiblePercent * 0.35 + cameraAttentionPercent * 0.3 + postureScore * 0.2 + movementStabilityScore * 0.15) / 10,
    ) / 2;

    return {
      faceVisiblePercent,
      cameraAttentionPercent,
      postureScore,
      movementStabilityScore,
      communicationScore,
      lookedAwayEvents: state.lookedAwayEvents,
      faceMissingEvents: state.faceMissingEvents,
      slouchingEvents: state.slouchingEvents,
      totalTrackedSeconds: state.samples,
      events: buildEvents(),
      feedback: buildFeedback(faceVisiblePercent, cameraAttentionPercent, postureScore, movementStabilityScore),
    };
  }

  function buildEvents() {
    const events = [];
    if (state.lookedAwayEvents) events.push({ type: "looked_away", count: state.lookedAwayEvents });
    if (state.faceMissingEvents) events.push({ type: "face_not_visible", count: state.faceMissingEvents });
    if (state.slouchingEvents) events.push({ type: "posture_could_improve", count: state.slouchingEvents });
    return events;
  }

  return {
    start,
    stop,
    dispose,
    calibrate,
    snapshot: () => state.current,
    summary: buildSummary,
  };
}

function buildFeedback(faceVisiblePercent, cameraAttentionPercent, postureScore, movementStabilityScore) {
  const feedback = [];
  feedback.push(faceVisiblePercent >= 80 ? "You were visible most of the time." : "Try to keep your face visible while answering.");
  feedback.push(cameraAttentionPercent >= 70 ? "You faced the camera consistently." : "Try to face the camera more while explaining.");
  feedback.push(postureScore >= 70 ? "Your posture looked steady." : "Your posture could be more upright and centered.");
  feedback.push(movementStabilityScore >= 70 ? "Your delivery was visually stable." : "Try to reduce large movements while answering.");
  return feedback;
}

function emptySnapshot() {
  return {
    faceVisible: false,
    facingCamera: false,
    postureOkay: false,
    faceVisiblePercent: 0,
    cameraAttentionPercent: 0,
    postureScore: 0,
    movementStabilityScore: 0,
    communicationScore: 0,
    lookedAwayEvents: 0,
    faceMissingEvents: 0,
    slouchingEvents: 0,
    totalTrackedSeconds: 0,
    events: [],
    feedback: [],
  };
}
