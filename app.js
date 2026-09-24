const STORAGE_KEY = "lapManagerStateV3";
const RACE_RECORDS_KEY = "lapManagerRaceRecordsV1";
const LEGACY_STORAGE_KEY = "lapManagerMvpState";
const LONG_PRESS_MS = 650;
const TAIL_TARGET_COUNT = 5;
const MAX_HISTORY = 1000;
const MAX_RACE_RECORDS = 200;
const MAX_PARTICIPANTS = 50;
// Legacy double-tap guard is preserved but currently disabled by specification.
const TAP_LOCK_ENABLED = false;
const TAP_LOCK_MS = 45000;
const LONG_BELL_SRC = "sounds/bell-long.wav";
const SHORT_BELL_SRC = "sounds/bell-short-tail-3s.wav";
const TAP_SOUND_SRC = "sounds/tap-soft.wav";

const DEFAULT_LAPS_BY_DISTANCE = {
  "10000m": 25,
  "5000m": 13,
  "5000mW": 13,
  "3000m": 8,
  "3000mW": 8,
  "3000mSC": 7,
};

let raceState = createDefaultRaceState();
let runners = [];
let tailInputMode = false;
let selectedRunnerNumber = null;
let toastTimer = null;
let saveTimer = null;
let stepperRepeatTimer = null;
let stepperRepeatDelayTimer = null;
let tapLockRenderTimer = null;
let longBellAudio = null;
let shortBellAudio = null;
let tapAudio = null;
let tapAudioContext = null;

const elements = {
  globalLap: document.getElementById("globalLap"),
  globalLapButton: document.getElementById("globalLapButton"),
  eventName: document.getElementById("eventName"),
  raceName: document.getElementById("raceName"),
  runnerRows: document.getElementById("runnerRows"),
  settingsButton: document.getElementById("settingsButton"),
  fullscreenButton: document.getElementById("fullscreenButton"),
  bulkPassButton: document.getElementById("bulkPassButton"),
  undoButton: document.getElementById("undoButton"),
  addRunnerButton: document.getElementById("addRunnerButton"),
  displayModeButton: document.getElementById("displayModeButton"),
  displayModeMain: document.getElementById("displayModeMain"),
  displayModeSub: document.getElementById("displayModeSub"),
  bellButton: document.getElementById("bellButton"),
  bellMain: document.getElementById("bellMain"),
  bellSub: document.getElementById("bellSub"),
  saveRecordButton: document.getElementById("saveRecordButton"),
  recordsButton: document.getElementById("recordsButton"),
  tailModeBanner: document.getElementById("tailModeBanner"),
  tailModeCount: document.getElementById("tailModeCount"),
  cancelTailModeButton: document.getElementById("cancelTailModeButton"),
  toast: document.getElementById("toast"),
  settingsDialog: document.getElementById("settingsDialog"),
  settingsForm: document.getElementById("settingsForm"),
  cancelSettingsButton: document.getElementById("cancelSettingsButton"),
  restoreDialog: document.getElementById("restoreDialog"),
  restoreButton: document.getElementById("restoreButton"),
  discardRestoreButton: document.getElementById("discardRestoreButton"),
  runnerMenuDialog: document.getElementById("runnerMenuDialog"),
  runnerMenuTitle: document.getElementById("runnerMenuTitle"),
  runnerLapField: document.getElementById("runnerLapField"),
  runnerLapInput: document.getElementById("runnerLapInput"),
  restoreRunnerButton: document.getElementById("restoreRunnerButton"),
  updateRunnerLapButton: document.getElementById("updateRunnerLapButton"),
  returnRunnerLapButton: document.getElementById("returnRunnerLapButton"),
  dnfButton: document.getElementById("dnfButton"),
  dqButton: document.getElementById("dqButton"),
  dnsButton: document.getElementById("dnsButton"),
  cancelRunnerMenuButton: document.getElementById("cancelRunnerMenuButton"),
  addRunnerDialog: document.getElementById("addRunnerDialog"),
  addRunnerForm: document.getElementById("addRunnerForm"),
  addRunnerNumberInput: document.getElementById("addRunnerNumberInput"),
  addRunnerLapInput: document.getElementById("addRunnerLapInput"),
  cancelAddRunnerButton: document.getElementById("cancelAddRunnerButton"),
  recordsDialog: document.getElementById("recordsDialog"),
  recordList: document.getElementById("recordList"),
  recordDetail: document.getElementById("recordDetail"),
  closeRecordsButton: document.getElementById("closeRecordsButton"),
  distanceInput: document.getElementById("distanceInput"),
  initialLapsInput: document.getElementById("initialLapsInput"),
  eventNameInput: document.getElementById("eventNameInput"),
  genderInput: document.getElementById("genderInput"),
  roundInput: document.getElementById("roundInput"),
  heatNumberInput: document.getElementById("heatNumberInput"),
  participantCountInput: document.getElementById("participantCountInput"),
};

