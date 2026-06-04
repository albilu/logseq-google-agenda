import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AgendaApp } from './AgendaApp';
import type { AgendaTask, CalendarEvent, WeatherDay } from '../calendar/types';
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
    events: overrides.events ?? [],
    tasks: overrides.tasks ?? [],
    weather: overrides.weather ?? [],
    weatherLocation: overrides.weatherLocation ?? null,
    errors: overrides.errors ?? [],
    syncedAt: overrides.syncedAt ?? '2026-04-10T12:00:00.000Z',
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

function createWeatherDay(overrides: Partial<WeatherDay>): WeatherDay {
  return {
    date: '2026-04-15',
    temperatureMin: 12,
    temperatureMax: 20,
    temperatureDisplay: '20C / 12C',
    conditionCode: 1,
    conditionLabel: 'Partly cloudy',
    precipitationChance: 10,
    iconKey: 'partly-cloudy',
    ...overrides,
  };
}

describe('AgendaApp', () => {
  it('renders French copy and locale-aware date labels when the runtime locale is French', () => {
    const originalLanguage = window.navigator.language;

    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      value: 'fr-FR',
    });

    try {
      render(
        <AgendaApp
          initialMonth={new Date(2026, 3, 1)}
          today={new Date(2026, 3, 15)}
        />,
      );

      expect(screen.getByRole('button', { name: 'Mois précédent' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: "Aujourd'hui" })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'avril 2026' })).toBeInTheDocument();
      expect(screen.getByText(/^lun\.?$/i)).toBeInTheDocument();

      expect(screen.getByRole('group', { name: "Mode de l'agenda" })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Fermer' })).not.toBeInTheDocument();

      const sidebar = screen.getByRole('complementary', { name: 'Détails du jour' });
      const selectedSection = within(sidebar).getByRole('region', { name: 'Jour sélectionné' });

      expect(within(selectedSection).getByRole('heading', { name: '15 avril' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /mercredi 15 avril 2026/i })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window.navigator, 'language', {
        configurable: true,
        value: originalLanguage,
      });
    }
  });

  it('localizes weather labels in French from icon keys while preserving fallback labels', async () => {
    const originalLanguage = window.navigator.language;

    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      value: 'fr-FR',
    });

    try {
      const user = userEvent.setup();
      const snapshot = createSnapshot({
        weather: [
          createWeatherDay({
            date: '2026-04-15',
            conditionLabel: 'Partly cloudy',
            iconKey: 'partly-cloudy',
          }),
          createWeatherDay({
            date: '2026-04-16',
            conditionLabel: 'Custom English fallback',
            iconKey: 'unknown',
          }),
        ],
      });

      render(
        <AgendaApp
          snapshot={snapshot}
          initialMonth={new Date(2026, 3, 1)}
          today={new Date(2026, 3, 15)}
        />,
      );

      const sidebar = screen.getByRole('complementary', { name: 'Détails du jour' });
      const selectedSection = within(sidebar).getByRole('region', { name: 'Jour sélectionné' });
      const todayButton = screen.getByRole('button', { name: /mercredi 15 avril 2026/i });
      const fallbackButton = screen.getByRole('button', { name: /jeudi 16 avril 2026/i });

      expect(within(todayButton).getByLabelText('Partiellement nuageux')).toBeInTheDocument();
      expect(within(todayButton).queryByLabelText('Partly cloudy')).not.toBeInTheDocument();
      expect(within(selectedSection).getByText('Partiellement nuageux')).toBeInTheDocument();
      expect(within(selectedSection).queryByText('Partly cloudy')).not.toBeInTheDocument();

      await user.click(fallbackButton);

      expect(within(selectedSection).getByText('Custom English fallback')).toBeInTheDocument();
    } finally {
      Object.defineProperty(window.navigator, 'language', {
        configurable: true,
        value: originalLanguage,
      });
    }
  });

  it('falls back to English panel formatting for unsupported locales', () => {
    const originalLanguage = window.navigator.language;

    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      value: 'es-ES',
    });

    try {
      render(
        <AgendaApp
          initialMonth={new Date(2026, 3, 1)}
          today={new Date(2026, 3, 15)}
        />,
      );

      expect(screen.getByRole('heading', { name: 'April 2026' })).toBeInTheDocument();
      expect(screen.getByText('Mon')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Wednesday, April 15, 2026/i })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window.navigator, 'language', {
        configurable: true,
        value: originalLanguage,
      });
    }
  });

  it('does not render a close button when no close handler is provided', () => {
    render(
      <AgendaApp
        initialMonth={new Date(2026, 3, 1)}
        today={new Date(2026, 3, 15)}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('keeps the month-grid weather badge footprint while only enlarging the glyph', () => {
    const styles = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
    const weatherIconRuleMatch = styles.match(/\.agenda-day__weather-icon\s*\{([\s\S]*?)\}/);

    expect(weatherIconRuleMatch).not.toBeNull();

    const weatherIconRule = weatherIconRuleMatch?.[1] ?? '';

    expect(weatherIconRule).toContain('width: 1.25rem;');
    expect(weatherIconRule).toContain('height: 1.25rem;');
    expect(weatherIconRule).toContain('font-size: 0.8rem;');
  });

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
        initialMonth={new Date(2026, 3, 1)}
        today={new Date(2026, 3, 15)}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('group', { name: 'Agenda mode' })).toBeInTheDocument();
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
        initialMonth={new Date(2026, 3, 1)}
        today={new Date(2026, 3, 15)}
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
        initialMonth={new Date(2026, 3, 1)}
        today={new Date(2026, 3, 15)}
      />,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Day details' });
    const selectedSection = within(sidebar).getByRole('region', { name: 'Selected day' });

    await user.click(screen.getByRole('button', { name: 'Tasks' }));

    expect(within(selectedSection).getByRole('heading', { name: 'Write weekly summary' })).toBeInTheDocument();
    expect(within(selectedSection).getByText('DOING')).toBeInTheDocument();
    expect(within(selectedSection).queryByText(/^Priority$/)).not.toBeInTheDocument();
  });

  it('renders weather in the month grid for today through the next seven days and shows selected-day details', async () => {
    const user = userEvent.setup();

    const snapshot = createSnapshot({
      weatherLocation: {
        query: 'Paris',
        resolvedName: 'Paris, France',
        latitude: 48.8566,
        longitude: 2.3522,
      },
      weather: [
        createWeatherDay({
          date: '2026-04-14',
          temperatureDisplay: '18C / 11C',
          conditionLabel: 'Sunny',
          precipitationChance: 5,
          iconKey: 'sunny',
        }),
        createWeatherDay({
          date: '2026-04-15',
          temperatureDisplay: '20C / 12C',
          conditionLabel: 'Partly cloudy',
          precipitationChance: 10,
          iconKey: 'partly-cloudy',
        }),
        createWeatherDay({
          date: '2026-04-22',
          temperatureDisplay: '16C / 9C',
          conditionLabel: 'Rain',
          precipitationChance: 70,
          iconKey: 'rain',
        }),
        createWeatherDay({
          date: '2026-04-23',
          temperatureDisplay: '14C / 8C',
          conditionLabel: 'Cloudy',
          precipitationChance: 20,
          iconKey: 'unknown',
        }),
      ],
    });

    const { container } = render(
      <AgendaApp
        snapshot={snapshot}
        initialMonth={new Date(2026, 3, 1)}
        today={new Date(2026, 3, 15)}
      />,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Day details' });
    const selectedSection = within(sidebar).getByRole('region', { name: 'Selected day' });
    const yesterdayButton = screen.getByRole('button', { name: /Tuesday, April 14, 2026/i });
    const todayButton = screen.getByRole('button', { name: /Wednesday, April 15, 2026/i });
    const lastForecastButton = screen.getByRole('button', { name: /Wednesday, April 22, 2026/i });
    const outOfRangeButton = screen.getByRole('button', { name: /Thursday, April 23, 2026/i });
    const noWeatherButton = screen.getByRole('button', { name: /Friday, April 24, 2026/i });

    expect(container.querySelectorAll('.agenda-day__weather-icon')).toHaveLength(2);
    expect(within(todayButton).getByLabelText('Partly cloudy')).toBeInTheDocument();
    expect(within(todayButton).getByText('⛅')).toBeInTheDocument();
    expect(within(lastForecastButton).getByLabelText('Rain')).toBeInTheDocument();
    expect(within(lastForecastButton).getByText('🌧')).toBeInTheDocument();
    expect(within(selectedSection).getByText('20C / 12C')).toBeInTheDocument();
    const selectedWeatherDetail = within(selectedSection).getByText('Partly cloudy').closest('p');
    const selectedWeatherIcon = selectedWeatherDetail?.firstElementChild as HTMLElement | null;
    const selectedWeatherLabel = selectedWeatherIcon?.nextElementSibling as HTMLElement | null;

    expect(selectedWeatherDetail).not.toBeNull();
    expect(selectedWeatherIcon).not.toBeNull();
    expect(selectedWeatherIcon).toHaveTextContent('⛅');
    expect(selectedWeatherIcon).toHaveAttribute('aria-hidden', 'true');
    expect(selectedWeatherLabel).not.toBeNull();
    expect(selectedWeatherLabel).toHaveTextContent('Partly cloudy');
    expect(within(selectedSection).getByText('Precipitation 10%')).toBeInTheDocument();
    expect(within(yesterdayButton).queryByLabelText('Sunny')).not.toBeInTheDocument();
    expect(within(outOfRangeButton).queryByLabelText('Cloudy')).not.toBeInTheDocument();

    await user.click(outOfRangeButton);

    expect(within(selectedSection).getByRole('heading', { name: 'April 23' })).toBeInTheDocument();
    expect(within(selectedSection).getByText('14C / 8C')).toBeInTheDocument();
    expect(within(selectedSection).getByText('Cloudy')).toBeInTheDocument();
    expect(within(selectedSection).getByText('Cloudy').closest('p')?.querySelector('.agenda-sidebar__weather-icon')).toBeNull();
    expect(within(selectedSection).getByText('Precipitation 20%')).toBeInTheDocument();

    await user.click(noWeatherButton);

    expect(within(selectedSection).getByRole('heading', { name: 'April 24' })).toBeInTheDocument();
    expect(within(selectedSection).queryByText('14C / 8C')).not.toBeInTheDocument();
    expect(within(selectedSection).queryByText('Cloudy')).not.toBeInTheDocument();
    expect(within(selectedSection).queryByText('Precipitation 20%')).not.toBeInTheDocument();
  });

  it('renders reference-like toolbar controls and arrow month navigation', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      render(
        <AgendaApp
          initialMonth={new Date(2026, 3, 1)}
          today={new Date(2026, 3, 15)}
          onClose={onClose}
        />,
      );

      const toolbar = screen.getByRole('banner');
      const previousButton = within(toolbar).getByRole('button', { name: 'Previous month' });
      const nextButton = within(toolbar).getByRole('button', { name: 'Next month' });
      const closeButton = within(toolbar).getByRole('button', { name: 'Close' });
      const todayButton = within(toolbar).getByRole('button', { name: 'Today' });
      const modeGroup = within(toolbar).getByRole('group', { name: 'Agenda mode' });

      expect(within(toolbar).queryByText('Month')).not.toBeInTheDocument();
      expect(within(modeGroup).getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
      expect(within(modeGroup).getByRole('button', { name: 'Tasks' })).toBeInTheDocument();
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

      await user.click(screen.getByRole('button', { name: /Wednesday, April 15, 2026/i }));
      expect(logSpy).not.toHaveBeenCalled();

      await user.click(closeButton);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('updates resize styling and panel size during sidebar pointer interactions', () => {
    const originalSetPointerCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture');
    const originalHasPointerCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture');
    const originalReleasePointerCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'releasePointerCapture');
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const hasPointerCapture = vi.fn().mockReturnValue(false);

    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: setPointerCapture,
    });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: hasPointerCapture,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: releasePointerCapture,
    });

    try {
      render(
        <AgendaApp
          initialMonth={new Date(2026, 3, 1)}
          today={new Date(2026, 3, 15)}
        />,
      );

      const sidebar = screen.getByRole('complementary', { name: 'Day details' });
      const selectedSection = within(sidebar).getByRole('region', { name: 'Selected day' });
      const resizeHandle = within(sidebar).getByRole('separator', { name: 'Resize sidebar sections' });
      const resizeGrip = within(resizeHandle).getByText('', { selector: '.agenda-sidebar__resize-grip' });

      vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        top: 100,
        left: 0,
        right: 320,
        bottom: 500,
        width: 320,
        height: 400,
        toJSON: () => ({}),
      });

      expect(sidebar).not.toHaveClass('agenda-sidebar--resizing');
      expect(resizeHandle).toHaveAttribute('aria-orientation', 'horizontal');
      expect(resizeHandle).toHaveAttribute('aria-valuemin', '15');
      expect(resizeHandle).toHaveAttribute('aria-valuemax', '85');
      expect(resizeHandle).toHaveAttribute('aria-valuenow', '40');
      expect(selectedSection).toHaveStyle({ flex: '0 0 40%' });

      fireEvent.pointerDown(resizeGrip, { pointerId: 7 });

      expect(sidebar).toHaveClass('agenda-sidebar--resizing');
      expect(setPointerCapture).toHaveBeenCalledTimes(1);
      expect(setPointerCapture.mock.instances[0]).toBe(resizeHandle);
      expect(setPointerCapture).toHaveBeenCalledWith(7);

      hasPointerCapture.mockImplementation((pointerId: number) => pointerId === 7);

      fireEvent.pointerMove(sidebar, { pointerId: 7, clientY: 380 });

      expect(selectedSection).toHaveStyle({ flex: '0 0 70%' });

      fireEvent.keyDown(resizeHandle, { key: 'ArrowUp' });

      expect(resizeHandle).toHaveAttribute('aria-valuenow', '65');

      fireEvent.keyDown(resizeHandle, { key: 'ArrowDown' });

      expect(selectedSection).toHaveStyle({ flex: '0 0 70%' });
      expect(resizeHandle).toHaveAttribute('aria-valuenow', '70');

      fireEvent.pointerUp(sidebar, { pointerId: 7 });

      expect(sidebar).not.toHaveClass('agenda-sidebar--resizing');
      expect(hasPointerCapture.mock.instances[0]).toBe(resizeHandle);
      expect(hasPointerCapture).toHaveBeenCalledWith(7);
      expect(releasePointerCapture.mock.instances[0]).toBe(resizeHandle);
      expect(releasePointerCapture).toHaveBeenCalledTimes(1);
      expect(releasePointerCapture).toHaveBeenCalledWith(7);

      fireEvent.pointerCancel(sidebar, { pointerId: 8 });

      expect(releasePointerCapture).toHaveBeenCalledTimes(1);
    } finally {
      if (originalSetPointerCapture) {
        Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', originalSetPointerCapture);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
      }

      if (originalHasPointerCapture) {
        Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', originalHasPointerCapture);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture');
      }

      if (originalReleasePointerCapture) {
        Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', originalReleasePointerCapture);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'releasePointerCapture');
      }
    }
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
        initialMonth={new Date(2026, 0, 1)}
        today={new Date(2026, 0, 31)}
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
        initialMonth={new Date(2026, 3, 1)}
        today={new Date(2026, 3, 15)}
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
        initialMonth={new Date(2026, 2, 1)}
        today={new Date(2026, 3, 15)}
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
        initialMonth={new Date(2026, 3, 1)}
        today={new Date(2026, 3, 15)}
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
        initialMonth={new Date(2026, 3, 1)}
        today={new Date(2026, 3, 15)}
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
        initialMonth={new Date(2026, 3, 1)}
        today={new Date(2026, 3, 15)}
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
        initialMonth={new Date(2026, 3, 1)}
        today={new Date(2026, 3, 15)}
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
        initialMonth={new Date(2026, 3, 1)}
        today={new Date(2026, 3, 15)}
      />,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Day details' });
    const resizeHandle = within(sidebar).getByRole('separator', { name: 'Resize sidebar sections' });

    expect(resizeHandle).toBeInTheDocument();
    expect(resizeHandle).toHaveAttribute('aria-orientation', 'horizontal');
    expect(resizeHandle).toHaveAttribute('tabindex', '0');
    expect(resizeHandle).toHaveAttribute('aria-valuemin', '15');
    expect(resizeHandle).toHaveAttribute('aria-valuemax', '85');
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '40');
    expect(resizeHandle).toHaveClass('agenda-sidebar__resize-handle');
  });

});
