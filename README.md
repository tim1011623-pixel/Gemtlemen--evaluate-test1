# 口咽肌肉訓練計數：網頁原型

用手機或電腦的前鏡頭，偵測臉部特徵點，自動計算「嘟嘴」做了幾下。
只有幾個檔案、不需要安裝任何套件或建置工具。

| 檔案 | 內容 | 要改它的時候 |
|---|---|---|
| `index.html` | 畫面上有哪些東西（影像、次數、按鈕） | 加按鈕、改文字 |
| `style.css` | 顏色、字體大小 | 改外觀 |
| `app.js` | 開相機、載入 MediaPipe、每一幀把數字交給計數規則 | 加校正流程、加功能 |
| `exercises.js` | 每個動作「量哪兩個點的距離」 | **加新動作** |
| `counter.js` | 計數規則：75% 門檻、遲滯、維持計時 | 調整規則 |
| `counter.test.mjs` | 用假數字測試計數規則 | 每次改 `counter.js` 或 `exercises.js` 後跑一次 |

## 它怎麼數

1. **量**：每一幀算 `A(t) = 兩側嘴角距離 ÷ 臉寬`（除以臉寬，所以離鏡頭遠近不影響）。
2. **校正**：按「校正」→ 放鬆 3 秒 → 盡力嘟嘴 3 秒。取兩段的中位數得到 `A_rest`、`A_max`。
3. **進度**：`p(t) = (A(t) − A_rest) ÷ (A_max − A_rest)`，0 = 放鬆、1 = 自己的最大幅度。
4. **到位**：`p ≥ 0.75`（就是作品說明書中的 `A(t) ≥ A_rest + 0.75·(A_max − A_rest)`）。
5. **遲滯**：到位後，要掉到 `p < 0.60` 才算「放掉」，避免在門檻附近抖動被算很多下。
6. **維持**：到位後連續維持 3 秒（可選 2/3/5/10 秒）→ 計數 +1。
7. **放鬆**：數完一下後，要放鬆到 `p ≤ 0.30` 才能做下一下。

這些數字都在 `counter.js` 最上面的 `DEFAULTS`。

## 在自己電腦上執行

相機只能在 `https://` 或 `http://localhost` 的網頁上使用，所以**不能直接雙擊 `index.html`**，要開一個小伺服器：

```bash
cd prototype
python3 -m http.server 8000
```

然後用 Chrome 打開 <http://localhost:8000>，按「開啟相機」並允許使用相機。

第一次開啟會從網路下載 MediaPipe（約十幾 MB），需要網路。

## 跑測試

```bash
node --test prototype/counter.test.mjs
```

全部顯示 ✔ 才代表計數規則沒有被改壞。

## 放到 GitHub Pages（用手機開）

手機要用相機必須是 `https://` 網址，GitHub Pages 剛好提供：

1. 在 GitHub 建一個新的 repository（例如 `oral-counter`），**設為 Public**。
2. 把 `prototype/` 裡面的檔案上傳到 repository 的根目錄（`index.html` 要在最外層）。
3. Repository → Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main`、資料夾選 `/ (root)` → Save。
4. 等 1–2 分鐘，網址會是 `https://你的帳號.github.io/oral-counter/`，用手機打開即可。

注意：上傳前確認裡面沒有任何人的照片、影片或個資。這個網頁本身不會上傳影像。

## 加下一個動作（例：張大嘴）

1. 在 `exercises.js` 的 `LM` 加需要的點，在 `EXERCISES` 照 `pucker` 的格式加一個：

   ```js
   mouthOpen: Object.freeze({
     name: "張大嘴",
     hint: "嘴巴盡量張大",
     points: [LM.upperLipIn, LM.lowerLipIn, LM.faceLeft, LM.faceRight],
     measure: (lm, width, height) =>
       dist(lm[LM.upperLipIn], lm[LM.lowerLipIn], width, height) / faceWidth(lm, width, height),
   }),
   ```

2. 在 `app.js` 把 `const exercise = EXERCISES.pucker;` 改成讓使用者選（見 `PROMPTS.md` 第 2 個例子）。
3. 在 `counter.test.mjs` 加一個測試：做一個假的臉，確認 `measure()` 算出來的數字對。
4. 實際用鏡頭試：校正後看進度條是不是「放鬆 ≈ 0、盡力 ≈ 1」。

找特徵點編號：MediaPipe 官方的 face mesh 編號圖
<https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png>

建議的特徵（請實測確認）：

| 動作 | 量什麼 | 點 |
|---|---|---|
| 嘟嘴（已完成） | 嘴角距離 ÷ 臉寬（變小） | 61、291 ÷ 234、454 |
| 張大嘴 | 上下唇內緣距離 ÷ 臉寬（變大） | 13、14 ÷ 234、454 |
| 咧嘴笑 | 嘴角距離 ÷ 臉寬（變大） | 61、291 ÷ 234、454 |
| 河豚鼓鼓 | 臉頰下緣距離 ÷ 兩眼外眼角距離（變大，變化小） | 自己找，外眼角 33、263 |

## 版本

- MediaPipe Tasks Vision `0.10.14`（固定版本，寫在 `app.js` 最上面）。要升級時兩個網址的版本號一起改，並重新測試。
- 模型：`face_landmarker/float16/1`。

## 範圍說明

- 這是本隊自己寫的程式；沒有使用指導老師實驗室 iOS App 的任何程式、動畫或資料。
- 動作示範影片只放連結（洪菁霞老師，經同意引用），不嵌入、不下載。
- 本工具是口咽肌肉訓練的練習輔助，不做診斷或治療。
