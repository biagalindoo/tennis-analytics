import requests
import pandas as pd
from bs4 import BeautifulSoup

# URLs de ranking ATP e WTA
ATP_URL = "https://www.atptour.com/en/rankings/singles"
WTA_URL = "https://www.wtatennis.com/rankings/singles"

def get_atp_ranking():
    r = requests.get(ATP_URL)
    soup = BeautifulSoup(r.text, "html.parser")

    players = []
    ranks = []

    # Exemplo de parsing simples (depende do site)
    for row in soup.select("tr"):
        rank = row.select_one(".rank-cell")
        name = row.select_one(".player-cell a")
        if rank and name:
            ranks.append(rank.text.strip())
            players.append(name.text.strip())

    df = pd.DataFrame({"Rank": ranks, "Player": players})
    df.to_csv("data/atp_ranking.csv", index=False)
    print("ATP ranking salvo em data/atp_ranking.csv")

def get_wta_ranking():
    r = requests.get(WTA_URL)
    soup = BeautifulSoup(r.text, "html.parser")

    players = []
    ranks = []

    for row in soup.select("tr"):
        rank = row.select_one(".rank-cell")
        name = row.select_one(".player-cell a")
        if rank and name:
            ranks.append(rank.text.strip())
            players.append(name.text.strip())

    df = pd.DataFrame({"Rank": ranks, "Player": players})
    df.to_csv("data/wta_ranking.csv", index=False)
    print("WTA ranking salvo em data/wta_ranking.csv")

if __name__ == "__main__":
    get_atp_ranking()
    get_wta_ranking()