function createDefaultRaceState() {
  return {
    eventName: "26東京都総体",
    raceName: "男子5000m 決勝1組",
    gender: "男子",
    distance: "5000m",
    round: "決勝",
    heatNumber: 1,
    participantCount: 28,
    initialRunnerLaps: 13,
    globalRemainingLap: 13,
    currentLapInputLocked: false,
    displayMode: "no_order",
    bellEnabled: false,
    longBellPlaying: false,
    currentLapTappedNumbers: [],
    tailFiveNumbers: [],
    actionHistory: [],
    passCounter: 0,
    passOrderDisplayNumbers: [],
    firstBellRung: false,
  };
}

function createRunners(count, initialLaps) {
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    remainingLaps: initialLaps,
    status: "active",
    tappedInCurrentLap: false,
    tapLockedUntil: null,
    passOrder: null,
    isTailCandidate: false,
    isLappedCandidate: false,
  }));
}

function buildRaceName(gender, distance, round, heatNumber) {
  return `${gender}${distance} ${round}${heatNumber}組`.trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotRaceState() {
  const snapshot = clone(raceState);
  snapshot.actionHistory = [];
  return snapshot;
}

function normalizeRaceState(state) {
  const normalized = {
    ...createDefaultRaceState(),
    ...state,
  };
  normalized.actionHistory = Array.isArray(state?.actionHistory)
    ? state.actionHistory.slice(-MAX_HISTORY).map((record) => ({
        type: record.type,
        beforeState: record.beforeState ? {
          raceState: snapshotFromStoredRaceState(record.beforeState.raceState),
          runners: Array.isArray(record.beforeState.runners) ? record.beforeState.runners : [],
        } : null,
        afterState: record.afterState ? {
          raceState: snapshotFromStoredRaceState(record.afterState.raceState),
          runners: Array.isArray(record.afterState.runners) ? record.afterState.runners : [],
        } : null,
        timestamp: record.timestamp,
      })).filter((record) => record.beforeState)
    : [];
  return normalized;
}

function snapshotFromStoredRaceState(state) {
  const snapshot = {
    ...createDefaultRaceState(),
    ...state,
  };
  snapshot.actionHistory = [];
  return snapshot;
}

function pushHistory(type) {
  const record = {
    type,
    beforeState: {
      raceState: snapshotRaceState(),
      runners: clone(runners),
    },
    afterState: null,
    timestamp: new Date().toISOString(),
  };
  raceState.actionHistory.push(record);
  if (raceState.actionHistory.length > MAX_HISTORY) {
    raceState.actionHistory.shift();
  }
  return record;
}

function finishHistory(record) {
  if (!record) return;
  record.afterState = {
    raceState: snapshotRaceState(),
    runners: clone(runners),
  };
}

function render() {
  const now = Date.now();
  elements.globalLap.textContent = raceState.globalRemainingLap;
  elements.eventName.textContent = raceState.eventName || "大会名未設定";
  elements.raceName.textContent = raceState.raceName || "種目名未設定";
  updateFullscreenButton();

  elements.undoButton.disabled = raceState.actionHistory.length === 0;
  elements.bulkPassButton.disabled = false;
  elements.tailModeBanner.hidden = !tailInputMode;
  elements.tailModeCount.textContent = `${raceState.tailFiveNumbers.length} / ${TAIL_TARGET_COUNT}`;

  if (raceState.displayMode === "pass_order") {
    elements.displayModeMain.textContent = "通過順";
    elements.displayModeSub.textContent = "タップしてNo.順へ";
  } else {
    elements.displayModeMain.textContent = "No.順";
    elements.displayModeSub.textContent = "タップして通過順へ";
  }

  elements.bellMain.textContent = raceState.bellEnabled ? "鐘 ON" : "鐘 OFF";
  elements.bellSub.textContent = raceState.bellEnabled ? "タップしてOFF" : "タップしてON";
  elements.bellButton.classList.toggle("active", raceState.bellEnabled);

  const orderedRunners = getOrderedRunners();
  elements.runnerRows.innerHTML = "";

  for (let i = 0; i < orderedRunners.length; i += 10) {
    const row = document.createElement("section");
    row.className = "runner-row";
    row.setAttribute("aria-label", `${i + 1}番から${Math.min(i + 10, orderedRunners.length)}番`);

    orderedRunners.slice(i, i + 10).forEach((runner) => {
      row.appendChild(createRunnerButton(runner, now));
    });

    elements.runnerRows.appendChild(row);
  }
  scheduleTapLockRefresh(now);
}

function getPassOrderSnapshotNumbers() {
  return [...runners]
    .sort((a, b) => {
      const aInactive = a.status !== "active";
      const bInactive = b.status !== "active";
      if (aInactive && bInactive) return a.number - b.number;
      if (aInactive) return 1;
      if (bInactive) return -1;

      const aHasOrder = typeof a.passOrder === "number";
      const bHasOrder = typeof b.passOrder === "number";
      if (aHasOrder && bHasOrder) return a.passOrder - b.passOrder;
      if (aHasOrder) return -1;
      if (bHasOrder) return 1;
      return a.number - b.number;
    })
    .map((runner) => runner.number);
}

function refreshPassOrderDisplay() {
  raceState.passOrderDisplayNumbers = getPassOrderSnapshotNumbers();
}

function getOrderedRunners() {
  if (raceState.displayMode === "pass_order") {
    if (!Array.isArray(raceState.passOrderDisplayNumbers) || raceState.passOrderDisplayNumbers.length === 0) {
      refreshPassOrderDisplay();
    }

    const byNumber = new Map(runners.map((runner) => [runner.number, runner]));
    const displayed = raceState.passOrderDisplayNumbers
      .map((number) => byNumber.get(number))
      .filter(Boolean);
    const displayedNumbers = new Set(displayed.map((runner) => runner.number));
    const addedLater = runners
      .filter((runner) => !displayedNumbers.has(runner.number))
      .sort((a, b) => a.number - b.number);

    return [...displayed, ...addedLater];
  }
  return [...runners].sort((a, b) => a.number - b.number);
}

function createRunnerButton(runner, now = Date.now()) {
  const button = document.createElement("button");
  const lockedAtRender = isRunnerTapLocked(runner, now);
  button.type = "button";
  button.className = runnerButtonClass(runner, now);
  button.disabled = !tailInputMode && (runner.status === "finished" || lockedAtRender);
  button.dataset.lockedAtRender = lockedAtRender ? "1" : "0";
  button.innerHTML = `
    <span>
      <span class="runner-number">${runner.number}</span>
      <span class="runner-lap">${runnerStatusLabel(runner)}</span>
    </span>
  `;

  attachLongPress(button, () => openRunnerMenu(runner.number));
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openRunnerMenu(runner.number);
  });
  button.addEventListener("click", () => {
    if (button.dataset.skipClick === "1") {
      button.dataset.skipClick = "0";
      return;
    }
    if (button.dataset.lockedAtRender === "1") return;
    handleRunnerTap(runner.number);
  });
  return button;
}

