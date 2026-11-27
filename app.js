// app.js — 相機 + MediaPipe + 畫面。計數規則在 counter.js，動作定義在 exercises.js。
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { DEFAULTS, calibrate, initialState, step, faceLost } from "./counter.js";
import { EXERCISES } from "./exercises.js";
import { initEvaluation, recordSystemCount } from "./evaluation.js";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// 校正時間軸（毫秒）：準備 2 秒 → 放鬆 3 秒 → 準備 2 秒 → 盡力 3 秒
const CALIB_STEPS = [
  { until: 2000, collect: null, text: "請準備一下，先放鬆看著鏡頭" },
  { until: 5000, collect: "rest", text: "請保持放鬆" },
  { until: 7000, collect: null, text: "請準備一下，等等要盡力做動作" },
  { until: 10000, collect: "max", text: "可以開始了，請盡力做動作" },
];
const CALIBRATION_NOTICE_MS = 1500;
const NEXT_REP_MESSAGE = "準備下一下，可以開始囉！";

let exercise = EXERCISES.pucker;
const $ = (id) => document.getElementById(id);
const video = $("video");
const canvas = $("overlay");
const ctx = canvas.getContext("2d");

let landmarker = null;
let mode = "idle"; // idle | calibrating | waitingForRelease | counting | completed
let calibStart = 0;
let lastCalibrationStep = null;
let calibrationFinishedAt = 0;
let samples = { rest: [], max: [] };
let calib = null;
let state = initialState();
let lastVideoTime = -1;
let speechEnabled = false;

// 給自動測試看的資訊（不影響功能）
window.__oral = { frames: 0, faces: 0, lastA: null, mode: () => mode };

$("exName").textContent = exercise.name;
$("exHint").textContent = exercise.hint;

function options() {
  return {
    ...DEFAULTS,
    holdMs: Number($("holdSel").value) * 1000,
    targetCount: Number($("targetSel").value), // 讀取使用者設定的目標次數
  };
}

function say(text) { $("message").textContent = text; }
function status(text) { $("status").textContent = text; }

// 每日紀錄只保存日期、動作名稱、累計次數
const DAILY_RECORDS_KEY = "oral-counter-daily-records";
// 取得本機日期，格式為 YYYY-MM-DD
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 讀取已經保存的每日紀錄
function loadDailyRecords() {
  try {
    const saved = localStorage.getItem(DAILY_RECORDS_KEY);
    if (!saved) return [];

    const records = JSON.parse(saved);
    if (!Array.isArray(records)) return [];

    return records
      .filter((item) =>
        item &&
        typeof item.date === "string" &&
        typeof item.exercise === "string" &&
        Number.isFinite(item.count)
      )
      .map((item) => ({
        date: item.date,
        exercise: item.exercise,
        count: item.count,
      }));
  } catch (error) {
    console.warn("讀取每日紀錄失敗：", error);
    return [];
  }
}

// 每完成一下，就把當天該動作的累計次數加一
function saveDailyCount(exerciseName) {
  try {
    const records = loadDailyRecords();
    const today = getLocalDateString();

    const existing = records.find(
      (item) => item.date === today && item.exercise === exerciseName
    );

    if (existing) {
      existing.count += 1;
    } else {
      records.push({
        date: today,
        exercise: exerciseName,
        count: 1,
      });
    }

    localStorage.setItem(DAILY_RECORDS_KEY, JSON.stringify(records));
  } catch (error) {
    console.warn("保存每日紀錄失敗：", error);
    status("本機紀錄無法保存，請檢查瀏覽器儲存空間設定");
  }
}

