
// exercises.js — 每個動作「量什麼」

export const LM = Object.freeze({
  mouthLeft: 61,    // 左嘴角
  mouthRight: 291,  // 右嘴角
  upperLipIn: 13,   // 上唇內緣中央
  lowerLipIn: 14,   // 下唇內緣中央
  faceLeft: 234,    // 左臉外緣
  faceRight: 454,   // 右臉外緣
  cheekLeftLower: 416,  // 左臉頰鼓起
  noseTip: 1,           // 鼻尖作為臉部中央參考點
  eyeOuterLeft: 33,     // 左眼外眼角
  eyeOuterRight: 263,   // 右眼外眼角
});

// 兩點距離公式（換算成像素）
export function dist(p, q, width, height) {
  const dx = (p.x - q.x) * width;
  const dy = (p.y - q.y) * height;
  return Math.hypot(dx, dy);
}

export function faceWidth(lm, width, height) {
  return dist(
    lm[LM.faceLeft],
    lm[LM.faceRight],
    width,
    height
  );
}

export const EXERCISES = Object.freeze({
  // 原本的嘟嘴動作
  pucker: Object.freeze({
    name: "嘟嘴",
    hint: "嘴唇往前嘟起來，像要親親",
    points: [
      LM.mouthLeft,
      LM.mouthRight,
      LM.faceLeft,
      LM.faceRight
    ],
    measure: (lm, width, height) =>
      dist(
        lm[LM.mouthLeft],
        lm[LM.mouthRight],
        width,
        height
      ) / faceWidth(lm, width, height),
  }),

  // 新增：張大嘴動作
  mouthOpen: Object.freeze({
    name: "張大嘴",
    hint: "嘴巴盡量張大",
    points: [
      LM.upperLipIn,
      LM.lowerLipIn,
      LM.faceLeft,
      LM.faceRight
    ],
    measure: (lm, width, height) =>
      dist(
        lm[LM.upperLipIn],  // 上唇內緣（13）
        lm[LM.lowerLipIn],  // 下唇內緣（14）
        width,
        height
      ) / faceWidth(lm, width, height),
  }),

    // 新增動作：咧嘴笑
  smile: Object.freeze({
    name: "咧嘴笑",
    hint: "盡量向左右兩側展開嘴角，露出笑容",
    // 使用 61、291 測量嘴角距離，234、454 測量臉寬
    points: [LM.mouthLeft, LM.mouthRight, LM.faceLeft, LM.faceRight],
    // 嘴角距離 ÷ 臉寬，咧嘴笑時數值通常會變大
    measure: (lm, width, height) =>
      dist(lm[LM.mouthLeft], lm[LM.mouthRight], width, height) / faceWidth(lm, width, height),
  }),

 // 新增：左臉頰鼓起
  leftCheek: Object.freeze({
    name: "左臉頰鼓起",
    hint: "鼓起左邊臉頰，並用手指輕輕頂住",

    // 顯示左臉頰、鼻尖及兩眼外眼角的偵測點
    points: [
      LM.cheekLeftLower,
      LM.noseTip,
      LM.eyeOuterRight,
      LM.eyeOuterLeft
    ],

    // 左臉頰到鼻尖的距離 ÷ 兩眼外眼角距離
    // 用比例降低臉部遠近對量測值的影響
    measure: (lm, width, height) =>
      dist(
        lm[LM.cheekLeftLower],
        lm[LM.noseTip],
        width,
        height
      ) /
      dist(
        lm[LM.eyeOuterRight],
        lm[LM.eyeOuterLeft],
        width,
        height
      ),
  }),
});
