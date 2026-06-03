import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgendaTask } from './calendar/types';
import type { Snapshot } from './sync/cache';
import { SETTINGS_SCHEMA } from './logseq/settings';
import { bootPlugin, createDebouncedCallback, createSerializedRefresh, getInitialSnapshot, refreshSnapshot, refreshTasksOnly, startRefreshLoop } from './plugin';

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type LogseqMock = {
  ready: ReturnType<typeof vi.fn>;
  useSettingsSchema: ReturnType<typeof vi.fn>;
  setMainUIInlineStyle: ReturnType<typeof vi.fn>;
  showMainUI: ReturnType<typeof vi.fn>;
  hideMainUI: ReturnType<typeof vi.fn>;
  onSettingsChanged: ReturnType<typeof vi.fn>;
  settings: Record<string, unknown>;
  App: {
    registerCommandPalette: ReturnType<typeof vi.fn>;
    registerCommandShortcut: ReturnType<typeof vi.fn>;
  };
  DB: {
    onChanged: ReturnType<typeof vi.fn>;
  };
};

function createSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    events: [],
    tasks: [],
    errors: [],
    syncedAt: '2026-04-10T12:00:00.000Z',
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
    const intervalHandle = 42;
    const setIntervalImpl = vi.fn<(handler: () => void, timeout: number) => number>(() => intervalHandle);
    const clearIntervalImpl = vi.fn<(handle: number) => void>();

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

    expect(logSpy).toHaveBeenNthCalledWith(1, '[logseq-google-agenda] Plugin boot start');
    expect(logSpy).toHaveBeenNthCalledWith(2, '[logseq-google-agenda] Settings schema registered, mainUI zIndex set');
    expect(logSpy).toHaveBeenNthCalledWith(
      3,
      '[logseq-google-agenda] Open command registered',
      {
        commandKey: 'logseq-google-agenda-open',
        shortcut: 'mod+shift+g',
        shortcutKey: 'logseq-google-agenda-open-shortcut',
      },
    );
    expect(logSpy).toHaveBeenNthCalledWith(
      4,
      '[logseq-google-agenda] Refresh command registered',
      {
        commandKey: 'logseq-google-agenda-refresh',
        shortcut: 'mod+shift+r',
        shortcutKey: 'logseq-google-agenda-refresh-shortcut',
      },
    );
    expect(logSpy).toHaveBeenNthCalledWith(5, '[logseq-google-agenda] Open command handler start');
    expect(logSpy).toHaveBeenNthCalledWith(6, '[logseq-google-agenda] Toggle state evaluated', {
      inMemoryVisible: false,
      windowVisible: false,
      resolvedVisible: false,
    });
    expect(logSpy).toHaveBeenNthCalledWith(7, '[logseq-google-agenda] Calling showMainUI', { autoFocus: true });
    expect(logSpy).toHaveBeenNthCalledWith(8, '[logseq-google-agenda] showMainUI completed', { autoFocus: true });
    expect(logSpy).toHaveBeenNthCalledWith(9, '[logseq-google-agenda] Open command handler start');
    expect(logSpy).toHaveBeenNthCalledWith(10, '[logseq-google-agenda] Toggle state evaluated', {
      inMemoryVisible: true,
      windowVisible: true,
      resolvedVisible: true,
    });
    expect(logSpy).toHaveBeenNthCalledWith(11, '[logseq-google-agenda] Calling hideMainUI', { restoreEditingCursor: true });
    expect(logSpy).toHaveBeenNthCalledWith(12, '[logseq-google-agenda] hideMainUI completed', { restoreEditingCursor: true });
    expect(logseqMock.showMainUI).toHaveBeenNthCalledWith(1, { autoFocus: true });
    expect(logseqMock.showMainUI).toHaveBeenCalledTimes(1);
    expect(logseqMock.hideMainUI).toHaveBeenNthCalledWith(1, { restoreEditingCursor: true });
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
    });

    const result = await refreshTasksOnly({ currentSnapshot, storage });

    expect(result.events).toEqual(currentSnapshot.events);
    expect(result.errors).toEqual(currentSnapshot.errors);
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
