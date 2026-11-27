// counter.js — 計數規則（不碰相機、不碰畫面，所以可以單獨測試）
//
// 核心公式（作品說明書「方法」一節）：
//   進度 p(t) = (A(t) − A_rest) / (A_max − A_rest)
//   外觀到位 A=1：p(t) ≥ 0.75   ⇔   A(t) ≥ A_rest + 0.75·(A_max − A_rest)
//   時間到位 C=1：A=1 連續維持 holdMs 毫秒
//   A×C = 1 → 計數 +1，之後要放鬆到 p ≤ releaseAt 才能做下一下
//
// 每個函式都「回傳新的狀態」，不修改舊的狀態。

export const DEFAULTS = Object.freeze({
  onAt: 0.75,      // 進入「到位」的門檻（自己最大幅度的 75%）
  offAt: 0.60,     // 離開「到位」的門檻（比 onAt 低 = 遲滯，防止抖動）
  releaseAt: 0.30, // 做完一下後，要放鬆到這裡以下才算準備好下一下
  holdMs: 3000,    // 要維持多久（毫秒）
  targetCount: 10, // 預設目標次數為 10 下
  smoothing: 0.5,  // 平滑係數：0 = 不更新，1 = 不平滑
  minRange: 0.02,  // 校正時「放鬆」與「盡力」至少要差這麼多
});

export const PHASE = Object.freeze({
  READY: "ready",       // 等待做動作
  HOLDING: "holding",   // 已到位，正在計時
  RELEASE: "release",   // 剛算完一下，等待放鬆
});

export function median(values) {
  if (!values.length) throw new Error("沒有資料可以計算中位數");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 用「放鬆 3 秒」與「盡力 3 秒」收集到的 A 值，算出個人的 A_rest、A_max
export function calibrate(restSamples, maxSamples, minRange = DEFAULTS.minRange) {
  const rest = median(restSamples);
  const max = median(maxSamples);
  if (Math.abs(max - rest) < minRange) {
    throw new Error("動作幅度太小，請再校正一次（盡力時做大一點）");
  }
  return Object.freeze({ rest, max });
}

export function progress(a, calib) {
  return (a - calib.rest) / (calib.max - calib.rest);
}

export function initialState() {
  return Object.freeze({
    count: 0,
    phase: PHASE.READY,
    smoothed: null,
    p: 0,
    holdStart: null,
    heldMs: 0,
    message: "請開始做動作",
  });
}

// 每一幀呼叫一次：a = 這一幀的動作量，t = 時間（毫秒）
export function step(state, a, t, calib, opts = DEFAULTS) {
    // 已達目標時直接維持完成狀態，不再繼續計數
  if (state.count >= opts.targetCount) {
    return Object.freeze({ ...state, message: "完成今天的練習！" });
  }

  const smoothed = state.smoothed === null ? a : opts.smoothing * a + (1 - opts.smoothing) * state.smoothed;
  const p = progress(smoothed, calib);
  const base = { ...state, smoothed, p };

  if (state.phase === PHASE.READY) {
    if (p >= opts.onAt) {
      return Object.freeze({ ...base, phase: PHASE.HOLDING, holdStart: t, heldMs: 0, message: "很好，撐住！" });
    }
    const neutralMessage = state.message === "偵測不到臉"
      ? "請開始做動作"
      : state.message;
    return Object.freeze({ ...base, heldMs: 0, message: p > 0.4 ? "再用力一點" : neutralMessage });
  }

  if (state.phase === PHASE.HOLDING) {
    if (p < opts.offAt) {
      return Object.freeze({ ...base, phase: PHASE.READY, holdStart: null, heldMs: 0, message: "再撐久一點" });
    }
    const heldMs = t - state.holdStart;
    if (heldMs >= opts.holdMs) {
  const count = state.count + 1;

  // 最後一下達到目標時，顯示完成訊息
  const message = count >= opts.targetCount
    ? "完成今天的練習！"
    : "完成一下！請放鬆";

  return Object.freeze({
    ...base,
    count,
    phase: PHASE.RELEASE,
    holdStart: null,
    heldMs,
    message
  });
}
    return Object.freeze({ ...base, heldMs, message: "很好，撐住！" });
  }

  // PHASE.RELEASE
  if (p <= opts.releaseAt) {
    return Object.freeze({ ...base, phase: PHASE.READY, heldMs: 0, message: "準備下一下，可以開始囉！" });
  }
  return Object.freeze({ ...base, message: "請放鬆" });
}

// 偵測不到臉：正在計時的這一下作廢，不計數
export function faceLost(state) {
  if (state.phase === PHASE.HOLDING) {
    return Object.freeze({ ...state, phase: PHASE.READY, holdStart: null, heldMs: 0, message: "偵測不到臉" });
  }
  return Object.freeze({ ...state, message: "偵測不到臉" });
}
