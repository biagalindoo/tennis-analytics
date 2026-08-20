import argparse
from datetime import datetime

import requests

from get_live_matches import HEADERS, SCOREBOARD_URL, _parse_scoreboard, _store_match_history


def import_year(year: int) -> dict:
    tournament_ids = set()
    match_ids = set()
    for month in range(1, 13):
        period = f"{year}{month:02d}"
        print(f"Coletando {period}...")
        response = requests.get(
            SCOREBOARD_URL,
            params={"dates": period, "limit": 1000},
            headers=HEADERS,
            timeout=90,
        )
        response.raise_for_status()
        payload = _parse_scoreboard(response.json())
        _store_match_history(payload)
        tournament_ids.update(item["id"] for item in payload["tournaments"])
        match_ids.update(item["id"] for item in payload["matches"])
        print(f"  {len(payload['tournaments'])} torneios · {len(payload['matches'])} partidas")
    return {"year": year, "tournaments": len(tournament_ids), "matches": len(match_ids)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa temporadas históricas de tênis para o SQLite.")
    parser.add_argument("--years", nargs="+", type=int, default=[datetime.now().year])
    args = parser.parse_args()
    for year in args.years:
        result = import_year(year)
        print(f"{year} finalizado: {result['tournaments']} torneios e {result['matches']} partidas únicas.")


if __name__ == "__main__":
    main()
