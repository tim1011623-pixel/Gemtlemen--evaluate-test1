// 用假的數字測試計數規則：node --test prototype/
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, PHASE, calibrate, initialState, step, faceLost, median, progress } from "./counter.js";
import { EXERCISES, LM } from "./exercises.js";

const NO_SMOOTH = { ...DEFAULTS, smoothing: 1 };
const FPS = 30;
const DT = 1000 / FPS;

// 嘟嘴：放鬆時嘴寬/臉寬 ≈ 0.40，盡力時 ≈ 0.30（數值變小）
const PUCKER = calibrate([0.40, 0.41, 0.39], [0.30, 0.29, 0.31]);
const level = (p, c = PUCKER) => c.rest + p * (c.max - c.rest); // 進度 p → A 值

// 把一段「進度」序列餵進去，回傳最後狀態
function run(segments, calib = PUCKER, opts = NO_SMOOTH, start = initialState()) {
  let state = start;
  let t = 0;
  for (const [p, ms] of segments) {
    for (let i = 0; i < Math.round(ms / DT); i += 1) {
      state = step(state, level(p, calib), t, calib, opts);
      t += DT;
    }
  }
  return state;
}

test("median and calibration", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.deepEqual(PUCKER, { rest: 0.40, max: 0.30 });
  assert.ok(Math.abs(progress(0.325, PUCKER) - 0.75) < 1e-9);
});

test("calibration rejects a too-small range", () => {
  assert.throws(() => calibrate([0.40], [0.395]), /幅度太小/);
});

test("one full rep (reach 75%, hold 3 s, release) counts 1", () => {
  const s = run([[0, 500], [0.9, 3200], [0, 500]]);
  assert.equal(s.count, 1);
  assert.equal(s.phase, PHASE.READY);
});

test("formula: A(t) >= A_rest + 0.75 (A_max - A_rest) — just below 75% never counts", () => {
  assert.equal(run([[0.74, 5000], [0, 500]]).count, 0);
  assert.equal(run([[0.76, 3500], [0, 500]]).count, 1);
});

test("holding too short does not count and says 再撐久一點", () => {
  const s = run([[0.9, 2000], [0.2, 300]]);
  assert.equal(s.count, 0);
  assert.equal(s.message, "再撐久一點");
});

test("hysteresis: wobbling between 0.62 and 0.9 during the hold still counts once", () => {
  const wobble = Array.from({ length: 40 }, (_, i) => [i % 2 ? 0.62 : 0.9, 100]);
  const s = run([...wobble, [0, 500]]);
  assert.equal(s.count, 1);
});

test("dropping below offAt (0.60) cancels the hold", () => {
  const s = run([[0.9, 1500], [0.55, 200], [0.9, 1500], [0, 300]]);
  assert.equal(s.count, 0);
});

test("must release before the next rep: holding 10 s counts only 1", () => {
  assert.equal(run([[0.9, 10000]]).count, 1);
  assert.equal(run([[0.9, 3500], [0.5, 2000], [0.9, 3500]]).count, 1); // 0.5 is not relaxed enough
});

test("five clean reps count 5", () => {
  const rep = [[0.95, 3300], [0.05, 1000]];
  assert.equal(run(Array(5).fill(rep).flat()).count, 5);
});

test("works the same for an exercise whose value increases (e.g. 張大嘴)", () => {
  const open = calibrate([0.05, 0.05], [0.35, 0.36]);
  const s = run([[0.9, 3200], [0, 500], [0.9, 3200], [0, 500]], open);
  assert.equal(s.count, 2);
});

test("hold time is configurable", () => {
  const opts = { ...NO_SMOOTH, holdMs: 5000 };
  assert.equal(run([[0.9, 4000], [0, 500]], PUCKER, opts).count, 0);
  assert.equal(run([[0.9, 5200], [0, 500]], PUCKER, opts).count, 1);
});

test("smoothing absorbs a single-frame spike", () => {
  const s = run([[0, 500], [0.95, DT], [0, 500]], PUCKER, DEFAULTS);
  assert.equal(s.phase, PHASE.READY);
  assert.equal(s.count, 0);
});

test("losing the face during a hold cancels that rep", () => {
  const mid = run([[0.9, 1500]]);
  assert.equal(mid.phase, PHASE.HOLDING);
  const lost = faceLost(mid);
  assert.equal(lost.phase, PHASE.READY);
  assert.equal(lost.count, 0);
});

test("state objects are not mutated", () => {
  const s0 = initialState();
  const s1 = step(s0, level(0.9), 0, PUCKER, NO_SMOOTH);
  assert.equal(s0.phase, PHASE.READY);
  assert.equal(s1.phase, PHASE.HOLDING);
  assert.ok(Object.isFrozen(s1));
});

test("pucker measure = mouth width / face width, independent of distance to camera", () => {
  const face = (scale) => {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    lm[LM.faceLeft] = { x: 0.5 - 0.2 * scale, y: 0.5 };
    lm[LM.faceRight] = { x: 0.5 + 0.2 * scale, y: 0.5 };
    lm[LM.mouthLeft] = { x: 0.5 - 0.08 * scale, y: 0.6 };
    lm[LM.mouthRight] = { x: 0.5 + 0.08 * scale, y: 0.6 };
    return lm;
  };
  const near = EXERCISES.pucker.measure(face(1.0), 640, 480);
  const far = EXERCISES.pucker.measure(face(0.5), 640, 480);
  assert.ok(Math.abs(near - 0.4) < 1e-9);
  assert.ok(Math.abs(near - far) < 1e-9);
});
