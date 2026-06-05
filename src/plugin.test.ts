import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppUserConfigs } from '@logseq/libs/dist/LSPlugin';
import type { AgendaTask } from './calendar/types';
import type { Snapshot } from './sync/cache';
import { SETTINGS_SCHEMA, getSettingsSchema } from './logseq/settings';
vi.mock('./sync/weather', () => ({
  refreshWeather: vi.fn(),
}));

import { refreshWeather } from './sync/weather';
import { bootPlugin, createDebouncedCallback, createSerializedRefresh, getInitialSnapshot, refreshSnapshot, refreshTasksOnly, setMainUiVisible, startRefreshLoop } from './plugin';

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type IntervalHandle = ReturnType<typeof setInterval>;

type LogseqMock = {
  ready: ReturnType<typeof vi.fn>;
  useSettingsSchema: ReturnType<typeof vi.fn>;
  setMainUIInlineStyle: ReturnType<typeof vi.fn>;
  showMainUI: ReturnType<typeof vi.fn>;
  hideMainUI: ReturnType<typeof vi.fn>;
  onSettingsChanged: ReturnType<typeof vi.fn>;
  settings: Record<string, unknown>;
  App: {
    getUserConfigs?: ReturnType<typeof vi.fn>;
    registerCommandPalette: ReturnType<typeof vi.fn>;
    registerCommandShortcut: ReturnType<typeof vi.fn>;
  };
  DB: {
    onChanged: ReturnType<typeof vi.fn>;
  };
};

function createSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    events: overrides.events ?? [],
    tasks: overrides.tasks ?? [],
    weather: overrides.weather ?? [],
    weatherLocation: overrides.weatherLocation ?? null,
    errors: overrides.errors ?? [],
    syncedAt: overrides.syncedAt ?? '2026-04-10T12:00:00.000Z',
  };
}

function createUserConfigs(overrides: Partial<AppUserConfigs> = {}): AppUserConfigs {
  return {
    preferredThemeMode: 'light',
    preferredFormat: 'markdown',
    preferredDateFormat: 'yyyy-MM-dd',
    preferredStartOfWeek: 'Monday',
    preferredLanguage: 'en-US',
    preferredWorkflow: 'now',
    currentGraph: 'test-graph',
    showBracket: false,
    enabledFlashcards: false,
    enabledJournals: true,
    ...overrides,
  };
}

function createLogseqMock(settings: Record<string, unknown> = {}): LogseqMock {
  return {
    ready: vi.fn(async (callback?: () => unknown) => {
      await callback?.();
    }),
    useSettingsSchema: vi.fn(),
    setMainUIInlineStyle: vi.fn(),
    showMainUI: vi.fn(async () => undefined),
    hideMainUI: vi.fn(),
    onSettingsChanged: vi.fn(() => vi.fn()),
    settings,
    App: {
      registerCommandPalette: vi.fn(),
      registerCommandShortcut: vi.fn(),
    },
    DB: {
      onChanged: vi.fn(() => vi.fn()),
    },
  };
}

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

