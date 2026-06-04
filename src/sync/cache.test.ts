import { describe, expect, it, vi } from 'vitest';

import type {
  AgendaTask,
  CalendarEvent,
  WeatherDay,
  WeatherLocation,
} from '../calendar/types';
import type { FeedError } from './ical';
import { SNAPSHOT_KEY, loadSnapshot, saveSnapshot, type Snapshot } from './cache';

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const events: CalendarEvent[] = [
  {
    id: 'event-1',
    sourceUrl: 'https://example.com/engineering.ics',
    calendarName: 'Engineering',
    title: 'Planning',
    start: '2024-05-06T09:00:00.000Z',
    end: '2024-05-06T10:00:00.000Z',
    allDay: false,
    location: 'Room 1',
    description: 'Discuss roadmap',
  },
];

const errors: FeedError[] = [
  {
    sourceUrl: 'https://example.com/broken.ics',
    message: 'network down',
  },
];

const tasks: AgendaTask[] = [
  {
    id: 'task-1',
    title: 'Review roadmap',
    date: '2024-05-06',
    marker: 'TODO',
    pageName: '2024-05-06',
    pageOriginalName: 'May 6th, 2024',
    blockUuid: 'block-1',
    priority: 'A',
    scheduled: '2024-05-06',
    deadline: '2024-05-07',
  },
];

const weather: WeatherDay[] = [
  {
    date: '2024-05-06',
    temperatureMin: 11,
    temperatureMax: 18,
    temperatureDisplay: '18C / 11C',
    conditionCode: 61,
    conditionLabel: 'Rain',
    precipitationChance: 80,
    iconKey: 'rain',
  },
];

const weatherLocation: WeatherLocation = {
  query: 'Amsterdam',
  resolvedName: 'Amsterdam',
  latitude: 52.3676,
  longitude: 4.9041,
};

describe('SNAPSHOT_KEY', () => {
  it('uses the storage key for the cached sync snapshot', () => {
    expect(SNAPSHOT_KEY).toBe('syncSnapshot');
  });
});

describe('loadSnapshot', () => {
  it('returns the parsed snapshot from storage', () => {
    const storage: StorageLike = {
      getItem: vi.fn(() =>
        JSON.stringify({
          events,
          tasks,
          weather,
          weatherLocation,
          errors,
          syncedAt: '2024-05-06T12:00:00.000Z',
        }),
      ),
      setItem: vi.fn(),
    };

    expect(loadSnapshot(storage)).toEqual<Snapshot>({
      events,
      tasks,
      weather,
      weatherLocation,
      errors,
      syncedAt: '2024-05-06T12:00:00.000Z',
    });
    expect(storage.getItem).toHaveBeenCalledWith(SNAPSHOT_KEY);
  });

  it('returns null when storage is empty or invalid', () => {
    const emptyStorage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const invalidStorage: StorageLike = {
      getItem: vi.fn(() => '{bad json}'),
      setItem: vi.fn(),
    };

    expect(loadSnapshot(emptyStorage)).toBeNull();
    expect(loadSnapshot(invalidStorage)).toBeNull();
  });

  it('returns null when nested event or error items are malformed', () => {
    const malformedEventStorage: StorageLike = {
      getItem: vi.fn(() =>
        JSON.stringify({
          events: [
            {
              id: 'event-1',
              sourceUrl: 'https://example.com/engineering.ics',
            },
          ],
          tasks,
          weather,
          weatherLocation,
          errors,
          syncedAt: '2024-05-06T12:00:00.000Z',
        }),
      ),
      setItem: vi.fn(),
    };
    const malformedErrorStorage: StorageLike = {
      getItem: vi.fn(() =>
        JSON.stringify({
          events,
          tasks,
          weather,
          weatherLocation,
          errors: [
            {
              sourceUrl: 'https://example.com/broken.ics',
            },
          ],
          syncedAt: '2024-05-06T12:00:00.000Z',
        }),
      ),
      setItem: vi.fn(),
    };

    expect(loadSnapshot(malformedEventStorage)).toBeNull();
    expect(loadSnapshot(malformedErrorStorage)).toBeNull();
  });

  it('returns null when nested task items are malformed', () => {
    const storage: StorageLike = {
      getItem: vi.fn(() =>
        JSON.stringify({
          events,
          tasks: [
            {
              id: 'task-1',
              title: 'Review roadmap',
            },
          ],
          weather,
          weatherLocation,
          errors,
          syncedAt: '2024-05-06T12:00:00.000Z',
        }),
      ),
      setItem: vi.fn(),
    };

    expect(loadSnapshot(storage)).toBeNull();
  });

  it('returns null when nested weather items are malformed', () => {
    const malformedWeatherStorage: StorageLike = {
      getItem: vi.fn(() =>
        JSON.stringify({
          events,
          tasks,
          weather: [
            {
              date: '2024-05-06',
            },
          ],
          weatherLocation,
          errors,
          syncedAt: '2024-05-06T12:00:00.000Z',
        }),
      ),
      setItem: vi.fn(),
    };
    const malformedWeatherLocationStorage: StorageLike = {
      getItem: vi.fn(() =>
        JSON.stringify({
          events,
          tasks,
          weather,
          weatherLocation: {
            query: 'Amsterdam',
          },
          errors,
          syncedAt: '2024-05-06T12:00:00.000Z',
        }),
      ),
      setItem: vi.fn(),
    };

    expect(loadSnapshot(malformedWeatherStorage)).toBeNull();
    expect(loadSnapshot(malformedWeatherLocationStorage)).toBeNull();
  });

  it('loads legacy snapshots without tasks or weather and normalizes them to empty values', () => {
    const storage: StorageLike = {
      getItem: vi.fn(() =>
        JSON.stringify({
          events,
          errors,
          syncedAt: '2024-05-06T12:00:00.000Z',
        }),
      ),
      setItem: vi.fn(),
    };

    expect(loadSnapshot(storage)).toEqual<Snapshot>({
      events,
      tasks: [],
      weather: [],
      weatherLocation: null,
      errors,
      syncedAt: '2024-05-06T12:00:00.000Z',
    });
  });

  it('returns null when storage reads throw', () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => {
        throw new Error('security error');
      }),
      setItem: vi.fn(),
    };

    expect(() => loadSnapshot(storage)).not.toThrow();
    expect(loadSnapshot(storage)).toBeNull();
  });
});

describe('saveSnapshot', () => {
  it('serializes the snapshot into storage', () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const snapshot: Snapshot = {
      events,
      tasks,
      weather,
      weatherLocation,
      errors,
      syncedAt: '2024-05-06T12:00:00.000Z',
    };

    saveSnapshot(storage, snapshot);

    expect(storage.setItem).toHaveBeenCalledWith(SNAPSHOT_KEY, JSON.stringify(snapshot));
  });

  it('swallows storage write failures', () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error('quota exceeded');
      }),
    };
    const snapshot: Snapshot = {
      events,
      tasks,
      weather,
      weatherLocation,
      errors,
      syncedAt: '2024-05-06T12:00:00.000Z',
    };

    expect(() => saveSnapshot(storage, snapshot)).not.toThrow();
    expect(storage.setItem).toHaveBeenCalledWith(SNAPSHOT_KEY, JSON.stringify(snapshot));
  });
});
