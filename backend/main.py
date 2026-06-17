"""
PoseTrack バックエンド API

姿勢モニタリングの記録を保存・取得する REST API。
SQLite でデータを永続化し、Gemini API で AI 姿勢コーチングを提供する。

起動方法:
  uvicorn backend.main:app --reload

API ドキュメント:
  http://localhost:8000/docs
"""

import os
import sqlite3
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
from dotenv import load_dotenv
from google import genai

# .env から環境変数を読み込む（APIキーはここに保存）
load_dotenv(Path(__file__).parent / ".env")

app = FastAPI(title="PoseTrack API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # 学習用。本番では許可するオリジンを絞ること
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Gemini API 初期化 ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

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


# --- リクエストモデル ---

class PostureRecord(BaseModel):
    """フロントエンドから送られる1セッション分の姿勢記録"""
    good_seconds: float
    bad_seconds: float


class CoachRequest(BaseModel):
    """AI コーチングのリクエスト"""
    good_seconds: float
    bad_seconds: float
    issues: dict[str, int]  # {"forward": 12, "slouch": 5, "headTilt": 3, "shoulderTilt": 8}


# --- エンドポイント ---

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


@app.post("/coach")
def get_coaching(req: CoachRequest):
    """セッションデータをもとに Gemini API で姿勢改善アドバイスを生成する"""
    if not gemini_client:
        return {"advice": "APIキーが設定されていません。backend/.env に GEMINI_API_KEY を設定してください。"}

    total = req.good_seconds + req.bad_seconds
    score = round(req.good_seconds / total * 100) if total > 0 else 0

    issue_names = {
        "forward": "前のめり",
        "slouch": "猫背",
        "headTilt": "頭の傾き",
        "shoulderTilt": "肩の傾き",
    }
    issue_summary = "\n".join(
        f"- {issue_names.get(k, k)}: {v}回検出"
        for k, v in req.issues.items() if v > 0
    )
    if not issue_summary:
        issue_summary = "- 特に問題は検出されませんでした"

    prompt = f"""あなたは姿勢改善の専門コーチです。
以下のセッションデータをもとに、ユーザーに具体的で実践しやすい姿勢改善アドバイスを日本語で提供してください。

## セッションデータ
- 合計時間: {total:.0f}秒
- 良い姿勢の時間: {req.good_seconds:.0f}秒
- 悪い姿勢の時間: {req.bad_seconds:.0f}秒
- スコア: {score}点（100点満点）

## 検出された問題
{issue_summary}

## 回答のルール
- 3〜5つの具体的なアドバイスを箇条書きで
- 最も多く検出された問題を優先的に改善するアドバイスを出す
- 簡単にできるストレッチや意識するポイントを含める
- 励ましの言葉を最後に一言添える
- 200文字以内で簡潔に"""

    try:
        response = gemini_client.models.generate_content(
            model="gemini-3.5-flash",
            contents=prompt,
        )
        return {"advice": response.text, "score": score}
    except Exception as e:
        return {"advice": f"AIコーチングの取得に失敗しました: {str(e)}", "score": score}