afterEach(() => {
  setMainUiVisible(false);
  delete (globalThis as { __logseqGoogleAgendaMainUiVisible?: boolean }).__logseqGoogleAgendaMainUiVisible;
  vi.mocked(refreshWeather).mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('getInitialSnapshot', () => {
  it('returns the cached snapshot from local storage', () => {
    const storage: StorageLike = {
      getItem: vi.fn(() =>
        JSON.stringify(
          createSnapshot({
            events: [
              {
                id: 'event-1',
                sourceUrl: 'https://example.com/engineering.ics',
                calendarName: 'Engineering',
                title: 'Planning',
                start: '2026-04-10T09:00:00.000Z',
                end: '2026-04-10T10:00:00.000Z',
                allDay: false,
                location: '',
                description: '',
              },
            ],
          }),
        ),
      ),
      setItem: vi.fn(),
    };

    expect(getInitialSnapshot(storage)).toEqual(
      createSnapshot({
        events: [
          {
            id: 'event-1',
            sourceUrl: 'https://example.com/engineering.ics',
            calendarName: 'Engineering',
            title: 'Planning',
            start: '2026-04-10T09:00:00.000Z',
            end: '2026-04-10T10:00:00.000Z',
            allDay: false,
            location: '',
            description: '',
          },
        ],
      }),
    );
  });
});

describe('refreshSnapshot', () => {
  it('includes weather in the full refresh when weatherCity is configured', async () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const fetchImpl: typeof fetch = vi.fn(async () =>
      new Response(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:event-1@example.com',
          'DTSTAMP:20240501T120000Z',
          'DTSTART:20240507T150000Z',
          'DTEND:20240507T153000Z',
          'SUMMARY:Standup',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n'),
      ),
    ) as typeof fetch;

    vi.mocked(refreshWeather).mockResolvedValue({
      weather: [
        {
          date: '2024-05-07',
          temperatureMin: 12,
          temperatureMax: 20,
          temperatureDisplay: '20C / 12C',
          conditionCode: 1,
          conditionLabel: 'Partly cloudy',
          precipitationChance: 10,
          iconKey: 'partly-cloudy',
        },
      ],
      weatherLocation: {
        query: 'Paris',
        resolvedName: 'Paris',
        latitude: 48.8566,
        longitude: 2.3522,
      },
    });

    const snapshot = await refreshSnapshot({
      storage,
      settings: {
        feeds: JSON.stringify([
          {
            url: 'https://example.com/engineering.ics',
            calendarName: 'Engineering',
          },
        ]),
        refreshIntervalMinutes: 30,
        weatherCity: 'Paris',
        weatherRefreshIntervalMinutes: 90,
      },
      fetchImpl,
    });

    expect(refreshWeather).toHaveBeenCalledWith(expect.objectContaining({
      city: 'Paris',
    }));
    expect(refreshWeather).toHaveBeenCalledWith(expect.not.objectContaining({
      fetchImpl,
    }));
    expect(snapshot.weather).toEqual([
      {
        date: '2024-05-07',
        temperatureMin: 12,
        temperatureMax: 20,
        temperatureDisplay: '20C / 12C',
        conditionCode: 1,
        conditionLabel: 'Partly cloudy',
        precipitationChance: 10,
        iconKey: 'partly-cloudy',
      },
    ]);
    expect(snapshot.weatherLocation).toEqual({
      query: 'Paris',
      resolvedName: 'Paris',
      latitude: 48.8566,
      longitude: 2.3522,
    });
  });

  it('keeps the full refresh best effort when weather refresh fails', async () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const fetchImpl: typeof fetch = vi.fn(async () =>
      new Response(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:event-1@example.com',
          'DTSTAMP:20240501T120000Z',
          'DTSTART:20240507T150000Z',
          'DTEND:20240507T153000Z',
          'SUMMARY:Standup',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n'),
      ),
    ) as typeof fetch;
    const reportError = vi.fn();
    const weatherError = new Error('weather failed');

    vi.mocked(refreshWeather).mockRejectedValue(weatherError);

    const snapshot = await refreshSnapshot({
      storage,
      settings: {
        feeds: JSON.stringify([
          {
            url: 'https://example.com/engineering.ics',
            calendarName: 'Engineering',
          },
        ]),
        refreshIntervalMinutes: 30,
        weatherCity: 'Paris',
        weatherRefreshIntervalMinutes: 90,
      },
      fetchImpl,
      reportError,
    });

    expect(snapshot.events).toEqual([
      {
        id: 'event-1@example.com',
        sourceUrl: 'https://example.com/engineering.ics',
        calendarName: 'Engineering',
        title: 'Standup',
        start: '2024-05-07T15:00:00.000Z',
        end: '2024-05-07T15:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
    expect(snapshot.weather).toEqual([]);
    expect(snapshot.weatherLocation).toBeNull();
    expect(reportError).toHaveBeenCalledWith('Failed to refresh weather', weatherError);
  });

  it('returns a snapshot that includes journal tasks loaded alongside calendar feeds', async () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const fetchImpl: typeof fetch = vi.fn(async () =>
      new Response(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:event-1@example.com',
          'DTSTAMP:20240501T120000Z',
          'DTSTART:20240507T150000Z',
          'DTEND:20240507T153000Z',
          'SUMMARY:Standup',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n'),
      ),
    ) as typeof fetch;
    const tasks: AgendaTask[] = [
      {
        id: 'task-1',
        title: 'Review roadmap',
        date: '2024-05-07',
        marker: 'TODO',
        pageName: '2024-05-07',
        pageOriginalName: 'May 7th, 2024',
        blockUuid: 'task-1',
        priority: 'A',
        scheduled: '2024-05-07',
        deadline: '',
      },
    ];
    const editor = {
      getAllPages: vi.fn(async () => [
        {
          name: '2024-05-07',
          'original-name': 'May 7th, 2024',
          'journal-day': '2024-05-07',
          'journal?': true,
        },
      ]),
      getPageBlocksTree: vi.fn(async () => [
        {
          uuid: 'task-1',
          content: 'Review roadmap',
          marker: 'TODO',
          priority: 'A',
          scheduled: '2024-05-07',
        },
      ]),
    };
    const syncToJournals = vi.fn(async () => undefined);

    vi.stubGlobal('logseq', { Editor: editor });

    const snapshot = await refreshSnapshot({
      storage,
      settings: {
        feeds: JSON.stringify([
          {
            url: 'https://example.com/engineering.ics',
            calendarName: 'Engineering',
          },
        ]),
        refreshIntervalMinutes: 30,
      },
      fetchImpl,
      syncToJournals,
    });

    expect(editor.getAllPages).toHaveBeenCalledTimes(1);
    expect(editor.getPageBlocksTree).toHaveBeenCalledWith('2024-05-07');
    expect(snapshot.events).toEqual([
      {
        id: 'event-1@example.com',
        sourceUrl: 'https://example.com/engineering.ics',
        calendarName: 'Engineering',
        title: 'Standup',
        start: '2024-05-07T15:00:00.000Z',
        end: '2024-05-07T15:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
    expect(snapshot.tasks).toEqual(tasks);
    expect(storage.setItem).toHaveBeenCalledWith('syncSnapshot', JSON.stringify(snapshot));
    expect(syncToJournals).toHaveBeenCalledWith(snapshot.events);
  });

  it('keeps the refresh best effort when loading journal tasks fails', async () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const fetchImpl: typeof fetch = vi.fn(async () =>
      new Response(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:event-1@example.com',
          'DTSTAMP:20240501T120000Z',
          'DTSTART:20240507T150000Z',
          'DTEND:20240507T153000Z',
          'SUMMARY:Standup',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n'),
      ),
    ) as typeof fetch;
    const taskError = new Error('task load failed');
    const syncToJournals = vi.fn(async () => undefined);
    const reportError = vi.fn();

    vi.stubGlobal('logseq', {
      Editor: {
        getAllPages: vi.fn(async () => {
          throw taskError;
        }),
        getPageBlocksTree: vi.fn(),
      },
    });

    const snapshot = await refreshSnapshot({
      storage,
      settings: {
        feeds: JSON.stringify([
          {
            url: 'https://example.com/engineering.ics',
            calendarName: 'Engineering',
          },
        ]),
        refreshIntervalMinutes: 30,
      },
      fetchImpl,
      syncToJournals,
      reportError,
    });

    expect(snapshot.events).toEqual([
      {
        id: 'event-1@example.com',
        sourceUrl: 'https://example.com/engineering.ics',
        calendarName: 'Engineering',
        title: 'Standup',
        start: '2024-05-07T15:00:00.000Z',
        end: '2024-05-07T15:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
    expect(snapshot.tasks).toEqual([]);
    expect(storage.setItem).toHaveBeenCalledWith('syncSnapshot', JSON.stringify(snapshot));
    expect(syncToJournals).toHaveBeenCalledWith(snapshot.events);
    expect(reportError).toHaveBeenCalledWith('Failed to load Logseq journal tasks', taskError);
  });

  it('refreshes feeds from parsed settings, caches the result, and optionally syncs journals', async () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const fetchImpl: typeof fetch = vi.fn(async () =>
      new Response(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:event-1@example.com',
          'DTSTAMP:20240501T120000Z',
          'DTSTART:20240507T150000Z',
          'DTEND:20240507T153000Z',
          'SUMMARY:Standup',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n'),
      ),
    ) as typeof fetch;
    const syncToJournals = vi.fn(async () => undefined);

    const snapshot = await refreshSnapshot({
      storage,
      settings: {
        feeds: JSON.stringify([
          {
            url: ' https://example.com/engineering.ics ',
            calendarName: ' Engineering ',
          },
        ]),
        refreshIntervalMinutes: 30,
      },
      fetchImpl,
      syncToJournals,
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/engineering.ics');
    expect(snapshot.events).toEqual([
      {
        id: 'event-1@example.com',
        sourceUrl: 'https://example.com/engineering.ics',
        calendarName: 'Engineering',
        title: 'Standup',
        start: '2024-05-07T15:00:00.000Z',
        end: '2024-05-07T15:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
    expect(storage.setItem).toHaveBeenCalledWith('syncSnapshot', JSON.stringify(snapshot));
    expect(syncToJournals).toHaveBeenCalledWith(snapshot.events);
  });

  it('logs parsed settings and snapshot counts during refresh', async () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const fetchImpl: typeof fetch = vi.fn(async () =>
      new Response(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:event-1@example.com',
          'DTSTAMP:20240501T120000Z',
          'DTSTART:20240507T150000Z',
          'DTEND:20240507T153000Z',
          'SUMMARY:Standup',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n'),
      ),
    ) as typeof fetch;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await refreshSnapshot({
      storage,
      settings: {
        feeds: [
          {
            url: 'https://example.com/engineering.ics',
            calendarName: 'Engineering',
            color: '#33aaff',
          },
        ],
        refreshIntervalMinutes: 30,
      },
      fetchImpl,
    });

    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Refresh settings parsed', {
      feedCount: 1,
      feeds: [
        {
          url: 'https://example.com/engineering.ics',
          calendarName: 'Engineering',
          color: '#33aaff',
        },
      ],
      refreshIntervalMinutes: 30,
    });
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Refresh snapshot built', {
      eventCount: 1,
      taskCount: 0,
      errorCount: 0,
      syncedAt: expect.any(String),
    });
  });

  it('returns the fresh snapshot even when journal sync fails after caching it', async () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const fetchImpl: typeof fetch = vi.fn(async () =>
      new Response(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:event-1@example.com',
          'DTSTAMP:20240501T120000Z',
          'DTSTART:20240507T150000Z',
          'DTEND:20240507T153000Z',
          'SUMMARY:Standup',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n'),
      ),
    ) as typeof fetch;
    const syncError = new Error('journal sync failed');
    const syncToJournals = vi.fn(async () => {
      throw syncError;
    });
    const reportError = vi.fn();

    const snapshot = await refreshSnapshot({
      storage,
      settings: {
        feeds: JSON.stringify([
          {
            url: 'https://example.com/engineering.ics',
            calendarName: 'Engineering',
          },
        ]),
        refreshIntervalMinutes: 30,
      },
      fetchImpl,
      syncToJournals,
      reportError,
    });

    expect(snapshot).toMatchObject({
      events: [
        {
          id: 'event-1@example.com',
          sourceUrl: 'https://example.com/engineering.ics',
          calendarName: 'Engineering',
          title: 'Standup',
          start: '2024-05-07T15:00:00.000Z',
          end: '2024-05-07T15:30:00.000Z',
          allDay: false,
          location: '',
          description: '',
        },
      ],
      errors: [],
    });
    expect(new Date(snapshot.syncedAt).toISOString()).toBe(snapshot.syncedAt);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith('Failed to sync events to Logseq journals', syncError);
  });
});

describe('createSerializedRefresh', () => {
  it('serializes overlapping triggers into a single queued rerun', async () => {
    const firstRefresh = createDeferredPromise<Snapshot>();
    const secondRefresh = createDeferredPromise<Snapshot>();
    const refresh = vi
      .fn<() => Promise<Snapshot>>()
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);
    const onSnapshot = vi.fn();
    const onError = vi.fn();
    const runRefresh = createSerializedRefresh(refresh, { onSnapshot, onError });

    const firstRun = runRefresh();
    const secondRun = runRefresh();
    const thirdRun = runRefresh();

    expect(refresh).toHaveBeenCalledTimes(1);

    firstRefresh.resolve(createSnapshot({ syncedAt: '2026-04-10T12:01:00.000Z' }));
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    secondRefresh.resolve(createSnapshot({ syncedAt: '2026-04-10T12:02:00.000Z' }));
    await Promise.all([firstRun, secondRun, thirdRun]);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onSnapshot).toHaveBeenNthCalledWith(1, createSnapshot({ syncedAt: '2026-04-10T12:01:00.000Z' }));
    expect(onSnapshot).toHaveBeenNthCalledWith(2, createSnapshot({ syncedAt: '2026-04-10T12:02:00.000Z' }));
    expect(onError).not.toHaveBeenCalled();
  });

  it('logs refresh failures instead of rejecting callers', async () => {
    const refreshError = new Error('refresh failed');
    const refresh = vi.fn(async () => {
      throw refreshError;
    });
    const onSnapshot = vi.fn();
    const onError = vi.fn();
    const runRefresh = createSerializedRefresh(refresh, { onSnapshot, onError });

    await expect(runRefresh()).resolves.toBeUndefined();

    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(refreshError);
  });

  it('makes queued callers wait for the rerun they requested', async () => {
    const firstRefresh = createDeferredPromise<Snapshot>();
    const secondRefresh = createDeferredPromise<Snapshot>();
    const refresh = vi
      .fn<() => Promise<Snapshot>>()
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);
    const onSnapshot = vi.fn();
    const runRefresh = createSerializedRefresh(refresh, { onSnapshot });
    const completionOrder: string[] = [];
    let queuedCompleted = false;

    const firstRun = runRefresh().then(() => {
      completionOrder.push('first');
    });
    const queuedRun = runRefresh().then(() => {
      completionOrder.push('queued');
      queuedCompleted = true;
    });

    firstRefresh.resolve(createSnapshot({ syncedAt: '2026-04-10T12:01:00.000Z' }));
    await firstRun;

    expect(completionOrder).toEqual(['first']);
    expect(queuedCompleted).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(2);

    secondRefresh.resolve(createSnapshot({ syncedAt: '2026-04-10T12:02:00.000Z' }));
    await queuedRun;

    expect(completionOrder).toEqual(['first', 'queued']);
    expect(onSnapshot).toHaveBeenNthCalledWith(2, createSnapshot({ syncedAt: '2026-04-10T12:02:00.000Z' }));
  });

  it('makes a third trigger wait for the later rerun it requested', async () => {
    const firstRefresh = createDeferredPromise<Snapshot>();
    const secondRefresh = createDeferredPromise<Snapshot>();
    const thirdRefresh = createDeferredPromise<Snapshot>();
    const refresh = vi
      .fn<() => Promise<Snapshot>>()
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise)
      .mockImplementationOnce(() => thirdRefresh.promise);
    const onSnapshot = vi.fn();
    const runRefresh = createSerializedRefresh(refresh, { onSnapshot });
    const completionOrder: string[] = [];

    const firstRun = runRefresh().then(() => {
      completionOrder.push('first');
    });
    const secondRun = runRefresh().then(() => {
      completionOrder.push('second');
    });

    firstRefresh.resolve(createSnapshot({ syncedAt: '2026-04-10T12:01:00.000Z' }));
    await firstRun;

    const thirdRun = runRefresh().then(() => {
      completionOrder.push('third');
    });

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(completionOrder).toEqual(['first']);

    secondRefresh.resolve(createSnapshot({ syncedAt: '2026-04-10T12:02:00.000Z' }));
    await secondRun;

    expect(refresh).toHaveBeenCalledTimes(3);
    expect(completionOrder).toEqual(['first', 'second']);

    thirdRefresh.resolve(createSnapshot({ syncedAt: '2026-04-10T12:03:00.000Z' }));
    await thirdRun;

    expect(completionOrder).toEqual(['first', 'second', 'third']);
    expect(onSnapshot).toHaveBeenNthCalledWith(3, createSnapshot({ syncedAt: '2026-04-10T12:03:00.000Z' }));
  });
});

describe('startRefreshLoop', () => {
  it('schedules refreshes using the parsed settings interval and returns a cleanup function', () => {
    const onRefresh = vi.fn();
    const intervalHandle = Symbol('refresh-loop') as unknown as IntervalHandle;
    const setIntervalImpl = vi.fn<(handler: () => void, timeout: number) => IntervalHandle>(() => intervalHandle);
    const clearIntervalImpl = vi.fn<(handle: IntervalHandle) => void>();

    const stop = startRefreshLoop(onRefresh, {
      settings: {
        feeds: '[]',
        refreshIntervalMinutes: 5,
      },
      setIntervalImpl,
      clearIntervalImpl,
    });

    expect(setIntervalImpl).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);

    const tick = setIntervalImpl.mock.calls[0][0];
    tick();
    expect(onRefresh).toHaveBeenCalledTimes(1);

    stop();
    expect(clearIntervalImpl).toHaveBeenCalledWith(intervalHandle);
  });
});

