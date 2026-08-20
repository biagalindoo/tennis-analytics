import json
import argparse
import time
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

from tournament_metadata import classify_tournament

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
PUBLIC_DATA_DIR = ROOT / "tennis-dashboard" / "public" / "data"
HISTORY_DB_PATH = DATA_DIR / "tennis_history.db"
SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
}


def _get_scoreboard() -> dict:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    response = requests.get(
        SCOREBOARD_URL,
        params={"dates": today, "limit": 1000},
        headers=HEADERS,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def _tour_for_group(group: dict) -> str:
    label = " ".join(
        filter(None, [group.get("slug"), group.get("displayName")])
    ).lower()
    return "WTA" if "women" in label else "ATP"


def _competitor(row: dict) -> dict:
    athlete = row.get("athlete") or {}
    roster = row.get("roster") or {}
    roster_athletes = roster.get("athletes") or []
    primary_athlete = athlete or (roster_athletes[0] if roster_athletes else {})
    flag = primary_athlete.get("flag") or {}
    sets = []
    for score in row.get("linescores") or []:
        value = score.get("value")
        sets.append(
            {
                "value": int(value) if isinstance(value, (int, float)) else value,
                "tiebreak": score.get("tiebreak"),
                "winner": bool(score.get("winner")),
            }
        )
    return {
        "id": str(row.get("id") or ""),
        "name": roster.get("displayName") or athlete.get("displayName") or athlete.get("fullName") or "A definir",
        "shortName": roster.get("shortDisplayName") or athlete.get("shortName") or "",
        "country": flag.get("alt") or "",
        "flag": flag.get("href") or "",
        "winner": bool(row.get("winner")),
        "sets": sets,
    }


def _parse_scoreboard(payload: dict) -> dict:
    tournaments = []
    matches = []

    for event in payload.get("events") or []:
        event_matches = []
        tours = set()
        for grouping_row in event.get("groupings") or []:
            grouping = grouping_row.get("grouping") or {}
            tour = _tour_for_group(grouping)
            tours.add(tour)
            for competition in grouping_row.get("competitions") or []:
                status = (competition.get("status") or {}).get("type") or {}
                venue = competition.get("venue") or {}
                match = {
                    "id": str(competition.get("id") or ""),
                    "tournamentId": str(event.get("id") or ""),
                    "tournament": event.get("name") or "Torneio",
                    "tour": tour,
                    "discipline": grouping.get("displayName") or (competition.get("type") or {}).get("text") or "",
                    "round": (competition.get("round") or {}).get("displayName") or "",
                    "date": competition.get("date") or competition.get("startDate"),
                    "state": status.get("state") or "pre",
                    "status": status.get("description") or status.get("detail") or "Agendado",
                    "detail": status.get("detail") or status.get("shortDetail") or "",
                    "venue": venue.get("fullName") or "",
                    "court": venue.get("court") or "",
                    "competitors": [_competitor(row) for row in competition.get("competitors") or []],
                }
                event_matches.append(match)
                matches.append(match)

        tournaments.append(
            {
                "id": str(event.get("id") or ""),
                "name": event.get("name") or "Torneio",
                "startDate": event.get("date"),
                "endDate": event.get("endDate"),
                "year": (event.get("season") or {}).get("year"),
                "major": bool(event.get("major")),
                "tours": sorted(tours),
                "matchCount": len(event_matches),
                "liveCount": sum(match["state"] == "in" for match in event_matches),
            }
        )

    state_order = {"in": 0, "pre": 1, "post": 2}
    matches.sort(key=lambda match: (state_order.get(match["state"], 3), match.get("date") or ""))
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "ESPN Tennis Scoreboard",
        "refreshSeconds": 60,
        "tournaments": tournaments,
        "matches": matches,
    }


