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

async function fetchJsonWithFallback(apiUrl, staticUrl) {
  try {
    const response = await fetch(apiUrl);
    if (response.ok) return response.json();
  } catch {
    // O modo local sem backend continua disponível pelos arquivos gerados pelo ETL.
  }
  const fallback = await fetch(staticUrl);
  if (!fallback.ok) throw new Error("Dados indisponíveis.");
  return fallback.json();
}

function competitorForPlayer(match, player) {
  const name = normalizeSearchValue(player?.player);
  return match.competitors.find(
    (competitor) => competitor.id === player?.athleteId || normalizeSearchValue(competitor.name).includes(name)
  );
}

function playerMatchSummary(matches, player) {
  const related = matches.filter((match) => competitorForPlayer(match, player));
  const finished = related.filter((match) => match.state === "post");
  return {
    played: finished.length,
    wins: finished.filter((match) => competitorForPlayer(match, player)?.winner).length,
    live: related.filter((match) => match.state === "in").length,
    upcoming: related.filter((match) => match.state === "pre").length,
  };
}

function RankingHistoryChart({ history }) {
  if (!history?.length) return <p className="empty profile-empty">O histórico começará na próxima atualização do ETL.</p>;
  if (history.length === 1) {
    return <div className="history-start"><strong>#{history[0].rank}</strong><span>{formatPoints(history[0].points)} pontos em {new Date(`${history[0].date}T12:00:00`).toLocaleDateString("pt-BR")}</span><small>Primeiro registro salvo. O gráfico será formado nas próximas atualizações.</small></div>;
  }

  const width = 640;
  const height = 170;
  const padding = 22;
  const ranks = history.map((item) => item.rank);
  const minRank = Math.min(...ranks);
  const maxRank = Math.max(...ranks);
  const range = Math.max(maxRank - minRank, 1);
  const points = history.map((item, index) => ({
    ...item,
    x: padding + (index / (history.length - 1)) * (width - padding * 2),
    y: padding + ((item.rank - minRank) / range) * (height - padding * 2),
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className="history-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolução da posição no ranking">
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
        {points.map((point) => <circle key={point.date} cx={point.x} cy={point.y} r="5"><title>{point.date}: #{point.rank} · {formatPoints(point.points)} pontos</title></circle>)}
      </svg>
      <div><span>{new Date(`${history[0].date}T12:00:00`).toLocaleDateString("pt-BR")}</span><strong>Melhor: #{minRank}</strong><span>{new Date(`${history[history.length - 1].date}T12:00:00`).toLocaleDateString("pt-BR")}</span></div>
    </div>
  );
}

function App() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [tour, setTour] = useState("ATP");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("ranking");
  const [events, setEvents] = useState(null);
  const [rankingHistory, setRankingHistory] = useState(null);
  const [matchFilter, setMatchFilter] = useState("all");
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [selectedPlayerFallback, setSelectedPlayerFallback] = useState(null);
  const [remoteHeadToHead, setRemoteHeadToHead] = useState(null);
  const [archiveYear, setArchiveYear] = useState("2026");
  const [archiveSearch, setArchiveSearch] = useState("");
  const [tournamentArchive, setTournamentArchive] = useState(null);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [archivedMatches, setArchivedMatches] = useState([]);
  const [remotePlayerMatches, setRemotePlayerMatches] = useState(null);
  const [comparePlayerIds, setComparePlayerIds] = useState(["", ""]);
  const [favoriteMatchIds, setFavoriteMatchIds] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem("favoriteMatchIds")) || [];
    } catch {
      return [];
    }
  });
  const [favoritePlayerIds, setFavoritePlayerIds] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem("favoritePlayerIds")) || [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    fetchJsonWithFallback("/api/rankings", "/data/rankings.json")
      .then(setPayload)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (view !== "history") return;
    const params = new URLSearchParams({ year: archiveYear, tour });
    if (archiveSearch.trim()) params.set("search", archiveSearch.trim());
    fetch(`/api/tournaments?${params}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setTournamentArchive)
      .catch(() => {
        const tournaments = (events?.tournaments || []).filter((item) => item.tours.includes(tour) && (!archiveSearch.trim() || normalizeSearchValue(item.name).includes(normalizeSearchValue(archiveSearch))));
        setTournamentArchive({ count: tournaments.length, tournaments });
      });
  }, [view, archiveYear, archiveSearch, tour, events]);

  useEffect(() => {
    fetchJsonWithFallback("/api/ranking-history", "/data/ranking-history.json")
      .then(setRankingHistory)
      .catch(() => setRankingHistory(null));
  }, []);

  useEffect(() => {
    window.localStorage.setItem("favoriteMatchIds", JSON.stringify(favoriteMatchIds));
  }, [favoriteMatchIds]);

  useEffect(() => {
    window.localStorage.setItem("favoritePlayerIds", JSON.stringify(favoritePlayerIds));
  }, [favoritePlayerIds]);

  useEffect(() => {
    if (!selectedMatchId && !selectedPlayerId) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setSelectedMatchId(null);
      setSelectedPlayerId(null);
      setSelectedPlayerFallback(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedMatchId, selectedPlayerId]);

  useEffect(() => {
    let active = true;
    const loadEvents = () => {
      const timestamp = Date.now();
      fetchJsonWithFallback(`/api/events?ts=${timestamp}`, `/data/events.json?ts=${timestamp}`)
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
    if (matchFilter === "favorites") return list.filter((match) => favoriteMatchIds.includes(match.id));
    return list.filter((match) => match.state === matchFilter).slice(0, 40);
  }, [events, tour, matchFilter, favoriteMatchIds]);
  const selectedMatch = [...(events?.matches || []), ...archivedMatches, ...(remotePlayerMatches?.matches || [])].find((match) => match.id === selectedMatchId);
  useEffect(() => {
    if (!selectedMatch || selectedMatch.competitors.length < 2) {
      setRemoteHeadToHead(null);
      return;
    }
    const params = new URLSearchParams({
      tour: selectedMatch.tour,
      player1: selectedMatch.competitors[0].id || selectedMatch.competitors[0].name,
      player2: selectedMatch.competitors[1].id || selectedMatch.competitors[1].name,
    });
    fetch(`/api/head-to-head?${params}`)
      .then((response) => response.ok ? response.json() : null)
      .then(setRemoteHeadToHead)
      .catch(() => setRemoteHeadToHead(null));
  }, [selectedMatch]);
  const allPlayers = Object.values(payload?.tours || {}).flatMap((item) => item.players || []);
  const selectedPlayer = allPlayers.find((player) => player.athleteId === selectedPlayerId) || selectedPlayerFallback;
  useEffect(() => {
    if (!selectedPlayer) {
      setRemotePlayerMatches(null);
      return;
    }
    const params = new URLSearchParams({ name: selectedPlayer.player, limit: "100" });
    fetch(`/api/players/${tour}/${encodeURIComponent(selectedPlayer.athleteId)}/matches?${params}`)
      .then((response) => response.ok ? response.json() : null)
      .then(setRemotePlayerMatches)
      .catch(() => setRemotePlayerMatches(null));
  }, [selectedPlayer, tour]);
  const openPlayerProfile = (competitor) => {
    const competitorName = normalizeSearchValue(competitor.name);
    const rankedPlayer = allPlayers.find(
      (player) => player.athleteId === competitor.id || competitorName.includes(normalizeSearchValue(player.player))
    );
    setSelectedPlayerId(rankedPlayer?.athleteId || competitor.id || competitor.name);
    setSelectedPlayerFallback(rankedPlayer ? null : {
      athleteId: competitor.id || competitor.name,
      player: competitor.name,
      country: competitor.country || "",
      countryCode: "",
      flag: competitor.flag || "",
      headshot: "",
      rank: null,
      points: null,
      trend: "—",
      age: null,
    });
    setSelectedMatchId(null);
  };
  const selectedMatchHistory = selectedMatch
    ? (events?.matches || []).filter((match) =>
        match.id !== selectedMatch.id && selectedMatch.competitors.every((target) =>
          match.competitors.some((candidate) =>
            candidate.id === target.id || normalizeSearchValue(candidate.name) === normalizeSearchValue(target.name)
          )
        )
      )
    : [];
  const persistentMatchHistory = selectedMatch
    ? (remoteHeadToHead?.matches || selectedMatchHistory).filter((match) => match.id !== selectedMatch.id)
    : [];
  const selectedPlayerMatches = useMemo(() => {
    if (!selectedPlayer) return [];
    const playerName = normalizeSearchValue(selectedPlayer.player);
    return (events?.matches || []).filter((match) =>
      match.competitors.some((competitor) =>
        competitor.id === selectedPlayer.athleteId || normalizeSearchValue(competitor.name).includes(playerName)
      )
    ).slice(0, 8);
  }, [events, selectedPlayer]);
  const playerHistoricalMatches = remotePlayerMatches?.matches || selectedPlayerMatches;
  const playerFinishedMatches = playerHistoricalMatches.filter((match) => match.state === "post");
  const playerHistoricalWins = playerFinishedMatches.filter((match) => competitorForPlayer(match, selectedPlayer)?.winner).length;
  const selectedPlayerHistory = selectedPlayer
    ? rankingHistory?.players?.[`${tour}:${selectedPlayer.athleteId}`]?.history || []
    : [];
  const comparePlayers = [
    tourData?.players?.find((player) => player.athleteId === comparePlayerIds[0]) || tourData?.players?.[0],
    tourData?.players?.find((player) => player.athleteId === comparePlayerIds[1]) || tourData?.players?.[1],
  ];
  const currentTourMatches = (events?.matches || []).filter((match) => match.tour === tour);
  const compareSummaries = comparePlayers.map((player) => playerMatchSummary(currentTourMatches, player));
  const headToHead = currentTourMatches.filter(
    (match) => comparePlayers.every((player) => competitorForPlayer(match, player))
  );
  const toggleFavorite = (matchId) => {
    setFavoriteMatchIds((current) =>
      current.includes(matchId) ? current.filter((id) => id !== matchId) : [...current, matchId]
    );
  };
  const toggleFavoritePlayer = (playerId) => {
    setFavoritePlayerIds((current) =>
      current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]
    );
  };
  const openArchivedTournament = (tournament) => {
    setSelectedTournament(tournament);
    fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/matches?tour=${tour}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setArchivedMatches(data.matches || []))
      .catch(() => setArchivedMatches((events?.matches || []).filter((match) => match.tournamentId === tournament.id && match.tour === tour)));
  };
  const liveCount = (events?.matches || []).filter(
    (match) => match.tour === tour && match.state === "in"
  ).length;

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Tennis Analytics</p>
          <h1>{view === "ranking" ? "Ranking mundial" : view === "matches" ? "Torneios e partidas" : view === "history" ? "Histórico de torneios" : "Comparar jogadores"}</h1>
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
        <button className={view === "compare" ? "active" : ""} onClick={() => setView("compare")}>Comparar</button>
        <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>Histórico</button>
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
        {view === "history" && (
          <div className="archive-controls">
            <select aria-label="Ano do histórico" value={archiveYear} onChange={(event) => setArchiveYear(event.target.value)}>
              {[2026, 2025, 2024, 2023].map((year) => <option value={year} key={year}>{year}</option>)}
            </select>
            <input type="search" placeholder="Buscar torneio" aria-label="Buscar torneio" value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} />
          </div>
        )}
      </section>

      {error && <div className="banner error">{error}</div>}
      {!error && !payload && <div className="banner">Carregando ranking...</div>}

      {view === "ranking" && tourData && (
        <>
          <section className="podium">
            {featuredPlayers.map((player) => (
              <article key={player.athleteId} className={`card rank-${player.rank} player-link`} onClick={() => setSelectedPlayerId(player.athleteId)} tabIndex="0" onKeyDown={(event) => event.key === "Enter" && setSelectedPlayerId(player.athleteId)}>
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
                    <td className="player player-link" onClick={() => setSelectedPlayerId(player.athleteId)}>
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
            {[["all", "Agora e próximas"], ["in", "Ao vivo"], ["pre", "Próximas"], ["post", "Finalizadas"], ["favorites", `Favoritos (${favoriteMatchIds.length})`]].map(([value, label]) => (
              <button key={value} className={matchFilter === value ? "active" : ""} onClick={() => setMatchFilter(value)}>{label}</button>
            ))}
          </div>

          {!events && <div className="banner">Execute o ETL para carregar torneios e partidas.</div>}
          {events && tourMatches.length === 0 && <div className="banner">Nenhuma partida nesta categoria agora.</div>}

          <div className="matches-list">
            {tourMatches.map((match) => (
              <article className={`match-card state-${match.state}`} key={match.id} onClick={() => setSelectedMatchId(match.id)} tabIndex="0" onKeyDown={(event) => event.key === "Enter" && setSelectedMatchId(match.id)}>
                <div className="match-topline">
                  <div>
                    <strong>{match.tournament}</strong>
                    <span>{match.round || match.discipline}</span>
                  </div>
                  <span className="match-status">
                    {match.state === "in" && <i />} {match.state === "in" ? match.detail || "Ao vivo" : match.state === "post" ? "Final" : formatMatchDate(match.date)}
                  </span>
                  <button className={favoriteMatchIds.includes(match.id) ? "favorite-button active" : "favorite-button"} type="button" aria-label={favoriteMatchIds.includes(match.id) ? "Remover dos favoritos" : "Adicionar aos favoritos"} onClick={(event) => { event.stopPropagation(); toggleFavorite(match.id); }}>
                    {favoriteMatchIds.includes(match.id) ? "★" : "☆"}
                  </button>
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

      {view === "compare" && tourData && (
        <section className="compare-view">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Lado a lado</p>
              <h2>Comparação {tour}</h2>
            </div>
            <span className="events-updated">Dados do ranking e torneio atual</span>
          </div>

          <div className="compare-selectors">
            {[0, 1].map((index) => (
              <label key={index}>
                <span>Jogador {index + 1}</span>
                <select value={comparePlayers[index]?.athleteId || ""} onChange={(event) => setComparePlayerIds((current) => current.map((id, position) => position === index ? event.target.value : id))}>
                  {(tourData.players || []).map((player) => <option key={player.athleteId} value={player.athleteId}>{player.rank}. {player.player}</option>)}
                </select>
              </label>
            ))}
          </div>

          <div className="compare-players">
            {comparePlayers.map((player, index) => player && (
              <article className="compare-player-card" key={`${index}-${player.athleteId}`}>
                {player.headshot ? <img src={player.headshot} alt={player.player} /> : <div className="compare-avatar">{player.player.slice(0, 1)}</div>}
                <div>
                  <span className="compare-rank">#{player.rank}</span>
                  <h3>{player.player}</h3>
                  <p>{player.flag && <img src={player.flag} alt="" />} {player.country || player.countryCode}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="comparison-table">
            {[
              ["Ranking", `#${comparePlayers[0]?.rank ?? "—"}`, `#${comparePlayers[1]?.rank ?? "—"}`, "lower"],
              ["Pontos", formatPoints(comparePlayers[0]?.points), formatPoints(comparePlayers[1]?.points), "higher"],
              ["Idade", comparePlayers[0]?.age ?? "—", comparePlayers[1]?.age ?? "—", null],
              ["Variação", comparePlayers[0]?.trend || "—", comparePlayers[1]?.trend || "—", null],
              ["Vitórias no feed", compareSummaries[0].wins, compareSummaries[1].wins, "higher"],
              ["Partidas finalizadas", compareSummaries[0].played, compareSummaries[1].played, null],
              ["Próximas partidas", compareSummaries[0].upcoming, compareSummaries[1].upcoming, null],
            ].map(([label, left, right, preference]) => {
              const leftNumber = Number(String(left).replace(/[^0-9.-]/g, ""));
              const rightNumber = Number(String(right).replace(/[^0-9.-]/g, ""));
              const leftBest = preference && leftNumber !== rightNumber && (preference === "higher" ? leftNumber > rightNumber : leftNumber < rightNumber);
              const rightBest = preference && leftNumber !== rightNumber && !leftBest;
              return <div className="comparison-row" key={label}><strong className={leftBest ? "best" : ""}>{left}</strong><span>{label}</span><strong className={rightBest ? "best" : ""}>{right}</strong></div>;
            })}
          </div>

          <div className="head-to-head">
            <div className="profile-section-title"><h3>Confrontos no feed atual</h3><span>{headToHead.length} encontrados</span></div>
            {headToHead.length === 0 ? <p className="empty profile-empty">Nenhum confronto direto disponível no torneio atual.</p> : headToHead.map((match) => <button className="profile-match" key={match.id} onClick={() => setSelectedMatchId(match.id)}><span><small>{match.tournament} · {match.round}</small><strong>{match.competitors.map((item) => item.name).join(" × ")}</strong></span><span className="profile-result">{match.state === "post" ? "FINAL" : match.state === "in" ? "AO VIVO" : formatMatchDate(match.date)}</span></button>)}
          </div>
        </section>
      )}

      {view === "history" && (
        <section className="archive-view">
          <div className="section-heading">
            <div><p className="eyebrow">Temporada {archiveYear}</p><h2>Torneios {tour}</h2></div>
            <span className="events-updated">{tournamentArchive?.count ?? 0} encontrados</span>
          </div>
          {!tournamentArchive && <div className="banner">Carregando histórico...</div>}
          {tournamentArchive?.count === 0 && <div className="banner">Nenhum torneio armazenado para estes filtros.</div>}
          <div className="archive-grid">
            {(tournamentArchive?.tournaments || []).map((tournament) => (
              <button className="tournament-card" key={tournament.id} onClick={() => openArchivedTournament(tournament)}>
                <span className="tournament-year">{tournament.major ? "Grand Slam" : tournament.tours?.join(" · ")}</span>
                <h3>{tournament.name}</h3>
                <p>{formatMatchDate(tournament.startDate)} — {tournament.endDate ? new Date(tournament.endDate).toLocaleDateString("pt-BR") : "—"}</p>
                {tournament.champion && <p className="tournament-winner"><strong>Campeão:</strong> {tournament.champion}<br /><span>Vice: {tournament.runnerUp || "—"}</span></p>}
                <div><span>{tournament.matchCount || 0} partidas</span><strong>Ver torneio →</strong></div>
              </button>
            ))}
          </div>
        </section>
      )}

      {selectedMatch && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedMatchId(null)}>
          <section className="match-modal" role="dialog" aria-modal="true" aria-labelledby="match-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">{selectedMatch.tour} · {selectedMatch.discipline}</p>
                <h2 id="match-title">{selectedMatch.tournament}</h2>
              </div>
              <div className="modal-actions">
                <button className={favoriteMatchIds.includes(selectedMatch.id) ? "favorite-button active" : "favorite-button"} onClick={() => toggleFavorite(selectedMatch.id)} aria-label="Alternar favorito">{favoriteMatchIds.includes(selectedMatch.id) ? "★" : "☆"}</button>
                <button className="close-button" onClick={() => setSelectedMatchId(null)} aria-label="Fechar detalhes">×</button>
              </div>
            </div>
            <div className={`detail-status state-${selectedMatch.state}`}>
              {selectedMatch.state === "in" ? selectedMatch.detail || "Ao vivo" : selectedMatch.state === "post" ? "Partida finalizada" : formatMatchDate(selectedMatch.date)}
            </div>
            <div className="detail-score">
              {selectedMatch.competitors.map((player) => (
                <div className={player.winner ? "detail-player winner" : "detail-player"} key={player.id || player.name}>
                  {player.flag && <img src={player.flag} alt="" />}
                  <button className="detail-player-link" type="button" onClick={() => openPlayerProfile(player)}>{player.name}<small>Ver perfil</small></button>
                  <div className="set-scores" aria-label={`Placar de ${player.name}`}>
                    {player.sets.length > 0 ? player.sets.map((set, index) => <span className={set.winner ? "won" : ""} key={index}>{set.value}{set.tiebreak != null && <sup>{set.tiebreak}</sup>}</span>) : <span>—</span>}
                  </div>
                </div>
              ))}
            </div>
            <dl className="match-facts">
              <div><dt>Rodada</dt><dd>{selectedMatch.round || "—"}</dd></div>
              <div><dt>Data e hora</dt><dd>{formatMatchDate(selectedMatch.date)}</dd></div>
              <div><dt>Local</dt><dd>{selectedMatch.venue || "—"}</dd></div>
              <div><dt>Quadra</dt><dd>{selectedMatch.court || "A definir"}</dd></div>
            </dl>
            <div className="match-history">
              <div className="profile-section-title"><h3>Histórico do confronto</h3><span>{persistentMatchHistory.length} anteriores</span></div>
              {persistentMatchHistory.length === 0 ? <p className="empty profile-empty">Nenhum confronto anterior encontrado nos dados armazenados.</p> : persistentMatchHistory.slice(0, 8).map((match) => (
                <button className="profile-match" key={match.id} onClick={() => setSelectedMatchId(match.id)}>
                  <span><small>{match.tournament} · {match.round}</small><strong>{match.competitors.map((item) => item.name).join(" × ")}</strong></span>
                  <span className="profile-result">{match.state === "post" ? "FINAL" : match.state === "in" ? "AO VIVO" : formatMatchDate(match.date)}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {selectedPlayer && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => { setSelectedPlayerId(null); setSelectedPlayerFallback(null); }}>
          <section className="match-modal player-modal" role="dialog" aria-modal="true" aria-labelledby="player-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header player-profile-header">
              <div className="profile-identity">
                {selectedPlayer.headshot ? <img src={selectedPlayer.headshot} alt={selectedPlayer.player} /> : <div className="profile-avatar">{selectedPlayer.player.slice(0, 1)}</div>}
                <div>
                  <p className="eyebrow">Perfil do jogador</p>
                  <h2 id="player-title">{selectedPlayer.player}</h2>
                  <p className="profile-country">{selectedPlayer.flag && <img src={selectedPlayer.flag} alt="" />} {selectedPlayer.country || selectedPlayer.countryCode}</p>
                </div>
              </div>
              <div className="modal-actions">
                <button className={favoritePlayerIds.includes(selectedPlayer.athleteId) ? "favorite-button active" : "favorite-button"} onClick={() => toggleFavoritePlayer(selectedPlayer.athleteId)} aria-label="Alternar jogador favorito">{favoritePlayerIds.includes(selectedPlayer.athleteId) ? "★" : "☆"}</button>
                <button className="close-button" onClick={() => { setSelectedPlayerId(null); setSelectedPlayerFallback(null); }} aria-label="Fechar perfil">×</button>
              </div>
            </div>

            <div className="profile-stats">
              <div><span>Ranking</span><strong>{selectedPlayer.rank ? `#${selectedPlayer.rank}` : "—"}</strong></div>
              <div><span>Pontos</span><strong>{selectedPlayer.points != null ? formatPoints(selectedPlayer.points) : "—"}</strong></div>
              <div><span>Variação</span><strong className={trendClass(selectedPlayer.trend)}>{selectedPlayer.trend}</strong></div>
              <div><span>Idade</span><strong>{selectedPlayer.age ?? "—"}</strong></div>
            </div>

            <div className="profile-history">
              <div className="profile-section-title"><h3>Evolução no ranking</h3><span>{selectedPlayerHistory.length} registros</span></div>
              <RankingHistoryChart history={selectedPlayerHistory} />
            </div>

            <div className="profile-record">
              <div><span>Partidas arquivadas</span><strong>{playerHistoricalMatches.length}</strong></div>
              <div><span>Vitórias</span><strong>{playerHistoricalWins}</strong></div>
              <div><span>Derrotas</span><strong>{Math.max(playerFinishedMatches.length - playerHistoricalWins, 0)}</strong></div>
              <div><span>Aproveitamento</span><strong>{playerFinishedMatches.length ? `${Math.round((playerHistoricalWins / playerFinishedMatches.length) * 100)}%` : "—"}</strong></div>
            </div>

            <div className="profile-matches">
              <div className="profile-section-title">
                <h3>Histórico de partidas</h3>
                <span>{playerHistoricalMatches.length} encontradas</span>
              </div>
              {playerHistoricalMatches.length === 0 && <p className="empty profile-empty">Nenhuma partida armazenada para este jogador.</p>}
              {playerHistoricalMatches.slice(0, 50).map((match) => {
                const opponent = match.competitors.find((competitor) => !normalizeSearchValue(competitor.name).includes(normalizeSearchValue(selectedPlayer.player)));
                const playerRow = match.competitors.find((competitor) => normalizeSearchValue(competitor.name).includes(normalizeSearchValue(selectedPlayer.player)));
                return (
                  <button className="profile-match" key={match.id} onClick={() => { setSelectedPlayerId(null); setSelectedPlayerFallback(null); setSelectedMatchId(match.id); }}>
                    <span><small>{match.tournament} · {match.round}</small><strong>vs. {opponent?.name || "Adversário a definir"}</strong></span>
                    <span className={playerRow?.winner ? "profile-result win" : match.state === "post" ? "profile-result loss" : "profile-result"}>{match.state === "in" ? "AO VIVO" : match.state === "pre" ? formatMatchDate(match.date) : playerRow?.winner ? "VITÓRIA" : "DERROTA"}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {selectedTournament && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedTournament(null)}>
          <section className="match-modal tournament-modal" role="dialog" aria-modal="true" aria-labelledby="tournament-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header"><div><p className="eyebrow">{archiveYear} · {tour}</p><h2 id="tournament-title">{selectedTournament.name}</h2></div><button className="close-button" onClick={() => setSelectedTournament(null)} aria-label="Fechar torneio">×</button></div>
            <p className="tournament-summary">{archivedMatches.length} partidas armazenadas</p>
            <div className="tournament-matches">
              {archivedMatches.slice(0, 80).map((match) => (
                <button className="profile-match" key={match.id} onClick={() => { setSelectedTournament(null); setSelectedMatchId(match.id); }}>
                  <span><small>{match.round || match.discipline}</small><strong>{match.competitors.map((item) => item.name).join(" × ")}</strong></span>
                  <span className="profile-result">{match.state === "post" ? "FINAL" : match.state === "in" ? "AO VIVO" : formatMatchDate(match.date)}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
