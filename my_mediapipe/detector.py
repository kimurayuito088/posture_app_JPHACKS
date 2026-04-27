import cv2
import mediapipe as mp
import math
import time
import warnings

# --- 警告の抑制（protobuf関連） ---
warnings.filterwarnings("ignore", category=UserWarning, module='google.protobuf')

# --- MediaPipe 初期化 ---
mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils
pose = mp_pose.Pose(static_image_mode=False, model_complexity=1)

# --- アラート設定 ---
ALERT_ANGLE_THRESHOLD = 15   # アラートを出す傾きの閾値（度）
PRAISE_ANGLE_THRESHOLD = 5   # 褒める閾値（±この角度以内に戻ったら）
ALERT_INTERVAL_SEC = 10      # 連続通知防止（秒）

last_alert_time = 0
alert_triggered = False
praise_sent = False

# --- 肩の角度を計算する関数（-90〜+90°） ---
def calculate_shoulder_angle(left, right):
    dx = right['x'] - left['x']
    dy = right['y'] - left['y']
    angle_rad = math.atan2(dy, dx)
    angle_deg = math.degrees(angle_rad)

    # -180〜+180° を -90〜+90° に正規化
    if angle_deg > 90:
        angle_deg -= 180
    elif angle_deg < -90:
        angle_deg += 180

    return angle_deg  # -90〜+90°


def play_alert_beep():
    import winsound
    winsound.MessageBeep(winsound.MB_ICONHAND)

def play_praise_beep():
    import winsound
    winsound.MessageBeep(winsound.MB_ICONASTERISK)

# --- 通知 ---
def send_notification(message):
    from plyer import notification
    notification.notify(
        title="【姿勢アラート】",
        message=message,
        timeout=5
    )

# --- カメラ起動（必要に応じて番号変更） ---
cap = cv2.VideoCapture(0)


if not cap.isOpened():
    print("カメラが開けませんでした")
    exit()

try:
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = pose.process(image_rgb)
        annotated_frame = frame.copy()

        if results.pose_landmarks:
            landmarks = results.pose_landmarks.landmark
            left = {'x': landmarks[11].x, 'y': landmarks[11].y}
            right = {'x': landmarks[12].x, 'y': landmarks[12].y}

            angle = calculate_shoulder_angle(left, right)
            angle_abs = abs(angle)

            # 画面に角度を表示
            cv2.putText(annotated_frame, f"Angle: {angle:.2f} deg", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

            current_time = time.time()

            # --- アラート通知 ---
            if angle_abs > ALERT_ANGLE_THRESHOLD and (current_time - last_alert_time) > ALERT_INTERVAL_SEC:
                if angle > 0:
                    action = "右肩を下げましょう"
                else:
                    action = "左肩を下げましょう"
                message = f"肩が傾いています。{action}"
                print(f"アラート：{message}")
                send_notification(message)
                play_alert_beep()
                last_alert_time = current_time
                alert_triggered = True
                praise_sent = False  # 褒め通知リセット

            # --- 姿勢改善通知（褒める） ---
            elif alert_triggered and angle_abs < PRAISE_ANGLE_THRESHOLD and not praise_sent:
                message = "姿勢が改善されました！その調子です！"
                print(f"褒めメッセージ：{message}")
                send_notification(message)
                play_praise_beep()
                praise_sent = True
                alert_triggered = False

            # --- ランドマーク描画 ---
            mp_drawing.draw_landmarks(
                annotated_frame,
                results.pose_landmarks,
                mp_pose.POSE_CONNECTIONS
            )

        # --- 画面表示 ---
        cv2.imshow("Pose Detection", annotated_frame)

        # --- ESCキーで終了 ---
        if cv2.waitKey(1) & 0xFF == 27:
            break

finally:
    cap.release()
    pose.close()
    cv2.destroyAllWindows()
