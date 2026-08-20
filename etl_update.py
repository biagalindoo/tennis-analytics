import os
import sys

# Adiciona a pasta src ao path do Python
sys.path.append(os.path.join(os.path.dirname(__file__), "src"))

from get_rankings import update_rankings
from get_live_matches import update_live_matches

os.makedirs("data", exist_ok=True)

print("===== INICIANDO ETL =====")

# Rankings
print("\nRodando get_rankings.py ...")
update_rankings()

# Torneios, partidas ao vivo, próximas e finalizadas
print("\nRodando get_live_matches.py ...")
update_live_matches()

print("\n===== ETL FINALIZADO =====")
