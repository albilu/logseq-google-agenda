import type { AgendaTask } from '../calendar/types';

type JournalTaskBlock = {
  uuid: string;
  content: string;
  marker?: string;
  priority?: string;
  scheduled?: string;
  deadline?: string;
  children?: JournalTaskBlock[];
};

type JournalTaskPage = {
  name: string;
  originalName: string;
  journalDay: string;
  blocks: JournalTaskBlock[];
};

type LogseqPage = {
  name: string;
  originalName?: string;
  'original-name'?: string;
  journalDay?: number | string;
  'journal-day'?: number | string;
  'journal?': boolean;
};

type LogseqTaskReader = {
  getAllPages(): Promise<LogseqPage[] | null>;
  getPageBlocksTree(name: string): Promise<JournalTaskBlock[] | null>;
};

const OPEN_MARKERS = new Set(['TODO', 'NOW', 'LATER', 'DOING', 'WAITING']);

function normalizeJournalDay(journalDay: number | string | undefined): string {
  if (typeof journalDay === 'string') {
    return journalDay;
  }

  if (typeof journalDay === 'number') {
    const value = journalDay.toString();

    if (value.length === 8) {
      return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    }
  }

  return '';
}

function flattenBlocks(blocks: JournalTaskBlock[]): JournalTaskBlock[] {
  return blocks.flatMap((block) => [block, ...flattenBlocks(block.children ?? [])]);
}

export async function loadJournalTasks(reader: LogseqTaskReader): Promise<AgendaTask[]> {
  const pages = (await reader.getAllPages()) ?? [];

  const journalPages = await Promise.all(
    pages
      .filter((page) => page['journal?'])
      .map(async (page) => ({
        name: page.name,
        originalName: page.originalName ?? page['original-name'] ?? page.name,
        journalDay: normalizeJournalDay(page.journalDay ?? page['journal-day']),
        blocks: (await reader.getPageBlocksTree(page.name)) ?? [],
      })),
  );

  return extractJournalTasks(journalPages);
}

export function extractJournalTasks(pages: JournalTaskPage[]): AgendaTask[] {
  return pages.flatMap((page) =>
    flattenBlocks(page.blocks).flatMap((block) => {
      if (!block.marker || !OPEN_MARKERS.has(block.marker)) {
        return [];
      }

      const scheduled = block.scheduled ?? '';
      const deadline = block.deadline ?? '';

      return [
        {
          id: block.uuid,
          title: block.content,
          date: scheduled || deadline || page.journalDay,
          marker: block.marker,
          pageName: page.name,
          pageOriginalName: page.originalName,
          blockUuid: block.uuid,
          priority: block.priority ?? '',
          scheduled,
          deadline,
        },
      ];
    }),
  );
}
