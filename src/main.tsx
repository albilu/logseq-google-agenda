import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { format } from 'date-fns';
import { AgendaApp } from './app/AgendaApp';
import { getLogseqLocale } from './logseq/locale';
import type { Snapshot } from './sync/cache';
import {
  bootPlugin,
  createDebouncedCallback,
  createSerializedRefresh,
  getInitialSnapshot,
  refreshSnapshot,
  refreshTasksOnly,
  refreshWeatherOnly,
  setMainUiVisible,
  startRefreshLoop,
  startWeatherRefreshLoop,
} from './plugin';
import './styles.css';

function mergeWeatherSnapshot(currentSnapshot: Snapshot | null, weatherSnapshot: Snapshot): Snapshot {
  return {
    events: currentSnapshot?.events ?? weatherSnapshot.events,
    tasks: currentSnapshot?.tasks ?? weatherSnapshot.tasks,
    errors: currentSnapshot?.errors ?? weatherSnapshot.errors,
    weather: weatherSnapshot.weather,
    weatherLocation: weatherSnapshot.weatherLocation,
    syncedAt: weatherSnapshot.syncedAt,
  };
}

function hideAgendaPanel() {
  logseq.hideMainUI({ restoreEditingCursor: true });
  setMainUiVisible(false);
}

function handlePanelKeydown(e: KeyboardEvent) {
  const isEscape = e.key === 'Escape';
  const isToggle =
    (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g';

  if (isEscape || isToggle) {
    console.log('[logseq-google-agenda] In-iframe keydown close', {
      key: e.key,
      isEscape,
      isToggle,
    });
    hideAgendaPanel();
    e.stopPropagation();
    e.preventDefault();
  }
}

async function openJournalInSidebar(date: Date) {
  console.log('[logseq-google-agenda] openJournalInSidebar called', { date: date.toISOString() });
  try {
    const config = await logseq.App.getUserConfigs();
    const pageName = format(date, config.preferredDateFormat);
    console.log('[logseq-google-agenda] Looking up journal page', { pageName, preferredDateFormat: config.preferredDateFormat });
    const page = await logseq.Editor.getPage(pageName);

    if (page?.uuid) {
      await logseq.Editor.openInRightSidebar(page.uuid);
      hideAgendaPanel();
    } else {
      console.warn('[logseq-google-agenda] Journal page not found', { pageName });
    }
  } catch (error) {
    console.error('[logseq-google-agenda] Failed to open journal in sidebar', error);
  }
}

const container = document.getElementById('app');

if (!container) {
  throw new Error('Missing #app container');
}

function AgendaPluginRoot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => getInitialSnapshot());
  const [locale, setLocale] = useState('en-US');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const snapshotRef = useRef(snapshot);
  const refreshSequenceRef = useRef(0);
  snapshotRef.current = snapshot;

  const [handleRefresh] = useState(() =>
    createSerializedRefresh(
      () => refreshSnapshot(),
      {
        onSnapshot: setSnapshot,
        onError: (error) => {
          console.error('Failed to refresh Google Agenda', error);
        },
      },
    ),
  );

  const [handleWeatherRefresh] = useState(() =>
    createSerializedRefresh(
      () => refreshWeatherOnly({ currentSnapshot: snapshotRef.current }),
      {
        onSnapshot: (weatherSnapshot) => {
          setSnapshot((currentSnapshot) => mergeWeatherSnapshot(currentSnapshot, weatherSnapshot));
        },
        onError: (error) => {
          console.error('Failed to refresh weather', error);
        },
      },
    ),
  );

  const trackRefresh = async () => {
    const sequence = ++refreshSequenceRef.current;
    setIsRefreshing(true);
    try {
      await handleRefresh();
    } finally {
      if (refreshSequenceRef.current === sequence) {
        setIsRefreshing(false);
      }
    }
  };

  const [debouncedTaskRefresh] = useState(() =>
    createDebouncedCallback(async () => {
      try {
        const updated = await refreshTasksOnly({ currentSnapshot: snapshotRef.current });
        setSnapshot(updated);
      } catch (error) {
        console.error('Failed to refresh tasks on DB change', error);
      }
    }, 500),
  );

  useEffect(() => {
    // In-iframe keyboard handler: Logseq's registerCommandShortcut only fires
    // on the host window. When the plugin iframe has focus, handle close keys here.
    document.addEventListener('keydown', handlePanelKeydown, false);

    return () => {
      document.removeEventListener('keydown', handlePanelKeydown, false);
    };
  }, []);

  useEffect(() => {
    let isDisposed = false;
    let disposePlugin = () => {};
    let stopRefreshLoop = () => {};
    let stopWeatherRefreshLoop = () => {};

    void getLogseqLocale().then((resolvedLocale) => {
      if (!isDisposed) {
        setLocale(resolvedLocale);
      }
    });

    void bootPlugin({
      onOpen: () => {
        return getLogseqLocale().then((resolvedLocale) => {
          if (!isDisposed) {
            setLocale(resolvedLocale);
          }
        });
      },
      onRefresh: trackRefresh,
      onSettingsChanged: () => {
        stopRefreshLoop();
        stopWeatherRefreshLoop();
        stopRefreshLoop = startRefreshLoop(trackRefresh);
        stopWeatherRefreshLoop = startWeatherRefreshLoop(handleWeatherRefresh);

        return trackRefresh();
      },
      onTasksChanged: debouncedTaskRefresh,
    })
      .then((dispose) => {
        if (isDisposed) {
          dispose();
          return;
        }

        disposePlugin = dispose;
        stopRefreshLoop = startRefreshLoop(trackRefresh);
        stopWeatherRefreshLoop = startWeatherRefreshLoop(handleWeatherRefresh);
        return trackRefresh();
      })
      .catch((error) => {
        if (!isDisposed) {
          console.error('Failed to boot Logseq plugin', error);
        }
      });

    return () => {
      isDisposed = true;
      stopRefreshLoop();
      stopWeatherRefreshLoop();
      disposePlugin();
    };
  }, []);

  return <AgendaApp locale={locale} snapshot={snapshot} isRefreshing={isRefreshing} onRefresh={trackRefresh} onClose={hideAgendaPanel} onDateDoubleClick={openJournalInSidebar} />;
}

createRoot(container).render(<AgendaPluginRoot />);
