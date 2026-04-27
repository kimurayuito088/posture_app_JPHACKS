from typing import Dict

# --- MediaPipeのランドマークオブジェクトをJSONにシリアライズしやすい辞書形式に変換する --- 
def landmarks_to_json(landmarks) -> Dict:
    result = {}
    for idx, landmark in enumerate(landmarks.landmark):
        result[f'landmark_{idx}'] = {
            'x': landmark.x,
            'y': landmark.y,
            'z': landmark.z,
            # 'visibility'はランドマークに存在する場合のみ追加
            'visibility': getattr(landmark, 'visibility', None)
        }
    return result
