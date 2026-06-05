import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

import type { AppUserConfigs } from '@logseq/libs/dist/LSPlugin';
import type { Snapshot } from './sync/cache';

type AgendaAppProps = {
  snapshot?: Snapshot | null;
  locale?: string;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onClose?: () => void;
  onDateDoubleClick?: (date: Date) => void;
};

const bootPlugin = vi.fn();
const createDebouncedCallback = vi.fn();
const createLogseqFetch = vi.fn(() => vi.fn());
const createSerializedRefresh = vi.fn();
const getInitialSnapshot = vi.fn();
const refreshSnapshot = vi.fn();
const refreshTasksOnly = vi.fn();
const refreshWeatherOnly = vi.fn();
const setMainUiVisible = vi.fn();
const startRefreshLoop = vi.fn();
const startWeatherRefreshLoop = vi.fn();
const syncEventsToJournals = vi.fn();

let latestAgendaAppProps: AgendaAppProps | null = null;
let latestRoot: { unmount: () => void } | null = null;

vi.mock('./app/AgendaApp', () => ({
  AgendaApp: (props: AgendaAppProps) => {
    latestAgendaAppProps = props;
    return null;
  },
}));

vi.mock('./plugin', () => ({
  bootPlugin: (...args: Parameters<typeof bootPlugin>) => bootPlugin(...args),
  createDebouncedCallback: (...args: Parameters<typeof createDebouncedCallback>) =>
    createDebouncedCallback(...args),
  createLogseqFetch: (...args: Parameters<typeof createLogseqFetch>) => createLogseqFetch(...args),
  createSerializedRefresh: (...args: Parameters<typeof createSerializedRefresh>) =>
    createSerializedRefresh(...args),
  getInitialSnapshot: (...args: Parameters<typeof getInitialSnapshot>) => getInitialSnapshot(...args),
  refreshSnapshot: (...args: Parameters<typeof refreshSnapshot>) => refreshSnapshot(...args),
  refreshTasksOnly: (...args: Parameters<typeof refreshTasksOnly>) => refreshTasksOnly(...args),
  refreshWeatherOnly: (...args: Parameters<typeof refreshWeatherOnly>) => refreshWeatherOnly(...args),
  setMainUiVisible: (...args: Parameters<typeof setMainUiVisible>) => setMainUiVisible(...args),
  startRefreshLoop: (...args: Parameters<typeof startRefreshLoop>) => startRefreshLoop(...args),
  startWeatherRefreshLoop: (...args: Parameters<typeof startWeatherRefreshLoop>) => startWeatherRefreshLoop(...args),
  syncEventsToJournals,
}));

vi.mock('react-dom/client', async () => {
  const actual = await vi.importActual<typeof import('react-dom/client')>('react-dom/client');

  return {
    ...actual,
    createRoot: (container: Element | DocumentFragment) => {
      const root = actual.createRoot(container);
      latestRoot = root;
      return root;
    },
  };
});

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

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

async function loadMain() {
  document.body.innerHTML = '<div id="app"></div>';
  latestAgendaAppProps = null;
  await act(async () => {
    await import('./main');
  });
  await waitFor(() => {
    expect(latestAgendaAppProps).not.toBeNull();
  });
}

async function unmountMain() {
  await act(async () => {
    latestRoot?.unmount();
  });
  latestRoot = null;
  document.body.innerHTML = '';
}

beforeEach(() => {
  vi.resetModules();
  latestAgendaAppProps = null;
  latestRoot = null;

  vi.stubGlobal('logseq', {
    hideMainUI: vi.fn(),
    App: {
      getUserConfigs: vi.fn(async () => createUserConfigs()),
    },
    Editor: {
      getPage: vi.fn(async () => null),
      openInRightSidebar: vi.fn(async () => undefined),
    },
  });

  bootPlugin.mockReset();
  createDebouncedCallback.mockReset();
  createLogseqFetch.mockReset();
  createSerializedRefresh.mockReset();
  getInitialSnapshot.mockReset();
  refreshSnapshot.mockReset();
  refreshTasksOnly.mockReset();
  refreshWeatherOnly.mockReset();
  setMainUiVisible.mockReset();
  startRefreshLoop.mockReset();
  startWeatherRefreshLoop.mockReset();
  syncEventsToJournals.mockReset();

  getInitialSnapshot.mockReturnValue(null);
  bootPlugin.mockResolvedValue(vi.fn());
  startRefreshLoop.mockReturnValue(vi.fn());
  startWeatherRefreshLoop.mockReturnValue(vi.fn());
  createLogseqFetch.mockReturnValue(vi.fn());
  createDebouncedCallback.mockImplementation((fn: () => void) => fn);
});

