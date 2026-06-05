import '@logseq/libs';

import { createTranslator } from './i18n';
import { syncEventsToJournals } from './logseq/journal-sync';
import { getLogseqLocale } from './logseq/locale';
import { getSettingsSchema, parseSettings } from './logseq/settings';
import { loadJournalTasks } from './logseq/tasks';
import { loadSnapshot, saveSnapshot, type Snapshot } from './sync/cache';
import { refreshFeeds } from './sync/ical';
import { refreshWeather } from './sync/weather';

type SnapshotStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type RawSettings = Parameters<typeof parseSettings>[0];
type RefreshLoopHandle = ReturnType<typeof setInterval>;
type LogseqTaskReader = Parameters<typeof loadJournalTasks>[0];

type RefreshSnapshotOptions = {
  storage?: SnapshotStorage;
  settings?: RawSettings;
  fetchImpl?: typeof fetch;
  syncToJournals?: ((snapshot: Snapshot['events']) => Promise<void>) | null;
  reportError?: (message: string, error: unknown) => void;
};

type StartRefreshLoopOptions = {
  settings?: RawSettings;
  setIntervalImpl?: (handler: () => void, timeout: number) => RefreshLoopHandle;
  clearIntervalImpl?: (handle: RefreshLoopHandle) => void;
};

type RefreshTasksOnlyOptions = {
  currentSnapshot?: Snapshot | null;
  storage?: SnapshotStorage;
  reportError?: (message: string, error: unknown) => void;
};

type RefreshWeatherOnlyOptions = {
  currentSnapshot?: Snapshot | null;
  storage?: SnapshotStorage;
  settings?: RawSettings;
  fetchImpl?: typeof fetch;
  reportError?: (message: string, error: unknown) => void;
};

type BootPluginOptions = {
  onOpen?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onSettingsChanged?: () => void | Promise<void>;
  onTasksChanged?: () => void | Promise<void>;
};

type SerializedRefreshOptions = {
  onSnapshot?: (snapshot: Snapshot) => void;
  onError?: (error: unknown) => void;
};

const REFRESH_COMMAND_KEY = 'logseq-google-agenda-refresh';
const REFRESH_SHORTCUT_KEY = 'logseq-google-agenda-refresh-shortcut';
const REFRESH_SHORTCUT = 'mod+shift+r';
const OPEN_COMMAND_KEY = 'logseq-google-agenda-open';
const OPEN_SHORTCUT_KEY = 'logseq-google-agenda-open-shortcut';
const OPEN_SHORTCUT = 'mod+shift+g';
let isMainUiVisible = false;

function syncWindowMainUiVisible(visible: boolean): void {
  (globalThis as { __logseqGoogleAgendaMainUiVisible?: boolean }).__logseqGoogleAgendaMainUiVisible = visible;
}

function getMainUiVisible(): boolean {
  const runtimeVisible = (globalThis as { __logseqGoogleAgendaMainUiVisible?: boolean }).__logseqGoogleAgendaMainUiVisible;

  return typeof runtimeVisible === 'boolean' ? runtimeVisible : isMainUiVisible;
}

function getWindowMainUiVisible(): boolean | null {
  const runtimeVisible = (globalThis as { __logseqGoogleAgendaMainUiVisible?: boolean }).__logseqGoogleAgendaMainUiVisible;

  return typeof runtimeVisible === 'boolean' ? runtimeVisible : null;
}

export function setMainUiVisible(visible: boolean): void {
  isMainUiVisible = visible;
  syncWindowMainUiVisible(visible);
}

function getBrowserStorage(): SnapshotStorage {
  return window.localStorage;
}

function getCurrentSettings(settings?: RawSettings): RawSettings {
  return settings ?? (logseq.settings as RawSettings);
}

function getTaskReader(): LogseqTaskReader | null {
  const editor = (globalThis as { logseq?: { Editor?: LogseqTaskReader } }).logseq?.Editor;

  if (!editor || typeof editor.getAllPages !== 'function' || typeof editor.getPageBlocksTree !== 'function') {
    return null;
  }

  return editor;
}

