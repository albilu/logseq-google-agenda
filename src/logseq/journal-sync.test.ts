import type { CalendarEvent } from '../calendar/types';

import { buildJournalEntries, syncEventsToJournals } from './journal-sync';

const MANAGED_PREFIX = '<!-- logseq-google-agenda -->';

type TestBlock = {
  uuid: string;
  content: string;
  children?: TestBlock[];
};

function createEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'event-1',
    sourceUrl: 'https://calendar.google.com/calendar/u/0/r',
    calendarName: 'Engineering',
    title: 'Planning',
    start: '2024-05-06T09:00:00.000',
    end: '2024-05-06T10:00:00.000',
    allDay: false,
    location: 'Room 1',
    description: 'Discuss roadmap',
    ...overrides,
  } as CalendarEvent;
}

function managed(content: string): string {
  return `${MANAGED_PREFIX}${content}`;
}

function stubLocalTime(valuesByIso: Record<string, string>) {
  const DateTimeFormat = Object.assign(
    vi.fn(function DateTimeFormat() {
      return {
        format(date: Date) {
          return valuesByIso[date.toISOString()] ?? '00:00';
        },
      };
    }),
    { supportedLocalesOf: vi.fn(() => []) },
  );

  vi.stubGlobal('Intl', ({ ...Intl, DateTimeFormat } as unknown) as typeof Intl);

  return DateTimeFormat;
}

