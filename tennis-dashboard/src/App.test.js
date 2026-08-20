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

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(ranking) })
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
