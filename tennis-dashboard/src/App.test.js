import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  ],
};

beforeEach(() => {
  global.fetch = jest.fn((url) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(String(url).includes('events.json') ? events : ranking),
    })
  );
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