function runnerButtonClass(runner, now = Date.now()) {
  const classes = ["runner-button", runnerColorClass(runner)];
  if (runner.tappedInCurrentLap) classes.push("tapped");
  if (runner.isTailCandidate || runner.isLappedCandidate) classes.push("candidate");
  if (tailInputMode && raceState.tailFiveNumbers.includes(runner.number)) classes.push("tail-selected");
  return classes.filter(Boolean).join(" ");
}

function runnerStatusLabel(runner) {
  if (runner.status === "dnf") return "DNF";
  if (runner.status === "dq") return "DQ";
  if (runner.status === "dns") return "DNS";
  if (runner.status === "finished") return "FIN";
  return `残り ${runner.remainingLaps}`;
}

function runnerColorClass(runner) {
  if (runner.status === "dnf") return "dnf";
  if (runner.status === "dq") return "dq";
  if (runner.status === "dns") return "dns";
  if (runner.remainingLaps <= 0 || runner.status === "finished") return "finished";
  if (runner.remainingLaps === 1) return "lap1";
  if (runner.remainingLaps === 2) return "lap2";
  if (runner.remainingLaps === 3) return "lap3";
  return "";
}

function handleRunnerTap(number) {
  if (tailInputMode) {
    addTailRunner(number);
    return;
  }
  tapRunner(number);
}

function tapRunner(number) {
  const runner = runners.find((item) => item.number === number);
  if (!runner || runner.status !== "active" || runner.remainingLaps <= 0) return;
  if (isRunnerTapLocked(runner)) return;

  const history = pushHistory("individualTap");
  const becameFinalLap = decrementRunner(runner);
  markRunnerTapped(number);
  finishHistory(history);
  if (!becameFinalLap) {
    playTapSound();
  }
  saveState();
  render();
}

function decrementRunner(runner) {
  runner.remainingLaps -= 1;
  runner.passOrder = ++raceState.passCounter;
  let becameFinalLap = false;
  if (runner.remainingLaps === 1) {
    becameFinalLap = true;
    triggerBellCandidate();
  }
  if (runner.remainingLaps === 0) {
    runner.status = "finished";
  }
  return becameFinalLap;
}

function playTapSound() {
  try {
    if (!tapAudio) {
      tapAudio = new Audio(TAP_SOUND_SRC);
      tapAudio.preload = "auto";
      tapAudio.load();
    }
    tapAudio.pause();
    tapAudio.currentTime = 0;
    tapAudio.play().catch(() => playGeneratedTapSound());
  } catch {
    playGeneratedTapSound();
  }
}

