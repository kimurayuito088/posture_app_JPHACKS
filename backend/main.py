"""
PoseTrack バックエンド API

姿勢モニタリングの記録を保存・取得する REST API。
現在はインメモリ保存（サーバー再起動で消える）。DB 連携は今後実装予定。

起動方法:
  uvicorn backend.main:app --reload

API ドキュメント:
  http://localhost:8000/docs
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime

app = FastAPI(title="PoseTrack API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # 学習用。本番では許可するオリジンを絞ること
    allow_methods=["*"],
    allow_headers=["*"],
)


class PostureRecord(BaseModel):
    """フロントエンドから送られる1セッション分の姿勢記録"""
    good_seconds: float
    bad_seconds: float


# インメモリストア（本番では DB に置き換える）
records: list[dict] = []


@app.get("/")
def read_root():
    return {"message": "PoseTrack API へようこそ"}


@app.post("/records")
def create_record(record: PostureRecord):
    """姿勢記録を1件保存する"""
    saved = {
        "good_seconds": record.good_seconds,
        "bad_seconds": record.bad_seconds,
        "created_at": datetime.now().isoformat(),
    }
    records.append(saved)
    return {"message": "保存しました", "record": saved}


@app.get("/records")
def get_records():
    """保存済みの姿勢記録を全件返す"""
    return {"count": len(records), "records": records}