function shouldReportWeatherError(reportError: (message: string, error: unknown) => void) {
  return reportError !== console.error;
}

async function loadWeather(
  city: string,
  fetchImpl: typeof fetch | undefined,
  reportError: (message: string, error: unknown) => void,
  fallback: Pick<Snapshot, 'weather' | 'weatherLocation'> = {
    weather: [],
    weatherLocation: null,
  },
): Promise<Pick<Snapshot, 'weather' | 'weatherLocation'>> {
  if (!city) {
    console.log('[logseq-google-agenda] Weather refresh skipped', {
      reason: 'missing city',
    });
    return {
      weather: [],
      weatherLocation: null,
    };
  }

  try {
    const locale = await getLogseqLocale();
    const result = await refreshWeather({
      city,
      fetchImpl,
      locale,
    });

    console.log('[logseq-google-agenda] Weather refresh result', {
      city,
      dayCount: result.weather.length,
      hasLocation: result.weatherLocation !== null,
    });

    return result;
  } catch (error) {
    if (shouldReportWeatherError(reportError)) {
      reportError('Failed to refresh weather', error);
    }
    console.warn('[logseq-google-agenda] Weather refresh failed; using fallback weather data', {
      city,
      error,
    });
    return fallback;
  }
}

async function refreshTasks(reportError: (message: string, error: unknown) => void): Promise<Snapshot['tasks']> {
  const reader = getTaskReader();

  if (!reader) {
    return [];
  }

  try {
    return await loadJournalTasks(reader);
  } catch (error) {
    reportError('Failed to load Logseq journal tasks', error);
    return [];
  }
}

export function getInitialSnapshot(storage: SnapshotStorage = getBrowserStorage()): Snapshot | null {
  return loadSnapshot(storage);
}

export async function refreshSnapshot({
  storage = getBrowserStorage(),
  settings,
  fetchImpl,
  syncToJournals = null,
  reportError = console.error,
}: RefreshSnapshotOptions = {}): Promise<Snapshot> {
  const parsedSettings = parseSettings(getCurrentSettings(settings));
  console.log('[logseq-google-agenda] Refresh settings parsed', {
    feedCount: parsedSettings.feeds.length,
    feeds: parsedSettings.feeds,
    refreshIntervalMinutes: parsedSettings.refreshIntervalMinutes,
  });
  const [feedSnapshot, tasks, weatherSnapshot] = await Promise.all([
    refreshFeeds(parsedSettings.feeds, fetchImpl),
    refreshTasks(reportError),
    loadWeather(parsedSettings.weatherCity, fetchImpl, reportError),
  ]);
  const snapshot = {
    ...feedSnapshot,
    tasks,
    ...weatherSnapshot,
  } satisfies Snapshot;

  console.log('[logseq-google-agenda] Refresh snapshot built', {
    eventCount: snapshot.events.length,
    taskCount: snapshot.tasks.length,
    errorCount: snapshot.errors.length,
    syncedAt: snapshot.syncedAt,
  });

  saveSnapshot(storage, snapshot);

  if (syncToJournals) {
    void syncToJournals(snapshot.events).catch((error) => {
      reportError('Failed to sync events to Logseq journals', error);
    });
  }

  return snapshot;
}

export async function refreshTasksOnly({
  currentSnapshot = null,
  storage = getBrowserStorage(),
  reportError = console.error,
}: RefreshTasksOnlyOptions = {}): Promise<Snapshot> {
  const tasks = await refreshTasks(reportError);
  const snapshot: Snapshot = {
    events: currentSnapshot?.events ?? [],
    errors: currentSnapshot?.errors ?? [],
    tasks,
    weather: currentSnapshot?.weather ?? [],
    weatherLocation: currentSnapshot?.weatherLocation ?? null,
    syncedAt: new Date().toISOString(),
  };

  saveSnapshot(storage, snapshot);
  return snapshot;
}

