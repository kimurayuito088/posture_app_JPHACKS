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

let stream = null;        // カメラの映像ストリーム
let detecting = false;    // 検出中かどうか

// --- キャリブレーション関連 ---
let phase = "idle";              // idle / calibrating / monitoring
let baseline = null;            // 良い姿勢の基準値
let calibrationSamples = [];    // 基準測定中に集めるデータ
let calibrationStart = 0;       // 基準測定の開始時刻
const CALIBRATION_MS = 3000;    // 基準測定にかける時間（3秒）

// --- 判定のしきい値（基準からのズレ） ---
const TILT_THRESHOLD = 8;        // 肩・頭の傾き（度）
const FORWARD_RATIO = 1.12;      // 前のめり（肩幅が基準の何倍になったら）
const SLOUCH_RATIO = 0.85;       // 猫背（首の縦比が基準の何倍を下回ったら）

// --- ステータスバーを更新する関数 ---
function setStatus(type, text) {
  statusBar.className = "status-bar status-" + type;
  statusText.textContent = text;
}

// --- カメラエラー時の案内メッセージを生成 ---
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

// --- 2点を結ぶ線の傾き（度・-90〜+90に正規化） ---
function lineAngle(a, b) {
  let deg = Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
  if (deg > 90) deg -= 180;
  else if (deg < -90) deg += 180;
  return deg;
}

// --- 2点間の距離 ---
function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// --- 各種の姿勢指標を計算する ---
function getMetrics(lm) {
  const earL = lm[7];
  const earR = lm[8];
  const shoulderL = lm[11];
  const shoulderR = lm[12];

  const shoulderWidth = distance(shoulderL, shoulderR);
  const earMidY = (earL.y + earR.y) / 2;
  const shoulderMidY = (shoulderL.y + shoulderR.y) / 2;

  return {
    shoulderTilt: lineAngle(shoulderL, shoulderR),   // 肩の左右の傾き
    headTilt: lineAngle(earL, earR),                 // 頭・首の左右の傾き
    shoulderWidth: shoulderWidth,                    // 肩幅（前のめりで増える）
    neckRatio: (shoulderMidY - earMidY) / shoulderWidth, // 首の縦比（猫背で減る）
  };
}

// --- 基準（baseline）からズレを判定してメッセージを返す ---
function judge(m) {
  const issues = [];

  // 前のめり（最優先：画面に近づきすぎ）
  if (m.shoulderWidth > baseline.shoulderWidth * FORWARD_RATIO) {
    issues.push("前のめりです。背を起こしましょう");
  }
  // 猫背（頭が前に落ちている）
  if (m.neckRatio < baseline.neckRatio * SLOUCH_RATIO) {
    issues.push("猫背気味です。あごを引きましょう");
  }
  // 頭の傾き（鏡表示に合わせて左右を表記）
  const headDev = m.headTilt - baseline.headTilt;
  if (Math.abs(headDev) > TILT_THRESHOLD) {
    issues.push(headDev > 0 ? "頭が左に傾いています" : "頭が右に傾いています");
  }
  // 肩の傾き
  const shoulderDev = m.shoulderTilt - baseline.shoulderTilt;
  if (Math.abs(shoulderDev) > TILT_THRESHOLD) {
    issues.push(shoulderDev > 0 ? "左肩が下がっています" : "右肩が下がっています");
  }

  return issues;
}

// --- MediaPipeが検出結果を返すたびに呼ばれる関数 ---
function onResults(results) {
  canvas.width = results.image.width;
  canvas.height = results.image.height;

  // 鏡のように左右反転して表示（自撮りの自然な見え方にする）
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
    // 基準を測定中：データを集める
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
    // 基準からの肩のズレを参考値として表示
    angleValue.textContent = (metrics.shoulderTilt - baseline.shoulderTilt).toFixed(1) + "°";

    if (issues.length === 0) {
      setStatus("good", "良い姿勢です！");
    } else if (issues.length === 1) {
      setStatus("warning", issues[0]);
    } else {
      setStatus("bad", issues[0]);  // 複数あるときは最優先の1件を表示
    }
  }
}

// --- 集めたサンプルの平均をとって基準を作る ---
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

// --- 基準測定を開始する ---
function startCalibration() {
  phase = "calibrating";
  calibrationSamples = [];
  calibrationStart = performance.now();
  recalibButton.disabled = true;
}

// --- MediaPipe Pose の準備 ---
const pose = new Pose({
  locateFile: (file) => "https://cdn.jsdelivr.net/npm/@mediapipe/pose/" + file,
});
pose.setOptions({
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});
pose.onResults(onResults);

// --- 1フレームずつMediaPipeに送り続けるループ ---
async function detectLoop() {
  if (!detecting) return;
  await pose.send({ image: video });
  requestAnimationFrame(detectLoop);
}

// --- スタートボタン ---
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
    startCalibration();   // 起動したらまず基準測定
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

// --- 再調整ボタン（基準を取り直す） ---
recalibButton.addEventListener("click", function () {
  if (detecting) startCalibration();
});

// --- ストップボタン ---
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
