import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import { KinoCurveSection } from './KinoCurveSection.jsx';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('xlsx', () => ({
  utils: {
    aoa_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(),
  },
});

test('renders a Search button', () => {
  render(<KinoCurveSection devices={[]} />);
  expect(screen.getByRole('button', { name: /search/i })).toBeTruthy();
});

test('lists each device serial number as a filter option', () => {
  render(<KinoCurveSection devices={[{ serial_number: 'KINO-001' }, { serial_number: 'KINO-002' }]} />);
  expect(screen.getByRole('option', { name: 'KINO-001' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'KINO-002' })).toBeTruthy();
});

test('Export button is disabled before any curves are loaded', () => {
  render(<KinoCurveSection devices={[]} />);
  const exportBtn = screen.getByRole('button', { name: /export/i });
  expect(exportBtn.disabled).toBe(true);
});

test('lists serials from the full device endpoint, not just the paginated prop', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    serial_number: `KINO-${String(i + 1).padStart(3, '0')}`,
  }));
  axios.get.mockImplementation((url) => {
    if (url === '/api/kino-devices') return Promise.resolve({ data: { devices: many } });
    return Promise.resolve({ data: {} });
  });
  // prop only carries the first 10 (client pagination); the 12th must still appear.
  render(<KinoCurveSection devices={many.slice(0, 10)} />);
  expect(await screen.findByRole('option', { name: 'KINO-012' })).toBeTruthy();
});

test('searching fetches curves, enables Export, and shows the chart', async () => {
  axios.get.mockImplementation((url) => {
    if (url === '/api/kino-curves') {
      return Promise.resolve({
        data: { curves: [{ serial_number: 'S1', chip_code: 'C1', curve: [0, 1, 2, 1, 0] }] },
      });
    }
    return Promise.resolve({ data: { devices: [] } });
  });
  render(<KinoCurveSection devices={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /search/i }));

  await waitFor(() => expect(screen.getByTestId('curve-chart')).toBeTruthy());
  expect(axios.get).toHaveBeenCalledWith('/api/kino-curves', { params: {} });
  expect(screen.getByRole('button', { name: /export/i }).disabled).toBe(false);
});

test('draws a start-to-end chord per wave, each wave in its own color', async () => {
  // two separate waves -> two chords with two distinct colors
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 150) return i;              // wave 1 rise
    if (i <= 300) return 300 - i;        // wave 1 fall
    if (i <= 600) return 0;              // valley
    if (i <= 690) return i - 600;        // wave 2 rise
    if (i <= 780) return 780 - i;        // wave 2 fall
    return 0;
  });
  axios.get.mockImplementation((url) => {
    if (url === '/api/kino-curves') {
      return Promise.resolve({ data: { curves: [{ serial_number: 'S1', chip_code: 'C1', curve }] } });
    }
    return Promise.resolve({ data: { devices: [] } });
  });
  render(<KinoCurveSection devices={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /search/i }));

  const chart = await screen.findByTestId('curve-chart');
  expect(Number(chart.getAttribute('data-region-chords'))).toBe(2);
  const colors = (chart.getAttribute('data-chord-colors') || '').split(',').filter(Boolean);
  expect(new Set(colors).size).toBe(2);
});

test('marks start/peak/end points for each detected region', async () => {
  const curve = Array.from({ length: 1000 }, (_, i) => {
    if (i <= 200) return i;       // rise
    if (i <= 400) return 400 - i; // fall
    return 0;
  });
  axios.get.mockImplementation((url) => {
    if (url === '/api/kino-curves') {
      return Promise.resolve({ data: { curves: [{ serial_number: 'S1', chip_code: 'C1', curve }] } });
    }
    return Promise.resolve({ data: { devices: [] } });
  });
  render(<KinoCurveSection devices={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /search/i }));

  const chart = await screen.findByTestId('curve-chart');
  // one region -> 3 markers (start, peak, end)
  expect(Number(chart.getAttribute('data-region-markers'))).toBeGreaterThanOrEqual(3);
});

test('debug mode displays one curve at a time and switches with controls and arrow keys', async () => {
  axios.get.mockImplementation((url) => {
    if (url === '/api/kino-curves') {
      return Promise.resolve({
        data: {
          curves: [
            { serial_number: 'S1', chip_code: 'C1', curve: [0, 10, 0], created_at: '2026-08-01' },
            { serial_number: 'S2', chip_code: 'C2', curve: [0, 20, 0], created_at: '2026-08-02' },
          ],
        },
      });
    }
    return Promise.resolve({ data: { devices: [] } });
  });

  render(<KinoCurveSection devices={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /search/i }));
  await screen.findByTestId('curve-chart');

  fireEvent.click(screen.getByRole('button', { name: /debug/i }));
  expect(screen.getByText('1 / 2')).toBeTruthy();
  expect(screen.getByText(/S1 · C1/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /下一条/i }));
  expect(screen.getByText('2 / 2')).toBeTruthy();
  expect(screen.getByText(/S2 · C2/)).toBeTruthy();

  fireEvent.keyDown(window, { key: 'ArrowLeft' });
  expect(screen.getByText('1 / 2')).toBeTruthy();
});

test('debug button loads all curves when no search result is present yet', async () => {
  axios.get.mockImplementation((url) => {
    if (url === '/api/kino-curves') {
      return Promise.resolve({
        data: {
          curves: [
            { serial_number: 'S1', chip_code: 'C1', curve: [0, 10, 0] },
            { serial_number: 'S2', chip_code: 'C2', curve: [0, 20, 0] },
          ],
        },
      });
    }
    return Promise.resolve({ data: { devices: [] } });
  });

  render(<KinoCurveSection devices={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /debug/i }));

  expect(await screen.findByText('1 / 2')).toBeTruthy();
  expect(screen.getByText(/S1 · C1/)).toBeTruthy();
  expect(axios.get).toHaveBeenCalledWith('/api/kino-curves', { params: {} });
});

test('debug copy button writes the active curve data to the clipboard', async () => {
  navigator.clipboard.writeText.mockResolvedValue();
  axios.get.mockImplementation((url) => {
    if (url === '/api/kino-curves') {
      return Promise.resolve({
        data: { curves: [{ serial_number: 'S1', chip_code: 'C1', curve: [3, 4, 5] }] },
      });
    }
    return Promise.resolve({ data: { devices: [] } });
  });

  render(<KinoCurveSection devices={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /search/i }));
  await screen.findByTestId('curve-chart');

  fireEvent.click(screen.getByRole('button', { name: /debug/i }));
  fireEvent.click(screen.getByRole('button', { name: /复制 curve 数据/i }));

  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('[3,4,5]'));
});
