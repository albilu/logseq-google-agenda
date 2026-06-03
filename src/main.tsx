import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { format } from 'date-fns';
import { AgendaApp } from './app/AgendaApp';
import type { Snapshot } from './sync/cache';
import {
  bootPlugin,
  createDebouncedCallback,
  createSerializedRefresh,
  getInitialSnapshot,
  refreshSnapshot,
  refreshTasksOnly,
  setMainUiVisible,
  startRefreshLoop,
} from './plugin';
import './styles.css';

function hideAgendaPanel() {
  logseq.hideMainUI({ restoreEditingCursor: true });
  setMainUiVisible(false);
}

// In-iframe keyboard handler: Logseq's registerCommandShortcut only fires
// on the host window.  When the plugin iframe has focus (after showMainUI),
// keyboard events never reach the host, so the toggle shortcut never fires.
// We listen inside the iframe and close the panel ourselves.
document.addEventListener(
  'keydown',
  (e: KeyboardEvent) => {
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
  },
  false,
);

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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const snapshotRef = useRef(snapshot);
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

  const trackRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await handleRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [handleRefresh]);

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
    let isDisposed = false;
    let disposePlugin = () => {};
    let stopRefreshLoop = () => {};

    void bootPlugin({
      onRefresh: trackRefresh,
      onSettingsChanged: () => {
        stopRefreshLoop();
        stopRefreshLoop = startRefreshLoop(trackRefresh);
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
      disposePlugin();
    };
  }, []);

  return <AgendaApp snapshot={snapshot} isRefreshing={isRefreshing} onRefresh={trackRefresh} onClose={hideAgendaPanel} onDateDoubleClick={openJournalInSidebar} />;
}

createRoot(container).render(<AgendaPluginRoot />);
