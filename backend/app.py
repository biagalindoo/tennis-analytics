import json
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA_DIR = ROOT / "tennis-dashboard" / "public" / "data"
HISTORY_DB_PATH = ROOT / "data" / "tennis_history.db"

app = FastAPI(
    title="Tennis Analytics API",
    version="1.0.0",
    description="Rankings, torneios, partidas e histórico ATP/WTA.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _read_json(filename: str) -> dict:
    path = PUBLIC_DATA_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=503, detail=f"{filename} ainda não foi gerado pelo ETL.")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Falha ao ler {filename}.") from exc


@app.get("/api/health", tags=["Sistema"])
def health() -> dict:
    return {
        "status": "ok",
        "rankingsReady": (PUBLIC_DATA_DIR / "rankings.json").exists(),
        "eventsReady": (PUBLIC_DATA_DIR / "events.json").exists(),
        "historyReady": HISTORY_DB_PATH.exists(),
    }


@app.get("/api/rankings", tags=["Rankings"])
def rankings(tour: Optional[str] = Query(default=None, pattern="^(ATP|WTA)$")) -> dict:
    payload = _read_json("rankings.json")
    if not tour:
        return payload
    tour_data = (payload.get("tours") or {}).get(tour)
    if not tour_data:
        raise HTTPException(status_code=404, detail="Circuito não encontrado.")
    return {"generatedAt": payload.get("generatedAt"), "source": payload.get("source"), "tour": tour_data}


@app.get("/api/events", tags=["Eventos"])
def events(
    tour: Optional[str] = Query(default=None, pattern="^(ATP|WTA)$"),
    state: Optional[str] = Query(default=None, pattern="^(in|pre|post)$"),
) -> dict:
    payload = _read_json("events.json")
    matches = payload.get("matches") or []
    if tour:
        matches = [match for match in matches if match.get("tour") == tour]
    if state:
        matches = [match for match in matches if match.get("state") == state]
    return {**payload, "matches": matches, "count": len(matches)}


@app.get("/api/ranking-history", tags=["Jogadores"])
def ranking_history() -> dict:
    return _read_json("ranking-history.json")


@app.get("/api/players/{tour}/{athlete_id}/history", tags=["Jogadores"])
def player_history(tour: str, athlete_id: str) -> dict:
    tour = tour.upper()
    if tour not in {"ATP", "WTA"}:
        raise HTTPException(status_code=400, detail="Circuito deve ser ATP ou WTA.")
    if not HISTORY_DB_PATH.exists():
        raise HTTPException(status_code=503, detail="Histórico ainda não foi inicializado.")

    connection = sqlite3.connect(HISTORY_DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT player, snapshot_date, rank, points
            FROM ranking_history
            WHERE tour = ? AND athlete_id = ?
            ORDER BY snapshot_date ASC
            """,
            (tour, athlete_id),
        ).fetchall()
    finally:
        connection.close()
    if not rows:
        raise HTTPException(status_code=404, detail="Jogador sem histórico.")
    return {
        "tour": tour,
        "athleteId": athlete_id,
        "player": rows[-1]["player"],
        "history": [
            {"date": row["snapshot_date"], "rank": row["rank"], "points": row["points"]}
            for row in rows
        ],
    }