describe('startWeatherRefreshLoop', () => {
  it('schedules weather refreshes using the weather interval and returns a cleanup function', async () => {
    const { startWeatherRefreshLoop } = await import('./plugin');
    const onRefresh = vi.fn();
    const intervalHandle = Symbol('weather-refresh-loop') as unknown as IntervalHandle;
    const setIntervalImpl = vi.fn<(handler: () => void, timeout: number) => IntervalHandle>(() => intervalHandle);
    const clearIntervalImpl = vi.fn<(handle: IntervalHandle) => void>();

    const stop = startWeatherRefreshLoop(onRefresh, {
      settings: {
        feeds: '[]',
        refreshIntervalMinutes: 5,
        weatherCity: 'Paris',
        weatherRefreshIntervalMinutes: 90,
      },
      setIntervalImpl,
      clearIntervalImpl,
    });

    expect(setIntervalImpl).toHaveBeenCalledWith(expect.any(Function), 90 * 60 * 1000);

    const tick = setIntervalImpl.mock.calls[0][0];
    tick();
    expect(onRefresh).toHaveBeenCalledTimes(1);

    stop();
    expect(clearIntervalImpl).toHaveBeenCalledWith(intervalHandle);
  });

  it('does not schedule weather refreshes when weatherCity is blank', async () => {
    const { startWeatherRefreshLoop } = await import('./plugin');
    const onRefresh = vi.fn();
    const setIntervalImpl = vi.fn<(handler: () => void, timeout: number) => IntervalHandle>();
    const clearIntervalImpl = vi.fn<(handle: IntervalHandle) => void>();

    const stop = startWeatherRefreshLoop(onRefresh, {
      settings: {
        feeds: '[]',
        refreshIntervalMinutes: 5,
        weatherCity: '   ',
        weatherRefreshIntervalMinutes: 90,
      },
      setIntervalImpl,
      clearIntervalImpl,
    });

    expect(setIntervalImpl).not.toHaveBeenCalled();

    stop();
    expect(clearIntervalImpl).not.toHaveBeenCalled();
  });
});

