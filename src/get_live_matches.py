import requests
import pandas as pd
from bs4 import BeautifulSoup
import os

os.makedirs("data", exist_ok=True)

# URLs de partidas ao vivo
ATP_LIVE_URL = "https://www.atptour.com/en/scores/live"
WTA_LIVE_URL = "https://www.wtatennis.com/scores/live"

def get_atp_live_matches():
    r = requests.get(ATP_LIVE_URL)
    soup = BeautifulSoup(r.text, "html.parser")

    matches = []
    players1 = []
    players2 = []
    scores = []

    for row in soup.select(".live-match-row"):  # ajustar conforme HTML real
        p1 = row.select_one(".player1").text.strip() if row.select_one(".player1") else ""
        p2 = row.select_one(".player2").text.strip() if row.select_one(".player2") else ""
        score = row.select_one(".score").text.strip() if row.select_one(".score") else ""
        if p1 and p2:
            players1.append(p1)
            players2.append(p2)
            scores.append(score)
            matches.append(f"{p1} vs {p2}")

    df = pd.DataFrame({
        "Match": matches,
        "Player1": players1,
        "Player2": players2,
        "Score": scores
    })
    df.to_csv("data/atp_live_matches.csv", index=False)
    print("Partidas ATP ao vivo salvas em data/atp_live_matches.csv")

def get_wta_live_matches():
    r = requests.get(WTA_LIVE_URL)
    soup = BeautifulSoup(r.text, "html.parser")

    matches = []
    players1 = []
    players2 = []
    scores = []

    for row in soup.select(".live-match-row"):  # ajustar conforme HTML real
        p1 = row.select_one(".player1").text.strip() if row.select_one(".player1") else ""
        p2 = row.select_one(".player2").text.strip() if row.select_one(".player2") else ""
        score = row.select_one(".score").text.strip() if row.select_one(".score") else ""
        if p1 and p2:
            players1.append(p1)
            players2.append(p2)
            scores.append(score)
            matches.append(f"{p1} vs {p2}")

    df = pd.DataFrame({
        "Match": matches,
        "Player1": players1,
        "Player2": players2,
        "Score": scores
    })
    df.to_csv("data/wta_live_matches.csv", index=False)
    print("Partidas WTA ao vivo salvas em data/wta_live_matches.csv")

if __name__ == "__main__":
    get_atp_live_matches()
    get_wta_live_matches()
