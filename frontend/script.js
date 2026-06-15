const button = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const skeletonToggle = document.getElementById("skeletonToggle");
const message = document.getElementById("message");
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const canvasCtx = canvas.getContext("2d");

// カメラを入れておく箱（後から作る・止めるので let）
let camera = null;

// --- 肩の角度を計算する関数（Python版と同じロジック） ---
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
  // canvasを一度まっさらにして、カメラ映像を描く
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  canvasCtx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (results.poseLandmarks) {
    // スイッチがONのときだけ骨格の線と点を描画
    if (skeletonToggle.checked) {
      drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
        { color: "#00FF00", lineWidth: 2 });
      drawLandmarks(canvasCtx, results.poseLandmarks,
        { color: "#FF0000", lineWidth: 1 });
    }

    // 左肩(11)と右肩(12)を取り出して角度を計算
    const left = results.poseLandmarks[11];
    const right = results.poseLandmarks[12];
    const angle = calculateShoulderAngle(left, right);
    const angleAbs = Math.abs(angle);

    // 状態に応じてメッセージを変える
    if (angleAbs > 15) {
      const action = angle > 0 ? "右肩を下げましょう" : "左肩を下げましょう";
      message.textContent = `肩が傾いています。${action}（${angle.toFixed(1)}°）`;
    } else if (angleAbs < 5) {
      message.textContent = `良い姿勢です！その調子です！（${angle.toFixed(1)}°）`;
    } else {
      message.textContent = `現在の傾き: ${angle.toFixed(1)}°`;
    }
  }
}

// --- MediaPipe Pose の準備 ---
const pose = new Pose({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
});
pose.setOptions({
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});
pose.onResults(onResults);

// --- ボタンを押したらカメラを起動して検出開始 ---
button.addEventListener("click", function () {
  message.textContent = "カメラを起動しています...";
  camera = new Camera(video, {
    onFrame: async () => {
      await pose.send({ image: video });
    },
    width: 480,
    height: 360,
  });
  camera.start();
});

// --- ストップボタンでカメラを止める ---
stopButton.addEventListener("click", function () {
  if (camera) {
    camera.stop();
    camera = null;
  }
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  message.textContent = "停止しました。";
});