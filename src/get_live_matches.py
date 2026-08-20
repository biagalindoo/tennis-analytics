import json
import argparse
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
PUBLIC_DATA_DIR = ROOT / "tennis-dashboard" / "public" / "data"
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


def update_live_matches() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = _parse_scoreboard(_get_scoreboard())
    json_path = PUBLIC_DATA_DIR / "events.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = _write_csv(payload)
    print(f"Eventos ({len(payload['matches'])} partidas) salvos em {json_path}")
    print(f"CSV salvo em {csv_path}")
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
