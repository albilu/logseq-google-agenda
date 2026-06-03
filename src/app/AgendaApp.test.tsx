import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AgendaApp } from './AgendaApp';
import type { AgendaTask, CalendarEvent } from '../calendar/types';
import type { Snapshot } from '../sync/cache';

function createEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'event-1',
    sourceUrl: 'https://calendar.example.com/engineering',
    calendarName: 'Engineering',
    title: 'Team Sync',
    start: '2026-04-10T09:00:00.000Z',
    end: '2026-04-10T10:00:00.000Z',
    allDay: false,
    location: '',
    description: '',
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    events: [],
    tasks: [],
    errors: [],
    syncedAt: '2026-04-10T12:00:00.000Z',
    ...overrides,
  };
}

function createTask(overrides: Partial<AgendaTask>): AgendaTask {
  return {
    id: 'task-1',
    title: 'Review sprint board',
    date: '2026-04-15',
    marker: 'TODO',
    pageName: 'apr-15th-2026',
    pageOriginalName: 'Apr 15th, 2026',
    blockUuid: 'block-1',
    priority: 'B',
    scheduled: '',
    deadline: '',
    ...overrides,
  };
}

describe('AgendaApp', () => {
  it('renders the month calendar, sync banner, event overflow, and sidebar details', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const snapshot = createSnapshot({
      errors: [
        { sourceUrl: 'https://calendar.example.com/ops', message: 'Feed unavailable' },
        { sourceUrl: 'https://calendar.example.com/design', message: 'Rate limited' },
      ],
      events: [
        createEvent({ id: 'event-1', title: 'Standup', start: '2026-04-10T08:00:00.000Z', end: '2026-04-10T08:30:00.000Z' }),
        createEvent({ id: 'event-2', title: 'Planning', start: '2026-04-10T09:00:00.000Z', end: '2026-04-10T10:00:00.000Z' }),
        createEvent({ id: 'event-3', title: 'Lunch', start: '2026-04-10T12:00:00.000Z', end: '2026-04-10T13:00:00.000Z' }),
        createEvent({ id: 'event-4', title: 'Retro', start: '2026-04-10T15:00:00.000Z', end: '2026-04-10T16:00:00.000Z' }),
        createEvent({ id: 'event-5', title: 'Demo', start: '2026-04-15T10:00:00.000Z', end: '2026-04-15T11:00:00.000Z' }),
      ],
    });

    render(
      <AgendaApp
        snapshot={snapshot}
        initialMonth={new Date('2026-04-01T00:00:00.000Z')}
        today={new Date('2026-04-15T00:00:00.000Z')}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('heading', { name: 'April 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByText('Sync issues: Feed unavailable; Rate limited')).toBeInTheDocument();

    for (const weekday of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getByText(weekday)).toBeInTheDocument();
    }

    const selectedDay = screen.getByRole('button', { name: /Wednesday, April 15, 2026/i });
    expect(selectedDay).toHaveAttribute('aria-pressed', 'true');
    expect(within(selectedDay).getByText('Demo')).toBeInTheDocument();

    const overflowDay = screen.getByRole(
      'button',
      { name: /Friday, April 10, 2026.*Standup.*Planning.*Lunch.*\+1 more/i },
    );
    expect(within(overflowDay).getByText('Standup')).toBeInTheDocument();
    expect(within(overflowDay).getByText('Planning')).toBeInTheDocument();
    expect(within(overflowDay).getByText('Lunch')).toBeInTheDocument();
    expect(within(overflowDay).getByText('+1 more')).toBeInTheDocument();

    const sidebar = screen.getByRole('complementary', { name: 'Day details' });
    const selectedSection = within(sidebar).getByRole('region', { name: 'Selected day' });
    expect(within(selectedSection).getByRole('heading', { name: 'April 15' })).toBeInTheDocument();
    expect(within(selectedSection).getByText('Engineering')).toBeInTheDocument();
    expect(within(selectedSection).getByRole('heading', { name: 'Demo' })).toBeInTheDocument();

    await user.click(overflowDay);

    expect(within(selectedSection).getByRole('heading', { name: 'April 10' })).toBeInTheDocument();
    expect(within(selectedSection).getAllByText('Engineering')).toHaveLength(4);
    expect(within(selectedSection).getByRole('heading', { name: 'Retro' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next month' }));

    expect(screen.getByRole('heading', { name: 'May 2026' })).toBeInTheDocument();
    const sidebarSelected = within(sidebar).getAllByText('No data');
    expect(sidebarSelected.length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('button', { name: 'Today' }));

    expect(screen.getByRole('heading', { name: 'April 2026' })).toBeInTheDocument();
    expect(within(selectedSection).getByRole('heading', { name: 'April 15' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches between calendar events and tasks while keeping the month shell', async () => {
    const user = userEvent.setup();

    const snapshot = createSnapshot({
      events: [
        createEvent({
          id: 'event-1',
          title: 'Calendar planning',
          start: '2026-04-15T09:00:00.000Z',
          end: '2026-04-15T10:00:00.000Z',
        }),
      ],
      tasks: [
        createTask({
          id: 'task-1',
          title: 'Write weekly summary',
          date: '2026-04-15',
          marker: 'DOING',
          priority: 'A',
          scheduled: '2026-04-15',
          deadline: '2026-04-16',
        }),
      ],
    });

    render(
      <AgendaApp
        snapshot={snapshot}
        initialMonth={new Date('2026-04-01T00:00:00.000Z')}
        today={new Date('2026-04-15T00:00:00.000Z')}
      />,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Day details' });
    const selectedSection = within(sidebar).getByRole('region', { name: 'Selected day' });
    const calendarTab = screen.getByRole('button', { name: 'Calendar' });
    const tasksTab = screen.getByRole('button', { name: 'Tasks' });

    expect(screen.getByRole('heading', { name: 'April 2026' })).toBeInTheDocument();
    expect(screen.getByText('Week 14')).toBeInTheDocument();
    expect(screen.getByText('Week 18')).toBeInTheDocument();
    expect(calendarTab).toHaveAttribute('aria-pressed', 'true');
    expect(tasksTab).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Wednesday, April 15, 2026.*Calendar planning/i })).toBeInTheDocument();
    expect(within(selectedSection).getByRole('heading', { name: 'Calendar planning' })).toBeInTheDocument();
    expect(within(selectedSection).queryByRole('heading', { name: 'Write weekly summary' })).not.toBeInTheDocument();

    await user.click(tasksTab);

    expect(screen.getByRole('heading', { name: 'April 2026' })).toBeInTheDocument();
    expect(calendarTab).toHaveAttribute('aria-pressed', 'false');
    expect(tasksTab).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Wednesday, April 15, 2026.*Write weekly summary/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Wednesday, April 15, 2026.*Calendar planning/i })).not.toBeInTheDocument();
    expect(within(selectedSection).getByRole('heading', { name: 'Write weekly summary' })).toBeInTheDocument();
    expect(within(selectedSection).getByText('DOING')).toBeInTheDocument();
    expect(within(selectedSection).getByText('Priority A')).toBeInTheDocument();
    expect(within(selectedSection).getByText('Scheduled Apr 15, 2026')).toBeInTheDocument();
    expect(within(selectedSection).getByText('Due Apr 16, 2026')).toBeInTheDocument();
    expect(within(selectedSection).queryByRole('heading', { name: 'Calendar planning' })).not.toBeInTheDocument();
  });

  it('omits the priority row for tasks without a priority value', async () => {
    const user = userEvent.setup();

    const snapshot = createSnapshot({
      tasks: [
        createTask({
          title: 'Write weekly summary',
          date: '2026-04-15',
          marker: 'DOING',
          priority: '',
        }),
      ],
    });

    render(
      <AgendaApp
        snapshot={snapshot}
        initialMonth={new Date('2026-04-01T00:00:00.000Z')}
        today={new Date('2026-04-15T00:00:00.000Z')}
      />,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Day details' });
    const selectedSection = within(sidebar).getByRole('region', { name: 'Selected day' });

    await user.click(screen.getByRole('button', { name: 'Tasks' }));

    expect(within(selectedSection).getByRole('heading', { name: 'Write weekly summary' })).toBeInTheDocument();
    expect(within(selectedSection).getByText('DOING')).toBeInTheDocument();
    expect(within(selectedSection).queryByText(/^Priority$/)).not.toBeInTheDocument();
  });

  it('renders reference-like toolbar controls and arrow month navigation', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    render(
      <AgendaApp
        initialMonth={new Date('2026-04-01T00:00:00.000Z')}
        today={new Date('2026-04-15T00:00:00.000Z')}
        onClose={onClose}
      />,
    );

    const toolbar = screen.getByRole('banner');
    const previousButton = within(toolbar).getByRole('button', { name: 'Previous month' });
    const nextButton = within(toolbar).getByRole('button', { name: 'Next month' });
    const closeButton = within(toolbar).getByRole('button', { name: 'Close' });
    const todayButton = within(toolbar).getByRole('button', { name: 'Today' });

    expect(within(toolbar).queryByText('Month')).not.toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Tasks' })).toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(closeButton).toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Prev' })).not.toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(previousButton).toHaveClass('agenda-toolbar__icon-button', 'agenda-toolbar__icon-button--nav');
    expect(nextButton).toHaveClass('agenda-toolbar__icon-button', 'agenda-toolbar__icon-button--nav');
    expect(closeButton).toHaveClass('agenda-toolbar__icon-button', 'agenda-toolbar__icon-button--close');
    expect(todayButton).toHaveClass('agenda-toolbar__button');

    await user.click(previousButton);
    expect(screen.getByRole('heading', { name: 'March 2026' })).toBeInTheDocument();

    await user.click(nextButton);
    expect(screen.getByRole('heading', { name: 'April 2026' })).toBeInTheDocument();

    await user.click(nextButton);
    expect(screen.getByRole('heading', { name: 'May 2026' })).toBeInTheDocument();

    await user.click(todayButton);
    expect(screen.getByRole('heading', { name: 'April 2026' })).toBeInTheDocument();
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Today button clicked', {
      currentMonthBefore: '2026-05',
      today: '2026-04-15',
    });
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Toolbar layout measured', expect.objectContaining({
      hasPrimarySection: true,
      hasSecondarySection: true,
      hasTodayButton: true,
    }));

    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps month navigation inside the target month when moving from a 31st', async () => {
    const user = userEvent.setup();

    const snapshot = createSnapshot({
      events: [
        createEvent({
          id: 'event-31',
          title: 'Month End Review',
          start: '2026-01-31T09:00:00.000Z',
          end: '2026-01-31T10:00:00.000Z',
        }),
        createEvent({
          id: 'event-28',
          title: 'February Close',
          start: '2026-02-28T09:00:00.000Z',
          end: '2026-02-28T10:00:00.000Z',
        }),
      ],
    });

    render(
      <AgendaApp
        snapshot={snapshot}
        initialMonth={new Date('2026-01-01T00:00:00.000Z')}
        today={new Date('2026-01-31T00:00:00.000Z')}
      />,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Day details' });
    const selectedSection = within(sidebar).getByRole('region', { name: 'Selected day' });

    expect(screen.getByRole('heading', { name: 'January 2026' })).toBeInTheDocument();
    expect(within(selectedSection).getByRole('heading', { name: 'January 31' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next month' }));

    expect(screen.getByRole('heading', { name: 'February 2026' })).toBeInTheDocument();
    expect(within(selectedSection).getByRole('heading', { name: 'February 28' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Saturday, February 28, 2026/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(selectedSection).getByRole('heading', { name: 'February Close' })).toBeInTheDocument();
  });

  it('keeps selected details inside the displayed month after navigating from a spillover day', async () => {
    const user = userEvent.setup();

    const snapshot = createSnapshot({
      events: [
        createEvent({
          id: 'event-mar-31',
          title: 'March Wrap',
          start: '2026-03-31T09:00:00.000Z',
          end: '2026-03-31T10:00:00.000Z',
        }),
        createEvent({
          id: 'event-apr-30',
          title: 'April Close',
          start: '2026-04-30T09:00:00.000Z',
          end: '2026-04-30T10:00:00.000Z',
        }),
      ],
    });

    render(
      <AgendaApp
        snapshot={snapshot}
        initialMonth={new Date('2026-04-01T00:00:00.000Z')}
        today={new Date('2026-04-15T00:00:00.000Z')}
      />,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Day details' });
    const selectedSection = within(sidebar).getByRole('region', { name: 'Selected day' });
    const spilloverDay = screen.getByRole('button', { name: /Tuesday, March 31, 2026/i });

    await user.click(spilloverDay);

    expect(within(selectedSection).getByRole('heading', { name: 'March 31' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next month' }));

    expect(screen.getByRole('heading', { name: 'May 2026' })).toBeInTheDocument();
    expect(within(selectedSection).getByRole('heading', { name: 'May 31' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sunday, May 31, 2026/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: /Thursday, April 30, 2026/i, pressed: true })).not.toBeInTheDocument();
  });

  it('initializes the selected day inside the displayed month when initialMonth differs from today', () => {
    const snapshot = createSnapshot({
      events: [
        createEvent({
          id: 'event-mar-15',
          title: 'March Planning',
          start: '2026-03-15T09:00:00.000Z',
          end: '2026-03-15T10:00:00.000Z',
        }),
        createEvent({
          id: 'event-apr-15',
          title: 'April Planning',
          start: '2026-04-15T09:00:00.000Z',
          end: '2026-04-15T10:00:00.000Z',
        }),
      ],
    });

    render(
      <AgendaApp
        snapshot={snapshot}
        initialMonth={new Date('2026-03-01T00:00:00.000Z')}
        today={new Date('2026-04-15T00:00:00.000Z')}
      />,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Day details' });
    const selectedSection = within(sidebar).getByRole('region', { name: 'Selected day' });

    expect(screen.getByRole('heading', { name: 'March 2026' })).toBeInTheDocument();
    expect(within(selectedSection).getByRole('heading', { name: 'March 15' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sunday, March 15, 2026/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(selectedSection).getByRole('heading', { name: 'March Planning' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Wednesday, April 15, 2026/i, pressed: true })).not.toBeInTheDocument();
  });

  it('renders all sync errors in the status message', () => {
    render(
      <AgendaApp
        snapshot={createSnapshot({
          errors: [
            { sourceUrl: 'https://calendar.example.com/ops', message: 'Feed unavailable' },
            { sourceUrl: 'https://calendar.example.com/design', message: 'Rate limited' },
            { sourceUrl: 'https://calendar.example.com/sales', message: 'Unauthorized' },
          ],
        })}
        initialMonth={new Date('2026-04-01T00:00:00.000Z')}
        today={new Date('2026-04-15T00:00:00.000Z')}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Sync issues: Feed unavailable; Rate limited; Unauthorized',
    );
  });

  it('calls onDateDoubleClick when a day button is clicked twice rapidly', async () => {
    const user = userEvent.setup();
    const onDateDoubleClick = vi.fn();

    render(
      <AgendaApp
        snapshot={createSnapshot()}
        initialMonth={new Date('2026-04-01T00:00:00.000Z')}
        today={new Date('2026-04-15T00:00:00.000Z')}
        onDateDoubleClick={onDateDoubleClick}
      />,
    );

    const dayButton = screen.getByRole('button', { name: /Wednesday, April 15, 2026/i });

    // Two rapid clicks on the same day = double-click
    await user.click(dayButton);
    await user.click(dayButton);

    expect(onDateDoubleClick).toHaveBeenCalledTimes(1);
    expect(onDateDoubleClick).toHaveBeenCalledWith(expect.any(Date));
    expect(onDateDoubleClick.mock.calls[0][0].getDate()).toBe(15);
  });

  it('does not call onDateDoubleClick for a single click', async () => {
    const user = userEvent.setup();
    const onDateDoubleClick = vi.fn();

    render(
      <AgendaApp
        snapshot={createSnapshot()}
        initialMonth={new Date('2026-04-01T00:00:00.000Z')}
        today={new Date('2026-04-15T00:00:00.000Z')}
        onDateDoubleClick={onDateDoubleClick}
      />,
    );

    const dayButton = screen.getByRole('button', { name: /Wednesday, April 15, 2026/i });

    await user.click(dayButton);

    expect(onDateDoubleClick).not.toHaveBeenCalled();
  });

  it('does not call onDateDoubleClick when clicking two different days', async () => {
    const user = userEvent.setup();
    const onDateDoubleClick = vi.fn();

    render(
      <AgendaApp
        snapshot={createSnapshot()}
        initialMonth={new Date('2026-04-01T00:00:00.000Z')}
        today={new Date('2026-04-15T00:00:00.000Z')}
        onDateDoubleClick={onDateDoubleClick}
      />,
    );

    const day15 = screen.getByRole('button', { name: /Wednesday, April 15, 2026/i });
    const day16 = screen.getByRole('button', { name: /Thursday, April 16, 2026/i });

    await user.click(day15);
    await user.click(day16);

    expect(onDateDoubleClick).not.toHaveBeenCalled();
  });

  it('renders a resize handle between selected and upcoming sections', () => {
    render(
      <AgendaApp
        snapshot={createSnapshot()}
        initialMonth={new Date('2026-04-01T00:00:00.000Z')}
        today={new Date('2026-04-15T00:00:00.000Z')}
      />,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Day details' });
    const resizeHandle = within(sidebar).getByRole('separator', { name: 'Resize sidebar sections' });

    expect(resizeHandle).toBeInTheDocument();
    expect(resizeHandle).toHaveAttribute('aria-orientation', 'horizontal');
    expect(resizeHandle).toHaveClass('agenda-sidebar__resize-handle');
  });

});
