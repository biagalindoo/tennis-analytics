import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
PUBLIC_DATA_DIR = ROOT / "tennis-dashboard" / "public" / "data"
CACHE_PATH = DATA_DIR / "athlete_cache.json"
HISTORY_DB_PATH = DATA_DIR / "tennis_history.db"

RANKING_INDEX = {
    "ATP": "https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/rankings",
    "WTA": "https://sports.core.api.espn.com/v2/sports/tennis/leagues/wta/rankings",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def _https(url: str) -> str:
    if url.startswith("http://"):
        return "https://" + url[len("http://") :]
    return url


def _get_json(url: str, timeout: int = 25) -> dict:
    response = SESSION.get(_https(url), timeout=timeout)
    response.raise_for_status()
    return response.json()


def _athlete_id(athlete_ref: str) -> str:
    return athlete_ref.rstrip("/").split("?")[0].split("/")[-1]


def _load_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def _save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def _extract_athlete(payload: dict) -> dict:
    country = payload.get("citizenshipCountry") or {}
    flag = payload.get("flag") or country.get("flag") or {}
    headshot = payload.get("headshot") or {}
    return {
        "id": str(payload.get("id", "")),
        "player": payload.get("displayName") or payload.get("fullName") or "",
        "country": country.get("name") or flag.get("alt") or "",
        "countryCode": country.get("abbreviation") or "",
        "age": payload.get("age"),
        "headshot": headshot.get("href") or "",
        "flag": flag.get("href") or "",
    }


def _fetch_athlete(athlete_id: str) -> dict:
    url = f"https://sports.core.api.espn.com/v2/sports/tennis/athletes/{athlete_id}?lang=en&region=us"
    return _extract_athlete(_get_json(url))


def _resolve_athletes(athlete_ids: list[str], cache: dict) -> dict:
    missing = [athlete_id for athlete_id in athlete_ids if athlete_id not in cache]
    if not missing:
        return cache

    print(f"  Buscando {len(missing)} jogadores...")
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(_fetch_athlete, athlete_id): athlete_id for athlete_id in missing}
        for future in as_completed(futures):
            athlete_id = futures[future]
            try:
                cache[athlete_id] = future.result()
            except requests.RequestException as exc:
                print(f"  Falha ao buscar jogador {athlete_id}: {exc}")
                cache[athlete_id] = {
                    "id": athlete_id,
                    "player": f"Jogador {athlete_id}",
                    "country": "",
                    "countryCode": "",
                    "age": None,
                    "headshot": "",
                    "flag": "",
                }
    _save_cache(cache)
    return cache


def _fetch_tour_ranking(tour: str) -> dict:
    index = _get_json(RANKING_INDEX[tour])
    items = index.get("items") or []
    if not items:
        raise RuntimeError(f"Nenhum ranking encontrado para {tour}")

    ranking = _get_json(items[0]["$ref"])
    ranks = ranking.get("ranks") or []
    athlete_ids = [_athlete_id(row["athlete"]["$ref"]) for row in ranks if row.get("athlete", {}).get("$ref")]

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cache = _resolve_athletes(athlete_ids, _load_cache())

    players = []
    for row in ranks:
        athlete_ref = (row.get("athlete") or {}).get("$ref")
        if not athlete_ref:
            continue
        athlete_id = _athlete_id(athlete_ref)
        profile = cache.get(athlete_id, {})
        current = int(row.get("current") or 0)
        previous = row.get("previous")
        previous_rank = int(previous) if previous not in (None, "") else None
        trend = row.get("trend") or "-"
        if trend in ("", None):
            if previous_rank is None or previous_rank == current:
                trend = "-"
            else:
                delta = previous_rank - current
                trend = f"+{delta}" if delta > 0 else str(delta)

        players.append(
            {
                "rank": current,
                "previousRank": previous_rank,
                "trend": str(trend),
                "points": int(row.get("points") or 0),
                "player": profile.get("player") or "",
                "country": profile.get("country") or "",
                "countryCode": profile.get("countryCode") or "",
                "age": profile.get("age"),
                "headshot": profile.get("headshot") or "",
                "flag": profile.get("flag") or "",
                "athleteId": athlete_id,
            }
        )

    return {
        "tour": tour,
        "headline": ranking.get("headline") or f"{tour} Rankings",
        "lastUpdated": ranking.get("lastUpdated"),
        "week": (ranking.get("occurrence") or {}).get("displayValue"),
        "players": players,
    }


