import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

const ranking = {
  generatedAt: '2026-08-06T04:00:00Z',
  tours: {
    ATP: {
      players: [
        { athleteId: '1', rank: 1, player: 'Jannik Sinner', country: 'Itália', countryCode: 'ITA', points: 13450 },
        { athleteId: '2', rank: 2, player: 'Carlos Alcaraz', country: 'Espanha', countryCode: 'ESP', points: 9590 },
      ],
    },
  },
};

const events = {
  generatedAt: '2026-08-20T15:00:00Z',
  matches: [
    {
      id: 'match-1', tournament: 'Cincinnati Open', tour: 'ATP', discipline: "Men's Singles",
      round: 'Semifinal', state: 'in', detail: '2º set', venue: 'Cincinnati, USA', court: 'Center Court',
      competitors: [
        { id: '1', name: 'Jannik Sinner', flag: '', winner: false, sets: [{ value: 6 }, { value: 2 }] },
        { id: '2', name: 'Carlos Alcaraz', flag: '', winner: false, sets: [{ value: 4 }, { value: 3 }] },
      ],
    },
    {
      id: 'match-0', tournament: 'Cincinnati Open', tour: 'ATP', discipline: "Men's Singles",
      round: 'Final 2025', state: 'post', detail: 'Final', venue: 'Cincinnati, USA', court: 'Center Court',
      competitors: [
        { id: '1', name: 'Jannik Sinner', flag: '', winner: true, sets: [{ value: 7 }, { value: 6 }] },
        { id: '2', name: 'Carlos Alcaraz', flag: '', winner: false, sets: [{ value: 5 }, { value: 4 }] },
      ],
    },
  ],
};

const rankingHistory = {
  players: {
    'ATP:1': { athleteId: '1', history: [{ date: '2026-08-06', rank: 1, points: 13450 }] },
  },
};

const tournamentArchive = {
  count: 1,
  tournaments: [{ id: 'archive-1', name: 'Australian Open', startDate: '2026-01-12T00:00Z', endDate: '2026-01-25T00:00Z', year: 2026, major: true, tours: ['ATP', 'WTA'], matchCount: 254, champion: 'Jannik Sinner', runnerUp: 'Carlos Alcaraz', category: 'Grand Slam', surface: 'Hard' }],
};

const archivedPlayerMatches = [...events.matches, {
  ...events.matches[1], id: 'match-old', tournament: 'US Open', round: 'Final 2024',
}];

const playerStats = {
  matches: 3, wins: 2, losses: 1, titleCount: 2,
  titles: { 'Grand Slam': 1, '1000': 1, '500': 0, '250': 0, Finals: 0 },
  bySurface: { Hard: { played: 3, wins: 2, losses: 1, winRate: 67 } },
};

beforeEach(() => {
  window.localStorage.clear();
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/head-to-head')) return new Promise(() => {});
    if (String(url).includes('/api/tournaments/archive-1/matches')) return Promise.resolve({ ok: true, json: () => Promise.resolve(events) });
    if (String(url).includes('/api/tournaments?')) return Promise.resolve({ ok: true, json: () => Promise.resolve(tournamentArchive) });
    if (String(url).includes('/api/players/ATP/1/matches')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 3, matches: archivedPlayerMatches }) });
    if (String(url).includes('/api/players/ATP/1/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve(playerStats) });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(
        String(url).includes('events') ? events : String(url).includes('ranking-history') ? rankingHistory : ranking
      ),
    });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('renders the personalized today page', async () => {
  render(<App />);
  const heading = screen.getByText(/Tênis hoje/i);
  expect(heading).toBeInTheDocument();
  await screen.findAllByText(/Jannik Sinner × Carlos Alcaraz/);
});

test('shows only one relevant match per favorite player on the today page', async () => {
  window.localStorage.setItem('favoritePlayerIds', JSON.stringify(['1']));
  render(<App />);

  const label = await screen.findByText('Próximo jogo · até 7 dias');
  const favoriteBlock = label.closest('.today-block');
  expect(within(favoriteBlock).getAllByRole('button')).toHaveLength(1);
  expect(within(favoriteBlock).getByText(/Jannik Sinner × Carlos Alcaraz/)).toBeInTheDocument();
  expect(within(favoriteBlock).getByText('AO VIVO')).toBeInTheDocument();
});

test('opens the notification center and clears persisted alerts', async () => {
  window.localStorage.setItem('tennisAlerts', JSON.stringify([{ id: 'alert-1', matchId: 'match-1', title: 'Sua partida começou', body: 'Jannik Sinner × Carlos Alcaraz', createdAt: '2026-08-20T15:00:00Z', read: false }]));
  render(<App />);
  await screen.findAllByText(/Jannik Sinner × Carlos Alcaraz/);

  fireEvent.click(screen.getByRole('button', { name: 'Abrir notificações' }));
  expect(screen.getByLabelText('Central de notificações')).toBeInTheDocument();
  expect(screen.getByText('Sua partida começou')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Limpar notificações' }));
  expect(screen.queryByText('Sua partida começou')).not.toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem('tennisAlerts'))).toEqual([]);
});

