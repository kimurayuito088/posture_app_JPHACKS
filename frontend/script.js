/**
 * PoseTrack - フロントエンド メインロジック
 *
 * 処理の流れ:
 *   1. スタートボタン → カメラ起動 → キャリブレーション（3秒）
 *   2. キャリブレーション完了 → 基準(baseline)を保存
 *   3. 毎フレーム: MediaPipe で姿勢検出 → getMetrics() → judge() → 表示更新
 *   4. 悪い姿勢が3秒続いたら checkAlert() で警告音+赤フラッシュ（直すまで繰り返し）
 *
 * 鏡表示: Canvas を左右反転して描画するため、judge() 内の左右テキストも反転済み
 */

// ============================================================
// DOM 要素の取得
// ============================================================
const button = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const recalibButton = document.getElementById("recalibButton");
const skeletonToggle = document.getElementById("skeletonToggle");
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const canvasCtx = canvas.getContext("2d");
const placeholder = document.getElementById("placeholder");
const statusBar = document.getElementById("statusBar");
const statusText = document.getElementById("statusText");
const angleDisplay = document.getElementById("angleDisplay");
const angleValue = document.getElementById("angleValue");
const errorPanel = document.getElementById("errorPanel");
const errorHelp = document.getElementById("errorHelp");

// ============================================================
// 状態管理
// ============================================================
let stream = null;
let detecting = false;

// --- キャリブレーション ---
let phase = "idle";              // "idle" | "calibrating" | "monitoring"
let baseline = null;             // キャリブレーションで得た基準値 (getMetrics の戻り値と同じ形)
let calibrationSamples = [];
let calibrationStart = 0;
const CALIBRATION_MS = 3000;     // 基準測定にかける時間（ミリ秒）

// --- 判定しきい値 ---
const TILT_THRESHOLD = 8;       // 肩・頭の傾き許容範囲（度）
const FORWARD_RATIO = 1.12;     // 前のめり判定: 肩幅が基準の何倍以上か
const SLOUCH_RATIO = 0.85;      // 猫背判定: 首の縦比が基準の何倍を下回るか

// --- アラート制御 ---
const ALERT_DELAY_MS = 3000;    // 悪い姿勢がこの時間続いたら初回警告（ミリ秒）
const ALERT_REPEAT_MS = 4000;   // 姿勢が悪い間、この間隔で警告を繰り返す（ミリ秒）
let badPoseStart = 0;           // 悪い姿勢が始まった時刻（0 = 現在は良い姿勢）
let lastAlertTime = 0;          // 最後に警告音を鳴らした時刻
let audioCtx = null;            // Web Audio API コンテキスト（初回使用時に初期化）

// ============================================================
// ユーティリティ関数
// ============================================================

/** ステータスバーの色とテキストを更新する */
function setStatus(type, text) {
  statusBar.className = "status-bar status-" + type;
  statusText.textContent = text;
}

/**
 * 2点を結ぶ線の角度を返す（度）
 * 返り値は -90 〜 +90 に正規化される
 */
function lineAngle(a, b) {
  let deg = Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
  if (deg > 90) deg -= 180;
  else if (deg < -90) deg += 180;
  return deg;
}

/** 2点間のユークリッド距離を返す */
function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// ============================================================
// アラート（警告音・視覚フラッシュ）
// ============================================================

/**
 * Web Audio API で「ポッ…ポッ」と2段階のビープ音を鳴らす
 * 外部の音声ファイルが不要で、ブラウザだけで動作する
 */
function playAlertSound() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // 1音目: 520Hz を 0.15秒
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = "sine";
  osc.frequency.value = 520;
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.15);

  // 2音目: 620Hz を 0.15秒（0.2秒後に開始）
  const osc2 = audioCtx.createOscillator();
  const gain2 = audioCtx.createGain();
  osc2.connect(gain2);
  gain2.connect(audioCtx.destination);
  osc2.type = "sine";
  osc2.frequency.value = 620;
  gain2.gain.setValueAtTime(0.3, audioCtx.currentTime + 0.2);
  gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
  osc2.start(audioCtx.currentTime + 0.2);
  osc2.stop(audioCtx.currentTime + 0.35);
}

/** 画面全体を赤くフラッシュさせる（0.6秒で消える） */
function showFlash() {
  const flash = document.getElementById("alertFlash");
  flash.classList.add("active");
  setTimeout(() => flash.classList.remove("active"), 600);
}

/**
 * 悪い姿勢の持続時間を追跡し、必要に応じてアラートを発動する
 *
 * 呼び出しタイミング: 毎フレームの姿勢判定後（monitoring フェーズ内）
 *
 * ロジック:
 *   - issues が空 → 良い姿勢なのでタイマーをリセット
 *   - issues あり → badPoseStart に開始時刻を記録
 *   - ALERT_DELAY_MS 以上経過 → 警告音 + 赤フラッシュ
 *   - 姿勢が悪い間、ALERT_REPEAT_MS ごとに繰り返し警告
 *
 * @param {string[]} issues - judge() が返した問題点の配列
 */
