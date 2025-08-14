import requests
import pandas as pd
from bs4 import BeautifulSoup
import os

os.makedirs("data", exist_ok=True)

def get_atp_match_stats(match_url):
    """
    Recebe a URL de uma partida ATP e retorna estatísticas detalhadas de jogadores
    """
    r = requests.get(match_url)
    soup = BeautifulSoup(r.text, "html.parser")

    stats = {}
    for row in soup.select(".match-stat-row"):
        stat_name = row.select_one(".stat-name").text.strip()
        player1_value = row.select(".stat-value")[0].text.strip()
        player2_value = row.select(".stat-value")[1].text.strip()
        stats[stat_name] = (player1_value, player2_value)

    df = pd.DataFrame(stats, index=["Player1", "Player2"]).transpose()
    return df

if __name__ == "__main__":
    # Exemplo de teste com uma URL de partida ATP
    url_exemplo = "https://www.atptour.com/en/scores/match-stats/2025/500/MS001"
    df = get_atp_match_stats(url_exemplo)
    df.to_csv("data/atp_match_stats.csv")
    print("Estatísticas da partida salvas em data/atp_match_stats.csv")

def get_wta_match_stats(match_url):
    """
    Recebe a URL de uma partida WTA e retorna estatísticas detalhadas de jogadores
    """
    r = requests.get(match_url)
    soup = BeautifulSoup(r.text, "html.parser")

    stats = {}
    for row in soup.select(".match-stats-row"):  # ajustar conforme site WTA
        stat_name_tag = row.select_one(".stat-name")
        stat_value_tags = row.select(".stat-value")

        if stat_name_tag and len(stat_value_tags) == 2:
            stat_name = stat_name_tag.text.strip()
            player1_value = stat_value_tags[0].text.strip()
            player2_value = stat_value_tags[1].text.strip()
            stats[stat_name] = (player1_value, player2_value)

    df = pd.DataFrame(stats, index=["Player1", "Player2"]).transpose()
    return df

if __name__ == "__main__":
    # Exemplo de teste com uma URL de partida WTA
    url_exemplo_wta = "https://www.wtatennis.com/tournament/2025/500/match/MS001"
    df_wta = get_wta_match_stats(url_exemplo_wta)
    df_wta.to_csv("data/wta_match_stats.csv")
    print("Estatísticas da partida WTA salvas em data/wta_match_stats.csv")
