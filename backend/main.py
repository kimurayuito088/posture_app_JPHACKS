from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime

# FastAPIアプリ本体を作る
app = FastAPI()

# ブラウザ（別の場所で動くフロント）からアクセスを許可する設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # どこからのアクセスも許可（学習用。本番では絞る）
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 受け取るデータの形を定義 ---
# フロントから送られてくるJSONがこの形かどうかを自動チェックしてくれる
class PostureRecord(BaseModel):
    good_seconds: float   # 良い姿勢だった秒数
    bad_seconds: float    # 悪い姿勢だった秒数


# --- データの保存場所（今はメモリ上のリスト。サーバーを止めると消える） ---
records = []


# トップにアクセスされたら挨拶を返す
@app.get("/")
def read_root():
    return {"message": "PoseTrack API へようこそ"}


# --- 姿勢データを受け取って保存する（POST） ---
@app.post("/records")
def create_record(record: PostureRecord):
    saved = {
        "good_seconds": record.good_seconds,
        "bad_seconds": record.bad_seconds,
        "created_at": datetime.now().isoformat(),  # 保存した日時を自動で付ける
    }
    records.append(saved)
    return {"message": "保存しました", "record": saved}


# --- 保存した記録を一覧で返す（GET） ---
@app.get("/records")
def get_records():
    return {"count": len(records), "records": records}