function checkAlert(issues) {
  const soundToggle = document.getElementById("soundToggle");
  const now = performance.now();

  if (issues.length === 0) {
    badPoseStart = 0;
    return;
  }

  if (badPoseStart === 0) {
    badPoseStart = now;
    return;
  }

  const elapsed = now - badPoseStart;

  if (elapsed >= ALERT_DELAY_MS && now - lastAlertTime > ALERT_REPEAT_MS) {
    lastAlertTime = now;
    if (soundToggle && soundToggle.checked) {
      playAlertSound();
    }
    showFlash();
  }
}

// ============================================================
// カメラエラーハンドリング
// ============================================================

/**
 * カメラ取得エラーに応じた、デバイス別の案内メッセージを返す
 * @param {DOMException} error - getUserMedia が投げたエラー
 * @returns {string} ユーザー向け案内テキスト
 */
function getCameraErrorHelp(error) {
  if (error.name === "NotAllowedError") {
    const isIOS = /iPhone|iPad/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);
    if (isIOS) {
      return "iPhoneの「設定」アプリ → お使いのブラウザ（Safari/Chrome）→「カメラ」をオンにしてください。その後、このページを再読み込みしてください。";
    } else if (isAndroid) {
      return "ブラウザの設定 →「サイトの設定」→「カメラ」を許可してください。その後、このページを再読み込みしてください。";
    } else {
      return "ブラウザのアドレスバー左のアイコンをクリック →「カメラ」を「許可」に変更してください。その後、再読み込みしてください。";
    }
  } else if (error.name === "NotFoundError") {
    return "カメラが見つかりません。カメラが接続されているか確認してください。";
  } else if (error.name === "NotReadableError") {
    return "カメラが他のアプリで使用中です。他のアプリを閉じてからもう一度お試しください。";
  }
  return "エラー: " + error.message;
}

// ============================================================
// 姿勢の計測と判定
// ============================================================

/**
 * MediaPipe ランドマーク座標から4つの姿勢指標を算出する
 *
 * 使用するランドマーク:
 *   7, 8  = 左耳, 右耳
 *   11, 12 = 左肩, 右肩
 *
 * @param {Object[]} lm - MediaPipe の poseLandmarks 配列（33点）
 * @returns {{ shoulderTilt: number, headTilt: number, shoulderWidth: number, neckRatio: number }}
 */
function getMetrics(lm) {
  const earL = lm[7];
  const earR = lm[8];
  const shoulderL = lm[11];
  const shoulderR = lm[12];

  const shoulderWidth = distance(shoulderL, shoulderR);
  const earMidY = (earL.y + earR.y) / 2;
  const shoulderMidY = (shoulderL.y + shoulderR.y) / 2;

  return {
    shoulderTilt: lineAngle(shoulderL, shoulderR),
    headTilt: lineAngle(earL, earR),
    shoulderWidth: shoulderWidth,
    neckRatio: (shoulderMidY - earMidY) / shoulderWidth,
  };
}

/**
 * 現在の指標と基準(baseline)を比較し、問題点のリストを返す
 *
 * 配列の順番 = 優先度（前のめり > 猫背 > 頭の傾き > 肩の傾き）
 * 鏡表示に合わせて左右のテキストを反転済み
 *
 * @param {{ shoulderTilt: number, headTilt: number, shoulderWidth: number, neckRatio: number }} m
 * @returns {string[]} 検出した問題のメッセージ配列（空 = 良い姿勢）
 */
function judge(m) {
  const issues = [];

  if (m.shoulderWidth > baseline.shoulderWidth * FORWARD_RATIO) {
    issues.push("前のめりです。背を起こしましょう");
  }
  if (m.neckRatio < baseline.neckRatio * SLOUCH_RATIO) {
    issues.push("猫背気味です。あごを引きましょう");
  }

  const headDev = m.headTilt - baseline.headTilt;
  if (Math.abs(headDev) > TILT_THRESHOLD) {
    issues.push(headDev > 0 ? "頭が左に傾いています" : "頭が右に傾いています");
  }

  const shoulderDev = m.shoulderTilt - baseline.shoulderTilt;
  if (Math.abs(shoulderDev) > TILT_THRESHOLD) {
    issues.push(shoulderDev > 0 ? "左肩が下がっています" : "右肩が下がっています");
  }

  return issues;
}

// ============================================================
// キャリブレーション（基準測定）
// ============================================================

/**
 * 収集したサンプルの各指標の平均値を返す
 * @param {Object[]} samples - getMetrics() の戻り値の配列
 * @returns {{ shoulderTilt: number, headTilt: number, shoulderWidth: number, neckRatio: number }}
 */