function playGeneratedTapSound() {
  try {
    if (!tapAudioContext) {
      tapAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (tapAudioContext.state === "suspended") {
      tapAudioContext.resume();
    }
    const now = tapAudioContext.currentTime;
    const oscillator = tapAudioContext.createOscillator();
    const gain = tapAudioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(430, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    oscillator.connect(gain).connect(tapAudioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.05);
  } catch {
    // Tap feedback is helpful but should never block race operation.
  }
}

function confirmLap() {
  const history = pushHistory("lapConfirm");
  if (raceState.globalRemainingLap > 0) {
    raceState.globalRemainingLap -= 1;
  }

  if (raceState.displayMode === "pass_order") {
    refreshPassOrderDisplay();
  }
  raceState.currentLapTappedNumbers = [];
  runners.forEach((runner) => {
    runner.tappedInCurrentLap = false;
    runner.tapLockedUntil = null;
  });

  finishHistory(history);
  saveState();
  render();
}

function bulkRemainingPass(type = "bulkRemainingPass") {
  const now = Date.now();
  const eligible = runners.filter((runner) => (
    runner.status === "active" &&
    runner.remainingLaps > 0 &&
    !runner.tappedInCurrentLap &&
    !isRunnerTapLocked(runner, now)
  ));

  if (eligible.length === 0) {
    showToast("一斉通過できるactive選手はいません。");
    return null;
  }

  const history = pushHistory(type);
  eligible.forEach((runner) => {
    decrementRunner(runner);
    markRunnerTapped(runner.number);
  });
  finishHistory(history);
  saveState();
  render();
  showToast(`${eligible.length}名を一斉通過しました。`);
  return history;
}

function enterTailInputMode() {
  bulkRemainingPass("tailInput");
  tailInputMode = true;
  raceState.tailFiveNumbers = [];
  runners = runners.map((runner) => ({
    ...runner,
    isTailCandidate: false,
  }));
  saveState();
  render();
  showToast("最後尾から順に5名タップしてください。");
}

function addTailRunner(number) {
  const runner = runners.find((item) => item.number === number);
  if (!runner || raceState.tailFiveNumbers.includes(number)) return;

  raceState.tailFiveNumbers.push(number);
  runner.isTailCandidate = true;
  runner.isLappedCandidate = true;
  saveState();

  if (raceState.tailFiveNumbers.length >= TAIL_TARGET_COUNT) {
    tailInputMode = false;
    showToast("最後尾5名を保存しました。");
  }
  render();
}

function cancelTailMode() {
  tailInputMode = false;
  saveState();
  render();
}

function undoLastAction() {
  const remainingHistory = raceState.actionHistory.slice(0, -1);
  const last = raceState.actionHistory[raceState.actionHistory.length - 1];
  if (!last?.beforeState) return;

  raceState = {
    ...createDefaultRaceState(),
    ...clone(last.beforeState.raceState),
  };
  raceState.actionHistory = remainingHistory;
  runners = clone(last.beforeState.runners);
  tailInputMode = false;
  saveState();
  render();
  showToast("直前の操作を取り消しました。");
}

function toggleDisplayMode() {
  if (raceState.displayMode === "no_order") {
    refreshPassOrderDisplay();
    raceState.displayMode = "pass_order";
  } else {
    raceState.displayMode = "no_order";
  }
  saveState();
  render();
}

function toggleBell() {
  raceState.bellEnabled = !raceState.bellEnabled;
  if (raceState.bellEnabled) {
    preloadBellAudio();
  }
  saveState();
  render();
}

function openRunnerMenu(number) {
  if (tailInputMode) return;
  selectedRunnerNumber = number;
  const runner = runners.find((item) => item.number === number);
  elements.runnerMenuTitle.textContent = `${number}番の選手操作`;
  elements.restoreRunnerButton.hidden = runner?.status === "active";
  elements.updateRunnerLapButton.hidden = runner?.status !== "active";
  elements.returnRunnerLapButton.hidden = runner?.status !== "active";
  elements.runnerLapInput.value = runner?.status === "active" ? runner.remainingLaps : raceState.globalRemainingLap;
  elements.runnerMenuDialog.showModal();
}

function setRunnerStatus(status) {
  const runner = runners.find((item) => item.number === selectedRunnerNumber);
  if (!runner) return;

  const history = pushHistory(status);
  runner.status = status;
  runner.tappedInCurrentLap = false;
  unmarkRunnerTapped(runner.number);
  finishHistory(history);
  saveState();
  elements.runnerMenuDialog.close();
  render();
}

function restoreRunnerToGlobalLap() {
  const runner = runners.find((item) => item.number === selectedRunnerNumber);
  if (!runner) return;

  const history = pushHistory("restoreRunner");
  const restoreLap = clampNumber(Number(elements.runnerLapInput.value), 0, 99);
  runner.status = "active";
  runner.remainingLaps = restoreLap;
  runner.tappedInCurrentLap = false;
  runner.passOrder = null;
  runner.isTailCandidate = false;
  runner.isLappedCandidate = false;
  unmarkRunnerTapped(runner.number);
  finishHistory(history);
  saveState();
  elements.runnerMenuDialog.close();
  render();
  showToast(`${runner.number}番を復活し、残り${runner.remainingLaps}周にしました。`);
}

function updateRunnerLap() {
  const runner = runners.find((item) => item.number === selectedRunnerNumber);
  if (!runner || runner.status !== "active") return;

  const history = pushHistory("updateRunnerLap");
  runner.remainingLaps = clampNumber(Number(elements.runnerLapInput.value), 0, 99);
  if (runner.remainingLaps === 0) {
    runner.status = "finished";
  }
  runner.tappedInCurrentLap = false;
  unmarkRunnerTapped(runner.number);
  finishHistory(history);
  saveState();
  elements.runnerMenuDialog.close();
  render();
  showToast(`${runner.number}番を残り${runner.remainingLaps}周に修正しました。`);
}

function returnRunnerOneLap() {
  const runner = runners.find((item) => item.number === selectedRunnerNumber);
  if (!runner || runner.status !== "active") return;

  const history = pushHistory("returnRunnerLap");
  runner.remainingLaps = clampNumber(runner.remainingLaps + 1, 0, 99);
  runner.tappedInCurrentLap = false;
  runner.status = "active";
  unmarkRunnerTapped(runner.number);
  finishHistory(history);
  saveState();
  elements.runnerMenuDialog.close();
  render();
  showToast(`${runner.number}番を1周戻しました。`);
}

function attachLongPress(element, callback) {
  let timer = null;
  let fired = false;

  const clear = () => {
    window.clearTimeout(timer);
    timer = null;
  };

  element.addEventListener("pointerdown", () => {
    fired = false;
    clear();
    timer = window.setTimeout(() => {
      fired = true;
      element.dataset.skipClick = "1";
      callback();
    }, LONG_PRESS_MS);
  });

  ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
    element.addEventListener(eventName, () => {
      clear();
      fired = false;
    });
  });
}