function createStorage(initialDates: string[] = [], initialChildMap: Record<string, string[]> = {}) {
  const values = new Map<string, string>();

  if (initialDates.length > 0) {
    values.set('logseq-google-agenda:journal-pages', JSON.stringify(initialDates));
  }

  if (Object.keys(initialChildMap).length > 0) {
    values.set('logseq-google-agenda:journal-child-uuids', JSON.stringify(initialChildMap));
  }

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe('buildJournalEntries', () => {
  it('groups rendered event lines by journal date using local time', () => {
    const DateTimeFormat = stubLocalTime({
      '2024-05-06T09:00:00.000Z': '11:00',
      '2024-05-06T10:00:00.000Z': '12:00',
      '2024-05-06T12:00:00.000Z': '14:00',
      '2024-05-06T13:00:00.000Z': '15:00',
      '2024-05-07T11:00:00.000Z': '13:00',
      '2024-05-07T12:00:00.000Z': '14:00',
    });

    try {
      const events: CalendarEvent[] = [
        createEvent({
          id: '2',
          title: 'Retro',
          start: '2024-05-07T11:00:00.000Z',
          end: '2024-05-07T12:00:00.000Z',
        }),
        createEvent({
          id: '1',
          title: 'Planning',
          start: '2024-05-06T09:00:00.000Z',
          end: '2024-05-06T10:00:00.000Z',
        }),
        createEvent({
          id: '3',
          title: 'Lunch',
          start: '2024-05-06T12:00:00.000Z',
          end: '2024-05-06T13:00:00.000Z',
          location: '',
        }),
        createEvent({
          id: '4',
          title: 'Holiday',
          start: '2024-05-08',
          end: '2024-05-09',
          allDay: true,
          location: '',
        }),
      ];

      expect(buildJournalEntries(events)).toEqual({
        '2024-05-06': [
          '11:00-12:00 Planning',
          'Calendar: Engineering',
          'Location: Room 1',
          '14:00-15:00 Lunch',
          'Calendar: Engineering',
        ],
        '2024-05-07': ['13:00-14:00 Retro', 'Calendar: Engineering', 'Location: Room 1'],
        '2024-05-08': ['All day Holiday', 'Calendar: Engineering'],
      });

      expect(DateTimeFormat).toHaveBeenCalledWith([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns an empty object when there are no events', () => {
    expect(buildJournalEntries([])).toEqual({});
  });
});

describe('syncEventsToJournals', () => {
  it('replaces previously synced plugin lines when storage tracking is missing', async () => {
    const events: CalendarEvent[] = [
      createEvent({
        id: '1',
        title: 'Planning',
        start: '2024-05-06T09:00:00.000Z',
        end: '2024-05-06T10:00:00.000Z',
      }),
    ];

    const pageBlocks: TestBlock[] = [
      {
        uuid: 'agenda-block',
        content: 'Google Agenda',
        children: [
          { uuid: 'managed-line-1', content: managed('11:00-12:00 Old planning') },
          { uuid: 'managed-line-2', content: managed('Calendar: Old calendar') },
          { uuid: 'user-child', content: 'User note' },
        ],
      },
    ];
    const removedBlocks: string[] = [];
    const insertedBlocks: Array<{ parentUuid: string; content: string }> = [];

    const editor = {
      createPage: vi.fn(async () => null),
      getPageBlocksTree: vi.fn(async () => pageBlocks),
      appendBlockInPage: vi.fn(async () => {
        throw new Error('should not append when Google Agenda already exists');
      }),
      insertBlock: vi.fn(async (parentUuid: string, content: string) => {
        insertedBlocks.push({ parentUuid, content });
        return { uuid: `new-${insertedBlocks.length}`, content };
      }),
      updateBlock: vi.fn(async (uuid: string, content: string) => ({ uuid, content })),
      removeBlock: vi.fn(async (uuid: string) => {
        removedBlocks.push(uuid);
      }),
    };

    const storage = createStorage(['2024-05-06']);
    stubLocalTime({
      '2024-05-06T09:00:00.000Z': '11:00',
      '2024-05-06T10:00:00.000Z': '12:00',
    });
    vi.stubGlobal('logseq', { Editor: editor });
    vi.stubGlobal('localStorage', storage);

    try {
      await syncEventsToJournals(events);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(removedBlocks).toEqual(['managed-line-1', 'managed-line-2']);
    expect(insertedBlocks).toEqual([
      { parentUuid: 'agenda-block', content: managed('11:00-12:00 Planning') },
      { parentUuid: 'agenda-block', content: managed('Calendar: Engineering') },
      { parentUuid: 'agenda-block', content: managed('Location: Room 1') },
    ]);
    expect(storage.setItem).toHaveBeenCalledWith(
      'logseq-google-agenda:journal-child-uuids',
      JSON.stringify({ '2024-05-06': ['new-1', 'new-2', 'new-3'] }),
    );
  });

  it('stores raw approved event lines as direct children of Google Agenda', async () => {
    const events: CalendarEvent[] = [
      createEvent({
        id: '1',
        title: 'Planning',
        start: '2024-05-06T09:00:00.000Z',
        end: '2024-05-06T10:00:00.000Z',
      }),
      createEvent({
        id: '2',
        title: 'Retro',
        start: '2024-05-06T11:00:00.000Z',
        end: '2024-05-06T12:00:00.000Z',
        location: '',
      }),
      createEvent({
        id: '3',
        title: 'Holiday',
        start: '2024-05-07',
        end: '2024-05-08',
        allDay: true,
        location: '',
      }),
    ];

    const blocksByPage = new Map<string, TestBlock[]>();
    const appendedBlocks: Array<{ pageName: string; content: string }> = [];
    const insertedBlocks: Array<{ parentUuid: string; content: string }> = [];
    let blockSequence = 0;

    const editor = {
      createPage: vi.fn(async (name: string) => {
        if (!blocksByPage.has(name)) {
          blocksByPage.set(name, []);
        }

        return { uuid: `page-${name}`, name };
      }),
      getPageBlocksTree: vi.fn(async (name: string) =>
        (blocksByPage.get(name) ?? []).map((block) => ({
          ...block,
          children: block.children?.map((child) => ({ ...child })) ?? [],
        })),
      ),
      appendBlockInPage: vi.fn(async (pageName: string, content: string) => {
        const uuid = `block-${++blockSequence}`;
        appendedBlocks.push({ pageName, content });
        const pageBlocks = blocksByPage.get(pageName) ?? [];
        pageBlocks.push({ uuid, content, children: [] });
        blocksByPage.set(pageName, pageBlocks);
        return { uuid, content };
      }),
      insertBlock: vi.fn(async (parentUuid: string, content: string) => {
        const uuid = `block-${++blockSequence}`;
        insertedBlocks.push({ parentUuid, content });

        for (const blocks of blocksByPage.values()) {
          const parentBlock = blocks.find((block) => block.uuid === parentUuid);

          if (!parentBlock) {
            continue;
          }

          const children = parentBlock.children ?? [];
          children.push({ uuid, content, children: [] });
          parentBlock.children = children;
          break;
        }

        return { uuid, content };
      }),
      updateBlock: vi.fn(async (uuid: string, content: string) => ({ uuid, content })),
      removeBlock: vi.fn(async () => undefined),
    };

    const storage = createStorage();
    stubLocalTime({
      '2024-05-06T09:00:00.000Z': '11:00',
      '2024-05-06T10:00:00.000Z': '12:00',
      '2024-05-06T11:00:00.000Z': '13:00',
      '2024-05-06T12:00:00.000Z': '14:00',
    });
    vi.stubGlobal('logseq', { Editor: editor });
    vi.stubGlobal('localStorage', storage);

    try {
      await syncEventsToJournals(events);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(appendedBlocks).toEqual([
      { pageName: '2024-05-06', content: 'Google Agenda' },
      { pageName: '2024-05-07', content: 'Google Agenda' },
    ]);
    expect(insertedBlocks).toEqual([
      { parentUuid: 'block-1', content: managed('11:00-12:00 Planning') },
      { parentUuid: 'block-1', content: managed('Calendar: Engineering') },
      { parentUuid: 'block-1', content: managed('Location: Room 1') },
      { parentUuid: 'block-1', content: managed('13:00-14:00 Retro') },
      { parentUuid: 'block-1', content: managed('Calendar: Engineering') },
      { parentUuid: 'block-7', content: managed('All day Holiday') },
      { parentUuid: 'block-7', content: managed('Calendar: Engineering') },
    ]);
    expect(storage.setItem).toHaveBeenCalledWith(
      'logseq-google-agenda:journal-child-uuids',
      JSON.stringify({
        '2024-05-06': ['block-2', 'block-3', 'block-4', 'block-5', 'block-6'],
        '2024-05-07': ['block-8', 'block-9'],
      }),
    );
  });

  it('preserves user-authored sibling children under Google Agenda during updates', async () => {
    const events: CalendarEvent[] = [
      createEvent({
        id: '1',
        title: 'Planning',
        start: '2024-05-06T09:00:00.000Z',
        end: '2024-05-06T10:00:00.000Z',
      }),
    ];

    const pageBlocks: TestBlock[] = [
      {
        uuid: 'agenda-block',
        content: 'Google Agenda',
        children: [
          { uuid: 'managed-line', content: managed('old event line') },
          { uuid: 'user-child', content: 'TODO follow up with notes' },
        ],
      },
    ];
    const removedBlocks: string[] = [];
    const insertedBlocks: Array<{ parentUuid: string; content: string }> = [];

    const editor = {
      createPage: vi.fn(async () => null),
      getPageBlocksTree: vi.fn(async () => pageBlocks),
      appendBlockInPage: vi.fn(async () => {
        throw new Error('should not append when Google Agenda already exists');
      }),
      insertBlock: vi.fn(async (parentUuid: string, content: string) => {
        insertedBlocks.push({ parentUuid, content });
        return { uuid: `new-${insertedBlocks.length}`, content };
      }),
      updateBlock: vi.fn(async (uuid: string, content: string) => ({ uuid, content })),
      removeBlock: vi.fn(async (uuid: string) => {
        removedBlocks.push(uuid);
      }),
    };

    const storage = createStorage(['2024-05-06'], { '2024-05-06': ['managed-line'] });
    stubLocalTime({
      '2024-05-06T09:00:00.000Z': '11:00',
      '2024-05-06T10:00:00.000Z': '12:00',
    });
    vi.stubGlobal('logseq', { Editor: editor });
    vi.stubGlobal('localStorage', storage);

    try {
      await syncEventsToJournals(events);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(editor.updateBlock).toHaveBeenCalledWith('agenda-block', 'Google Agenda');
    expect(removedBlocks).toEqual(['managed-line']);
    expect(insertedBlocks).toEqual([
      { parentUuid: 'agenda-block', content: managed('11:00-12:00 Planning') },
      { parentUuid: 'agenda-block', content: managed('Calendar: Engineering') },
      { parentUuid: 'agenda-block', content: managed('Location: Room 1') },
    ]);
    expect(storage.setItem).toHaveBeenCalledWith(
      'logseq-google-agenda:journal-child-uuids',
      JSON.stringify({ '2024-05-06': ['new-1', 'new-2', 'new-3'] }),
    );
  });

  it('clears stale tracked pages without recreating missing pages', async () => {
    const blocksByPage = new Map<string, TestBlock[]>([
      [
        '2024-05-06',
        [
          {
            uuid: 'agenda-1',
            content: 'Google Agenda',
            children: [
              { uuid: 'managed-line-1', content: managed('old event line') },
              { uuid: 'user-1', content: 'User task' },
            ],
          },
        ],
      ],
    ]);
    const removedBlocks: string[] = [];
    const updatedBlocks: Array<{ uuid: string; content: string }> = [];

    const editor = {
      createPage: vi.fn(async () => null),
      getPageBlocksTree: vi.fn(async (name: string) =>
        (blocksByPage.get(name) ?? null)?.map((block) => ({
          ...block,
          children: block.children?.map((child) => ({ ...child })) ?? [],
        })) ?? null,
      ),
      appendBlockInPage: vi.fn(async () => {
        throw new Error('should not append during stale cleanup');
      }),
      insertBlock: vi.fn(async () => {
        throw new Error('should not insert during stale cleanup');
      }),
      updateBlock: vi.fn(async (uuid: string, content: string) => {
        updatedBlocks.push({ uuid, content });
        return { uuid, content };
      }),
      removeBlock: vi.fn(async (uuid: string) => {
        removedBlocks.push(uuid);
      }),
    };

    const storage = createStorage(['2024-05-06', '2024-05-08'], {
      '2024-05-06': ['managed-line-1'],
      '2024-05-08': ['ghost-line'],
    });
    vi.stubGlobal('logseq', { Editor: editor });
    vi.stubGlobal('localStorage', storage);

    try {
      await syncEventsToJournals([]);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(editor.getPageBlocksTree).toHaveBeenCalledWith('2024-05-06');
    expect(editor.getPageBlocksTree).toHaveBeenCalledWith('2024-05-08');
    expect(editor.createPage).not.toHaveBeenCalled();
    expect(updatedBlocks).toEqual([{ uuid: 'agenda-1', content: 'Google Agenda' }]);
    expect(removedBlocks).toEqual(['managed-line-1']);
    expect(storage.setItem).toHaveBeenCalledWith('logseq-google-agenda:journal-pages', JSON.stringify([]));
    expect(storage.setItem).toHaveBeenCalledWith('logseq-google-agenda:journal-child-uuids', JSON.stringify({}));
  });
});