export async function refreshWeatherOnly({
  currentSnapshot = null,
  storage = getBrowserStorage(),
  settings,
  fetchImpl,
  reportError = console.error,
}: RefreshWeatherOnlyOptions = {}): Promise<Snapshot> {
  const parsedSettings = parseSettings(getCurrentSettings(settings));
  const weatherSnapshot = await loadWeather(parsedSettings.weatherCity, fetchImpl, reportError, {
    weather: currentSnapshot?.weather ?? [],
    weatherLocation: currentSnapshot?.weatherLocation ?? null,
  });
  const snapshot: Snapshot = {
    events: currentSnapshot?.events ?? [],
    errors: currentSnapshot?.errors ?? [],
    tasks: currentSnapshot?.tasks ?? [],
    ...weatherSnapshot,
    syncedAt: new Date().toISOString(),
  };

  saveSnapshot(storage, snapshot);
  return snapshot;
}

export function createDebouncedCallback(
  fn: () => void | Promise<void>,
  delayMs: number,
  timers: {
    setTimeout: (handler: () => void, timeout: number) => number;
    clearTimeout: (handle: number) => void;
  } = {
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  },
): () => void {
  let handle: number | null = null;

  return () => {
    if (handle !== null) {
      timers.clearTimeout(handle);
    }

    handle = timers.setTimeout(() => {
      handle = null;
      void fn();
    }, delayMs);
  };
}