function triggerBellCandidate() {
  if (!raceState.bellEnabled) return;
  if (!raceState.firstBellRung) {
    raceState.firstBellRung = true;
    playBell("long");
    return;
  }
  playBell("short");
}

function markRunnerTapped(number) {
  const runner = runners.find((item) => item.number === number);
  if (runner) {
    runner.tappedInCurrentLap = true;
    runner.tapLockedUntil = TAP_LOCK_ENABLED ? Date.now() + TAP_LOCK_MS : null;
  }
  if (!raceState.currentLapTappedNumbers.includes(number)) {
    raceState.currentLapTappedNumbers.push(number);
  }
}

function unmarkRunnerTapped(number) {
  const runner = runners.find((item) => item.number === number);
  if (runner) {
    runner.tappedInCurrentLap = false;
    runner.tapLockedUntil = null;
  }
  raceState.currentLapTappedNumbers = raceState.currentLapTappedNumbers.filter((item) => item !== number);
}

function isRunnerTapLocked(runner, now = Date.now()) {
  return TAP_LOCK_ENABLED && runner.status === "active" && Number(runner.tapLockedUntil || 0) > now;
}

function scheduleTapLockRefresh(now = Date.now()) {
  window.clearTimeout(tapLockRenderTimer);
  if (!TAP_LOCK_ENABLED) return;
  const nextUnlock = runners
    .map((runner) => Number(runner.tapLockedUntil || 0))
    .filter((unlockAt) => unlockAt > now)
    .sort((a, b) => a - b)[0];
  if (!nextUnlock) return;
  tapLockRenderTimer = window.setTimeout(render, Math.max(0, nextUnlock - now) + 30);
}

function preloadBellAudio() {
  if (!longBellAudio) {
    longBellAudio = new Audio(LONG_BELL_SRC);
    longBellAudio.preload = "auto";
  }
  if (!shortBellAudio) {
    shortBellAudio = new Audio(SHORT_BELL_SRC);
    shortBellAudio.preload = "auto";
  }
  longBellAudio.load();
  shortBellAudio.load();
}

function playBell(kind) {
  preloadBellAudio();
  const template = kind === "long" ? longBellAudio : shortBellAudio;
  if (!template) return;
  const source = template.cloneNode(true);

  if (kind === "long") {
    raceState.longBellPlaying = true;
    source.onended = finishLongBellPlayback;
    window.setTimeout(finishLongBellPlayback, 5000);
  }

  source.play().catch(() => {
    if (kind === "long") {
      finishLongBellPlayback();
    }
    showToast("音声を再生できませんでした。もう一度、鐘ONを押してください。");
  });
}

function finishLongBellPlayback() {
  if (raceState.longBellPlaying) {
    raceState.longBellPlaying = false;
    saveState();
    render();
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    showToast("全画面を切り替えできませんでした。");
  }
  updateFullscreenButton();
}

function updateFullscreenButton() {
  if (!elements.fullscreenButton) return;
  const isFullscreen = Boolean(document.fullscreenElement);
  elements.fullscreenButton.textContent = isFullscreen ? "戻す" : "全画面";
  elements.fullscreenButton.setAttribute(
    "aria-label",
    isFullscreen ? "全画面表示を解除する" : "全画面表示にする"
  );
}

