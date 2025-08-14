import requests
import pandas as pd
from bs4 import BeautifulSoup
import os

# Cria pasta data se não existir
os.makedirs("data", exist_ok=True)

def get_atp_matches():
    url = "https://www.atptour.com/en/scores/results-archive"  # resultados históricos/recentes
    r = requests.get(url)
    soup = BeautifulSoup(r.text, "html.parser")

    tournaments = []
    dates = []
    winners = []
    runners_up = []

    # Cada torneio listado na página
    for row in soup.select("tr"):
        date_tag = row.select_one(".tourney-dates")
        tourney_tag = row.select_one(".tourney-title a")
        winner_tag = row.select_one(".tourney-winner a")
        runner_tag = row.select_one(".tourney-finalist a")

        if date_tag and tourney_tag and winner_tag and runner_tag:
            dates.append(date_tag.text.strip())
            tournaments.append(tourney_tag.text.strip())
            winners.append(winner_tag.text.strip())
            runners_up.append(runner_tag.text.strip())

    df = pd.DataFrame({
        "Date": dates,
        "Tournament": tournaments,
        "Winner": winners,
        "Runner-up": runners_up
    })
    df.to_csv("data/atp_matches.csv", index=False)
    print("Resultados ATP salvos em data/atp_matches.csv")

if __name__ == "__main__":
    get_atp_matches()
