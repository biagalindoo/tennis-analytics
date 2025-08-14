import os
import sys

# Adiciona a pasta src ao path do Python
sys.path.append(os.path.join(os.path.dirname(__file__), "src"))

from get_rankings import get_atp_ranking, get_wta_ranking
from get_matches import get_atp_matches, get_wta_matches
from get_player_stats import get_atp_match_stats, get_wta_match_stats
from get_live_matches import get_atp_live_matches, get_wta_live_matches

os.makedirs("data", exist_ok=True)

print("===== INICIANDO ETL =====")

# Rankings
print("\nRodando get_rankings.py ...")
get_atp_ranking()
get_wta_ranking()

# Resultados torneios
print("\nRodando get_matches.py ...")
get_atp_matches()
get_wta_matches()

# Partidas ao vivo
print("\nRodando get_live_matches.py ...")
get_atp_live_matches()
get_wta_live_matches()

print("\n===== ETL FINALIZADO =====")
