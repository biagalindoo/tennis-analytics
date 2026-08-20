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


@app.get("/api/tournaments", tags=["Torneios"])
def tournaments(
    year: Optional[int] = None,
    tour: Optional[str] = Query(default=None, pattern="^(ATP|WTA)$"),
    search: Optional[str] = None,
    month: Optional[int] = Query(default=None, ge=1, le=12),
    surface: Optional[str] = None,
    category: Optional[str] = None,
) -> dict:
    if not HISTORY_DB_PATH.exists():
        raise HTTPException(status_code=503, detail="Histórico ainda não foi inicializado.")
    clauses = []
    params = []
    if year:
        clauses.append("tournament.year = ?")
        params.append(year)
    if tour:
        clauses.append("tournament.tours_json LIKE ?")
        params.append(f'%"{tour}"%')
    if search:
        clauses.append("lower(tournament.name) LIKE lower(?)")
        params.append(f"%{search}%")
    if month:
        calendar_year = year or 2026
        next_year = calendar_year + 1 if month == 12 else calendar_year
        next_month = 1 if month == 12 else month + 1
        month_start = f"{calendar_year}-{month:02d}-01"
        next_month_start = f"{next_year}-{next_month:02d}-01"
        clauses.append("date(tournament.end_date) >= date(?) AND date(tournament.start_date) < date(?)")
        params.extend([month_start, next_month_start])
    if surface:
        clauses.append("tournament.surface = ?")
        params.append(surface)
    if category and tour:
        clauses.append("json_extract(tournament.categories_json, ?) = ?")
        params.extend([f"$.{tour}", category])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    connection = sqlite3.connect(HISTORY_DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            f"""
            SELECT tournament.*,
                   COUNT(history.match_id) AS match_count,
                   SUM(CASE WHEN history.state = 'post' THEN 1 ELSE 0 END) AS completed_count
            FROM tournament_history AS tournament
            LEFT JOIN match_history AS history ON history.tournament_id = tournament.tournament_id
            {where}
            GROUP BY tournament.tournament_id
            ORDER BY tournament.start_date DESC
            """,
            params,
        ).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=503, detail="Arquivo de torneios ainda não foi importado.") from exc
    finally:
        connection.close()
    final_by_tournament = {}
    if tour:
        connection = sqlite3.connect(HISTORY_DB_PATH)
        try:
            final_rows = connection.execute(
                """
                SELECT tournament_id, payload_json
                FROM match_history
                WHERE tour = ? AND state = 'post'
                """,
                (tour,),
            ).fetchall()
        finally:
            connection.close()
        for tournament_id, payload_json in final_rows:
            match = json.loads(payload_json)
            if (match.get("round") or "").lower() != "final" or "singles" not in (match.get("discipline") or "").lower():
                continue
            competitors = match.get("competitors") or []
            winner = next((item for item in competitors if item.get("winner")), None)
            runner_up = next((item for item in competitors if not item.get("winner")), None)
            if winner:
                final_by_tournament[tournament_id] = {
                    "champion": winner.get("name"),
                    "runnerUp": runner_up.get("name") if runner_up else None,
                }
    items = [
        {
            "id": row["tournament_id"], "name": row["name"], "startDate": row["start_date"],
            "endDate": row["end_date"], "year": row["year"], "major": bool(row["major"]),
            "tours": json.loads(row["tours_json"]), "matchCount": row["match_count"],
            "completedCount": row["completed_count"] or 0,
            "surface": row["surface"],
            "category": (json.loads(row["categories_json"] or "{}")).get(tour) if tour else None,
            **final_by_tournament.get(row["tournament_id"], {"champion": None, "runnerUp": None}),
        }
        for row in rows
    ]
    return {"count": len(items), "tournaments": items}


@app.get("/api/tournaments/{tournament_id}/matches", tags=["Torneios"])
def tournament_matches(tournament_id: str, tour: Optional[str] = Query(default=None, pattern="^(ATP|WTA)$")) -> dict:
    connection = sqlite3.connect(HISTORY_DB_PATH)
    try:
        if tour:
            rows = connection.execute(
                "SELECT payload_json FROM match_history WHERE tournament_id = ? AND tour = ? ORDER BY match_date DESC",
                (tournament_id, tour),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT payload_json FROM match_history WHERE tournament_id = ? ORDER BY match_date DESC",
                (tournament_id,),
            ).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=503, detail="Arquivo de partidas ainda não foi importado.") from exc
    finally:
        connection.close()
    matches = [json.loads(row[0]) for row in rows]
    if not matches:
        raise HTTPException(status_code=404, detail="Torneio sem partidas armazenadas.")
    return {"tournamentId": tournament_id, "count": len(matches), "matches": matches}