export function createSerializedRefresh(
  refresh: () => Promise<Snapshot>,
  { onSnapshot, onError }: SerializedRefreshOptions = {},
) {
  let inFlight: Promise<void> | null = null;
  let queuedTail: Promise<void> | null = null;
  let queued = false;

  async function run(): Promise<void> {
    try {
      const snapshot = await refresh();
      onSnapshot?.(snapshot);
    } catch (error) {
      onError?.(error);
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

  return function triggerRefresh(): Promise<void> {
    if (inFlight) {
      queued = true;
      queuedTail = (queuedTail ?? inFlight).then(() => inFlight ?? Promise.resolve());
      return queuedTail;
    }

    inFlight = run();
    queuedTail = null;
    return inFlight;
  };
}

export function startRefreshLoop(
  onRefresh: () => void | Promise<void>,
  {
    settings,
    setIntervalImpl = window.setInterval.bind(window),
    clearIntervalImpl = window.clearInterval.bind(window),
  }: StartRefreshLoopOptions = {},
): () => void {
  const parsedSettings = parseSettings(getCurrentSettings(settings));
  const intervalMs = parsedSettings.refreshIntervalMinutes * 60 * 1000;
  console.log('[logseq-google-agenda] Refresh loop started', {
    refreshIntervalMinutes: parsedSettings.refreshIntervalMinutes,
    intervalMs,
  });
  const handle = setIntervalImpl(() => {
    void onRefresh();
  }, intervalMs);

  return () => {
    clearIntervalImpl(handle);
  };
}

export function startWeatherRefreshLoop(
  onRefresh: () => void | Promise<void>,
  {
    settings,
    setIntervalImpl = window.setInterval.bind(window),
    clearIntervalImpl = window.clearInterval.bind(window),
  }: StartRefreshLoopOptions = {},
): () => void {
  const parsedSettings = parseSettings(getCurrentSettings(settings));

  if (!parsedSettings.weatherCity) {
    return () => {};
  }

  const intervalMs = parsedSettings.weatherRefreshIntervalMinutes * 60 * 1000;
  const handle = setIntervalImpl(() => {
    void onRefresh();
  }, intervalMs);

  return () => {
    clearIntervalImpl(handle);
  };
}

export async function bootPlugin({ onOpen, onRefresh, onSettingsChanged, onTasksChanged }: BootPluginOptions = {}): Promise<() => void> {
  let offSettingsChanged = () => {};
  let offDbChanged = () => {};

  console.log('[logseq-google-agenda] Plugin boot start');

  await logseq.ready(async () => {
    const locale = await getLogseqLocale();
    const t = createTranslator(locale);
    const openCommandLabel = t('command.openAgenda');
    const refreshCommandLabel = t('command.refreshAgenda');

    logseq.useSettingsSchema([...getSettingsSchema(locale)]);
    logseq.setMainUIInlineStyle({
      zIndex: 9999,
      position: 'fixed',
      top: '0px',
      left: '0px',
      width: '100vw',
      height: '100vh',
    });
    console.log('[logseq-google-agenda] Settings schema registered, mainUI zIndex set');

    const openAgenda = async () => {
      console.log('[logseq-google-agenda] Open command handler start');

      const resolvedVisible = getMainUiVisible();
      console.log('[logseq-google-agenda] Toggle state evaluated', {
        inMemoryVisible: isMainUiVisible,
        windowVisible: getWindowMainUiVisible() ?? false,
        resolvedVisible,
      });

      if (resolvedVisible) {
        console.log('[logseq-google-agenda] Calling hideMainUI', { restoreEditingCursor: true });
        logseq.hideMainUI({ restoreEditingCursor: true });
        setMainUiVisible(false);
        console.log('[logseq-google-agenda] hideMainUI completed', { restoreEditingCursor: true });
        return;
      }

      try {
        await onOpen?.();
      } catch (error) {
        console.error('[logseq-google-agenda] onOpen failed', error);
        throw error;
      }

      try {
        console.log('[logseq-google-agenda] Calling showMainUI', { autoFocus: true });
        await logseq.showMainUI({ autoFocus: true });
        setMainUiVisible(true);
        console.log('[logseq-google-agenda] showMainUI completed', { autoFocus: true });
      } catch (error) {
        console.error('[logseq-google-agenda] showMainUI failed', error);
        throw error;
      }
    };
    const runRefresh = () => {
      void onRefresh?.();
    };

    logseq.App.registerCommandPalette(
      {
        key: OPEN_COMMAND_KEY,
        label: openCommandLabel,
      },
      openAgenda,
    );
    logseq.App.registerCommandShortcut(OPEN_SHORTCUT, openAgenda, {
      key: OPEN_SHORTCUT_KEY,
      label: openCommandLabel,
    });
    console.log('[logseq-google-agenda] Open command registered', {
      commandKey: OPEN_COMMAND_KEY,
      shortcut: OPEN_SHORTCUT,
      shortcutKey: OPEN_SHORTCUT_KEY,
    });

    logseq.App.registerCommandPalette(
      {
        key: REFRESH_COMMAND_KEY,
        label: refreshCommandLabel,
      },
      runRefresh,
    );
    logseq.App.registerCommandShortcut(REFRESH_SHORTCUT, runRefresh, {
      key: REFRESH_SHORTCUT_KEY,
      label: refreshCommandLabel,
    });
    console.log('[logseq-google-agenda] Refresh command registered', {
      commandKey: REFRESH_COMMAND_KEY,
      shortcut: REFRESH_SHORTCUT,
      shortcutKey: REFRESH_SHORTCUT_KEY,
    });

    offSettingsChanged = logseq.onSettingsChanged(() => {
      void onSettingsChanged?.();
    });

    if (onTasksChanged) {
      offDbChanged = logseq.DB.onChanged(() => {
        void onTasksChanged();
      });
    }
  });

  return () => {
    offSettingsChanged();
    offDbChanged();
  };
}

/**
 * Returns a fetch-compatible implementation that routes requests through
 * Logseq's IPC bridge (Electron main process), bypassing browser CORS
 * restrictions that block direct fetches from the lsp://logseq.io origin.
 *
 * When the IPC bridge is unavailable (e.g. cross-origin frame blocked), the
 * implementation throws a TypeError similar to native fetch network failures
 * so callers can handle it uniformly.
 */
export function createLogseqFetch(): typeof fetch {
  return async (url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof url === 'string' ? url :
      url instanceof URL ? url.href :
      (url as Request).url;

    let text: string;

    try {
      text = (await logseq.Request._request({
        url: urlStr,
        method: 'GET',
        returnType: 'text',
      })) as string;
    } catch (error) {
      if (error instanceof DOMException) {
        throw new TypeError(
          `Logseq IPC bridge unavailable (${error.message}). Request to ${urlStr} could not be dispatched.`,
        );
      }

      throw error;
    }

    return new Response(text, { status: 200 });
  };
}

export { syncEventsToJournals };
