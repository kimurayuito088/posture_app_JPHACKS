#未使用
import cv2
import mediapipe as mp
from plyer import notification
import time

# MediaPipeの準備
mp_pose = mp.solutions.pose
pose = mp_pose.Pose()

# 通知関数
def notify(msg):
    notification.notify(
        title="姿勢アラート",
        message=msg,
        timeout=3
    )

cap = cv2.VideoCapture(0)
last_notify = 0

while True:
    success, frame = cap.read()
    if not success:
        break

    # 鏡表示
    frame = cv2.flip(frame, 1)

    # 姿勢推定
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = pose.process(rgb)

    # 首の角度を計算（肩と耳で近似）
    if results.pose_landmarks:
        lm = results.pose_landmarks.landmark
        shoulder = lm[11]  # 左肩
        ear = lm[7]        # 左耳

        dy = ear.y - shoulder.y
        dx = ear.x - shoulder.x
        angle = abs(dy / (dx + 1e-6))

        # ある程度前のめりならアラート
        if angle < 0.5 and (time.time() - last_notify > 10):
            notify("首が前に出ています！少し休憩しましょう。")
            last_notify = time.time()

    cv2.imshow("Posture Detector (qで終了)", frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