// 顯示最近 7 天的練習紀錄
function renderDailyRecords() {
  const tableBody = $("dailyRecordsBody");
  const records = loadDailyRecords();

  const firstDay = new Date();
  firstDay.setHours(0, 0, 0, 0);
  firstDay.setDate(firstDay.getDate() - 6);

  const firstDate = getLocalDateString(firstDay);
  const today = getLocalDateString();

  const recentRecords = records
    .filter((item) => item.date >= firstDate && item.date <= today)
    .sort((a, b) =>
      b.date.localeCompare(a.date) || a.exercise.localeCompare(b.exercise)
    );

  tableBody.replaceChildren();

  if (recentRecords.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "最近 7 天還沒有紀錄";
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  for (const item of recentRecords) {
    const row = document.createElement("tr");

    for (const value of [item.date, item.exercise, `${item.count} 下`]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }

    tableBody.appendChild(row);
  }
}

function toChineseNumber(number) {      // 將數字轉換成中文
  const chineseNumbers = ["零", "一", "二", "三", "四",
    "五", "六", "七", "八", "九"];

  if (number < 10) return chineseNumbers[number];

  if (number < 20) {
    return "十" + (number % 10 === 0 ? "" : chineseNumbers[number % 10]);
  }

  if (number < 100) {
    return chineseNumbers[Math.floor(number / 10)] + "十" +
      (number % 10 === 0 ? "" : chineseNumbers[number % 10]);
  }

  return String(number);
}


// 唸出語音提示
function speakMessage(message) {
  if (!speechEnabled) return;

  // 確認瀏覽器支援語音合成
  if (!("speechSynthesis" in window)) return;

  const utterance = new SpeechSynthesisUtterance(message);

  // 設定中文語音
  utterance.lang = "zh-TW";
  utterance.rate = 0.9;

  // 取得瀏覽器目前可用的語音
  const voices = window.speechSynthesis.getVoices();

  // 優先尋找繁體中文語音
  const chineseVoice = voices.find(
    (voice) => voice.lang === "zh-TW"
  );

  // 找到繁體中文語音才指定使用
  if (chineseVoice) {
    utterance.voice = chineseVoice;
  }

  // 直接播放，不在每次播放前取消語音
  window.speechSynthesis.speak(utterance);
}


// 唸出目前計數
function speakCount(count) {
  speakMessage(toChineseNumber(count));
}

async function loadModel() {
  const files = await FilesetResolver.forVisionTasks(WASM_URL);
  const base = { modelAssetPath: MODEL_URL };
  const settings = { runningMode: "VIDEO", numFaces: 1 };
  try {
    return await FaceLandmarker.createFromOptions(files, { baseOptions: { ...base, delegate: "GPU" }, ...settings });
  } catch (gpuError) {
    status(`GPU 無法使用，改用 CPU（${gpuError.message ?? gpuError}）`);
    return FaceLandmarker.createFromOptions(files, { baseOptions: { ...base, delegate: "CPU" }, ...settings });
  }
}

async function start() {
  $("startBtn").disabled = true;
  try {
    status("開啟相機中…");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    status("載入臉部特徵點模型中（第一次約需幾秒）…");
    landmarker = await loadModel();
    status("");
    $("startBtn").textContent = "相機已開啟";
    say("請按「校正」");
    $("calibBtn").disabled = false;
    requestAnimationFrame(loop);
  } catch (error) {
    $("startBtn").disabled = false;
    const denied = error?.name === "NotAllowedError";
    say(denied ? "相機權限被拒絕，請在瀏覽器設定中允許使用相機" : "無法啟動");
    status(`錯誤：${error?.message ?? error}`);
  }
}

function startCalibration() {
  mode = "calibrating";
  calibStart = performance.now();
  lastCalibrationStep = null;
  samples = { rest: [], max: [] };
  $("calibBanner").hidden = false;
  $("resetBtn").disabled = true;
  $("calibrationInfo").textContent = "校正中";
  status("");
  say("校正中");
}

function calibrationTick(now, a) {
  const elapsed = now - calibStart;
  const current = CALIB_STEPS.find((step) => elapsed < step.until);
  const banner = $("calibBanner");

  if (current) {
    const secondsLeft = Math.ceil((current.until - elapsed) / 1000);
    banner.textContent = `${current.text}（剩 ${secondsLeft} 秒）`;
    if (current !== lastCalibrationStep) {
      lastCalibrationStep = current;
      if (current.collect) speakMessage(current.collect === "rest" ? "請保持放鬆" : "可以開始了");
    }
    if (current.collect && Number.isFinite(a)) {
      samples[current.collect].push(a);
    }
    return;
  }

  if (!samples.rest.length || !samples.max.length) {
    banner.hidden = true;
    mode = "idle";
    $("calibrationInfo").textContent = "校正未完成";
    say("校正時偵測不到臉，請正對鏡頭再校正一次");
    return;
  }

  try {
    calib = calibrate(samples.rest, samples.max);
    state = initialState();
    calibrationFinishedAt = now;
    mode = "waitingForRelease";
    $("calibrationInfo").textContent =
      `校正數值｜放鬆 ${calib.rest.toFixed(3)}、盡力 ${calib.max.toFixed(3)}`;

    const message = "校正結束，請先放鬆";
    banner.textContent = message;
    render();
    say(message);
    speakMessage(message);
  } catch (error) {
    banner.hidden = true;
    mode = "idle";
    $("calibrationInfo").textContent = "校正未完成";
    say(error.message);
  }
}

function waitForReleaseAfterCalibration(now, a) {
  if (now - calibrationFinishedAt < CALIBRATION_NOTICE_MS || !Number.isFinite(a)) {
    return;
  }

  const progress = (a - calib.rest) / (calib.max - calib.rest);
  if (progress > DEFAULTS.releaseAt) return;

  const message = "正式開始！可以做第一下囉";
  state = Object.freeze({ ...initialState(), message });
  mode = "counting";
  $("calibBanner").hidden = true;
  $("resetBtn").disabled = false;
  render();
  speakMessage(message);
}

function draw(landmarks) {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;
  ctx.fillStyle = "#3ee0b4";
  for (const i of exercise.points) {
    const p = landmarks[i];
    ctx.beginPath();
    ctx.arc(p.x * canvas.width, p.y * canvas.height, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderSettings() {
  $("countTarget").textContent = $("targetSel").value;
  const hold = options().holdMs / 1000;
  $("hold").textContent = `維持 ${(state.heldMs / 1000).toFixed(1)} / ${hold} 秒`;
}

function render() {
  $("count").textContent = String(state.count);
  renderSettings();

  const missingFace = state.message === "偵測不到臉";
  const pct = missingFace ? 0 : Math.max(0, Math.min(1, state.p)) * 100;
  $("barFill").style.width = `${pct}%`;
  $("amplitudeBar").setAttribute("aria-valuenow", Math.round(pct));
  $("message").classList.toggle("needs-attention", missingFace);
  say(missingFace ? "暫停計數，請正對鏡頭" : state.message);
}

function loop() {
  const now = performance.now();
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = landmarker.detectForVideo(video, now);
    const landmarks = result.faceLandmarks?.[0] ?? null;
    const a = landmarks ? exercise.measure(landmarks, video.videoWidth, video.videoHeight) : null;
    window.__oral = { ...window.__oral, frames: window.__oral.frames + 1, faces: window.__oral.faces + (landmarks ? 1 : 0), lastA: a };
    draw(landmarks);

    if (mode === "calibrating") {
      calibrationTick(now, a);
    } else if (mode === "waitingForRelease") {
      waitForReleaseAfterCalibration(now, a);
    } else if (mode === "counting") {
      const previousCount = state.count;
      const previousMessage = state.message;
      state = Number.isFinite(a)
        ? step(state, a, now, calib, options())
        : faceLost(state);

      if (state.message !== previousMessage &&
          (state.message === "再撐久一點" || state.message === NEXT_REP_MESSAGE)) {
        speakMessage(state.message);
      }

      if (state.count > previousCount) {
        recordSystemCount();
        speakCount(state.count);
        saveDailyCount(exercise.name);
        renderDailyRecords();
      }

      if (state.count >= options().targetCount) {
        mode = "completed";
        state = Object.freeze({ ...state, message: "完成今天的練習！" });
      }

      render();
    }
  }
  requestAnimationFrame(loop);
}

$("startBtn").addEventListener("click", start);
$("calibBtn").addEventListener("click", startCalibration);
$("targetSel").addEventListener("change", renderSettings);
$("holdSel").addEventListener("change", renderSettings);
$("resetBtn").addEventListener("click", () => {
  // 將次數歸零
  state = initialState();

  // 如果已經完成校正，歸零後就可以重新練習
  if (calib) {
    mode = "counting";
  }

  render();
});

// 切換動作時，清除舊的校正資料並重新開始
$("exerciseSel").addEventListener("change", (event) => {
  // 根據下拉選單選擇新的動作
  exercise = EXERCISES[event.target.value];

  // 更新畫面上的動作名稱與提示
  $("exName").textContent = exercise.name;
  $("exHint").textContent = exercise.hint;

  // 清除舊的校正結果與校正樣本
  calib = null;
  samples = { rest: [], max: [] };

  // 停止目前的計數或校正流程
  mode = "idle";

  // 次數歸零，進度重新開始
  state = initialState();
  render();

  // 隱藏校正提示，並要求重新校正
  $("calibBanner").hidden = true;
  $("resetBtn").disabled = true;

  if (landmarker) {
    $("calibBtn").disabled = false;
    say("動作已切換，請重新按「校正」");
  } else {
    say("動作已切換，請先開啟相機，再重新校正");
  }

  $("calibrationInfo").textContent = "尚未校正";
  status("");
});


// 點擊按鈕切換語音開關
$("speechBtn").addEventListener("click", () => {
  speechEnabled = !speechEnabled;
  $("speechHint").textContent = speechEnabled
    ? "現在是開的喔"
    : "點我開啟語音輔助";

  $("speechBtn").textContent = speechEnabled
    ? "語音：開"
    : "語音：關";

  if (speechEnabled) {
    // 開啟語音時，先初始化瀏覽器的語音引擎
    window.speechSynthesis.getVoices();

    // 讓瀏覽器在使用者點擊時先執行一次語音
    const utterance = new SpeechSynthesisUtterance("語音已開啟");
    utterance.lang = "zh-TW";
    utterance.volume = 0; // 初始化時不發出聲音

    window.speechSynthesis.speak(utterance);
  } else {
    // 關閉語音時，停止尚未唸完的語音
    window.speechSynthesis.cancel();
  }
});


// 網頁開啟時，先顯示已保存的最近 7 天紀錄
renderDailyRecords();

initEvaluation({
  canStart: () =>
    mode === "counting" &&
    state.phase === "ready" &&
    state.smoothed !== null &&
    state.p <= DEFAULTS.releaseAt &&
    state.message !== "偵測不到臉",
  getExercise: () => exercise.name,
});