def _write_csv(payload: dict) -> Path:
    rows = []
    for match in payload["matches"]:
        players = match["competitors"]
        rows.append(
            {
                "Tournament": match["tournament"],
                "Tour": match["tour"],
                "Discipline": match["discipline"],
                "Round": match["round"],
                "Date": match["date"],
                "State": match["state"],
                "Status": match["detail"],
                "Player1": players[0]["name"] if len(players) > 0 else "",
                "Player2": players[1]["name"] if len(players) > 1 else "",
                "Score1": " ".join(str(item["value"]) for item in players[0]["sets"]) if len(players) > 0 else "",
                "Score2": " ".join(str(item["value"]) for item in players[1]["sets"]) if len(players) > 1 else "",
                "Venue": match["venue"],
                "Court": match["court"],
            }
        )
    path = DATA_DIR / "tennis_matches.csv"
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def _store_match_history(payload: dict) -> Path:
    connection = sqlite3.connect(HISTORY_DB_PATH)
    try:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS match_history (
                match_id TEXT PRIMARY KEY,
                tournament_id TEXT,
                tour TEXT NOT NULL,
                tournament TEXT NOT NULL,
                match_date TEXT,
                state TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        columns = {row[1] for row in connection.execute("PRAGMA table_info(match_history)")}
        if "tournament_id" not in columns:
            connection.execute("ALTER TABLE match_history ADD COLUMN tournament_id TEXT")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tournament_history (
                tournament_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                start_date TEXT,
                end_date TEXT,
                year INTEGER,
                major INTEGER NOT NULL DEFAULT 0,
                tours_json TEXT NOT NULL,
                surface TEXT,
                categories_json TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        tournament_columns = {row[1] for row in connection.execute("PRAGMA table_info(tournament_history)")}
        if "surface" not in tournament_columns:
            connection.execute("ALTER TABLE tournament_history ADD COLUMN surface TEXT")
        if "categories_json" not in tournament_columns:
            connection.execute("ALTER TABLE tournament_history ADD COLUMN categories_json TEXT")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS match_competitors (
                match_id TEXT NOT NULL,
                competitor_id TEXT NOT NULL,
                name TEXT NOT NULL,
                winner INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (match_id, competitor_id, name),
                FOREIGN KEY (match_id) REFERENCES match_history(match_id)
            )
            """
        )
        updated_at = datetime.now(timezone.utc).isoformat()
        for tournament in payload.get("tournaments") or []:
            start_date = tournament.get("startDate")
            year = tournament.get("year") or (int(start_date[:4]) if start_date else None)
            metadata = classify_tournament(tournament["name"], tournament.get("tours") or [], tournament.get("major", False))
            connection.execute(
                """
                INSERT INTO tournament_history
                    (tournament_id, name, start_date, end_date, year, major, tours_json, surface, categories_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tournament_id) DO UPDATE SET
                    name = excluded.name,
                    start_date = excluded.start_date,
                    end_date = excluded.end_date,
                    year = excluded.year,
                    major = excluded.major,
                    tours_json = excluded.tours_json,
                    surface = excluded.surface,
                    categories_json = excluded.categories_json,
                    updated_at = excluded.updated_at
                """,
                (
                    tournament["id"], tournament["name"], start_date, tournament.get("endDate"),
                    year, int(tournament.get("major", False)), json.dumps(tournament.get("tours") or []),
                    metadata["surface"], json.dumps(metadata["categories"]), updated_at,
                ),
            )
        for match in payload["matches"]:
            connection.execute(
                """
                INSERT INTO match_history
                    (match_id, tournament_id, tour, tournament, match_date, state, payload_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(match_id) DO UPDATE SET
                    tournament_id = excluded.tournament_id,
                    tour = excluded.tour,
                    tournament = excluded.tournament,
                    match_date = excluded.match_date,
                    state = excluded.state,
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (
                    match["id"], match.get("tournamentId"), match["tour"], match["tournament"], match.get("date"),
                    match["state"], json.dumps(match, ensure_ascii=False), updated_at,
                ),
            )
            connection.execute("DELETE FROM match_competitors WHERE match_id = ?", (match["id"],))
            connection.executemany(
                """
                INSERT INTO match_competitors (match_id, competitor_id, name, winner)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (match["id"], competitor.get("id") or competitor["name"], competitor["name"], int(competitor["winner"]))
                    for competitor in match["competitors"]
                ],
            )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_match_competitors_id ON match_competitors(competitor_id)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_match_competitors_name ON match_competitors(name)")
        connection.commit()
    finally:
        connection.close()
    return HISTORY_DB_PATH


def update_live_matches() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = _parse_scoreboard(_get_scoreboard())
    json_path = PUBLIC_DATA_DIR / "events.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = _write_csv(payload)
    history_path = _store_match_history(payload)
    print(f"Eventos ({len(payload['matches'])} partidas) salvos em {json_path}")
    print(f"CSV salvo em {csv_path}")
    print(f"Histórico de partidas atualizado em {history_path}")
    return payload


def get_atp_live_matches() -> list:
    return [match for match in update_live_matches()["matches"] if match["tour"] == "ATP"]


def get_wta_live_matches() -> list:
    return [match for match in update_live_matches()["matches"] if match["tour"] == "WTA"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Atualiza torneios e placares de tênis.")
    parser.add_argument("--watch", action="store_true", help="Atualiza continuamente.")
    parser.add_argument("--interval", type=int, default=60, help="Intervalo em segundos (mínimo: 30).")
    args = parser.parse_args()

    if not args.watch:
        update_live_matches()
    else:
        interval = max(args.interval, 30)
        print(f"Modo contínuo ativo: atualização a cada {interval}s. Pressione Ctrl+C para parar.")
        try:
            while True:
                try:
                    update_live_matches()
                except requests.RequestException as exc:
                    print(f"Falha temporária ao atualizar eventos: {exc}")
                time.sleep(interval)
        except KeyboardInterrupt:
            print("\nAtualização contínua encerrada.")
