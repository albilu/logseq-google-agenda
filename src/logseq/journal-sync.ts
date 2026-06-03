import { groupEventsByDate } from '../calendar/group-events';
import type { CalendarEvent } from '../calendar/types';

const JOURNAL_BLOCK_TITLE = 'Google Agenda';
const JOURNAL_PAGES_STORAGE_KEY = 'logseq-google-agenda:journal-pages';
const JOURNAL_CHILD_UUIDS_STORAGE_KEY = 'logseq-google-agenda:journal-child-uuids';
const MANAGED_LINE_PREFIX = '<!-- logseq-google-agenda -->';

type LogseqBlockNode = {
  uuid: string;
  content: string;
  children?: LogseqBlockNode[];
};

type LogseqEditor = {
  createPage(
    name: string,
    properties?: Record<string, never>,
    options?: { createFirstBlock?: boolean; journal?: boolean },
  ): Promise<unknown>;
  getPageBlocksTree(name: string): Promise<LogseqBlockNode[] | null>;
  appendBlockInPage(pageName: string, content: string): Promise<{ uuid: string } | null>;
  insertBlock(parentUuid: string, content: string): Promise<{ uuid: string } | null>;
  updateBlock(uuid: string, content: string): Promise<unknown>;
  removeBlock(uuid: string): Promise<unknown>;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type ChildUuidMap = Record<string, string[]>;

function formatTime(value: string): string {
  return new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function buildEventLines(event: CalendarEvent): string[] {
  const lines = [
    event.allDay
      ? `All day ${event.title}`
      : `${formatTime(event.start)}-${formatTime(event.end)} ${event.title}`,
    `Calendar: ${event.calendarName}`,
  ];

  if (event.location) {
    lines.push(`Location: ${event.location}`);
  }

  return lines;
}

function toManagedContent(content: string): string {
  return `${MANAGED_LINE_PREFIX}${content}`;
}

function isManagedContent(content: string): boolean {
  return content.startsWith(MANAGED_LINE_PREFIX);
}

function findJournalBlock(blocks: LogseqBlockNode[]): LogseqBlockNode | null {
  return blocks.find((block) => block.content === JOURNAL_BLOCK_TITLE) ?? null;
}

function getEditor(): LogseqEditor {
  return (globalThis as { logseq: { Editor: LogseqEditor } }).logseq.Editor;
}

function getStorage(): StorageLike | null {
  return typeof localStorage === 'undefined' ? null : (localStorage as StorageLike);
}

function loadTrackedJournalPages(storage: StorageLike | null): string[] {
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(JOURNAL_PAGES_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function saveTrackedJournalPages(storage: StorageLike | null, pageNames: string[]): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(JOURNAL_PAGES_STORAGE_KEY, JSON.stringify(pageNames));
  } catch {
    // Ignore storage write failures and keep sync best-effort.
  }
}

function loadTrackedChildUuids(storage: StorageLike | null): ChildUuidMap {
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(JOURNAL_CHILD_UUIDS_STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;

    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [],
      ]),
    );
  } catch {
    return {};
  }
}

function saveTrackedChildUuids(storage: StorageLike | null, childUuidsByPage: ChildUuidMap): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(JOURNAL_CHILD_UUIDS_STORAGE_KEY, JSON.stringify(childUuidsByPage));
  } catch {
    // Ignore storage write failures and keep sync best-effort.
  }
}

async function removeManagedChildren(
  editor: LogseqEditor,
  trackedChildUuids: string[],
  existingJournalBlock: LogseqBlockNode,
): Promise<void> {
  const trackedChildUuidSet = new Set(trackedChildUuids);

  for (const child of existingJournalBlock.children ?? []) {
    if (trackedChildUuidSet.has(child.uuid) || isManagedContent(child.content)) {
      await editor.removeBlock(child.uuid);
    }
  }
}

async function syncJournalPage(
  editor: LogseqEditor,
  dateKey: string,
  lines: string[],
  trackedChildUuids: string[],
): Promise<string[]> {
  if (lines.length === 0) {
    const pageBlocks = await editor.getPageBlocksTree(dateKey);

    if (!pageBlocks) {
      return [];
    }

    const existingJournalBlock = findJournalBlock(pageBlocks);

    if (!existingJournalBlock) {
      return [];
    }

    await editor.updateBlock(existingJournalBlock.uuid, JOURNAL_BLOCK_TITLE);
    await removeManagedChildren(editor, trackedChildUuids, existingJournalBlock);
    return [];
  }

  await editor.createPage(dateKey, {}, { createFirstBlock: false, journal: true });

  const pageBlocks = (await editor.getPageBlocksTree(dateKey)) ?? [];
  let journalBlock = findJournalBlock(pageBlocks);

  if (!journalBlock) {
    const insertedBlock = await editor.appendBlockInPage(dateKey, JOURNAL_BLOCK_TITLE);

    if (!insertedBlock?.uuid) {
      return [];
    }

    journalBlock = {
      uuid: insertedBlock.uuid,
      content: JOURNAL_BLOCK_TITLE,
      children: [],
    };
  } else {
    await editor.updateBlock(journalBlock.uuid, JOURNAL_BLOCK_TITLE);
    await removeManagedChildren(editor, trackedChildUuids, journalBlock);
  }

  const insertedChildUuids: string[] = [];

  for (const line of lines) {
    const insertedBlock = await editor.insertBlock(journalBlock.uuid, toManagedContent(line));

    if (insertedBlock?.uuid) {
      insertedChildUuids.push(insertedBlock.uuid);
    }
  }

  return insertedChildUuids;
}

export function buildJournalEntries(events: CalendarEvent[]): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(groupEventsByDate(events)).map(([dateKey, dateEvents]) => [
      dateKey,
      dateEvents.flatMap(buildEventLines),
    ]),
  );
}

export async function syncEventsToJournals(events: CalendarEvent[]): Promise<void> {
  const editor = getEditor();
  const storage = getStorage();
  const journalEntries = buildJournalEntries(events);
  const currentDates = Object.keys(journalEntries);
  const trackedDates = loadTrackedJournalPages(storage);
  const trackedChildUuidsByPage = loadTrackedChildUuids(storage);
  const nextTrackedChildUuidsByPage: ChildUuidMap = {};
  const datesToSync = [...new Set([...trackedDates, ...currentDates])].sort();

  for (const dateKey of datesToSync) {
    const insertedChildUuids = await syncJournalPage(
      editor,
      dateKey,
      journalEntries[dateKey] ?? [],
      trackedChildUuidsByPage[dateKey] ?? [],
    );

    if (insertedChildUuids.length > 0) {
      nextTrackedChildUuidsByPage[dateKey] = insertedChildUuids;
    }
  }

  saveTrackedJournalPages(storage, currentDates.sort());
  saveTrackedChildUuids(storage, nextTrackedChildUuidsByPage);
}
