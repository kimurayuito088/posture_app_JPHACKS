POSE_CONFIG = {
    'static_image_mode': False,           # 動画の場合はFalse、静止画検出ならTrue
    'model_complexity': 1,                 # モデルの複雑度 0-2（高いほど精度UP・遅くなる）
    'enable_segmentation': False,         # セグメンテーション（背景除去）を使うか
    'min_detection_confidence': 0.5,      # 検出信頼度の閾値
    'min_tracking_confidence': 0.5,       # トラッキング信頼度の閾値
}