function averageMetrics(samples) {
  const sum = { shoulderTilt: 0, headTilt: 0, shoulderWidth: 0, neckRatio: 0 };
  for (const s of samples) {
    sum.shoulderTilt += s.shoulderTilt;
    sum.headTilt += s.headTilt;
    sum.shoulderWidth += s.shoulderWidth;
    sum.neckRatio += s.neckRatio;
  }
  const n = samples.length;
  return {
    shoulderTilt: sum.shoulderTilt / n,
    headTilt: sum.headTilt / n,
    shoulderWidth: sum.shoulderWidth / n,
    neckRatio: sum.neckRatio / n,
  };
}

/** キャリブレーションを開始する（3秒間のサンプル収集を開始） */
function startCalibration() {
  phase = "calibrating";
  calibrationSamples = [];
  calibrationStart = performance.now();
  recalibButton.disabled = true;
}

// ============================================================
// MediaPipe Pose の初期化とメインループ
// ============================================================

const pose = new Pose({
  locateFile: (file) => "https://cdn.jsdelivr.net/npm/@mediapipe/pose/" + file,
});
pose.setOptions({
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});
pose.onResults(onResults);

/**
 * MediaPipe がフレームの検出結果を返すたびに呼ばれるコールバック
 *
 * 処理内容:
 *   1. Canvas に鏡表示で映像を描画
 *   2. 骨格オーバーレイを描画（トグルON時）
 *   3. フェーズに応じて処理を分岐:
 *      - calibrating: サンプル収集 → 3秒経過で monitoring へ遷移
 *      - monitoring:  judge() で判定 → ステータス表示 → checkAlert()
 */
function onResults(results) {
  canvas.width = results.image.width;
  canvas.height = results.image.height;

  // 鏡表示: translate + scale(-1, 1) で左右反転
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  canvasCtx.translate(canvas.width, 0);
  canvasCtx.scale(-1, 1);
  canvasCtx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (results.poseLandmarks && skeletonToggle.checked) {
    drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
      { color: "rgba(0, 255, 128, 0.6)", lineWidth: 2 });
    drawLandmarks(canvasCtx, results.poseLandmarks,
      { color: "rgba(255, 100, 100, 0.7)", lineWidth: 1, radius: 3 });
  }
  canvasCtx.restore();

  if (!results.poseLandmarks) {
    setStatus("loading", "体を検出できません。カメラに上半身を映してください");
    return;
  }

  const metrics = getMetrics(results.poseLandmarks);

  if (phase === "calibrating") {
    calibrationSamples.push(metrics);
    const remaining = Math.ceil((CALIBRATION_MS - (performance.now() - calibrationStart)) / 1000);
    setStatus("loading", `基準を測定中... 良い姿勢を保ってください（${Math.max(remaining, 0)}）`);
    angleValue.textContent = "—";

    if (performance.now() - calibrationStart >= CALIBRATION_MS) {
      baseline = averageMetrics(calibrationSamples);
      phase = "monitoring";
      recalibButton.disabled = false;
    }
    return;
  }

  if (phase === "monitoring") {
    const issues = judge(metrics);
    angleValue.textContent = (metrics.shoulderTilt - baseline.shoulderTilt).toFixed(1) + "°";

    if (issues.length === 0) {
      setStatus("good", "良い姿勢です！");
    } else if (issues.length === 1) {
      setStatus("warning", issues[0]);
    } else {
      setStatus("bad", issues[0]);
    }

    checkAlert(issues);
  }
}

/** 1フレームずつ MediaPipe に映像を送り続けるループ */
async function detectLoop() {
  if (!detecting) return;
  await pose.send({ image: video });
  requestAnimationFrame(detectLoop);
}

// ============================================================
// ボタンのイベントハンドラ
// ============================================================

button.addEventListener("click", async function () {
  setStatus("loading", "カメラを起動しています...");
  errorPanel.style.display = "none";
  placeholder.style.display = "none";
  angleDisplay.style.display = "flex";

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    detecting = true;
    badPoseStart = 0;
    lastAlertTime = 0;
    startCalibration();
    detectLoop();

    button.disabled = true;
    stopButton.disabled = false;
  } catch (error) {
    setStatus("idle", "待機中");
    placeholder.style.display = "flex";
    angleDisplay.style.display = "none";
    errorPanel.style.display = "block";
    errorHelp.textContent = getCameraErrorHelp(error);
  }
});

recalibButton.addEventListener("click", function () {
  if (detecting) startCalibration();
});

stopButton.addEventListener("click", function () {
  detecting = false;
  phase = "idle";
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  setStatus("idle", "停止しました");
  placeholder.style.display = "flex";
  angleDisplay.style.display = "none";
  button.disabled = false;
  stopButton.disabled = true;
  recalibButton.disabled = true;
});