describe('bootPlugin', () => {
  it('registers a toggle command and shortcut that open then close the main UI', async () => {
    const logseqMock = createLogseqMock();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    vi.stubGlobal('logseq', logseqMock);

    await bootPlugin();

    expect(logseqMock.setMainUIInlineStyle).toHaveBeenCalledWith({
      zIndex: 9999,
      position: 'fixed',
      top: '0px',
      left: '0px',
      width: '100vw',
      height: '100vh',
    });
    expect(logseqMock.App.registerCommandPalette).toHaveBeenCalledWith(
      {
        key: 'logseq-google-agenda-open',
        label: 'Open Google Agenda',
      },
      expect.any(Function),
    );
    expect(logseqMock.App.registerCommandShortcut).toHaveBeenCalledWith(
      'mod+shift+g',
      expect.any(Function),
      {
        key: 'logseq-google-agenda-open-shortcut',
        label: 'Open Google Agenda',
      },
    );

    const commandAction = logseqMock.App.registerCommandPalette.mock.calls[0]?.[1] as () => void | Promise<void>;
    const shortcutAction = logseqMock.App.registerCommandShortcut.mock.calls[0]?.[1] as () => void | Promise<void>;

    await commandAction();
    await shortcutAction();

    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Plugin boot start');
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Settings schema registered, mainUI zIndex set');
    expect(logSpy).toHaveBeenCalledWith(
      '[logseq-google-agenda] Open command registered',
      {
        commandKey: 'logseq-google-agenda-open',
        shortcut: 'mod+shift+g',
        shortcutKey: 'logseq-google-agenda-open-shortcut',
      },
    );
    expect(logSpy).toHaveBeenCalledWith(
      '[logseq-google-agenda] Refresh command registered',
      {
        commandKey: 'logseq-google-agenda-refresh',
        shortcut: 'mod+shift+r',
        shortcutKey: 'logseq-google-agenda-refresh-shortcut',
      },
    );
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Open command handler start');
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Toggle state evaluated', {
      inMemoryVisible: false,
      windowVisible: false,
      resolvedVisible: false,
    });
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Toggle state evaluated', {
      inMemoryVisible: true,
      windowVisible: true,
      resolvedVisible: true,
    });
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Calling showMainUI', { autoFocus: true });
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] showMainUI completed', { autoFocus: true });
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Calling hideMainUI', { restoreEditingCursor: true });
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] hideMainUI completed', { restoreEditingCursor: true });
    expect(logseqMock.showMainUI).toHaveBeenNthCalledWith(1, { autoFocus: true });
    expect(logseqMock.showMainUI).toHaveBeenCalledTimes(1);
    expect(logseqMock.hideMainUI).toHaveBeenNthCalledWith(1, { restoreEditingCursor: true });
  });

  it('calls onOpen only when showing the panel', async () => {
    const logseqMock = createLogseqMock();
    const onOpen = vi.fn(async () => undefined);

    vi.stubGlobal('logseq', logseqMock);

    await bootPlugin({ onOpen });

    const commandAction = logseqMock.App.registerCommandPalette.mock.calls[0]?.[1] as () => Promise<void>;

    await commandAction();
    await commandAction();

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(logseqMock.showMainUI).toHaveBeenCalledTimes(1);
    expect(logseqMock.hideMainUI).toHaveBeenCalledTimes(1);
  });

  it('waits for onOpen before showing the panel', async () => {
    const logseqMock = createLogseqMock();
    const deferred = createDeferredPromise<void>();
    const onOpen = vi.fn(() => deferred.promise);

    vi.stubGlobal('logseq', logseqMock);

    await bootPlugin({ onOpen });

    const commandAction = logseqMock.App.registerCommandPalette.mock.calls[0]?.[1] as () => Promise<void>;
    const opening = commandAction();

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(logseqMock.showMainUI).not.toHaveBeenCalled();

    deferred.resolve();
    await opening;

    expect(logseqMock.showMainUI).toHaveBeenCalledTimes(1);
  });

  it('logs onOpen failures, skips showMainUI, and rethrows the error', async () => {
    const onOpenError = new Error('onOpen failed');
    const logseqMock = createLogseqMock();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onOpen = vi.fn(async () => {
      throw onOpenError;
    });

    vi.stubGlobal('logseq', logseqMock);

    await bootPlugin({ onOpen });

    const commandAction = logseqMock.App.registerCommandPalette.mock.calls[0]?.[1] as () => Promise<void>;

    await expect(commandAction()).rejects.toThrow(onOpenError);

    expect(logseqMock.showMainUI).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[logseq-google-agenda] onOpen failed', onOpenError);
  });

  it('closes after reopening when panel visibility was reset externally', async () => {
    const logseqMock = createLogseqMock();

    vi.stubGlobal('logseq', logseqMock);

    const plugin = await import('./plugin');
    await plugin.bootPlugin();

    const shortcutAction = logseqMock.App.registerCommandShortcut.mock.calls[0]?.[1] as () => Promise<void>;

    await shortcutAction();
    plugin.setMainUiVisible(false);
    await shortcutAction();
    await shortcutAction();

    expect(logseqMock.showMainUI).toHaveBeenCalledTimes(2);
    expect(logseqMock.hideMainUI).toHaveBeenCalledTimes(1);
    expect(logseqMock.hideMainUI).toHaveBeenCalledWith({ restoreEditingCursor: true });
  });

  it('logs when opening the main UI fails and rethrows the error', async () => {
    const openError = new Error('open failed');
    const logseqMock = createLogseqMock();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logseqMock.showMainUI.mockRejectedValueOnce(openError);
    vi.stubGlobal('logseq', logseqMock);

    await bootPlugin();

    const commandAction = logseqMock.App.registerCommandPalette.mock.calls[0]?.[1] as () => Promise<void>;

    await expect(commandAction()).rejects.toThrow(openError);

    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Open command handler start');
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Calling showMainUI', { autoFocus: true });
    expect(logSpy).not.toHaveBeenCalledWith('[logseq-google-agenda] showMainUI completed', { autoFocus: true });
    expect(errorSpy).toHaveBeenCalledWith('[logseq-google-agenda] showMainUI failed', openError);
  });

  it('registers settings, commands, shortcut, and settings change handling through the Logseq lifecycle', async () => {
    const logseqMock = createLogseqMock();
    const offSettingsChanged = vi.fn();
    const onRefresh = vi.fn();
    const onSettingsChanged = vi.fn();

    logseqMock.onSettingsChanged.mockReturnValue(offSettingsChanged);
    vi.stubGlobal('logseq', logseqMock);

    const dispose = await bootPlugin({
      onRefresh,
      onSettingsChanged,
    });

    expect(logseqMock.ready).toHaveBeenCalledTimes(1);
    expect(logseqMock.useSettingsSchema).toHaveBeenCalledWith(SETTINGS_SCHEMA);
    expect(logseqMock.showMainUI).not.toHaveBeenCalled();
    expect(logseqMock.App.registerCommandPalette).toHaveBeenCalledTimes(2);
    expect(logseqMock.App.registerCommandShortcut).toHaveBeenCalledTimes(2);
    expect(logseqMock.App.registerCommandPalette).toHaveBeenCalledWith(
      {
        key: 'logseq-google-agenda-open',
        label: 'Open Google Agenda',
      },
      expect.any(Function),
    );
    expect(logseqMock.App.registerCommandPalette).toHaveBeenCalledWith(
      {
        key: 'logseq-google-agenda-refresh',
        label: 'Refresh Google Agenda',
      },
      expect.any(Function),
    );
    expect(logseqMock.App.registerCommandShortcut).toHaveBeenCalledWith(
      'mod+shift+g',
      expect.any(Function),
      {
        key: 'logseq-google-agenda-open-shortcut',
        label: 'Open Google Agenda',
      },
    );
    expect(logseqMock.App.registerCommandShortcut).toHaveBeenCalledWith(
      'mod+shift+r',
      expect.any(Function),
      {
        key: 'logseq-google-agenda-refresh-shortcut',
        label: 'Refresh Google Agenda',
      },
    );

    const commandAction = logseqMock.App.registerCommandPalette.mock.calls[1]?.[1] as () => void;
    const shortcutAction = logseqMock.App.registerCommandShortcut.mock.calls[1]?.[1] as () => void;
    const settingsChangedCalls = logseqMock.onSettingsChanged.mock.calls as [() => void][];
    const settingsChangedAction = settingsChangedCalls[0][0];

    commandAction();
    shortcutAction();
    settingsChangedAction();

    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(onSettingsChanged).toHaveBeenCalledTimes(1);

    dispose();
    expect(offSettingsChanged).toHaveBeenCalledTimes(1);
  });

  it('registers localized settings schema and command labels for German locales', async () => {
    const logseqMock = createLogseqMock();

    vi.stubGlobal('logseq', logseqMock);
    vi.stubGlobal('navigator', { language: 'de-DE' });

    await bootPlugin();

    expect(logseqMock.useSettingsSchema).toHaveBeenCalledWith(getSettingsSchema('de-DE'));
    expect(logseqMock.App.registerCommandPalette).toHaveBeenCalledWith(
      {
        key: 'logseq-google-agenda-open',
        label: 'Google Agenda oeffnen',
      },
      expect.any(Function),
    );
    expect(logseqMock.App.registerCommandPalette).toHaveBeenCalledWith(
      {
        key: 'logseq-google-agenda-refresh',
        label: 'Google Agenda aktualisieren',
      },
      expect.any(Function),
    );
    expect(logseqMock.App.registerCommandShortcut).toHaveBeenCalledWith(
      'mod+shift+g',
      expect.any(Function),
      {
        key: 'logseq-google-agenda-open-shortcut',
        label: 'Google Agenda oeffnen',
      },
    );
    expect(logseqMock.App.registerCommandShortcut).toHaveBeenCalledWith(
      'mod+shift+r',
      expect.any(Function),
      {
        key: 'logseq-google-agenda-refresh-shortcut',
        label: 'Google Agenda aktualisieren',
      },
    );
  });

  it('falls back to English settings schema and command labels for bare zh locales', async () => {
    const logseqMock = createLogseqMock();

    vi.stubGlobal('logseq', logseqMock);
    vi.stubGlobal('navigator', { language: 'zh' });

    await bootPlugin();

    expect(logseqMock.useSettingsSchema).toHaveBeenCalledWith(getSettingsSchema('en-US'));
    expect(logseqMock.App.registerCommandPalette).toHaveBeenCalledWith(
      {
        key: 'logseq-google-agenda-open',
        label: 'Open Google Agenda',
      },
      expect.any(Function),
    );
    expect(logseqMock.App.registerCommandPalette).toHaveBeenCalledWith(
      {
        key: 'logseq-google-agenda-refresh',
        label: 'Refresh Google Agenda',
      },
      expect.any(Function),
    );
  });

  it('prefers Logseq preferredLanguage over navigator.language for localization', async () => {
    const logseqMock = createLogseqMock();

    vi.stubGlobal('logseq', logseqMock);
    vi.stubGlobal('navigator', { language: 'en-US' });
    logseqMock.App.getUserConfigs = vi.fn(async () => createUserConfigs({ preferredLanguage: 'fr-FR' }));

    await bootPlugin();

    expect(logseqMock.useSettingsSchema).toHaveBeenCalledWith(getSettingsSchema('fr-FR'));
    expect(logseqMock.App.registerCommandPalette).toHaveBeenCalledWith(
      {
        key: 'logseq-google-agenda-open',
        label: 'Ouvrir Google Agenda',
      },
      expect.any(Function),
    );
  });

  it('registers a DB.onChanged listener when onTasksChanged is provided and cleans it up on dispose', async () => {
    const logseqMock = createLogseqMock();
    const offDbChanged = vi.fn();
    const onTasksChanged = vi.fn();

    logseqMock.DB.onChanged.mockReturnValue(offDbChanged);
    vi.stubGlobal('logseq', logseqMock);

    const dispose = await bootPlugin({ onTasksChanged });

    expect(logseqMock.DB.onChanged).toHaveBeenCalledTimes(1);

    const dbChangedCallback = logseqMock.DB.onChanged.mock.calls[0][0] as () => void;
    dbChangedCallback();
    expect(onTasksChanged).toHaveBeenCalledTimes(1);

    dispose();
    expect(offDbChanged).toHaveBeenCalledTimes(1);
  });

  it('does not register DB.onChanged when onTasksChanged is not provided', async () => {
    const logseqMock = createLogseqMock();

    vi.stubGlobal('logseq', logseqMock);

    await bootPlugin();

    expect(logseqMock.DB.onChanged).not.toHaveBeenCalled();
  });
});

