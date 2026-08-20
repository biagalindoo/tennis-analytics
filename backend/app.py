import json
import hashlib
import hmac
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA_DIR = ROOT / "tennis-dashboard" / "public" / "data"
HISTORY_DB_PATH = ROOT / "data" / "tennis_history.db"
CAREER_TOTALS_PATH = ROOT / "data" / "career_totals.json"

app = FastAPI(
    title="Tennis Analytics API",
    version="1.0.0",
    description="Rankings, torneios, partidas e histórico ATP/WTA.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class RegisterPayload(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized.count("@") != 1 or "." not in normalized.split("@", 1)[1]:
            raise ValueError("E-mail inválido.")
        return normalized


class LoginPayload(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class PreferencePayload(BaseModel):
    favoritePlayerIds: list[str] = Field(default_factory=list, max_length=500)
    favoriteMatchIds: list[str] = Field(default_factory=list, max_length=500)
    preferredTour: str = Field(default="ATP", pattern="^(ATP|WTA)$")
    notificationSettings: dict[str, bool] = Field(default_factory=lambda: {"beforeMatch": True, "matchStart": True, "scheduleChange": True, "matchEnd": True})


class AccountUpdatePayload(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    currentPassword: Optional[str] = Field(default=None, min_length=8, max_length=128)
    newPassword: Optional[str] = Field(default=None, min_length=8, max_length=128)


def _initialize_auth_tables() -> None:
    HISTORY_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(HISTORY_DB_PATH)
    try:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id TEXT PRIMARY KEY,
                favorite_player_ids_json TEXT NOT NULL DEFAULT '[]',
                favorite_match_ids_json TEXT NOT NULL DEFAULT '[]',
                preferred_tour TEXT NOT NULL DEFAULT 'ATP',
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );
            """
        )
        preference_columns = {row[1] for row in connection.execute("PRAGMA table_info(user_preferences)").fetchall()}
        if "notification_settings_json" not in preference_columns:
            connection.execute("ALTER TABLE user_preferences ADD COLUMN notification_settings_json TEXT NOT NULL DEFAULT '{}' ")
        connection.commit()
    finally:
        connection.close()


def _password_hash(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return f"pbkdf2_sha256$310000${salt.hex()}${digest.hex()}"


def _password_matches(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, expected = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations))
        return hmac.compare_digest(digest.hex(), expected)
    except (TypeError, ValueError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_session(connection: sqlite3.Connection, user_id: str) -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=30)
    connection.execute(
        "INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (_token_hash(token), user_id, expires_at.isoformat(), now.isoformat()),
    )
    return token, expires_at.isoformat()


def _authenticated_user(authorization: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sessão não informada.")
    token = authorization.removeprefix("Bearer ").strip()
    connection = sqlite3.connect(HISTORY_DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            """
            SELECT users.user_id, users.name, users.email, users.created_at, user_sessions.expires_at
            FROM user_sessions JOIN users ON users.user_id = user_sessions.user_id
            WHERE user_sessions.token_hash = ? AND user_sessions.expires_at > ?
            """,
            (_token_hash(token), datetime.now(timezone.utc).isoformat()),
        ).fetchone()
    finally:
        connection.close()
    if not row:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada.")
    return dict(row)


_initialize_auth_tables()


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


@app.post("/api/auth/register", tags=["Conta"], status_code=201)
def register(payload: RegisterPayload) -> dict:
    connection = sqlite3.connect(HISTORY_DB_PATH)
    connection.row_factory = sqlite3.Row
    user_id = secrets.token_urlsafe(12)
    now = datetime.now(timezone.utc).isoformat()
    try:
        connection.execute(
            "INSERT INTO users (user_id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, payload.name.strip(), payload.email, _password_hash(payload.password), now),
        )
        token, expires_at = _new_session(connection, user_id)
        connection.commit()
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Já existe uma conta com este e-mail.") from exc
    finally:
        connection.close()
    return {"token": token, "expiresAt": expires_at, "user": {"id": user_id, "name": payload.name.strip(), "email": payload.email}}


@app.post("/api/auth/login", tags=["Conta"])
def login(payload: LoginPayload) -> dict:
    connection = sqlite3.connect(HISTORY_DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        user = connection.execute(
            "SELECT user_id, name, email, password_hash FROM users WHERE email = ? COLLATE NOCASE",
            (payload.email,),
        ).fetchone()
        if not user or not _password_matches(payload.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
        token, expires_at = _new_session(connection, user["user_id"])
        connection.commit()
    finally:
        connection.close()
    return {"token": token, "expiresAt": expires_at, "user": {"id": user["user_id"], "name": user["name"], "email": user["email"]}}


@app.get("/api/auth/me", tags=["Conta"])
def current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    user = _authenticated_user(authorization)
    return {"user": {"id": user["user_id"], "name": user["name"], "email": user["email"], "createdAt": user["created_at"]}}


@app.post("/api/auth/logout", tags=["Conta"], status_code=204)
def logout(authorization: Optional[str] = Header(default=None)) -> None:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        connection = sqlite3.connect(HISTORY_DB_PATH)
        try:
            connection.execute("DELETE FROM user_sessions WHERE token_hash = ?", (_token_hash(token),))
            connection.commit()
        finally:
            connection.close()


@app.get("/api/account/preferences", tags=["Conta"])
def account_preferences(authorization: Optional[str] = Header(default=None)) -> dict:
    user = _authenticated_user(authorization)
    connection = sqlite3.connect(HISTORY_DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            "SELECT favorite_player_ids_json, favorite_match_ids_json, preferred_tour, notification_settings_json, updated_at FROM user_preferences WHERE user_id = ?",
            (user["user_id"],),
        ).fetchone()
    finally:
        connection.close()
    if not row:
        return {"initialized": False, "favoritePlayerIds": [], "favoriteMatchIds": [], "preferredTour": "ATP", "notificationSettings": {"beforeMatch": True, "matchStart": True, "scheduleChange": True, "matchEnd": True}}
    return {
        "initialized": True,
        "favoritePlayerIds": json.loads(row["favorite_player_ids_json"]),
        "favoriteMatchIds": json.loads(row["favorite_match_ids_json"]),
        "preferredTour": row["preferred_tour"],
        "notificationSettings": {"beforeMatch": True, "matchStart": True, "scheduleChange": True, "matchEnd": True, **json.loads(row["notification_settings_json"] or "{}")},
        "updatedAt": row["updated_at"],
    }


@app.post("/api/account/preferences", tags=["Conta"])
def save_account_preferences(payload: PreferencePayload, authorization: Optional[str] = Header(default=None)) -> dict:
    user = _authenticated_user(authorization)
    player_ids = list(dict.fromkeys(payload.favoritePlayerIds))
    match_ids = list(dict.fromkeys(payload.favoriteMatchIds))
    now = datetime.now(timezone.utc).isoformat()
    connection = sqlite3.connect(HISTORY_DB_PATH)
    try:
        connection.execute(
            """
            INSERT INTO user_preferences (user_id, favorite_player_ids_json, favorite_match_ids_json, preferred_tour, notification_settings_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                favorite_player_ids_json = excluded.favorite_player_ids_json,
                favorite_match_ids_json = excluded.favorite_match_ids_json,
                preferred_tour = excluded.preferred_tour,
                notification_settings_json = excluded.notification_settings_json,
                updated_at = excluded.updated_at
            """,
            (user["user_id"], json.dumps(player_ids), json.dumps(match_ids), payload.preferredTour, json.dumps(payload.notificationSettings), now),
        )
        connection.commit()
    finally:
        connection.close()
    return {"saved": True, "favoritePlayerIds": player_ids, "favoriteMatchIds": match_ids, "preferredTour": payload.preferredTour, "notificationSettings": payload.notificationSettings, "updatedAt": now}


@app.post("/api/account/profile", tags=["Conta"])
def update_account_profile(payload: AccountUpdatePayload, authorization: Optional[str] = Header(default=None)) -> dict:
    user = _authenticated_user(authorization)
    if bool(payload.currentPassword) != bool(payload.newPassword):
        raise HTTPException(status_code=400, detail="Informe a senha atual e a nova senha.")
    connection = sqlite3.connect(HISTORY_DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        if payload.newPassword:
            stored = connection.execute("SELECT password_hash FROM users WHERE user_id = ?", (user["user_id"],)).fetchone()
            if not stored or not _password_matches(payload.currentPassword or "", stored["password_hash"]):
                raise HTTPException(status_code=400, detail="A senha atual está incorreta.")
            connection.execute(
                "UPDATE users SET name = ?, password_hash = ? WHERE user_id = ?",
                (payload.name.strip(), _password_hash(payload.newPassword), user["user_id"]),
            )
            connection.execute(
                "DELETE FROM user_sessions WHERE user_id = ? AND token_hash <> ?",
                (user["user_id"], _token_hash(authorization.removeprefix("Bearer ").strip())),
            )
        else:
            connection.execute("UPDATE users SET name = ? WHERE user_id = ?", (payload.name.strip(), user["user_id"]))
        connection.commit()
    finally:
        connection.close()
    return {"saved": True, "passwordChanged": bool(payload.newPassword), "user": {"id": user["user_id"], "name": payload.name.strip(), "email": user["email"]}}


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
def player_career_stats(tour: str, athlete_id: str, name: Optional[str] = None, year: Optional[int] = None) -> dict:
    tour = tour.upper()
    if tour not in {"ATP", "WTA"}:
        raise HTTPException(status_code=400, detail="Circuito deve ser ATP ou WTA.")
    connection = sqlite3.connect(HISTORY_DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        year_clause = "AND substr(history.match_date, 1, 4) = ?" if year else ""
        params = [tour, athlete_id, name or ""]
        if year:
            params.append(str(year))
        rows = connection.execute(
            f"""
            SELECT history.payload_json, tournament.surface, tournament.categories_json
            FROM match_history AS history
            JOIN match_competitors AS player ON player.match_id = history.match_id
            LEFT JOIN tournament_history AS tournament ON tournament.tournament_id = history.tournament_id
            WHERE history.tour = ? AND history.state = 'post'
              AND (player.competitor_id = ? OR lower(player.name) = lower(?))
              {year_clause}
            ORDER BY history.match_date DESC
            """,
            params,
        ).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=503, detail="Estatísticas ainda não foram geradas.") from exc
    finally:
        connection.close()

    surfaces = {}
    titles = {"Grand Slam": 0, "1000": 0, "500": 0, "250": 0, "Finals": 0}
    title_list = []
    recent_form = []
    all_results = []
    top_ten_played = 0
    top_ten_wins = 0
    ranking_payload = _read_json("rankings.json")
    top_ten_players = [player for player in (ranking_payload.get("tours", {}).get(tour, {}).get("players") or []) if player.get("rank", 999) <= 10]
    top_ten_ids = {str(player.get("athleteId")) for player in top_ten_players if player.get("athleteId")}
    top_ten_names = {str(player.get("player", "")).casefold() for player in top_ten_players}
    for row in rows:
        match = json.loads(row["payload_json"])
        if "singles" not in (match.get("discipline") or "").lower():
            continue
        competitor = next(
            (item for item in match.get("competitors") or [] if item.get("id") == athlete_id or (name and item.get("name", "").lower() == name.lower())),
            None,
        )
        if not competitor:
            continue
        opponent = next((item for item in match.get("competitors") or [] if item is not competitor), None)
        won = bool(competitor.get("winner"))
        all_results.append("W" if won else "L")
        if len(recent_form) < 10:
            recent_form.append({"result": "W" if won else "L", "opponent": opponent.get("name") if opponent else "—", "tournament": match.get("tournament"), "date": match.get("date")})
        if opponent and (str(opponent.get("id")) in top_ten_ids or str(opponent.get("name", "")).casefold() in top_ten_names):
            top_ten_played += 1
            if won:
                top_ten_wins += 1
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
    streak_result = all_results[0] if all_results else None
    streak_count = 0
    for result in all_results:
        if result != streak_result:
            break
        streak_count += 1
    official_career = None
    if CAREER_TOTALS_PATH.exists():
        try:
            official_career = json.loads(CAREER_TOTALS_PATH.read_text(encoding="utf-8")).get("players", {}).get(f"{tour}:{athlete_id}")
        except (OSError, json.JSONDecodeError):
            official_career = None
    return {
        "tour": tour, "athleteId": athlete_id, "year": year, "matches": sum(item["played"] for item in surfaces.values()),
        "wins": sum(item["wins"] for item in surfaces.values()), "losses": sum(item["losses"] for item in surfaces.values()),
        "bySurface": surfaces, "titles": titles, "titleCount": sum(titles.values()), "titleList": title_list,
        "recentForm": recent_form,
        "currentStreak": {"type": streak_result, "count": streak_count},
        "vsTop10": {"played": top_ten_played, "wins": top_ten_wins, "losses": top_ten_played - top_ten_wins, "winRate": round(top_ten_wins / top_ten_played * 100) if top_ten_played else 0, "basis": "current-ranking"},
        "officialCareer": official_career,
    }


@app.get("/api/leaders", tags=["Jogadores"])
def performance_leaders(
    tour: str = Query(pattern="^(ATP|WTA)$"),
    year: int = 2026,
    metric: str = Query(default="titles", pattern="^(titles|wins|winRate)$"),
    limit: int = Query(default=10, ge=1, le=50),
) -> dict:
    connection = sqlite3.connect(HISTORY_DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT history.payload_json, tournament.categories_json
            FROM match_history AS history
            LEFT JOIN tournament_history AS tournament ON tournament.tournament_id = history.tournament_id
            WHERE history.tour = ? AND history.state = 'post' AND substr(history.match_date, 1, 4) = ?
            """,
            (tour, str(year)),
        ).fetchall()
    finally:
        connection.close()
    players = {}
    for row in rows:
        match = json.loads(row["payload_json"])
        if "singles" not in (match.get("discipline") or "").lower():
            continue
        is_final = (match.get("round") or "").lower() == "final"
        category = (json.loads(row["categories_json"] or "{}")).get(tour)
        for competitor in match.get("competitors") or []:
            player_id = competitor.get("id") or competitor.get("name")
            entry = players.setdefault(player_id, {"athleteId": player_id, "player": competitor.get("name"), "played": 0, "wins": 0, "titles": 0, "winRate": 0})
            entry["played"] += 1
            if competitor.get("winner"):
                entry["wins"] += 1
                if is_final and category:
                    entry["titles"] += 1
    for entry in players.values():
        entry["winRate"] = round(entry["wins"] / entry["played"] * 100) if entry["played"] else 0
    candidates = list(players.values())
    if metric == "winRate":
        candidates = [entry for entry in candidates if entry["played"] >= 5]
    candidates.sort(key=lambda entry: (entry[metric], entry["wins"], -entry["played"]), reverse=True)
    return {"tour": tour, "year": year, "metric": metric, "count": min(len(candidates), limit), "leaders": candidates[:limit]}


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
