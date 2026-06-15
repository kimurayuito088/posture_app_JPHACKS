const button = document.getElementById("startButton");
const message = document.getElementById("message");
const video = document.getElementById("video");

button.addEventListener("click", async function () {
  message.textContent = "カメラを起動しています...";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    message.textContent = "カメラが起動しました！";
  } catch (error) {
    message.textContent = "カメラを起動できませんでした: " + error;
  }
});