describe('refreshTasksOnly', () => {
  it('reloads tasks and merges them with the current snapshot events', async () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const editor = {
      getAllPages: vi.fn(async () => [
        {
          name: '2024-05-07',
          'original-name': 'May 7th, 2024',
          'journal-day': '2024-05-07',
          'journal?': true,
        },
      ]),
      getPageBlocksTree: vi.fn(async () => [
        {
          uuid: 'task-new',
          content: 'New task',
          marker: 'TODO',
          priority: '',
        },
      ]),
    };

    vi.stubGlobal('logseq', { Editor: editor });

    const currentSnapshot = createSnapshot({
      events: [
        {
          id: 'event-1',
          sourceUrl: 'https://example.com/cal.ics',
          calendarName: 'Work',
          title: 'Meeting',
          start: '2024-05-07T09:00:00.000Z',
          end: '2024-05-07T10:00:00.000Z',
          allDay: false,
          location: '',
          description: '',
        },
      ],
      errors: [{ sourceUrl: 'https://example.com/bad.ics', message: 'failed' }],
      weather: [
        {
          date: '2024-05-07',
          temperatureMin: 12,
          temperatureMax: 20,
          temperatureDisplay: '20C / 12C',
          conditionCode: 1,
          conditionLabel: 'Partly cloudy',
          precipitationChance: 10,
          iconKey: 'partly-cloudy',
        },
      ],
      weatherLocation: {
        query: 'Paris',
        resolvedName: 'Paris',
        latitude: 48.8566,
        longitude: 2.3522,
      },
    });

    const result = await refreshTasksOnly({ currentSnapshot, storage });

    expect(result.events).toEqual(currentSnapshot.events);
    expect(result.errors).toEqual(currentSnapshot.errors);
    expect(result.weather).toEqual(currentSnapshot.weather);
    expect(result.weatherLocation).toEqual(currentSnapshot.weatherLocation);
    expect(result.tasks).toEqual([
      {
        id: 'task-new',
        title: 'New task',
        date: '2024-05-07',
        marker: 'TODO',
        pageName: '2024-05-07',
        pageOriginalName: 'May 7th, 2024',
        blockUuid: 'task-new',
        priority: '',
        scheduled: '',
        deadline: '',
      },
    ]);
    expect(storage.setItem).toHaveBeenCalledWith('syncSnapshot', JSON.stringify(result));
  });

  it('returns empty events and errors when there is no current snapshot', async () => {
    vi.stubGlobal('logseq', {
      Editor: {
        getAllPages: vi.fn(async () => []),
        getPageBlocksTree: vi.fn(async () => []),
      },
    });

    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };

    const result = await refreshTasksOnly({ currentSnapshot: null, storage });

    expect(result.events).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.tasks).toEqual([]);
  });
});