function applySettingsFromForm() {
  const formData = new FormData(elements.settingsForm);
  const eventName = String(formData.get("eventName") || "").trim();
  const gender = String(formData.get("gender") || "男子");
  const distance = String(formData.get("distance") || "5000m");
  const round = String(formData.get("round") || "決勝");
  const heatNumber = clampNumber(Number(formData.get("heatNumber")), 1, 20);
  const participantCount = clampNumber(Number(formData.get("participantCount")), 1, MAX_PARTICIPANTS);
  const initialLaps = clampNumber(Number(formData.get("initialLaps")), 1, 99);
  const initialGlobalLaps = initialLaps;

  raceState = {
    ...createDefaultRaceState(),
    eventName,
    raceName: buildRaceName(gender, distance, round, heatNumber),
    gender,
    distance,
    round,
    heatNumber,
    participantCount,
    initialRunnerLaps: initialGlobalLaps,
    globalRemainingLap: initialGlobalLaps,
    currentLapInputLocked: false,
  };
  runners = createRunners(participantCount, initialGlobalLaps);
  tailInputMode = false;
  saveState();
  elements.settingsDialog.close();
  render();
}

function populateSettingsForm() {
  elements.eventNameInput.value = raceState.eventName;
  elements.genderInput.value = raceState.gender;
  elements.distanceInput.value = raceState.distance;
  elements.roundInput.value = raceState.round || inferRoundFromRaceName(raceState.raceName);
  elements.heatNumberInput.value = raceState.heatNumber || inferHeatNumberFromRaceName(raceState.raceName);
  elements.participantCountInput.value = raceState.participantCount;
  elements.participantCountInput.max = MAX_PARTICIPANTS;
  elements.initialLapsInput.value = Math.max(1, raceState.initialRunnerLaps || runners[0]?.remainingLaps || raceState.globalRemainingLap);
}

function inferRoundFromRaceName(raceName) {
  if (raceName?.includes("準決勝")) return "準決勝";
  if (raceName?.includes("予選")) return "予選";
  return "決勝";
}

function inferHeatNumberFromRaceName(raceName) {
  const match = String(raceName || "").match(/(\d+)組/);
  return match ? Number(match[1]) : 1;
}

function clampNumber(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function saveState() {
  const stateToSave = {
    ...raceState,
    actionHistory: raceState.actionHistory.slice(-MAX_HISTORY),
  };
  const payload = {
    raceState: stateToSave,
    runners,
    savedAt: new Date().toISOString(),
  };
  window.__lapManagerMemoryState = payload;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => persistState(payload), 120);
}

function persistState(payload) {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    window.__lapManagerMemoryState = payload;
  }
}

function loadState() {
  try {
    if (window.__lapManagerMemoryState) return window.__lapManagerMemoryState;
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload?.raceState || !Array.isArray(payload?.runners)) return null;
    return {
      ...payload,
      raceState: normalizeRaceState(payload.raceState),
    };
  } catch {
    return null;
  }
}

function loadRaceRecords() {
  try {
    const raw = window.localStorage?.getItem(RACE_RECORDS_KEY);
    if (!raw) return [];
    const records = JSON.parse(raw);
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function persistRaceRecords(records) {
  window.localStorage?.setItem(RACE_RECORDS_KEY, JSON.stringify(records.slice(0, MAX_RACE_RECORDS)));
}

function createRaceRecord() {
  const savedAt = new Date().toISOString();
  const completedCount = runners.filter((runner) => runner.status === "finished").length;
  const dnfCount = runners.filter((runner) => runner.status === "dnf").length;
  const dqCount = runners.filter((runner) => runner.status === "dq").length;
  const dnsCount = runners.filter((runner) => runner.status === "dns").length;
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt,
    eventName: raceState.eventName,
    raceName: raceState.raceName,
    summary: {
      participantCount: runners.length,
      completedCount,
      dnfCount,
      dqCount,
      dnsCount,
      globalRemainingLap: raceState.globalRemainingLap,
      actionCount: raceState.actionHistory.length,
    },
    raceState: {
      ...snapshotRaceState(),
      actionHistory: clone(raceState.actionHistory),
    },
    runners: clone(runners),
  };
}

function saveRaceRecord() {
  if (runners.length === 0) {
    showToast("保存するレースがありません。");
    return;
  }
  const records = loadRaceRecords();
  const record = createRaceRecord();
  persistRaceRecords([record, ...records]);
  showToast(`${record.raceName}を保存しました。`);
}

function openRecordsDialog() {
  renderRaceRecords();
  elements.recordsDialog.showModal();
}

function renderRaceRecords(selectedId = null) {
  const records = loadRaceRecords();
  elements.recordList.innerHTML = "";
  if (records.length === 0) {
    elements.recordList.textContent = "保存済みレースはありません。";
    elements.recordDetail.textContent = "レース後に「記録保存」を押すと、ここに残ります。";
    return;
  }

  const activeId = selectedId || records[0].id;
  records.forEach((record) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "record-item";
    button.classList.toggle("active", record.id === activeId);
    button.innerHTML = `
      <strong>${escapeHtml(record.raceName || "レース名未設定")}</strong>
      <span>${escapeHtml(record.eventName || "大会名未設定")}</span>
      <small>${formatDateTime(record.savedAt)} / 操作 ${record.summary?.actionCount ?? 0}件</small>
    `;
    button.addEventListener("click", () => renderRaceRecords(record.id));
    elements.recordList.appendChild(button);
  });

  const selected = records.find((record) => record.id === activeId) || records[0];
  renderRaceRecordDetail(selected);
}

