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

function formatMatchDate(iso) {
  if (!iso) return "Horário a definir";
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setScore(sets = []) {
  return sets.map((set) => set.value).join("  ") || "—";
}

function App() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [tour, setTour] = useState("ATP");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("ranking");
  const [events, setEvents] = useState(null);
  const [matchFilter, setMatchFilter] = useState("all");

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

  useEffect(() => {
    let active = true;
    const loadEvents = () => {
      fetch(`/data/events.json?ts=${Date.now()}`)
        .then((response) => {
          if (!response.ok) throw new Error("Eventos ainda não foram gerados pelo ETL.");
          return response.json();
        })
        .then((data) => active && setEvents(data))
        .catch(() => active && setEvents(null));
    };
    loadEvents();
    const interval = window.setInterval(loadEvents, 60000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
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
  const tourMatches = useMemo(() => {
    const list = (events?.matches || []).filter((match) => match.tour === tour);
    if (matchFilter === "all") return list.filter((match) => match.state !== "post").slice(0, 40);
    return list.filter((match) => match.state === matchFilter).slice(0, 40);
  }, [events, tour, matchFilter]);
  const liveCount = (events?.matches || []).filter(
    (match) => match.tour === tour && match.state === "in"
  ).length;

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

      <nav className="view-tabs" aria-label="Seções">
        <button className={view === "ranking" ? "active" : ""} onClick={() => setView("ranking")}>Ranking</button>
        <button className={view === "matches" ? "active" : ""} onClick={() => setView("matches")}>
          Torneios e partidas {liveCount > 0 && <span className="live-pill">{liveCount} ao vivo</span>}
        </button>
      </nav>

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
        {view === "ranking" && (
          <input
            type="search"
            placeholder="Buscar jogador ou país"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Buscar jogador ou país"
          />
        )}
      </section>

      {error && <div className="banner error">{error}</div>}
      {!error && !payload && <div className="banner">Carregando ranking...</div>}

      {view === "ranking" && tourData && (
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

      {view === "matches" && (
        <section className="matches-view">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Placar em tempo real</p>
              <h2>Torneios e partidas</h2>
            </div>
            <span className="events-updated">Atualizado em {formatUpdated(events?.generatedAt)}</span>
          </div>

          <div className="match-filters" aria-label="Status das partidas">
            {[["all", "Agora e próximas"], ["in", "Ao vivo"], ["pre", "Próximas"], ["post", "Finalizadas"]].map(([value, label]) => (
              <button key={value} className={matchFilter === value ? "active" : ""} onClick={() => setMatchFilter(value)}>{label}</button>
            ))}
          </div>

          {!events && <div className="banner">Execute o ETL para carregar torneios e partidas.</div>}
          {events && tourMatches.length === 0 && <div className="banner">Nenhuma partida nesta categoria agora.</div>}

          <div className="matches-list">
            {tourMatches.map((match) => (
              <article className={`match-card state-${match.state}`} key={match.id}>
                <div className="match-topline">
                  <div>
                    <strong>{match.tournament}</strong>
                    <span>{match.round || match.discipline}</span>
                  </div>
                  <span className="match-status">
                    {match.state === "in" && <i />} {match.state === "in" ? match.detail || "Ao vivo" : match.state === "post" ? "Final" : formatMatchDate(match.date)}
                  </span>
                </div>
                <div className="competitors">
                  {match.competitors.map((player) => (
                    <div className={player.winner ? "competitor winner" : "competitor"} key={player.id || player.name}>
                      <span className="competitor-name">{player.flag && <img src={player.flag} alt="" />} {player.name}</span>
                      <strong>{setScore(player.sets)}</strong>
                    </div>
                  ))}
                </div>
                <p className="match-location">{[match.discipline, match.venue, match.court].filter(Boolean).join(" · ")}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default App;
