# 🎾 Tennis Analytics – ATP & WTA 2025

Projeto de Business Intelligence para acompanhar o circuito profissional de tênis (ATP e WTA), incluindo:

- Ranking atualizado (simples e duplas)
- Resultados ao vivo dos torneios
- Estatísticas detalhadas das partidas
- Histórico e evolução de jogadores
- Dashboard interativo no Power BI

## 🛠 Tecnologias utilizadas
- **Python** – Coleta e tratamento de dados
- **Pandas** – Limpeza e análise
- **BeautifulSoup / Requests** – Web scraping
- **SQL Server** – Armazenamento e histórico
- **Power BI** – Visualização e dashboard
- **Git & GitHub** – Controle de versão

## 📌 Funcionalidades previstas
1. Coletar e armazenar ranking ATP/WTA atualizado.
2. Obter resultados ao vivo e próximos jogos.
3. Coletar estatísticas detalhadas das partidas em andamento.
4. Construir Data Warehouse no SQL Server.
5. Criar dashboard no Power BI.

## 📂 Estrutura do projeto

## Executar o dashboard

Na primeira execução, prepare o ambiente Python:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Depois, use três terminais. No primeiro, inicie a API:

```bash
.venv/bin/python -m uvicorn backend.app:app --reload
```

No segundo, inicie o dashboard:

```bash
cd tennis-dashboard
npm start
```

No terceiro, mantenha o coletor ao vivo:

```bash
python3 src/get_live_matches.py --watch
```

O coletor atualiza torneios e placares a cada 60 segundos, e o dashboard busca o
novo arquivo automaticamente no mesmo intervalo. Para atualizar rankings e eventos
uma única vez, execute `python3 etl_update.py`.

A API roda em `http://127.0.0.1:8000`. A documentação interativa fica disponível
em `http://127.0.0.1:8000/docs`.