afterEach(async () => {
  await act(async () => {
    latestRoot?.unmount();
  });
  vi.unstubAllGlobals();
  latestRoot = null;
  document.body.innerHTML = '';
});

describe('main wiring', () => {
  it('passes startup snapshot tasks and the shared close handler into AgendaApp', async () => {
    const startupSnapshot = createSnapshot({
      tasks: [
        {
          id: 'task-1',
          title: 'Review agenda tasks',
          date: '2026-04-10',
          marker: 'TODO',
          pageName: 'apr-10th-2026',
          pageOriginalName: 'Apr 10th, 2026',
          blockUuid: 'block-1',
          priority: 'A',
          scheduled: '',
          deadline: '',
        },
      ],
    });
    const sharedRefresh = vi.fn(async () => undefined);

    getInitialSnapshot.mockReturnValue(startupSnapshot);
    createSerializedRefresh.mockReturnValue(sharedRefresh);

    await loadMain();

    expect(latestAgendaAppProps?.snapshot?.tasks).toEqual(startupSnapshot.tasks);

    // onRefresh wraps the serialized refresh with loading tracking
    expect(latestAgendaAppProps?.onRefresh).toBeTypeOf('function');
    await act(async () => {
      await latestAgendaAppProps?.onRefresh?.();
    });
    expect(sharedRefresh).toHaveBeenCalled();

    latestAgendaAppProps?.onClose?.();

    expect(logseq.hideMainUI).toHaveBeenCalledWith({ restoreEditingCursor: true });
    expect(setMainUiVisible).toHaveBeenCalledWith(false);
  });

  it('passes Logseq preferredLanguage through to AgendaApp locale on initial load', async () => {
    createSerializedRefresh.mockReturnValue(vi.fn());
    vi.mocked(logseq.App.getUserConfigs).mockResolvedValue(createUserConfigs({ preferredLanguage: 'fr-FR' }));

    await loadMain();

    expect(latestAgendaAppProps?.locale).toBe('fr-FR');
  });

  it('keeps the current locale through settings changes and refreshes it only when the panel open callback runs', async () => {
    createSerializedRefresh.mockReturnValue(vi.fn());
    vi.mocked(logseq.App.getUserConfigs).mockResolvedValue(createUserConfigs({ preferredLanguage: 'fr-FR' }));

    await loadMain();

    expect(latestAgendaAppProps?.locale).toBe('fr-FR');

    vi.mocked(logseq.App.getUserConfigs).mockResolvedValue(createUserConfigs({ preferredLanguage: 'de-DE' }));

    const bootOptions = bootPlugin.mock.calls[0][0] as {
      onSettingsChanged?: unknown;
      onOpen?: unknown;
    };
    const onSettingsChanged = bootOptions.onSettingsChanged;

    expect(onSettingsChanged).toBeTypeOf('function');

    if (typeof onSettingsChanged !== 'function') {
      throw new TypeError('Expected bootPlugin onSettingsChanged callback');
    }

    await act(async () => {
      await onSettingsChanged();
    });

    expect(latestAgendaAppProps?.locale).toBe('fr-FR');

    const onOpen = bootOptions.onOpen;

    expect(onOpen).toBeTypeOf('function');

    if (typeof onOpen !== 'function') {
      throw new TypeError('Expected bootPlugin onOpen callback');
    }

    await act(async () => {
      await onOpen();
    });

    expect(latestAgendaAppProps?.locale).toBe('de-DE');
  });

  it('uses one shared serialized refresh path across UI, plugin, and interval triggers after rerenders', async () => {
    const snapshots = [
      createSnapshot({ syncedAt: '2026-04-10T12:01:00.000Z' }),
      createSnapshot({ syncedAt: '2026-04-10T12:02:00.000Z' }),
    ];
    const createdRunners: Array<ReturnType<typeof vi.fn>> = [];

    refreshSnapshot.mockResolvedValue(snapshots[0]);
    createSerializedRefresh.mockImplementation((refresh: () => Promise<Snapshot>, options?: {
      onSnapshot?: (snapshot: Snapshot) => void;
      onError?: (error: unknown) => void;
    }) => {
      const runner = vi.fn(async () => {
        const snapshot = await refresh();
        options?.onSnapshot?.(snapshot);
      });
      createdRunners.push(runner);
      return runner;
    });

    await loadMain();

    const pluginRefresh = bootPlugin.mock.calls[0][0].onRefresh as () => void;
    const intervalRefresh = startRefreshLoop.mock.calls[0][0] as () => void;

    await waitFor(() => {
      expect(createdRunners[0]).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      latestAgendaAppProps?.onRefresh?.();
    });

    await waitFor(() => {
      expect(createdRunners[0]).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      pluginRefresh();
      intervalRefresh();
      latestAgendaAppProps?.onRefresh?.();
    });

    await waitFor(() => {
      expect(createSerializedRefresh).toHaveBeenCalledTimes(2);
      expect(createdRunners[0]).toHaveBeenCalledTimes(5);
      expect(createdRunners[1]).not.toHaveBeenCalled();
    });
  });

  it('triggers an initial refresh on startup after booting the plugin', async () => {
    const freshSnapshot = createSnapshot({ syncedAt: '2026-04-10T12:05:00.000Z' });

    refreshSnapshot.mockResolvedValue(freshSnapshot);
    createSerializedRefresh.mockImplementation((refresh: () => Promise<Snapshot>, options?: {
      onSnapshot?: (snapshot: Snapshot) => void;
      onError?: (error: unknown) => void;
    }) => {
      return vi.fn(async () => {
        const snapshot = await refresh();
        options?.onSnapshot?.(snapshot);
      });
    });

    await loadMain();

    await waitFor(() => {
      expect(refreshSnapshot).toHaveBeenCalledTimes(1);
      expect(latestAgendaAppProps?.snapshot).toEqual(freshSnapshot);
    });
  });

  it('keeps isRefreshing true until the serialized refresh queue drains', async () => {
    const initialSnapshot = createSnapshot({ syncedAt: '2026-04-10T12:00:00.000Z' });
    const firstQueuedSnapshot = createSnapshot({ syncedAt: '2026-04-10T12:01:00.000Z' });
    const secondQueuedSnapshot = createSnapshot({ syncedAt: '2026-04-10T12:02:00.000Z' });
    const firstDeferred = createDeferredPromise<Snapshot>();
    const secondDeferred = createDeferredPromise<Snapshot>();

    refreshSnapshot
      .mockResolvedValueOnce(initialSnapshot)
      .mockImplementationOnce(() => firstDeferred.promise)
      .mockImplementationOnce(() => secondDeferred.promise);
    createSerializedRefresh.mockImplementation((refresh: () => Promise<Snapshot>, options?: {
      onSnapshot?: (snapshot: Snapshot) => void;
      onError?: (error: unknown) => void;
    }) => {
      let inFlight: Promise<void> | null = null;
      let queuedTail: Promise<void> | null = null;
      let queued = false;

      async function run() {
        try {
          const snapshot = await refresh();
          options?.onSnapshot?.(snapshot);
        } catch (error) {
          options?.onError?.(error);
        } finally {
          inFlight = null;

          if (queued) {
            queued = false;
            const rerun = run();
            inFlight = rerun;
            queuedTail = rerun;
          } else {
            queuedTail = null;
          }
        }
      }

      return () => {
        if (inFlight) {
          queued = true;
          queuedTail = (queuedTail ?? inFlight).then(() => inFlight ?? Promise.resolve());
          return queuedTail;
        }

        inFlight = run();
        queuedTail = null;
        return inFlight;
      };
    });

    await loadMain();

    await waitFor(() => {
      expect(latestAgendaAppProps?.isRefreshing).toBe(false);
    });

    let firstRefresh: Promise<void> | undefined;
    let secondRefresh: Promise<void> | undefined;
    const onRefresh = latestAgendaAppProps?.onRefresh as (() => Promise<void>) | undefined;

    await act(async () => {
      firstRefresh = onRefresh?.();
      secondRefresh = onRefresh?.();
    });

    expect(latestAgendaAppProps?.isRefreshing).toBe(true);

    await act(async () => {
      firstDeferred.resolve(firstQueuedSnapshot);
      await firstRefresh;
    });

    expect(latestAgendaAppProps?.snapshot).toEqual(firstQueuedSnapshot);
    expect(latestAgendaAppProps?.isRefreshing).toBe(true);

    await act(async () => {
      secondDeferred.resolve(secondQueuedSnapshot);
      await secondRefresh;
    });

    expect(latestAgendaAppProps?.snapshot).toEqual(secondQueuedSnapshot);
    expect(latestAgendaAppProps?.isRefreshing).toBe(false);
  });

  it('starts, restarts, and stops the weather loop alongside the agenda loop', async () => {
    const startupSnapshot = createSnapshot({ syncedAt: '2026-04-10T12:00:00.000Z' });
    const refreshedSnapshot = createSnapshot({ syncedAt: '2026-04-10T12:05:00.000Z' });
    const weatherSnapshot = createSnapshot({
      syncedAt: '2026-04-10T12:06:00.000Z',
      weather: [
        {
          date: '2026-04-10',
          temperatureMin: 10,
          temperatureMax: 18,
          temperatureDisplay: '18C / 10C',
          conditionCode: 0,
          conditionLabel: 'Sunny',
          precipitationChance: 10,
          iconKey: 'sunny',
        },
      ],
    });
    const stopAgendaLoop = vi.fn();
    const stopAgendaLoopAfterSettings = vi.fn();
    const stopWeatherLoop = vi.fn();
    const stopWeatherLoopAfterSettings = vi.fn();
    const weatherFetch = vi.fn();

    getInitialSnapshot.mockReturnValue(startupSnapshot);
    refreshSnapshot.mockResolvedValue(refreshedSnapshot);
    refreshWeatherOnly.mockResolvedValue(weatherSnapshot);
    createLogseqFetch.mockReturnValue(weatherFetch);
    createSerializedRefresh.mockImplementation((refresh: () => Promise<Snapshot>, options?: {
      onSnapshot?: (snapshot: Snapshot) => void;
      onError?: (error: unknown) => void;
    }) => {
      return vi.fn(async () => {
        const snapshot = await refresh();
        options?.onSnapshot?.(snapshot);
      });
    });
    startRefreshLoop
      .mockReturnValueOnce(stopAgendaLoop)
      .mockReturnValueOnce(stopAgendaLoopAfterSettings);
    startWeatherRefreshLoop
      .mockReturnValueOnce(stopWeatherLoop)
      .mockReturnValueOnce(stopWeatherLoopAfterSettings);

    await loadMain();

    await waitFor(() => {
      expect(startRefreshLoop).toHaveBeenCalledTimes(1);
      expect(startWeatherRefreshLoop).toHaveBeenCalledTimes(1);
      expect(refreshSnapshot).toHaveBeenCalledTimes(1);
    });

    const onSettingsChanged = bootPlugin.mock.calls[0][0].onSettingsChanged as () => Promise<void>;
    const weatherRefresh = startWeatherRefreshLoop.mock.calls[0][0] as () => Promise<void>;

    await act(async () => {
      await weatherRefresh();
    });

    expect(refreshWeatherOnly).toHaveBeenCalledWith({
      currentSnapshot: refreshedSnapshot,
    });
    expect(latestAgendaAppProps?.snapshot).toEqual(weatherSnapshot);

    await act(async () => {
      await onSettingsChanged();
    });

    expect(stopAgendaLoop).toHaveBeenCalledTimes(1);
    expect(stopWeatherLoop).toHaveBeenCalledTimes(1);
    expect(startRefreshLoop).toHaveBeenCalledTimes(2);
    expect(startWeatherRefreshLoop).toHaveBeenCalledTimes(2);
    expect(refreshSnapshot).toHaveBeenCalledTimes(2);

    await unmountMain();

    expect(stopAgendaLoopAfterSettings).toHaveBeenCalledTimes(1);
    expect(stopWeatherLoopAfterSettings).toHaveBeenCalledTimes(1);
  });

  it('merges a late weather-only refresh into the latest full snapshot without restoring stale events tasks or errors', async () => {
    const startupSnapshot = createSnapshot({
      events: [
        {
          id: 'event-startup',
          sourceUrl: 'https://example.com/startup.ics',
          calendarName: 'Startup',
          title: 'Startup event',
          start: '2026-04-10T09:00:00.000Z',
          end: '2026-04-10T10:00:00.000Z',
          allDay: false,
          location: '',
          description: '',
        },
      ],
      tasks: [
        {
          id: 'startup-task',
          title: 'Startup task',
          date: '2026-04-10',
          marker: 'TODO',
          pageName: '2026-04-10',
          pageOriginalName: 'Apr 10th, 2026',
          blockUuid: 'startup-task',
          priority: '',
          scheduled: '',
          deadline: '',
        },
      ],
      errors: [{ sourceUrl: 'https://example.com/startup.ics', message: 'startup warning' }],
      weather: [],
      weatherLocation: null,
      syncedAt: '2026-04-10T12:00:00.000Z',
    });
    const latestFullSnapshot = createSnapshot({
      events: [
        {
          id: 'event-latest',
          sourceUrl: 'https://example.com/latest.ics',
          calendarName: 'Latest',
          title: 'Latest event',
          start: '2026-04-10T11:00:00.000Z',
          end: '2026-04-10T12:00:00.000Z',
          allDay: false,
          location: '',
          description: '',
        },
      ],
      tasks: [
        {
          id: 'latest-task',
          title: 'Latest task',
          date: '2026-04-10',
          marker: 'NOW',
          pageName: '2026-04-10',
          pageOriginalName: 'Apr 10th, 2026',
          blockUuid: 'latest-task',
          priority: 'A',
          scheduled: '',
          deadline: '',
        },
      ],
      errors: [{ sourceUrl: 'https://example.com/latest.ics', message: 'latest warning' }],
      weather: [],
      weatherLocation: null,
      syncedAt: '2026-04-10T12:05:00.000Z',
    });
    const lateWeatherSnapshot = createSnapshot({
      events: startupSnapshot.events,
      tasks: startupSnapshot.tasks,
      errors: startupSnapshot.errors,
      weather: [
        {
          date: '2026-04-10',
          temperatureMin: 10,
          temperatureMax: 18,
          temperatureDisplay: '18C / 10C',
          conditionCode: 0,
          conditionLabel: 'Sunny',
          precipitationChance: 10,
          iconKey: 'sunny',
        },
      ],
      weatherLocation: {
        query: 'Paris',
        resolvedName: 'Paris',
        latitude: 48.8566,
        longitude: 2.3522,
      },
      syncedAt: '2026-04-10T12:06:00.000Z',
    });
    const weatherDeferred = createDeferredPromise<Snapshot>();
    const weatherFetch = vi.fn();

    getInitialSnapshot.mockReturnValue(startupSnapshot);
    createLogseqFetch.mockReturnValue(weatherFetch);
    refreshSnapshot
      .mockResolvedValueOnce(startupSnapshot)
      .mockResolvedValueOnce(latestFullSnapshot);
    refreshWeatherOnly.mockImplementationOnce(() => weatherDeferred.promise);
    createSerializedRefresh.mockImplementation((refresh: () => Promise<Snapshot>, options?: {
      onSnapshot?: (snapshot: Snapshot) => void;
      onError?: (error: unknown) => void;
    }) => {
      return vi.fn(async () => {
        try {
          const snapshot = await refresh();
          options?.onSnapshot?.(snapshot);
        } catch (error) {
          options?.onError?.(error);
        }
      });
    });

    await loadMain();

    await waitFor(() => {
      expect(refreshSnapshot).toHaveBeenCalledTimes(1);
      expect(latestAgendaAppProps?.snapshot).toEqual(startupSnapshot);
    });

    const weatherRefresh = startWeatherRefreshLoop.mock.calls[0][0] as () => Promise<void>;

    await act(async () => {
      void weatherRefresh();
    });

    expect(refreshWeatherOnly).toHaveBeenCalledWith({
      currentSnapshot: startupSnapshot,
    });

    await act(async () => {
      await latestAgendaAppProps?.onRefresh?.();
    });

    expect(latestAgendaAppProps?.snapshot).toEqual(latestFullSnapshot);

    await act(async () => {
      weatherDeferred.resolve(lateWeatherSnapshot);
      await weatherDeferred.promise;
    });

    expect(latestAgendaAppProps?.snapshot).toEqual({
      ...latestFullSnapshot,
      weather: lateWeatherSnapshot.weather,
      weatherLocation: lateWeatherSnapshot.weatherLocation,
      syncedAt: lateWeatherSnapshot.syncedAt,
    });
  });

  it('opens the matching journal in the sidebar and closes the panel on date double click', async () => {
    const page = {
      uuid: 'page-1',
    };

    createSerializedRefresh.mockReturnValue(vi.fn());
    vi.mocked(logseq.Editor.getPage).mockResolvedValue(page as never);

    await loadMain();

    await act(async () => {
      await latestAgendaAppProps?.onDateDoubleClick?.(new Date('2026-04-10T12:00:00.000Z'));
    });

    expect(logseq.App.getUserConfigs).toHaveBeenCalledTimes(2);
    expect(logseq.Editor.getPage).toHaveBeenCalledWith('2026-04-10');
    expect(logseq.Editor.openInRightSidebar).toHaveBeenCalledWith('page-1');
    expect(logseq.hideMainUI).toHaveBeenCalledWith({ restoreEditingCursor: true });
    expect(setMainUiVisible).toHaveBeenCalledWith(false);
  });

  it('warns and keeps the panel open when no matching journal page exists', async () => {
    createSerializedRefresh.mockReturnValue(vi.fn());
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await loadMain();

    await act(async () => {
      await latestAgendaAppProps?.onDateDoubleClick?.(new Date('2026-04-10T12:00:00.000Z'));
    });

    expect(logseq.Editor.getPage).toHaveBeenCalledWith('2026-04-10');
    expect(logseq.Editor.openInRightSidebar).not.toHaveBeenCalled();
    expect(logseq.hideMainUI).not.toHaveBeenCalled();
    expect(setMainUiVisible).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[logseq-google-agenda] Journal page not found', {
      pageName: '2026-04-10',
    });

    warnSpy.mockRestore();
  });

  it('logs an error and keeps the panel open when opening a journal fails', async () => {
    createSerializedRefresh.mockReturnValue(vi.fn());
    const error = new Error('config failed');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.mocked(logseq.App.getUserConfigs).mockRejectedValue(error);

    await loadMain();

    await act(async () => {
      await latestAgendaAppProps?.onDateDoubleClick?.(new Date('2026-04-10T12:00:00.000Z'));
    });

    expect(logseq.Editor.getPage).not.toHaveBeenCalled();
    expect(logseq.Editor.openInRightSidebar).not.toHaveBeenCalled();
    expect(logseq.hideMainUI).not.toHaveBeenCalled();
    expect(setMainUiVisible).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[logseq-google-agenda] Failed to open journal in sidebar', error);

    errorSpy.mockRestore();
  });


  it('avoids interval and refresh side effects after unmount when boot resolves late', async () => {
    const bootDeferred = createDeferredPromise<() => void>();
    const handleRefresh = vi.fn(async () => undefined);
    const stopRefreshLoop = vi.fn();

    bootPlugin.mockReturnValue(bootDeferred.promise);
    createSerializedRefresh.mockReturnValue(handleRefresh);
    startRefreshLoop.mockReturnValue(stopRefreshLoop);

    await loadMain();

    await unmountMain();

    await act(async () => {
      bootDeferred.resolve(() => undefined);
      await bootDeferred.promise;
    });

    expect(startRefreshLoop).not.toHaveBeenCalled();
    expect(handleRefresh).not.toHaveBeenCalled();
  });

  it('closes the panel when Ctrl+Shift+G is pressed inside the iframe', async () => {
    createSerializedRefresh.mockReturnValue(vi.fn());

    await loadMain();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'G',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });

    expect(logseq.hideMainUI).toHaveBeenCalledWith({ restoreEditingCursor: true });
    expect(setMainUiVisible).toHaveBeenCalledWith(false);
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] In-iframe keydown close', {
      key: 'G',
      isEscape: false,
      isToggle: true,
    });

    logSpy.mockRestore();
  });

  it('closes the panel when Escape is pressed inside the iframe', async () => {
    createSerializedRefresh.mockReturnValue(vi.fn());

    await loadMain();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      );
    });

    expect(logseq.hideMainUI).toHaveBeenCalledWith({ restoreEditingCursor: true });
    expect(setMainUiVisible).toHaveBeenCalledWith(false);
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] In-iframe keydown close', {
      key: 'Escape',
      isEscape: true,
      isToggle: false,
    });

    logSpy.mockRestore();
  });

  it('cleans up the keydown listener across unmount and repeated module loads', async () => {
    createSerializedRefresh.mockReturnValue(vi.fn());
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

    await loadMain();

    const firstKeydownHandler = addEventListenerSpy.mock.calls.find(([type]) => type === 'keydown')?.[1];

    expect(addEventListenerSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);

    await unmountMain();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', firstKeydownHandler, false);

    vi.resetModules();
    await loadMain();

    expect(addEventListenerSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(2);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      );
    });

    expect(logseq.hideMainUI).toHaveBeenCalledTimes(1);
  });
});
