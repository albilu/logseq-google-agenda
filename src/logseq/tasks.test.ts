import type { AgendaTask } from '../calendar/types';
import { expectTypeOf } from 'vitest';

import { extractJournalTasks, loadJournalTasks } from './tasks';

describe('AgendaTask', () => {
  it('defines the shared task shape for agenda tasks', () => {
    const task = {
      id: 'task-1',
      title: 'Review roadmap',
      date: '2024-05-06',
      marker: 'TODO',
      pageName: '2024-05-06',
      pageOriginalName: 'May 6th, 2024',
      blockUuid: 'block-1',
      priority: 'A',
      scheduled: '2024-05-06',
      deadline: '2024-05-07',
    } satisfies AgendaTask;

    expectTypeOf(task).toMatchTypeOf<AgendaTask>();
  });

  it('extracts open journal tasks and assigns dates by scheduled deadline then journal date', () => {
    expect(
      extractJournalTasks([
        {
          name: '2024-05-06',
          originalName: 'May 6th, 2024',
          journalDay: '2024-05-06',
          blocks: [
            {
              uuid: 'todo-1',
              content: 'Review roadmap',
              marker: 'TODO',
              priority: 'A',
              scheduled: '2024-05-07',
            },
            {
              uuid: 'waiting-1',
              content: 'Need approval',
              marker: 'WAITING',
              priority: '',
              deadline: '2024-05-08',
            },
            {
              uuid: 'now-1',
              content: 'Prepare notes',
              marker: 'NOW',
              priority: 'B',
            },
            {
              uuid: 'done-1',
              content: 'Already finished',
              marker: 'DONE',
              priority: 'C',
              scheduled: '2024-05-06',
            },
            {
              uuid: 'canceled-1',
              content: 'Canceled task',
              marker: 'CANCELED',
              priority: '',
              deadline: '2024-05-09',
            },
          ],
        },
      ]),
    ).toEqual<AgendaTask[]>([
      {
        id: 'todo-1',
        title: 'Review roadmap',
        date: '2024-05-07',
        marker: 'TODO',
        pageName: '2024-05-06',
        pageOriginalName: 'May 6th, 2024',
        blockUuid: 'todo-1',
        priority: 'A',
        scheduled: '2024-05-07',
        deadline: '',
      },
      {
        id: 'waiting-1',
        title: 'Need approval',
        date: '2024-05-08',
        marker: 'WAITING',
        pageName: '2024-05-06',
        pageOriginalName: 'May 6th, 2024',
        blockUuid: 'waiting-1',
        priority: '',
        scheduled: '',
        deadline: '2024-05-08',
      },
      {
        id: 'now-1',
        title: 'Prepare notes',
        date: '2024-05-06',
        marker: 'NOW',
        pageName: '2024-05-06',
        pageOriginalName: 'May 6th, 2024',
        blockUuid: 'now-1',
        priority: 'B',
        scheduled: '',
        deadline: '',
      },
    ]);
  });

  it('extracts open journal tasks from nested child blocks', () => {
    expect(
      extractJournalTasks([
        {
          name: '2024-05-10',
          originalName: 'May 10th, 2024',
          journalDay: '2024-05-10',
          blocks: [
            {
              uuid: 'parent-1',
              content: 'Parent note',
              children: [
                {
                  uuid: 'todo-child-1',
                  content: 'Nested review',
                  marker: 'TODO',
                  priority: 'B',
                  children: [
                    {
                      uuid: 'waiting-grandchild-1',
                      content: 'Nested dependency',
                      marker: 'WAITING',
                      deadline: '2024-05-11',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    ).toEqual<AgendaTask[]>([
      {
        id: 'todo-child-1',
        title: 'Nested review',
        date: '2024-05-10',
        marker: 'TODO',
        pageName: '2024-05-10',
        pageOriginalName: 'May 10th, 2024',
        blockUuid: 'todo-child-1',
        priority: 'B',
        scheduled: '',
        deadline: '',
      },
      {
        id: 'waiting-grandchild-1',
        title: 'Nested dependency',
        date: '2024-05-11',
        marker: 'WAITING',
        pageName: '2024-05-10',
        pageOriginalName: 'May 10th, 2024',
        blockUuid: 'waiting-grandchild-1',
        priority: '',
        scheduled: '',
        deadline: '2024-05-11',
      },
    ]);
  });

  it('loads journal pages through the reader and normalizes their open tasks', async () => {
    const reader = {
      getAllPages: vi.fn(async () => [
        {
          name: '2024-05-06',
          'original-name': 'May 6th, 2024',
          'journal?': true,
          'journal-day': '2024-05-06',
        },
        {
          name: 'projects',
          'original-name': 'projects',
          'journal?': false,
          'journal-day': '2024-05-07',
        },
        {
          name: '2024-05-08',
          'original-name': 'May 8th, 2024',
          'journal?': true,
          'journal-day': '2024-05-08',
        },
      ]),
      getPageBlocksTree: vi.fn(async (name: string) => {
        if (name === '2024-05-06') {
          return [
            {
              uuid: 'todo-1',
              content: 'Review roadmap',
              marker: 'TODO',
              priority: 'A',
              scheduled: '2024-05-07',
            },
            {
              uuid: 'done-1',
              content: 'Already finished',
              marker: 'DONE',
              priority: 'C',
            },
          ];
        }

        if (name === '2024-05-08') {
          return [
            {
              uuid: 'waiting-1',
              content: 'Need approval',
              marker: 'WAITING',
              deadline: '2024-05-09',
            },
            {
              uuid: 'note-1',
              content: 'plain note',
            },
          ];
        }

        return [
          {
            uuid: 'project-1',
            content: 'Project task',
            marker: 'TODO',
          },
        ];
      }),
    };

    await expect(loadJournalTasks(reader)).resolves.toEqual([
      {
        id: 'todo-1',
        title: 'Review roadmap',
        date: '2024-05-07',
        marker: 'TODO',
        pageName: '2024-05-06',
        pageOriginalName: 'May 6th, 2024',
        blockUuid: 'todo-1',
        priority: 'A',
        scheduled: '2024-05-07',
        deadline: '',
      },
      {
        id: 'waiting-1',
        title: 'Need approval',
        date: '2024-05-09',
        marker: 'WAITING',
        pageName: '2024-05-08',
        pageOriginalName: 'May 8th, 2024',
        blockUuid: 'waiting-1',
        priority: '',
        scheduled: '',
        deadline: '2024-05-09',
      },
    ]);

    expect(reader.getAllPages).toHaveBeenCalledTimes(1);
    expect(reader.getPageBlocksTree).toHaveBeenCalledTimes(2);
    expect(reader.getPageBlocksTree).toHaveBeenCalledWith('2024-05-06');
    expect(reader.getPageBlocksTree).toHaveBeenCalledWith('2024-05-08');
  });

  it('loads open tasks from nested journal blocks returned by getPageBlocksTree', async () => {
    const reader = {
      getAllPages: vi.fn(async () => [
        {
          name: '2024-05-10',
          'original-name': 'May 10th, 2024',
          'journal?': true,
          'journal-day': '2024-05-10',
        },
      ]),
      getPageBlocksTree: vi.fn(async () => [
        {
          uuid: 'parent-1',
          content: 'Parent note',
          children: [
            {
              uuid: 'todo-child-1',
              content: 'Nested review',
              marker: 'TODO',
              priority: 'B',
              children: [
                {
                  uuid: 'waiting-grandchild-1',
                  content: 'Nested dependency',
                  marker: 'WAITING',
                  deadline: '2024-05-11',
                },
              ],
            },
          ],
        },
      ]),
    };

    await expect(loadJournalTasks(reader)).resolves.toEqual([
      {
        id: 'todo-child-1',
        title: 'Nested review',
        date: '2024-05-10',
        marker: 'TODO',
        pageName: '2024-05-10',
        pageOriginalName: 'May 10th, 2024',
        blockUuid: 'todo-child-1',
        priority: 'B',
        scheduled: '',
        deadline: '',
      },
      {
        id: 'waiting-grandchild-1',
        title: 'Nested dependency',
        date: '2024-05-11',
        marker: 'WAITING',
        pageName: '2024-05-10',
        pageOriginalName: 'May 10th, 2024',
        blockUuid: 'waiting-grandchild-1',
        priority: '',
        scheduled: '',
        deadline: '2024-05-11',
      },
    ]);

    expect(reader.getPageBlocksTree).toHaveBeenCalledWith('2024-05-10');
  });

  it('loads journal pages using the installed Logseq page entity shape', async () => {
    const reader = {
      getAllPages: vi.fn(async () => [
        {
          name: '2024-05-12',
          originalName: 'May 12th, 2024',
          'journal?': true,
          journalDay: 20240512,
        },
      ]),
      getPageBlocksTree: vi.fn(async () => [
        {
          uuid: 'todo-1',
          content: 'Follow up',
          marker: 'TODO',
        },
      ]),
    };

    await expect(loadJournalTasks(reader)).resolves.toEqual([
      {
        id: 'todo-1',
        title: 'Follow up',
        date: '2024-05-12',
        marker: 'TODO',
        pageName: '2024-05-12',
        pageOriginalName: 'May 12th, 2024',
        blockUuid: 'todo-1',
        priority: '',
        scheduled: '',
        deadline: '',
      },
    ]);
  });
});
