const button = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const skeletonToggle = document.getElementById("skeletonToggle");
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const canvasCtx = canvas.getContext("2d");
const placeholder = document.getElementById("placeholder");
const statusBar = document.getElementById("statusBar");
const statusIcon = document.getElementById("statusIcon");
const statusText = document.getElementById("statusText");
const angleDisplay = document.getElementById("angleDisplay");
const angleValue = document.getElementById("angleValue");
const errorPanel = document.getElementById("errorPanel");
const errorHelp = document.getElementById("errorHelp");

let stream = null;       // カメラの映像ストリーム
let detecting = false;   // 検出中かどうか

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

// --- 肩の角度を計算する関数 ---
function calculateShoulderAngle(left, right) {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

  if (angleDeg > 90) angleDeg -= 180;
  else if (angleDeg < -90) angleDeg += 180;

  return angleDeg;
}

// --- MediaPipeが検出結果を返すたびに呼ばれる関数 ---
function onResults(results) {
  canvas.width = results.image.width;
  canvas.height = results.image.height;

  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  canvasCtx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (results.poseLandmarks) {
    if (skeletonToggle.checked) {
      drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
        { color: "rgba(0, 255, 128, 0.6)", lineWidth: 2 });
      drawLandmarks(canvasCtx, results.poseLandmarks,
        { color: "rgba(255, 100, 100, 0.7)", lineWidth: 1, radius: 3 });
    }

    const left = results.poseLandmarks[11];
    const right = results.poseLandmarks[12];
    const angle = calculateShoulderAngle(left, right);
    const angleAbs = Math.abs(angle);

    angleValue.textContent = angle.toFixed(1) + "°";

    if (angleAbs > 15) {
      const action = angle > 0 ? "右肩を下げましょう" : "左肩を下げましょう";
      setStatus("bad", "肩が傾いています — " + action);
    } else if (angleAbs < 5) {
      setStatus("good", "良い姿勢です！");
    } else {
      setStatus("warning", "少し傾いています（" + angle.toFixed(1) + "°）");
    }
  }
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
  requestAnimationFrame(detectLoop);  // 次のフレームを予約
}

// --- スタートボタン ---
button.addEventListener("click", async function () {
  setStatus("loading", "カメラを起動しています...");
  errorPanel.style.display = "none";
  placeholder.style.display = "none";
  angleDisplay.style.display = "flex";

  try {
    // カメラ本来の比率のまま取得（前面カメラを優先）
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    detecting = true;
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

// --- ストップボタン ---
stopButton.addEventListener("click", function () {
  detecting = false;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());  // カメラを止める
    stream = null;
  }
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  setStatus("idle", "停止しました");
  placeholder.style.display = "flex";
  angleDisplay.style.display = "none";
  button.disabled = false;
  stopButton.disabled = true;
});