@app.get("/api/players/{tour}/{athlete_id}/matches", tags=["Jogadores"])
def archived_player_matches(tour: str, athlete_id: str, name: Optional[str] = None, limit: int = Query(default=100, ge=1, le=500)) -> dict:
    tour = tour.upper()
    if tour not in {"ATP", "WTA"}:
        raise HTTPException(status_code=400, detail="Circuito deve ser ATP ou WTA.")
    connection = sqlite3.connect(HISTORY_DB_PATH)
    try:
        if name:
            rows = connection.execute(
                """
                SELECT DISTINCT history.payload_json
                FROM match_history AS history
                JOIN match_competitors AS player ON player.match_id = history.match_id
                WHERE history.tour = ? AND (player.competitor_id = ? OR lower(player.name) = lower(?))
                ORDER BY history.match_date DESC LIMIT ?
                """,
                (tour, athlete_id, name, limit),
            ).fetchall()
        else:
            rows = connection.execute(
                """
                SELECT DISTINCT history.payload_json
                FROM match_history AS history
                JOIN match_competitors AS player ON player.match_id = history.match_id
                WHERE history.tour = ? AND player.competitor_id = ?
                ORDER BY history.match_date DESC LIMIT ?
                """,
                (tour, athlete_id, limit),
            ).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=503, detail="Histórico de partidas ainda não foi gerado.") from exc
    finally:
        connection.close()
    matches = [json.loads(row[0]) for row in rows]
    return {"tour": tour, "athleteId": athlete_id, "count": len(matches), "matches": matches}


@app.get("/api/players/{tour}/{athlete_id}/stats", tags=["Jogadores"])
def player_career_stats(tour: str, athlete_id: str, name: Optional[str] = None) -> dict:
    tour = tour.upper()
    if tour not in {"ATP", "WTA"}:
        raise HTTPException(status_code=400, detail="Circuito deve ser ATP ou WTA.")
    connection = sqlite3.connect(HISTORY_DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT history.payload_json, tournament.surface, tournament.categories_json
            FROM match_history AS history
            JOIN match_competitors AS player ON player.match_id = history.match_id
            LEFT JOIN tournament_history AS tournament ON tournament.tournament_id = history.tournament_id
            WHERE history.tour = ? AND history.state = 'post'
              AND (player.competitor_id = ? OR lower(player.name) = lower(?))
            ORDER BY history.match_date DESC
            """,
            (tour, athlete_id, name or ""),
        ).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=503, detail="Estatísticas ainda não foram geradas.") from exc
    finally:
        connection.close()

    surfaces = {}
    titles = {"Grand Slam": 0, "1000": 0, "500": 0, "250": 0, "Finals": 0}
    title_list = []
    for row in rows:
        match = json.loads(row["payload_json"])
        competitor = next(
            (item for item in match.get("competitors") or [] if item.get("id") == athlete_id or (name and item.get("name", "").lower() == name.lower())),
            None,
        )
        if not competitor:
            continue
        surface = row["surface"] or "Unknown"
        bucket = surfaces.setdefault(surface, {"played": 0, "wins": 0, "losses": 0, "winRate": 0})
        bucket["played"] += 1
        if competitor.get("winner"):
            bucket["wins"] += 1
        else:
            bucket["losses"] += 1
        if competitor.get("winner") and (match.get("round") or "").lower() == "final" and "singles" in (match.get("discipline") or "").lower():
            category = (json.loads(row["categories_json"] or "{}")).get(tour)
            if category in titles:
                titles[category] += 1
                title_list.append({"tournament": match["tournament"], "date": match.get("date"), "category": category, "surface": surface})
    for bucket in surfaces.values():
        bucket["winRate"] = round(bucket["wins"] / bucket["played"] * 100) if bucket["played"] else 0
    return {
        "tour": tour, "athleteId": athlete_id, "matches": sum(item["played"] for item in surfaces.values()),
        "wins": sum(item["wins"] for item in surfaces.values()), "losses": sum(item["losses"] for item in surfaces.values()),
        "bySurface": surfaces, "titles": titles, "titleCount": sum(titles.values()), "titleList": title_list,
    }


@app.get("/api/head-to-head", tags=["Jogadores"])
def head_to_head(tour: str, player1: str, player2: str) -> dict:
    tour = tour.upper()
    if tour not in {"ATP", "WTA"}:
        raise HTTPException(status_code=400, detail="Circuito deve ser ATP ou WTA.")
    if not HISTORY_DB_PATH.exists():
        raise HTTPException(status_code=503, detail="Histórico ainda não foi inicializado.")

    connection = sqlite3.connect(HISTORY_DB_PATH)
    try:
        rows = connection.execute(
            """
            SELECT DISTINCT history.payload_json
            FROM match_history AS history
            JOIN match_competitors AS first ON first.match_id = history.match_id
            JOIN match_competitors AS second ON second.match_id = history.match_id
            WHERE history.tour = ?
              AND (first.competitor_id = ? OR lower(first.name) = lower(?))
              AND (second.competitor_id = ? OR lower(second.name) = lower(?))
              AND first.name <> second.name
            ORDER BY history.match_date DESC
            """,
            (tour, player1, player1, player2, player2),
        ).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=503, detail="Histórico de partidas ainda não foi gerado.") from exc
    finally:
        connection.close()
    matches = [json.loads(row[0]) for row in rows]
    return {"tour": tour, "players": [player1, player2], "count": len(matches), "matches": matches}


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