describe('refreshWeatherOnly', () => {
  it('preserves events tasks and errors while updating only weather fields', async () => {
    const { refreshWeatherOnly } = await import('./plugin');
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const currentSnapshot = createSnapshot({
      events: [
        {
          id: 'event-1',
          sourceUrl: 'https://example.com/cal.ics',
          calendarName: 'Work',
          title: 'Meeting',
          start: '2024-05-07T09:00:00.000Z',
          end: '2024-05-07T10:00:00.000Z',
          allDay: false,
          location: '',
          description: '',
        },
      ],
      tasks: [
        {
          id: 'task-1',
          title: 'Review roadmap',
          date: '2024-05-07',
          marker: 'TODO',
          pageName: '2024-05-07',
          pageOriginalName: 'May 7th, 2024',
          blockUuid: 'task-1',
          priority: 'A',
          scheduled: '2024-05-07',
          deadline: '',
        },
      ],
      errors: [{ sourceUrl: 'https://example.com/bad.ics', message: 'failed' }],
      weather: [],
      weatherLocation: null,
      syncedAt: '2026-04-10T12:00:00.000Z',
    });

    vi.mocked(refreshWeather).mockResolvedValue({
      weather: [
        {
          date: '2024-05-08',
          temperatureMin: 14,
          temperatureMax: 22,
          temperatureDisplay: '22C / 14C',
          conditionCode: 0,
          conditionLabel: 'Sunny',
          precipitationChance: 5,
          iconKey: 'sunny',
        },
      ],
      weatherLocation: {
        query: 'Paris',
        resolvedName: 'Paris',
        latitude: 48.8566,
        longitude: 2.3522,
      },
    });

    const result = await refreshWeatherOnly({
      currentSnapshot,
      storage,
      settings: {
        feeds: '[]',
        refreshIntervalMinutes: 15,
        weatherCity: 'Paris',
        weatherRefreshIntervalMinutes: 90,
      },
    });

    expect(refreshWeather).toHaveBeenCalledWith(expect.objectContaining({ city: 'Paris' }));
    expect(result.events).toEqual(currentSnapshot.events);
    expect(result.tasks).toEqual(currentSnapshot.tasks);
    expect(result.errors).toEqual(currentSnapshot.errors);
    expect(result.weather).toEqual([
      {
        date: '2024-05-08',
        temperatureMin: 14,
        temperatureMax: 22,
        temperatureDisplay: '22C / 14C',
        conditionCode: 0,
        conditionLabel: 'Sunny',
        precipitationChance: 5,
        iconKey: 'sunny',
      },
    ]);
    expect(result.weatherLocation).toEqual({
      query: 'Paris',
      resolvedName: 'Paris',
      latitude: 48.8566,
      longitude: 2.3522,
    });
    expect(result.syncedAt).not.toBe(currentSnapshot.syncedAt);
    expect(storage.setItem).toHaveBeenCalledWith('syncSnapshot', JSON.stringify(result));
  });

  it('preserves prior weather data when weather refresh fails', async () => {
    const { refreshWeatherOnly } = await import('./plugin');
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const reportError = vi.fn();
    const weatherError = new Error('weather failed');
    const currentSnapshot = createSnapshot({
      events: [
        {
          id: 'event-1',
          sourceUrl: 'https://example.com/cal.ics',
          calendarName: 'Work',
          title: 'Meeting',
          start: '2024-05-07T09:00:00.000Z',
          end: '2024-05-07T10:00:00.000Z',
          allDay: false,
          location: '',
          description: '',
        },
      ],
      tasks: [
        {
          id: 'task-1',
          title: 'Review roadmap',
          date: '2024-05-07',
          marker: 'TODO',
          pageName: '2024-05-07',
          pageOriginalName: 'May 7th, 2024',
          blockUuid: 'task-1',
          priority: 'A',
          scheduled: '2024-05-07',
          deadline: '',
        },
      ],
      errors: [{ sourceUrl: 'https://example.com/bad.ics', message: 'failed' }],
      weather: [
        {
          date: '2024-05-08',
          temperatureMin: 14,
          temperatureMax: 22,
          temperatureDisplay: '22C / 14C',
          conditionCode: 0,
          conditionLabel: 'Sunny',
          precipitationChance: 5,
          iconKey: 'sunny',
        },
      ],
      weatherLocation: {
        query: 'Paris',
        resolvedName: 'Paris',
        latitude: 48.8566,
        longitude: 2.3522,
      },
      syncedAt: '2026-04-10T12:00:00.000Z',
    });

    vi.mocked(refreshWeather).mockRejectedValue(weatherError);

    const result = await refreshWeatherOnly({
      currentSnapshot,
      storage,
      settings: {
        feeds: '[]',
        refreshIntervalMinutes: 15,
        weatherCity: 'Paris',
        weatherRefreshIntervalMinutes: 90,
      },
      reportError,
    });

    expect(result.events).toEqual(currentSnapshot.events);
    expect(result.tasks).toEqual(currentSnapshot.tasks);
    expect(result.errors).toEqual(currentSnapshot.errors);
    expect(result.weather).toEqual(currentSnapshot.weather);
    expect(result.weatherLocation).toEqual(currentSnapshot.weatherLocation);
    expect(result.syncedAt).not.toBe(currentSnapshot.syncedAt);
    expect(storage.setItem).toHaveBeenCalledWith('syncSnapshot', JSON.stringify(result));
    expect(reportError).toHaveBeenCalledWith('Failed to refresh weather', weatherError);
  });

  it('uses a warning instead of console.error for default weather fallback logging', async () => {
    const { refreshWeatherOnly } = await import('./plugin');
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const weatherError = new Error('weather failed');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.mocked(refreshWeather).mockRejectedValue(weatherError);

    await refreshWeatherOnly({
      currentSnapshot: createSnapshot(),
      storage,
      settings: {
        feeds: '[]',
        refreshIntervalMinutes: 15,
        weatherCity: 'Paris',
        weatherRefreshIntervalMinutes: 90,
      },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[logseq-google-agenda] Weather refresh failed; using fallback weather data',
      {
        city: 'Paris',
        error: weatherError,
      },
    );
    expect(errorSpy).not.toHaveBeenCalledWith('Failed to refresh weather', weatherError);
  });

  it('logs when weather refresh is skipped because no city is configured', async () => {
    const { refreshWeatherOnly } = await import('./plugin');
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await refreshWeatherOnly({
      currentSnapshot: createSnapshot(),
      storage,
      settings: {
        feeds: '[]',
        refreshIntervalMinutes: 15,
        weatherCity: '   ',
        weatherRefreshIntervalMinutes: 90,
      },
    });

    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Weather refresh skipped', {
      reason: 'missing city',
    });

    logSpy.mockRestore();
  });
});

