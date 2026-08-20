import json
import sqlite3

from get_live_matches import HISTORY_DB_PATH
from tournament_metadata import classify_tournament


def main() -> None:
    connection = sqlite3.connect(HISTORY_DB_PATH)
    try:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(tournament_history)")}
        if "surface" not in columns:
            connection.execute("ALTER TABLE tournament_history ADD COLUMN surface TEXT")
        if "categories_json" not in columns:
            connection.execute("ALTER TABLE tournament_history ADD COLUMN categories_json TEXT")
        rows = connection.execute(
            "SELECT tournament_id, name, major, tours_json FROM tournament_history"
        ).fetchall()
        for tournament_id, name, major, tours_json in rows:
            tours = json.loads(tours_json)
            metadata = classify_tournament(name, tours, bool(major))
            connection.execute(
                "UPDATE tournament_history SET surface = ?, categories_json = ? WHERE tournament_id = ?",
                (metadata["surface"], json.dumps(metadata["categories"]), tournament_id),
            )
        connection.commit()
    finally:
        connection.close()
    print(f"Metadados atualizados para {len(rows)} torneios.")


if __name__ == "__main__":
    main()
