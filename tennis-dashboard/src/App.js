import { useEffect, useMemo, useState } from "react";
import "./App.css";

function formatPoints(value) {
  return Number(value || 0).toLocaleString("pt-BR");
}

function formatUpdated(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function trendClass(trend) {
  const value = String(trend || "-");
  if (value.startsWith("+")) return "up";
  if (value.startsWith("-") && value !== "-") return "down";
  return "flat";
}

function normalizeSearchValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function App() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [tour, setTour] = useState("ATP");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/data/rankings.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Arquivo de ranking não encontrado. Rode o ETL primeiro.");
        }
        return response.json();
      })
      .then(setPayload)
      .catch((err) => setError(err.message));
  }, []);

  const tourData = payload?.tours?.[tour];
  const players = useMemo(() => {
    const list = tourData?.players || [];
    const term = normalizeSearchValue(query.trim());
    if (!term) return list;
    return list.filter((player) =>
      [player.player, player.country, player.countryCode]
        .filter(Boolean)
        .some((field) => normalizeSearchValue(field).includes(term))
    );
  }, [tourData, query]);

  const featuredPlayers = players.slice(0, 3);

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Tennis Analytics</p>
          <h1>Ranking mundial</h1>
          <p className="lede">
            ATP e WTA atualizados a partir da fonte oficial via ESPN.
          </p>
        </div>
        <div className="meta">
          <span>{tourData?.week || "Temporada 2026"}</span>
          <span>Atualizado em {formatUpdated(tourData?.lastUpdated || payload?.generatedAt)}</span>
        </div>
      </header>

      <section className="toolbar">
        <div className="toggles" role="tablist" aria-label="Circuito">
          {["ATP", "WTA"].map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tour === name}
              className={tour === name ? "active" : ""}
              onClick={() => setTour(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Buscar jogador ou país"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Buscar jogador ou país"
        />
      </section>

      {error && <div className="banner error">{error}</div>}
      {!error && !payload && <div className="banner">Carregando ranking...</div>}

      {tourData && (
        <>
          <section className="podium">
            {featuredPlayers.map((player) => (
              <article key={player.athleteId} className={`card rank-${player.rank}`}>
                <span className="rank">#{player.rank}</span>
                {player.headshot ? (
                  <img src={player.headshot} alt={player.player} />
                ) : (
                  <div className="avatar">{player.player.slice(0, 1)}</div>
                )}
                <h2>{player.player}</h2>
                <p>
                  {player.flag && <img className="flag" src={player.flag} alt="" />}
                  {player.countryCode || player.country}
                </p>
                <strong>{formatPoints(player.points)} pts</strong>
              </article>
            ))}
          </section>

          <section className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pos.</th>
                  <th>Jogador</th>
                  <th>País</th>
                  <th>Pts</th>
                  <th>Idade</th>
                  <th>Var.</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => (
                  <tr key={player.athleteId}>
                    <td className="pos">{player.rank}</td>
                    <td className="player">
                      {player.headshot ? (
                        <img src={player.headshot} alt="" />
                      ) : (
                        <span className="dot" />
                      )}
                      {player.player}
                    </td>
                    <td className="country">
                      {player.flag && <img className="flag" src={player.flag} alt="" />}
                      {player.country || player.countryCode || "—"}
                    </td>
                    <td>{formatPoints(player.points)}</td>
                    <td>{player.age ?? "—"}</td>
                    <td className={`trend ${trendClass(player.trend)}`}>{player.trend}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {players.length === 0 && (
              <p className="empty">Nenhum jogador encontrado para essa busca.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default App;
