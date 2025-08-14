import requests
import pandas as pd
from bs4 import BeautifulSoup
import os

# Cria pasta data se não existir
os.makedirs("data", exist_ok=True)

def get_atp_ranking():
    url = "https://www.atptour.com/en/rankings/singles"
    r = requests.get(url)
    soup = BeautifulSoup(r.text, "html.parser")

    players = []
    ranks = []

    # Cada jogador está dentro da tag tr com classe 'rankings-row'
    for row in soup.select("tr.rankings-row"):
        rank = row.select_one("td.rank-cell").text.strip()
        name = row.select_one("td.player-cell a").text.strip()
        ranks.append(rank)
        players.append(name)

    df = pd.DataFrame({"Rank": ranks, "Player": players})
    df.to_csv("data/atp_ranking.csv", index=False)
    print("ATP ranking salvo em data/atp_ranking.csv")

def get_wta_ranking():
    url = "https://www.wtatennis.com/rankings/singles"
    r = requests.get(url)
    soup = BeautifulSoup(r.text, "html.parser")

    players = []
    ranks = []

    # Cada jogador está dentro da tag tr com classe 'rankings-row'
    for row in soup.select("tr.rankings-table__row"):
        rank = row.select_one("td.rankings-table__rank").text.strip()
        name = row.select_one("td.rankings-table__player a").text.strip()
        ranks.append(rank)
        players.append(name)

    df = pd.DataFrame({"Rank": ranks, "Player": players})
    df.to_csv("data/wta_ranking.csv", index=False)
    print("WTA ranking salvo em data/wta_ranking.csv")

if __name__ == "__main__":
    get_atp_ranking()
    get_wta_ranking()
