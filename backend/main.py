"""
PoseTrack バックエンド API

姿勢モニタリングの記録を保存・取得する REST API。
SQLite でデータを永続化する（サーバーを再起動しても消えない）。

起動方法:
  uvicorn backend.main:app --reload

API ドキュメント:
  http://localhost:8000/docs
"""

import sqlite3
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime

app = FastAPI(title="PoseTrack API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # 学習用。本番では許可するオリジンを絞ること
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- データベース ---
DB_PATH = Path(__file__).parent / "posture.db"


def get_db():
    """SQLite 接続を取得する"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """テーブルが存在しなければ作成する"""
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            good_seconds REAL NOT NULL,
            bad_seconds REAL NOT NULL,
            score INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


init_db()


class PostureRecord(BaseModel):
    """フロントエンドから送られる1セッション分の姿勢記録"""
    good_seconds: float
    bad_seconds: float


@app.get("/")
def read_root():
    return {"message": "PoseTrack API へようこそ"}


@app.post("/records")
def create_record(record: PostureRecord):
    """姿勢記録を1件保存する"""
    total = record.good_seconds + record.bad_seconds
    score = round(record.good_seconds / total * 100) if total > 0 else 0
    created_at = datetime.now().isoformat()

    conn = get_db()
    conn.execute(
        "INSERT INTO records (good_seconds, bad_seconds, score, created_at) VALUES (?, ?, ?, ?)",
        (record.good_seconds, record.bad_seconds, score, created_at),
    )
    conn.commit()
    conn.close()

    return {
        "message": "保存しました",
        "record": {
            "good_seconds": record.good_seconds,
            "bad_seconds": record.bad_seconds,
            "score": score,
            "created_at": created_at,
        },
    }


@app.get("/records")
def get_records():
    """保存済みの姿勢記録を全件返す（新しい順）"""
    conn = get_db()
    rows = conn.execute("SELECT * FROM records ORDER BY id DESC").fetchall()
    conn.close()
    records = [dict(row) for row in rows]
    return {"count": len(records), "records": records}