describe('createDebouncedCallback', () => {
  it('delays function execution until after the debounce period', () => {
    const fn = vi.fn();
    const setTimeoutImpl = vi.fn<(handler: () => void, timeout: number) => number>(() => 1);
    const clearTimeoutImpl = vi.fn<(handle: number) => void>();

    const debounced = createDebouncedCallback(fn, 500, {
      setTimeout: setTimeoutImpl,
      clearTimeout: clearTimeoutImpl,
    });

    debounced();

    expect(setTimeoutImpl).toHaveBeenCalledWith(expect.any(Function), 500);
    expect(fn).not.toHaveBeenCalled();

    // Simulate the timer firing
    const timerCallback = setTimeoutImpl.mock.calls[0][0];
    timerCallback();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancels previous timer when called again within the debounce period', () => {
    const fn = vi.fn();
    let nextHandle = 1;
    const setTimeoutImpl = vi.fn<(handler: () => void, timeout: number) => number>(() => nextHandle++);
    const clearTimeoutImpl = vi.fn<(handle: number) => void>();

    const debounced = createDebouncedCallback(fn, 500, {
      setTimeout: setTimeoutImpl,
      clearTimeout: clearTimeoutImpl,
    });

    debounced();
    debounced();
    debounced();

    expect(setTimeoutImpl).toHaveBeenCalledTimes(3);
    expect(clearTimeoutImpl).toHaveBeenCalledTimes(2);
    expect(clearTimeoutImpl).toHaveBeenNthCalledWith(1, 1);
    expect(clearTimeoutImpl).toHaveBeenNthCalledWith(2, 2);
    expect(fn).not.toHaveBeenCalled();
  });
});