function renderRaceRecordDetail(record) {
  const sortedRunners = [...(record.runners || [])].sort((a, b) => a.number - b.number);
  const runnerRows = sortedRunners.map((runner) => `
    <tr>
      <td>${runner.number}</td>
      <td>${runnerStatusText(runner.status)}</td>
      <td>${runner.remainingLaps}</td>
      <td>${runner.passOrder ?? ""}</td>
    </tr>
  `).join("");
  const historyRows = (record.raceState?.actionHistory || []).map((history, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${formatTime(history.timestamp)}</td>
      <td>${historyTypeLabel(history.type)}</td>
      <td>${escapeHtml(describeHistoryRecord(history))}</td>
    </tr>
  `).join("");

  elements.recordDetail.innerHTML = `
    <div class="record-summary">
      <strong>${escapeHtml(record.raceName || "レース名未設定")}</strong>
      <span>${escapeHtml(record.eventName || "大会名未設定")}</span>
      <small>保存日時 ${formatDateTime(record.savedAt)}</small>
      <small>参加 ${record.summary?.participantCount ?? 0}名 / 完走 ${record.summary?.completedCount ?? 0}名 / DNF ${record.summary?.dnfCount ?? 0}名 / DQ ${record.summary?.dqCount ?? 0}名 / DNS ${record.summary?.dnsCount ?? 0}名</small>
    </div>
    <h3>選手別最終状態</h3>
    <div class="record-table-wrap">
      <table class="record-table">
        <thead><tr><th>No.</th><th>状態</th><th>残り</th><th>通過順</th></tr></thead>
        <tbody>${runnerRows}</tbody>
      </table>
    </div>
    <h3>操作履歴</h3>
    <div class="record-table-wrap history">
      <table class="record-table">
        <thead><tr><th>#</th><th>時刻</th><th>操作</th><th>内容</th></tr></thead>
        <tbody>${historyRows || '<tr><td colspan="4">操作履歴はありません。</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function describeHistoryRecord(record) {
  const beforeRunners = record.beforeState?.runners || [];
  const afterRunners = record.afterState?.runners || [];
  if (beforeRunners.length === 0 || afterRunners.length === 0) {
    return "詳細なし";
  }
  const beforeMap = new Map(beforeRunners.map((runner) => [runner.number, runner]));
  const changes = afterRunners
    .filter((runner) => {
      const before = beforeMap.get(runner.number);
      return !before ||
        before.remainingLaps !== runner.remainingLaps ||
        before.status !== runner.status ||
        before.tappedInCurrentLap !== runner.tappedInCurrentLap;
    })
    .map((runner) => {
      const before = beforeMap.get(runner.number);
      if (!before) return `${runner.number}番を追加`;
      const from = `${runnerStatusText(before.status)} 残り${before.remainingLaps}`;
      const to = `${runnerStatusText(runner.status)} 残り${runner.remainingLaps}`;
      return `${runner.number}番: ${from} → ${to}`;
    });
  return changes.slice(0, 8).join(" / ") + (changes.length > 8 ? ` / 他${changes.length - 8}件` : "");
}

function runnerStatusText(status) {
  if (status === "active") return "走行中";
  if (status === "finished") return "完走";
  if (status === "dnf") return "DNF";
  if (status === "dq") return "DQ";
  if (status === "dns") return "DNS";
  return status || "";
}

function historyTypeLabel(type) {
  const labels = {
    individualTap: "個別タップ",
    lapConfirm: "周回確定",
    bulkRemainingPass: "一斉通過",
    tailInput: "最後尾入力",
    addRunner: "選手追加",
    restoreRunner: "復活",
    updateRunnerLap: "周回修正",
    returnRunnerLap: "1周戻し",
    dnf: "DNF",
    dq: "DQ",
    dns: "DNS",
  };
  return labels[type] || type || "";
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function openSettings() {
  populateSettingsForm();
  elements.settingsDialog.showModal();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 1800);
}

function stepInput(button) {
  const target = document.getElementById(button.dataset.stepTarget);
  const step = Number(button.dataset.step || 0);
  if (!target || !step) return;
  const min = Number(target.min || -Infinity);
  const max = Number(target.max || Infinity);
  const current = Number(target.value || min || 0);
  target.value = clampNumber(current + step, min, max);
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function stopStepperRepeat() {
  window.clearTimeout(stepperRepeatDelayTimer);
  window.clearInterval(stepperRepeatTimer);
  stepperRepeatDelayTimer = null;
  stepperRepeatTimer = null;
}

function startStepperRepeat(button) {
  stopStepperRepeat();
  stepInput(button);
  stepperRepeatDelayTimer = window.setTimeout(() => {
    stepperRepeatTimer = window.setInterval(() => stepInput(button), 220);
  }, 520);
}

function openAddRunnerDialog() {
  if (runners.length >= MAX_PARTICIPANTS) {
    showToast(`選手は最大${MAX_PARTICIPANTS}名までです。`);
    return;
  }
  const usedNumbers = new Set(runners.map((runner) => runner.number));
  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) nextNumber += 1;
  elements.addRunnerNumberInput.value = nextNumber;
  elements.addRunnerLapInput.value = raceState.globalRemainingLap;
  elements.addRunnerDialog.showModal();
}

function addRunnerFromForm(event) {
  event.preventDefault();
  if (runners.length >= MAX_PARTICIPANTS) {
    showToast(`選手は最大${MAX_PARTICIPANTS}名までです。`);
    return;
  }

  const formData = new FormData(elements.addRunnerForm);
  const number = clampNumber(Number(formData.get("runnerNumber")), 1, 9999);
  const remainingLaps = clampNumber(Number(formData.get("remainingLaps")), 0, 99);
  if (runners.some((runner) => runner.number === number)) {
    showToast(`${number}番はすでに登録されています。`);
    return;
  }

  const history = pushHistory("addRunner");
  runners.push({
    number,
    remainingLaps,
    status: remainingLaps === 0 ? "finished" : "active",
    tappedInCurrentLap: false,
    tapLockedUntil: null,
    passOrder: null,
    isTailCandidate: false,
    isLappedCandidate: false,
  });
  raceState.participantCount = runners.length;
  finishHistory(history);
  saveState();
  elements.addRunnerDialog.close();
  render();
  showToast(`${number}番を追加しました。`);
}

function boot() {
  try {
    window.localStorage?.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in some embedded browsers.
  }
  const saved = loadState();
  if (saved) {
    elements.restoreDialog.showModal();
  } else {
    runners = createRunners(raceState.participantCount, raceState.initialRunnerLaps);
    render();
    openSettings();
  }
}

elements.settingsButton.addEventListener("click", openSettings);
elements.fullscreenButton.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
elements.globalLapButton.addEventListener("click", confirmLap);
elements.bulkPassButton.addEventListener("click", () => {
  if (elements.bulkPassButton.dataset.skipClick === "1") {
    elements.bulkPassButton.dataset.skipClick = "0";
    return;
  }
  bulkRemainingPass();
});
attachLongPress(elements.bulkPassButton, enterTailInputMode);
elements.bulkPassButton.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  enterTailInputMode();
});
elements.undoButton.addEventListener("click", undoLastAction);
elements.displayModeButton.addEventListener("click", toggleDisplayMode);
elements.bellButton.addEventListener("click", toggleBell);
elements.saveRecordButton.addEventListener("click", saveRaceRecord);
elements.recordsButton.addEventListener("click", openRecordsDialog);
elements.cancelTailModeButton.addEventListener("click", cancelTailMode);
elements.restoreRunnerButton.addEventListener("click", restoreRunnerToGlobalLap);
elements.updateRunnerLapButton.addEventListener("click", updateRunnerLap);
elements.returnRunnerLapButton.addEventListener("click", returnRunnerOneLap);
elements.addRunnerButton.addEventListener("click", openAddRunnerDialog);
elements.addRunnerForm.addEventListener("submit", addRunnerFromForm);
elements.cancelAddRunnerButton.addEventListener("click", () => elements.addRunnerDialog.close());
elements.closeRecordsButton.addEventListener("click", () => elements.recordsDialog.close());
document.querySelectorAll(".stepper-button").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    startStepperRepeat(button);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
    button.addEventListener(eventName, stopStepperRepeat);
  });
});
elements.dnfButton.addEventListener("click", () => setRunnerStatus("dnf"));
elements.dqButton.addEventListener("click", () => setRunnerStatus("dq"));
elements.dnsButton.addEventListener("click", () => setRunnerStatus("dns"));
elements.cancelRunnerMenuButton.addEventListener("click", () => elements.runnerMenuDialog.close());
elements.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  applySettingsFromForm();
});
elements.cancelSettingsButton.addEventListener("click", () => {
  if (runners.length === 0) return;
  elements.settingsDialog.close();
});
elements.distanceInput.addEventListener("change", () => {
  const defaultLaps = DEFAULT_LAPS_BY_DISTANCE[elements.distanceInput.value];
  if (defaultLaps) elements.initialLapsInput.value = defaultLaps;
});
elements.restoreButton.addEventListener("click", () => {
  const saved = loadState();
  if (saved) {
    raceState = normalizeRaceState(saved.raceState);
    runners = saved.runners.map((runner) => ({
      isTailCandidate: false,
      isLappedCandidate: false,
      ...runner,
    }));
  }
  elements.restoreDialog.close();
  render();
});
elements.discardRestoreButton.addEventListener("click", () => {
  try {
    window.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    window.__lapManagerMemoryState = null;
  }
  raceState = createDefaultRaceState();
  runners = createRunners(raceState.participantCount, raceState.initialRunnerLaps);
  elements.restoreDialog.close();
  render();
  openSettings();
});

boot();
