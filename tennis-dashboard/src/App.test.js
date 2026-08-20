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
  tournaments: [{ id: 'archive-1', name: 'Australian Open', startDate: '2026-01-12T00:00Z', endDate: '2026-01-25T00:00Z', year: 2026, major: true, tours: ['ATP', 'WTA'], matchCount: 254 }],
};

beforeEach(() => {
  window.localStorage.clear();
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/head-to-head')) return new Promise(() => {});
    if (String(url).includes('/api/tournaments/archive-1/matches')) return Promise.resolve({ ok: true, json: () => Promise.resolve(events) });
    if (String(url).includes('/api/tournaments?')) return Promise.resolve({ ok: true, json: () => Promise.resolve(tournamentArchive) });
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

test('renders ranking heading', async () => {
  render(<App />);
  const heading = screen.getByText(/Ranking mundial/i);
  expect(heading).toBeInTheDocument();
  await screen.findAllByText('Jannik Sinner');
});

test('filters visible players by name or country without requiring accents', async () => {
  render(<App />);

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
  const playerNames = await screen.findAllByText('Jannik Sinner');

  fireEvent.click(playerNames[0]);

  const profile = screen.getByRole('dialog', { name: 'Jannik Sinner' });
  expect(profile).toBeInTheDocument();
  expect(within(profile).getAllByText('#1')).toHaveLength(2);
  expect(screen.getAllByText('vs. Carlos Alcaraz')).toHaveLength(2);
  expect(screen.getByText(/Primeiro registro salvo/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Alternar jogador favorito' }));
  expect(JSON.parse(window.localStorage.getItem('favoritePlayerIds'))).toEqual(['1']);
});

test('compares two ranked players and shows their head-to-head match', async () => {
  render(<App />);
  await screen.findAllByText('Jannik Sinner');

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
  expect(screen.getAllByText('vs. Carlos Alcaraz')).toHaveLength(2);
});

test('lists archived tournaments and opens their stored matches', async () => {
  render(<App />);
  await screen.findAllByText('Jannik Sinner');
  fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));

  expect(await screen.findByText('Australian Open')).toBeInTheDocument();
  expect(screen.getByText('254 partidas')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Australian Open'));

  expect(await screen.findByRole('dialog', { name: 'Australian Open' })).toBeInTheDocument();
  expect(await screen.findByText('2 partidas armazenadas')).toBeInTheDocument();
});
