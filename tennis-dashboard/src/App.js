import { useEffect, useMemo, useRef, useState } from "react";
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
  const [view, setView] = useState("today");
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
  const [remotePlayerStats, setRemotePlayerStats] = useState(null);
  const [playerStatsYear, setPlayerStatsYear] = useState("2026");
  const [leaderYear, setLeaderYear] = useState("2026");
  const [leaderMetric, setLeaderMetric] = useState("titles");
  const [leaderData, setLeaderData] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(String(new Date().getMonth() + 1));
  const [calendarSurface, setCalendarSurface] = useState("");
  const [calendarCategory, setCalendarCategory] = useState("");
  const [calendarData, setCalendarData] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [browserNotifications, setBrowserNotifications] = useState(() => window.localStorage.getItem("browserNotifications") === "true");
  const [alerts, setAlerts] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem("tennisAlerts")) || [];
    } catch {
      return [];
    }
  });
  const [authToken, setAuthToken] = useState(() => window.localStorage.getItem("tennisAuthToken") || "");
  const [currentUser, setCurrentUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const previousMatchStates = useRef(new Map());
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
    if (!authToken) {
      setCurrentUser(null);
      setPreferencesReady(false);
      return;
    }
    const headers = { Authorization: `Bearer ${authToken}` };
    fetch("/api/auth/me", { headers })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => {
        setCurrentUser(data.user);
        return fetch("/api/account/preferences", { headers });
      })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(async (preferences) => {
        if (preferences.initialized) {
          setFavoritePlayerIds(preferences.favoritePlayerIds || []);
          setFavoriteMatchIds(preferences.favoriteMatchIds || []);
          setTour(preferences.preferredTour || "ATP");
        } else {
          let localPlayers = [];
          let localMatches = [];
          try {
            localPlayers = JSON.parse(window.localStorage.getItem("favoritePlayerIds")) || [];
            localMatches = JSON.parse(window.localStorage.getItem("favoriteMatchIds")) || [];
          } catch {
            // Preferências locais inválidas são ignoradas durante a migração.
          }
          await fetch("/api/account/preferences", {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ favoritePlayerIds: localPlayers, favoriteMatchIds: localMatches, preferredTour: tour }),
          });
        }
        setPreferencesReady(true);
      })
      .catch(() => {
        window.localStorage.removeItem("tennisAuthToken");
        setAuthToken("");
        setCurrentUser(null);
        setPreferencesReady(false);
      });
    // A preferência de circuito é carregada depois da autenticação; não deve reiniciar este fluxo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

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
    if (view !== "calendar") return;
    const params = new URLSearchParams({ year: "2026", month: calendarMonth, tour });
    if (calendarSurface) params.set("surface", calendarSurface);
    if (calendarCategory) params.set("category", calendarCategory);
    fetch(`/api/tournaments?${params}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setCalendarData)
      .catch(() => setCalendarData({ count: 0, tournaments: [] }));
  }, [view, calendarMonth, calendarSurface, calendarCategory, tour]);

  useEffect(() => {
    if (view !== "leaders") return;
    setLeaderData(null);
    const params = new URLSearchParams({ tour, year: leaderYear, metric: leaderMetric, limit: "10" });
    fetch(`/api/leaders?${params}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setLeaderData)
      .catch(() => setLeaderData({ count: 0, leaders: [] }));
  }, [view, tour, leaderYear, leaderMetric]);

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
    if (!authToken || !currentUser || !preferencesReady) return;
    fetch("/api/account/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ favoritePlayerIds, favoriteMatchIds, preferredTour: tour }),
    }).catch(() => {});
  }, [authToken, currentUser, preferencesReady, favoritePlayerIds, favoriteMatchIds, tour]);

  useEffect(() => {
    window.localStorage.setItem("tennisAlerts", JSON.stringify(alerts));
  }, [alerts]);

  useEffect(() => {
    if (!events?.matches) return;
    const nextStates = new Map(events.matches.map((match) => [match.id, match.state]));
    if (previousMatchStates.current.size > 0) {
      const newAlerts = [];
      for (const match of events.matches) {
        const previousState = previousMatchStates.current.get(match.id);
        const isFavorite = favoriteMatchIds.includes(match.id) || match.competitors.some((competitor) => favoritePlayerIds.includes(competitor.id));
        if (!isFavorite || !previousState || previousState === match.state) continue;
        let title = "Partida atualizada";
        if (match.state === "in") title = "Sua partida começou";
        if (match.state === "post") title = "Sua partida terminou";
        const body = match.competitors.map((competitor) => competitor.name).join(" × ");
        const alert = { id: `${match.id}-${match.state}-${Date.now()}`, matchId: match.id, title, body, createdAt: new Date().toISOString(), read: false };
        newAlerts.push(alert);
        if (browserNotifications && typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(title, { body, tag: `tennis-${match.id}` });
        }
      }
      if (newAlerts.length) setAlerts((current) => [...newAlerts, ...current].slice(0, 30));
    }
    previousMatchStates.current = nextStates;
  }, [events, favoriteMatchIds, favoritePlayerIds, browserNotifications]);

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
      setRemotePlayerStats(null);
      return;
    }
    const params = new URLSearchParams({ name: selectedPlayer.player, limit: "100" });
    fetch(`/api/players/${tour}/${encodeURIComponent(selectedPlayer.athleteId)}/matches?${params}`)
      .then((response) => response.ok ? response.json() : null)
      .then(setRemotePlayerMatches)
      .catch(() => setRemotePlayerMatches(null));
    const statsParams = new URLSearchParams({ name: selectedPlayer.player, year: playerStatsYear });
    fetch(`/api/players/${tour}/${encodeURIComponent(selectedPlayer.athleteId)}/stats?${statsParams}`)
      .then((response) => response.ok ? response.json() : null)
      .then(setRemotePlayerStats)
      .catch(() => setRemotePlayerStats(null));
  }, [selectedPlayer, tour, playerStatsYear]);
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
    if (!currentUser) {
      setAuthMode("login");
      setAuthError("Entre para salvar partidas e receber alertas.");
      setAuthOpen(true);
      return;
    }
    setFavoriteMatchIds((current) =>
      current.includes(matchId) ? current.filter((id) => id !== matchId) : [...current, matchId]
    );
  };
  const toggleFavoritePlayer = (playerId) => {
    if (!currentUser) {
      setAuthMode("login");
      setAuthError("Entre para seguir jogadores e personalizar sua página.");
      setAuthOpen(true);
      return;
    }
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
  const requestBrowserNotifications = async () => {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    const enabled = permission === "granted";
    setBrowserNotifications(enabled);
    window.localStorage.setItem("browserNotifications", String(enabled));
  };
  const toggleNotifications = () => {
    const opening = !notificationsOpen;
    setNotificationsOpen(opening);
    if (opening) setAlerts((current) => current.map((alert) => ({ ...alert, read: true })));
  };
  const submitAuth = async (event) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    const fields = new FormData(event.currentTarget);
    const body = { email: fields.get("email"), password: fields.get("password") };
    if (authMode === "register") body.name = fields.get("name");
    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Não foi possível entrar.");
      window.localStorage.setItem("tennisAuthToken", data.token);
      setPreferencesReady(false);
      setAuthToken(data.token);
      setCurrentUser(data.user);
      setAuthOpen(false);
    } catch (authRequestError) {
      setAuthError(authRequestError.message);
    } finally {
      setAuthLoading(false);
    }
  };
  const logoutUser = () => {
    if (authToken) fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${authToken}` } }).catch(() => {});
    window.localStorage.removeItem("tennisAuthToken");
    setAuthToken("");
    setCurrentUser(null);
    setPreferencesReady(false);
    setFavoritePlayerIds([]);
    setFavoriteMatchIds([]);
    setTour("ATP");
  };
  const liveCount = (events?.matches || []).filter(
    (match) => match.tour === tour && match.state === "in"
  ).length;
  const todayTourMatches = (events?.matches || []).filter((match) => match.tour === tour);
  const todayLive = todayTourMatches.filter((match) => match.state === "in");
  const todayUpcoming = todayTourMatches.filter((match) => match.state === "pre").slice(0, 6);
  const todayRecent = todayTourMatches.filter((match) => match.state === "post").slice(0, 6);
  const now = Date.now();
  const sevenDaysFromNow = now + 7 * 24 * 60 * 60 * 1000;
  const relevantFavoriteMatches = todayTourMatches
    .filter((match) => match.state === "in" || (match.state === "pre" && new Date(match.date).getTime() >= now && new Date(match.date).getTime() <= sevenDaysFromNow))
    .sort((left, right) => left.state === "in" ? -1 : right.state === "in" ? 1 : new Date(left.date) - new Date(right.date));
  const favoritePlayerMatches = favoritePlayerIds
    .map((playerId) => relevantFavoriteMatches.find((match) => match.competitors.some((competitor) => competitor.id === playerId)))
    .filter(Boolean);
  const explicitlyFavoriteMatches = relevantFavoriteMatches.filter((match) => favoriteMatchIds.includes(match.id));
  const favoriteTodayMatches = [...new Map([...favoritePlayerMatches, ...explicitlyFavoriteMatches].map((match) => [match.id, match])).values()];
  const unreadAlerts = alerts.filter((alert) => !alert.read).length;

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Tennis Analytics</p>
          <h1>{view === "today" ? "Tênis hoje" : view === "ranking" ? "Ranking mundial" : view === "matches" ? "Torneios e partidas" : view === "history" ? "Histórico de torneios" : view === "calendar" ? "Calendário" : view === "leaders" ? "Líderes da temporada" : "Comparar jogadores"}</h1>
          <p className="lede">
            ATP e WTA atualizados a partir da fonte oficial via ESPN.
          </p>
        </div>
        <div className="meta">
          <span>{tourData?.week || "Temporada 2026"}</span>
          <span>Atualizado em {formatUpdated(tourData?.lastUpdated || payload?.generatedAt)}</span>
          <div className="header-actions">
            {currentUser && <button className="notification-button" type="button" aria-label="Abrir notificações" onClick={toggleNotifications}>🔔{unreadAlerts > 0 && <b>{unreadAlerts}</b>}</button>}
            {currentUser ? <button className="account-button signed-in" type="button" onClick={logoutUser} title="Sair da conta"><span>{currentUser.name.slice(0, 1).toUpperCase()}</span><b>{currentUser.name}</b><small>Sair</small></button> : <button className="account-button" type="button" onClick={() => { setAuthMode("login"); setAuthError(""); setAuthOpen(true); }}>Entrar</button>}
          </div>
        </div>
      </header>

      {authOpen && (
        <div className="modal-backdrop auth-backdrop" role="presentation" onMouseDown={() => setAuthOpen(false)}>
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><p className="eyebrow">Sua conta</p><h2 id="auth-title">{authMode === "login" ? "Bem-vinda de volta" : "Crie sua conta"}</h2></div>
              <button className="close-button" type="button" onClick={() => setAuthOpen(false)} aria-label="Fechar login">×</button>
            </div>
            <p className="auth-intro">Entre para manter sua experiência preparada para sincronizar favoritos e alertas em qualquer dispositivo.</p>
            <form className="auth-form" onSubmit={submitAuth}>
              {authMode === "register" && <label><span>Nome</span><input name="name" required minLength="2" autoComplete="name" placeholder="Como podemos chamar você?" /></label>}
              <label><span>E-mail</span><input name="email" type="email" required autoComplete="email" placeholder="voce@email.com" /></label>
              <label><span>Senha</span><input name="password" type="password" required minLength="8" autoComplete={authMode === "login" ? "current-password" : "new-password"} placeholder="Mínimo de 8 caracteres" /></label>
              {authError && <p className="auth-error" role="alert">{authError}</p>}
              <button className="auth-submit" disabled={authLoading}>{authLoading ? "Aguarde..." : authMode === "login" ? "Entrar" : "Criar conta"}</button>
            </form>
            <button className="auth-switch" type="button" onClick={() => { setAuthMode((mode) => mode === "login" ? "register" : "login"); setAuthError(""); }}>{authMode === "login" ? "Ainda não tenho conta" : "Já tenho uma conta"}</button>
          </section>
        </div>
      )}

      {notificationsOpen && (
        <aside className="notification-panel" aria-label="Central de notificações">
          <div className="notification-header"><div><h2>Notificações</h2><span>{browserNotifications ? "Alertas do navegador ativos" : "Alertas somente dentro do site"}</span></div><button onClick={requestBrowserNotifications} disabled={browserNotifications}>{browserNotifications ? "Ativadas" : "Ativar no navegador"}</button></div>
          {alerts.length === 0 ? <p className="empty profile-empty">As mudanças das partidas favoritas aparecerão aqui.</p> : <div className="notification-list">{alerts.map((alert) => <button key={alert.id} onClick={() => { setNotificationsOpen(false); setSelectedMatchId(alert.matchId); }}><strong>{alert.title}</strong><span>{alert.body}</span><small>{formatUpdated(alert.createdAt)}</small></button>)}</div>}
          {alerts.length > 0 && <button className="clear-alerts" onClick={() => setAlerts([])}>Limpar notificações</button>}
        </aside>
      )}

      <nav className="view-tabs" aria-label="Seções">
        <button className={view === "today" ? "active" : ""} onClick={() => setView("today")}>Hoje</button>
        <button className={view === "ranking" ? "active" : ""} onClick={() => setView("ranking")}>Ranking</button>
        <button className={view === "leaders" ? "active" : ""} onClick={() => setView("leaders")}>Líderes</button>
        <button className={view === "matches" ? "active" : ""} onClick={() => setView("matches")}>
          Torneios e partidas {liveCount > 0 && <span className="live-pill">{liveCount} ao vivo</span>}
        </button>
        <button className={view === "compare" ? "active" : ""} onClick={() => setView("compare")}>Comparar</button>
        <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>Histórico</button>
        <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>Calendário</button>
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
        {view === "calendar" && (
          <div className="calendar-controls">
            <select aria-label="Mês do calendário" value={calendarMonth} onChange={(event) => setCalendarMonth(event.target.value)}>
              {["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"].map((month, index) => <option value={index + 1} key={month}>{month}</option>)}
            </select>
            <select aria-label="Superfície" value={calendarSurface} onChange={(event) => setCalendarSurface(event.target.value)}><option value="">Todas as superfícies</option>{["Hard", "Clay", "Grass", "Indoor Hard"].map((value) => <option key={value}>{value}</option>)}</select>
            <select aria-label="Categoria" value={calendarCategory} onChange={(event) => setCalendarCategory(event.target.value)}><option value="">Todas as categorias</option>{["Grand Slam", "1000", "500", "250", "Finals"].map((value) => <option key={value}>{value}</option>)}</select>
          </div>
        )}
        {view === "leaders" && (
          <div className="leader-controls">
            <select aria-label="Temporada dos líderes" value={leaderYear} onChange={(event) => setLeaderYear(event.target.value)}>
              {[2026, 2025].map((year) => <option value={year} key={year}>{year}</option>)}
            </select>
            <select aria-label="Critério dos líderes" value={leaderMetric} onChange={(event) => setLeaderMetric(event.target.value)}>
              <option value="titles">Mais títulos</option>
              <option value="wins">Mais vitórias</option>
              <option value="winRate">Melhor aproveitamento</option>
            </select>
          </div>
        )}
      </section>

      {error && <div className="banner error">{error}</div>}
      {!error && !payload && <div className="banner">Carregando ranking...</div>}

      {view === "today" && (
        <section className="today-view">
          <div className="today-summary">
            <div><span>Ao vivo</span><strong>{todayLive.length}</strong></div>
            <div><span>Próximas</span><strong>{todayUpcoming.length}</strong></div>
            {currentUser ? <div><span>Meus favoritos</span><strong>{favoriteTodayMatches.length}</strong></div> : <div><span>Líder do ranking</span><strong>{tourData?.players?.[0] ? `#${tourData.players[0].rank}` : "—"}</strong></div>}
            <div><span>Torneios ativos</span><strong>{(events?.tournaments || []).filter((item) => item.tours.includes(tour)).length}</strong></div>
          </div>

          {currentUser && favoriteTodayMatches.length > 0 && (
            <div className="today-block favorite-block"><div className="profile-section-title"><h2>Para você</h2><span>Próximo jogo · até 7 dias</span></div><div className="home-match-list">{favoriteTodayMatches.map((match) => <button className="home-match" key={match.id} onClick={() => setSelectedMatchId(match.id)}><span><small>{match.tournament} · {match.round}</small><strong>{match.competitors.map((item) => item.name).join(" × ")}</strong></span><b>{match.state === "in" ? "AO VIVO" : formatMatchDate(match.date)}</b></button>)}</div></div>
          )}

          {!currentUser && (
            <div className="public-home-grid">
              <div className="today-block public-ranking">
                <div className="profile-section-title"><h2>Ranking {tour}</h2><button onClick={() => setView("ranking")}>Ver ranking</button></div>
                {(tourData?.players || []).slice(0, 5).map((player) => <button className="public-ranking-row" key={player.athleteId} onClick={() => openPlayerProfile({ id: player.athleteId, name: player.player })}><strong>#{player.rank}</strong><span>{player.player}<small>{player.country || player.countryCode}</small></span><b>{formatPoints(player.points)} pts</b></button>)}
              </div>
              <div className="today-block public-tournaments">
                <div className="profile-section-title"><h2>Torneios atuais</h2><button onClick={() => setView("matches")}>Ver partidas</button></div>
                {(events?.tournaments || []).filter((item) => item.tours.includes(tour)).slice(0, 5).map((tournament) => <div className="public-tournament-row" key={tournament.id || tournament.name}><span>{tournament.name}</span><small>{tournament.location || tournament.venue || tournament.tours.join(" · ")}</small></div>)}
                {(events?.tournaments || []).filter((item) => item.tours.includes(tour)).length === 0 && <p className="empty profile-empty">Nenhum torneio ativo agora.</p>}
              </div>
            </div>
          )}

          <div className="today-columns">
            <div className="today-block live-block"><div className="profile-section-title"><h2>Ao vivo</h2><span>{todayLive.length} partidas</span></div>{todayLive.length === 0 ? <p className="empty profile-empty">Nenhuma partida ao vivo agora.</p> : <div className="home-match-list">{todayLive.map((match) => <button className="home-match" key={match.id} onClick={() => setSelectedMatchId(match.id)}><span><small>{match.tournament} · {match.detail}</small><strong>{match.competitors.map((item) => item.name).join(" × ")}</strong></span><b>AO VIVO</b></button>)}</div>}</div>
            <div className="today-block"><div className="profile-section-title"><h2>Próximas</h2><button onClick={() => setView("matches")}>Ver todas</button></div><div className="home-match-list">{todayUpcoming.map((match) => <button className="home-match" key={match.id} onClick={() => setSelectedMatchId(match.id)}><span><small>{match.tournament} · {match.round}</small><strong>{match.competitors.map((item) => item.name).join(" × ")}</strong></span><b>{formatMatchDate(match.date)}</b></button>)}</div></div>
          </div>

          {currentUser && <div className="today-block"><div className="profile-section-title"><h2>Resultados recentes</h2><span>{tour}</span></div><div className="home-match-list recent-grid">{todayRecent.map((match) => <button className="home-match" key={match.id} onClick={() => setSelectedMatchId(match.id)}><span><small>{match.tournament} · {match.round}</small><strong>{match.competitors.map((item) => item.name).join(" × ")}</strong></span><b>FINAL</b></button>)}</div></div>}
        </section>
      )}

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

      {view === "leaders" && (
        <section className="leaders-view">
          <div className="section-heading">
            <div><p className="eyebrow">Temporada {leaderYear}</p><h2>Top 10 {tour}</h2></div>
            <span className="events-updated">Dados das partidas armazenadas</span>
          </div>
          {!leaderData && <div className="banner">Calculando líderes...</div>}
          {leaderData?.count === 0 && <div className="banner">Ainda não há partidas suficientes nesta temporada.</div>}
          <div className="leader-list">
            {(leaderData?.leaders || []).map((leader, index) => {
              const rankedPlayer = (tourData?.players || []).find((player) => player.athleteId === leader.athleteId || normalizeSearchValue(player.player) === normalizeSearchValue(leader.player));
              const metricValue = leaderMetric === "titles" ? `${leader.titles} ${leader.titles === 1 ? "título" : "títulos"}` : leaderMetric === "wins" ? `${leader.wins} vitórias` : `${leader.winRate}%`;
              return (
                <button className="leader-card" key={leader.athleteId || leader.player} onClick={() => openPlayerProfile({ id: leader.athleteId, name: leader.player })}>
                  <strong className="leader-position">#{index + 1}</strong>
                  {rankedPlayer?.headshot ? <img src={rankedPlayer.headshot} alt="" /> : <span className="leader-avatar">{leader.player.slice(0, 1)}</span>}
                  <span className="leader-name"><strong>{leader.player}</strong><small>{leader.wins}V · {Math.max(leader.played - leader.wins, 0)}D · {leader.played} jogos</small></span>
                  <b>{metricValue}</b>
                </button>
              );
            })}
          </div>
          <p className="data-note">O aproveitamento exige pelo menos 5 partidas armazenadas no ano.</p>
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
                <div className="tournament-badges"><span>{tournament.category || (tournament.major ? "Grand Slam" : tournament.tours?.join(" · "))}</span>{tournament.surface && <span>{tournament.surface}</span>}</div>
                <h3>{tournament.name}</h3>
                <p>{formatMatchDate(tournament.startDate)} — {tournament.endDate ? new Date(tournament.endDate).toLocaleDateString("pt-BR") : "—"}</p>
                {tournament.champion && <p className="tournament-winner"><strong>Campeão:</strong> {tournament.champion}<br /><span>Vice: {tournament.runnerUp || "—"}</span></p>}
                <div className="tournament-footer"><span>{tournament.matchCount || 0} partidas</span><strong>Ver torneio →</strong></div>
              </button>
            ))}
          </div>
        </section>
      )}

      {view === "calendar" && (
        <section className="calendar-view">
          <div className="section-heading"><div><p className="eyebrow">Temporada 2026</p><h2>{new Date(2026, Number(calendarMonth) - 1, 1).toLocaleDateString("pt-BR", { month: "long" })}</h2></div><span className="events-updated">{calendarData?.count || 0} torneios</span></div>
          {!calendarData && <div className="banner">Carregando calendário...</div>}
          {calendarData?.count === 0 && <div className="banner">Nenhum torneio para estes filtros.</div>}
          <div className="calendar-list">
            {(calendarData?.tournaments || []).map((tournament) => (
              <button className="calendar-event" key={tournament.id} onClick={() => openArchivedTournament(tournament)}>
                <time><strong>{new Date(tournament.startDate).toLocaleDateString("pt-BR", { day: "2-digit" })}</strong><span>{new Date(tournament.startDate).toLocaleDateString("pt-BR", { month: "short" })}</span></time>
                <div><span className="calendar-badges"><i>{tournament.category || tour}</i><i>{tournament.surface || "—"}</i></span><h3>{tournament.name}</h3><p>{tournament.champion ? `Último campeão: ${tournament.champion}` : `${tournament.matchCount || 0} partidas armazenadas`}</p></div>
                <strong>→</strong>
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

            {remotePlayerStats && (
              <div className="career-stats">
                <div className="profile-section-title stats-season-heading">
                  <div><h3>Temporada {playerStatsYear}</h3><span>{remotePlayerStats.wins}V · {remotePlayerStats.losses}D</span></div>
                  <select aria-label="Temporada das estatísticas" value={playerStatsYear} onChange={(event) => setPlayerStatsYear(event.target.value)}>
                    {[2026, 2025].map((year) => <option value={year} key={year}>{year}</option>)}
                  </select>
                </div>
                <div className="profile-section-title title-summary"><h3>Títulos</h3><span>{remotePlayerStats.titleCount} títulos</span></div>
                <div className="title-breakdown">
                  {["Grand Slam", "1000", "500", "250", "Finals"].map((category) => <div key={category}><strong>{remotePlayerStats.titles?.[category] || 0}</strong><span>{category}</span></div>)}
                </div>
                <div className="profile-section-title surface-title"><h3>Desempenho por superfície</h3><span>{remotePlayerStats.matches} partidas</span></div>
                <div className="surface-stats">
                  {Object.entries(remotePlayerStats.bySurface || {}).map(([surface, stats]) => (
                    <div key={surface}><span><strong>{surface}</strong><small>{stats.wins}V · {stats.losses}D</small></span><div><i style={{ width: `${stats.winRate}%` }} /></div><b>{stats.winRate}%</b></div>
                  ))}
                </div>
              </div>
            )}

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
