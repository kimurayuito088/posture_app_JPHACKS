import streamlit as st
import cv2
import mediapipe as mp
import math
import time

# --- MediaPipe 初期化 ---
mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils

# --- アラート設定 ---
ALERT_ANGLE_THRESHOLD = 15   # アラートを出す傾きの閾値（度）
PRAISE_ANGLE_THRESHOLD = 5   # 褒める閾値（±この角度以内に戻ったら）


# --- 肩の角度を計算する関数（-90〜+90°） ---
def calculate_shoulder_angle(left, right):
    dx = right['x'] - left['x']
    dy = right['y'] - left['y']
    angle_deg = math.degrees(math.atan2(dy, dx))

    # -180〜+180° を -90〜+90° に正規化
    if angle_deg > 90:
        angle_deg -= 180
    elif angle_deg < -90:
        angle_deg += 180

    return angle_deg


# --- 画面のレイアウト ---
st.title("PoseTrack - 姿勢モニタリング")
st.write("Webカメラで肩の傾きをリアルタイムに検出します。")

run = st.checkbox("カメラを起動する")

# 映像とメッセージを表示する場所を確保
frame_placeholder = st.empty()
status_placeholder = st.empty()

if run:
    pose = mp_pose.Pose(static_image_mode=False, model_complexity=1)
    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        st.error("カメラが開けませんでした。番号を 0 から 1 に変えてみてください。")
    else:
        while run:
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)  # 鏡表示
            image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose.process(image_rgb)

            if results.pose_landmarks:
                landmarks = results.pose_landmarks.landmark
                left = {'x': landmarks[11].x, 'y': landmarks[11].y}
                right = {'x': landmarks[12].x, 'y': landmarks[12].y}

                angle = calculate_shoulder_angle(left, right)
                angle_abs = abs(angle)

                # 角度を映像に描画
                cv2.putText(frame, f"Angle: {angle:.2f} deg", (10, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

                # 状態に応じてメッセージを表示
                if angle_abs > ALERT_ANGLE_THRESHOLD:
                    action = "右肩を下げましょう" if angle > 0 else "左肩を下げましょう"
                    status_placeholder.warning(f"肩が傾いています。{action}（{angle:.1f}°）")
                elif angle_abs < PRAISE_ANGLE_THRESHOLD:
                    status_placeholder.success(f"良い姿勢です！その調子です！（{angle:.1f}°）")
                else:
                    status_placeholder.info(f"現在の傾き: {angle:.1f}°")

                # 骨格を描画
                mp_drawing.draw_landmarks(
                    frame, results.pose_landmarks, mp_pose.POSE_CONNECTIONS
                )

            # ブラウザに映像を表示（StreamlitはRGB想定なので変換）
            frame_placeholder.image(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

        cap.release()
else:
    status_placeholder.info("上のチェックボックスを押すとカメラが起動します。")