def _to_dataframe(tour_data: dict) -> pd.DataFrame:
    rows = [
        {
            "Rank": player["rank"],
            "Previous": player["previousRank"],
            "Trend": player["trend"],
            "Player": player["player"],
            "Country": player["country"],
            "CountryCode": player["countryCode"],
            "Points": player["points"],
            "Age": player["age"],
        }
        for player in tour_data["players"]
    ]
    return pd.DataFrame(rows)


def _write_tour_csv(tour: str, tour_data: dict) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / f"{tour.lower()}_ranking.csv"
    _to_dataframe(tour_data).to_csv(path, index=False)
    return path


def _write_dashboard_json(tours: dict) -> Path:
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "ESPN (ATP / WTA)",
        "tours": tours,
    }
    path = PUBLIC_DATA_DIR / "rankings.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _store_ranking_history(tours: dict) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(HISTORY_DB_PATH)
    try:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS ranking_history (
                tour TEXT NOT NULL,
                athlete_id TEXT NOT NULL,
                player TEXT NOT NULL,
                snapshot_date TEXT NOT NULL,
                rank INTEGER NOT NULL,
                points INTEGER NOT NULL,
                country TEXT,
                PRIMARY KEY (tour, athlete_id, snapshot_date)
            )
            """
        )
        for tour, tour_data in tours.items():
            snapshot_date = (tour_data.get("lastUpdated") or datetime.now(timezone.utc).isoformat())[:10]
            connection.executemany(
                """
                INSERT INTO ranking_history
                    (tour, athlete_id, player, snapshot_date, rank, points, country)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tour, athlete_id, snapshot_date) DO UPDATE SET
                    player = excluded.player,
                    rank = excluded.rank,
                    points = excluded.points,
                    country = excluded.country
                """,
                [
                    (
                        tour,
                        player["athleteId"],
                        player["player"],
                        snapshot_date,
                        player["rank"],
                        player["points"],
                        player["country"],
                    )
                    for player in tour_data["players"]
                ],
            )
        connection.commit()
    finally:
        connection.close()
    return HISTORY_DB_PATH


def _write_history_json() -> Path:
    connection = sqlite3.connect(HISTORY_DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT tour, athlete_id, player, snapshot_date, rank, points
            FROM ranking_history
            ORDER BY snapshot_date ASC
            """
        ).fetchall()
    finally:
        connection.close()

    players = {}
    for row in rows:
        key = f"{row['tour']}:{row['athlete_id']}"
        entry = players.setdefault(
            key,
            {"tour": row["tour"], "athleteId": row["athlete_id"], "player": row["player"], "history": []},
        )
        entry["history"].append(
            {"date": row["snapshot_date"], "rank": row["rank"], "points": row["points"]}
        )

    path = PUBLIC_DATA_DIR / "ranking-history.json"
    path.write_text(
        json.dumps(
            {"generatedAt": datetime.now(timezone.utc).isoformat(), "players": players},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return path


def get_atp_ranking() -> dict:
    print("Coletando ranking ATP...")
    data = _fetch_tour_ranking("ATP")
    path = _write_tour_csv("ATP", data)
    print(f"ATP ranking ({len(data['players'])} jogadores) salvo em {path}")
    return data


def get_wta_ranking() -> dict:
    print("Coletando ranking WTA...")
    data = _fetch_tour_ranking("WTA")
    path = _write_tour_csv("WTA", data)
    print(f"WTA ranking ({len(data['players'])} jogadores) salvo em {path}")
    return data


def update_rankings() -> dict:
    tours = {
        "ATP": get_atp_ranking(),
        "WTA": get_wta_ranking(),
    }
    dashboard_path = _write_dashboard_json(tours)
    history_db_path = _store_ranking_history(tours)
    history_json_path = _write_history_json()
    print(f"Dashboard atualizado em {dashboard_path}")
    print(f"Histórico armazenado em {history_db_path}")
    print(f"Histórico do dashboard atualizado em {history_json_path}")
    return tours


if __name__ == "__main__":
    update_rankings()