test('filters visible players by name or country without requiring accents', async () => {
  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: 'Ranking' }));

  await waitFor(() => expect(screen.getAllByText('Jannik Sinner')).toHaveLength(2));

  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'espanha' } });
  expect(screen.queryByText('Jannik Sinner')).not.toBeInTheDocument();
  expect(screen.getAllByText('Carlos Alcaraz')).toHaveLength(2);

  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'italia' } });
  expect(screen.getAllByText('Jannik Sinner')).toHaveLength(2);
  expect(screen.queryByText('Carlos Alcaraz')).not.toBeInTheDocument();
});

test('shows live tournament scores in the matches view', async () => {
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: /Torneios e partidas/i }));

  expect(await screen.findByText('Cincinnati Open')).toBeInTheDocument();
  expect(screen.getByText('2º set')).toBeInTheDocument();
  expect(screen.getByText('Center Court', { exact: false })).toBeInTheDocument();
});

test('opens match details and saves a favorite', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Torneios e partidas/i }));

  fireEvent.click(await screen.findByText('Cincinnati Open'));
  expect(screen.getByRole('dialog', { name: 'Cincinnati Open' })).toBeInTheDocument();
  expect(screen.getAllByText('Semifinal')).toHaveLength(2);

  fireEvent.click(screen.getByRole('button', { name: 'Alternar favorito' }));
  expect(JSON.parse(window.localStorage.getItem('favoriteMatchIds'))).toEqual(['match-1']);
});

test('opens a player profile with ranking, matches and favorite state', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Ranking' }));
  const playerNames = await screen.findAllByText('Jannik Sinner');

  fireEvent.click(playerNames[0]);

  const profile = screen.getByRole('dialog', { name: 'Jannik Sinner' });
  expect(profile).toBeInTheDocument();
  expect(within(profile).getAllByText('#1')).toHaveLength(2);
  await waitFor(() => expect(screen.getAllByText('vs. Carlos Alcaraz')).toHaveLength(3));
  expect(screen.getByText(/Primeiro registro salvo/)).toBeInTheDocument();
  expect(screen.getByText('US Open', { exact: false })).toBeInTheDocument();
  expect(await screen.findByText('2 títulos')).toBeInTheDocument();
  expect(screen.getByText('67%')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Alternar jogador favorito' }));
  expect(JSON.parse(window.localStorage.getItem('favoritePlayerIds'))).toEqual(['1']);
});

test('compares two ranked players and shows their head-to-head match', async () => {
  render(<App />);
  await screen.findAllByText(/Jannik Sinner × Carlos Alcaraz/);

  fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));

  expect(screen.getByText('Comparação ATP')).toBeInTheDocument();
  expect(screen.getByLabelText('Jogador 1')).toHaveValue('1');
  expect(screen.getByLabelText('Jogador 2')).toHaveValue('2');
  expect(screen.getAllByText('Jannik Sinner × Carlos Alcaraz')).toHaveLength(2);
  expect(screen.getByText('2 encontrados')).toBeInTheDocument();
});

test('opens a player profile from a future match and shows previous head-to-heads', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Torneios e partidas/i }));
  fireEvent.click(await screen.findByText('Cincinnati Open'));

  expect(screen.getByText('1 anteriores')).toBeInTheDocument();
  expect(screen.getByText('Final 2025', { exact: false })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Jannik Sinner.*Ver perfil/i }));
  expect(screen.getByRole('dialog', { name: 'Jannik Sinner' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByText('vs. Carlos Alcaraz')).toHaveLength(3));
});

test('lists archived tournaments and opens their stored matches', async () => {
  render(<App />);
  await screen.findAllByText(/Jannik Sinner × Carlos Alcaraz/);
  fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));

  expect(await screen.findByText('Australian Open')).toBeInTheDocument();
  expect(screen.getByText('254 partidas')).toBeInTheDocument();
  expect(screen.getByText('Campeão:', { exact: false })).toBeInTheDocument();
  expect(screen.getByText('Grand Slam')).toBeInTheDocument();
  expect(screen.getByText('Hard')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Australian Open'));

  expect(await screen.findByRole('dialog', { name: 'Australian Open' })).toBeInTheDocument();
  expect(await screen.findByText('2 partidas armazenadas')).toBeInTheDocument();
});

test('filters the tournament calendar by month, surface and category', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Calendário' }));

  expect(await screen.findByText('Australian Open')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Mês do calendário'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Superfície'), { target: { value: 'Hard' } });
  fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'Grand Slam' } });

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('month=1')));
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('surface=Hard'));
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('category=Grand+Slam'));
});
