let activeTrial = null;
let onSystemCount = () => {};

export function recordSystemCount() {
  if (activeTrial) {
    activeTrial.systemCount += 1;
    onSystemCount(activeTrial.systemCount);
  }
}

export function initEvaluation({ canStart, getExercise }) {
  const $ = (id) => document.getElementById(id);
  const participant = $("evalParticipant");
  const light = $("evalLight");
  const start = $("evalStart");
  const valid = $("evalValid");
  const invalid = $("evalInvalid");
  const cancel = $("evalCancel");
  const download = $("evalDownload");
  const message = $("evalMessage");
  const rows = [];
  const lockedControls = [
    participant, light, $("calibBtn"), $("resetBtn"), $("holdSel"),
    $("exerciseSel"), $("targetSel"),
  ];
  let priorDisabled = [];

  onSystemCount = (count) => {
    message.textContent = `第 ${activeTrial.number} 下進行中，系統加了 ${count} 次。`;
  };

  start.addEventListener("click", () => {
    if (activeTrial) return;
    const code = participant.value.trim().toUpperCase();
    if (!/^P[1-9][0-9]{0,2}$/.test(code)) {
      message.textContent = "請輸入受測代號，例如 P1。";
      return;
    }
    if (!canStart()) {
      message.textContent = "請先校正，正對鏡頭並完全放鬆，再開始記錄。";
      return;
    }

    activeTrial = {
      number: rows.length + 1,
      participant: code,
      exercise: getExercise(),
      light: light.value,
      holdSeconds: Number($("holdSel").value),
      started: new Date().toISOString(),
      systemCount: 0,
    };
    priorDisabled = lockedControls.map((control) => control.disabled);
    lockedControls.forEach((control) => { control.disabled = true; });
    setTrialButtons(true);
    onSystemCount(0);
  });

  function setTrialButtons(trialOpen) {
    start.disabled = trialOpen;
    valid.disabled = !trialOpen;
    invalid.disabled = !trialOpen;
    cancel.disabled = !trialOpen;
    download.disabled = trialOpen || rows.length === 0;
  }

  function closeTrial() {
    activeTrial = null;
    lockedControls.forEach((control, i) => {
      control.disabled = priorDisabled[i];
    });
    setTrialButtons(false);
  }

  function finishTrial(humanCount) {
    if (!activeTrial) return;
    rows.push({ ...activeTrial, humanCount });
    closeTrial();
    message.textContent = `已記錄 ${rows.length} 下。請先放鬆，再開始下一下。`;
  }

  valid.addEventListener("click", () => finishTrial(1));
  invalid.addEventListener("click", () => finishTrial(0));
  cancel.addEventListener("click", () => {
    if (!activeTrial) return;
    closeTrial();
    message.textContent = "已取消本下紀錄。請先放鬆，再重新開始。";
  });

  download.addEventListener("click", () => {
    const header = [
      "試次", "受測代號", "動作", "光線", "維持秒數",
      "開始時間（UTC）", "人工合格（1或0）", "系統加次數", "多算", "少算",
    ];
    const data = rows.map((row) => [
      row.number, row.participant, row.exercise, row.light, row.holdSeconds,
      row.started, row.humanCount, row.systemCount,
      Math.max(0, row.systemCount - row.humanCount),
      Math.max(0, row.humanCount - row.systemCount),
    ]);
    const csv = [header, ...data].map((row) =>
      row.map((value) => '"' + String(value).replaceAll('"', '""') + '"').join(",")
    ).join("\r\n");

    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "oral-counter-evaluation.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });

  setTrialButtons(false);
}
