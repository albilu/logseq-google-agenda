import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

import type { Snapshot } from './sync/cache';

type AgendaAppProps = {
  snapshot?: Snapshot | null;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onClose?: () => void;
  onDateDoubleClick?: (date: Date) => void;
};

const bootPlugin = vi.fn();
const createDebouncedCallback = vi.fn();
const createSerializedRefresh = vi.fn();
const getInitialSnapshot = vi.fn();
const refreshSnapshot = vi.fn();
const refreshTasksOnly = vi.fn();
const setMainUiVisible = vi.fn();
const startRefreshLoop = vi.fn();
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
  createSerializedRefresh: (...args: Parameters<typeof createSerializedRefresh>) =>
    createSerializedRefresh(...args),
  getInitialSnapshot: (...args: Parameters<typeof getInitialSnapshot>) => getInitialSnapshot(...args),
  refreshSnapshot: (...args: Parameters<typeof refreshSnapshot>) => refreshSnapshot(...args),
  refreshTasksOnly: (...args: Parameters<typeof refreshTasksOnly>) => refreshTasksOnly(...args),
  setMainUiVisible: (...args: Parameters<typeof setMainUiVisible>) => setMainUiVisible(...args),
  startRefreshLoop: (...args: Parameters<typeof startRefreshLoop>) => startRefreshLoop(...args),
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
    events: [],
    tasks: [],
    errors: [],
    syncedAt: '2026-04-10T12:00:00.000Z',
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
  });

  bootPlugin.mockReset();
  createDebouncedCallback.mockReset();
  createSerializedRefresh.mockReset();
  getInitialSnapshot.mockReset();
  refreshSnapshot.mockReset();
  refreshTasksOnly.mockReset();
  setMainUiVisible.mockReset();
  startRefreshLoop.mockReset();
  syncEventsToJournals.mockReset();

  getInitialSnapshot.mockReturnValue(null);
  bootPlugin.mockResolvedValue(vi.fn());
  startRefreshLoop.mockReturnValue(vi.fn());
  createDebouncedCallback.mockImplementation((fn: () => void) => fn);
});

afterEach(() => {
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
      expect(createSerializedRefresh).toHaveBeenCalledTimes(1);
      expect(createdRunners[0]).toHaveBeenCalledTimes(5);
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
});
