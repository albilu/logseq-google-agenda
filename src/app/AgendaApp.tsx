import { useCallback, useMemo, useRef, useState } from 'react';

import { buildMonthGrid, getOverflowCount, toDateKey } from '../calendar/month-grid';
import { groupEventsByDate } from '../calendar/group-events';
import type { AgendaTask, CalendarEvent, WeatherDay } from '../calendar/types';
import {
  createTranslator,
  formatLocaleDate,
  getFormattingLocale,
  getWeatherConditionLabel,
  getWeekdayLabels,
} from '../i18n';
import type { Snapshot } from '../sync/cache';

type AgendaAppProps = {
  snapshot?: Snapshot | null;
  initialMonth?: Date;
  today?: Date;
  locale?: string;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onClose?: () => void;
  onDateDoubleClick?: (date: Date) => void;
};

const VISIBLE_EVENT_LIMIT = 3;
const MIN_SELECTED_PANEL_RATIO = 0.15;
const MAX_SELECTED_PANEL_RATIO = 0.85;
const KEYBOARD_RESIZE_STEP = 0.05;

type AgendaMode = 'calendar' | 'tasks';

type AgendaItem = CalendarEvent | AgendaTask;

function groupTasksByDate(tasks: AgendaTask[]) {
  return tasks.reduce<Record<string, AgendaTask[]>>((groupedTasks, task) => {
    const existingTasks = groupedTasks[task.date] ?? [];

    groupedTasks[task.date] = [...existingTasks, task];
    return groupedTasks;
  }, {});
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftMonth(date: Date, delta: number) {
  const targetYear = date.getFullYear();
  const targetMonth = date.getMonth() + delta;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

  return new Date(targetYear, targetMonth, Math.min(date.getDate(), lastDayOfTargetMonth));
}

function setDateInMonth(month: Date, dayOfMonth: number) {
  const lastDayOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  return new Date(month.getFullYear(), month.getMonth(), Math.min(dayOfMonth, lastDayOfMonth));
}

function formatMonthHeading(date: Date, locale: string) {
  return formatLocaleDate(locale, date, { month: 'long', year: 'numeric' });
}

function formatDayButtonLabel(date: Date, locale: string) {
  return formatLocaleDate(locale, date, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDayButtonAccessibleLabel(
  date: Date,
  visibleItems: AgendaItem[],
  overflowCount: number,
  locale: string,
  t: ReturnType<typeof createTranslator>,
) {
  const parts = [formatDayButtonLabel(date, locale)];

  if (visibleItems.length > 0) {
    parts.push(visibleItems.map((item) => item.title).join(', '));
  }

  if (overflowCount > 0) {
    parts.push(`+${overflowCount} ${t('agenda.more')}`);
  }

  return parts.join('. ');
}

function formatSyncIssues(errors: Snapshot['errors'], t: ReturnType<typeof createTranslator>) {
  const label = errors.length === 1 ? t('agenda.syncIssue') : t('agenda.syncIssues');
  return `${label}: ${errors.map((error) => error.message).join('; ')}`;
}

function formatSidebarHeading(date: Date, locale: string) {
  return formatLocaleDate(locale, date, { month: 'long', day: 'numeric' });
}

function getWeatherIcon(iconKey: WeatherDay['iconKey']) {
  switch (iconKey) {
    case 'sunny':
      return '☀';
    case 'partly-cloudy':
      return '⛅';
    case 'cloudy':
      return '☁';
    case 'rain':
      return '🌧';
    case 'snow':
      return '❄';
    case 'storm':
      return '⛈';
    default:
      return null;
  }
}

function formatShortDate(date: string | null | undefined, locale: string) {
  if (!date) {
    return null;
  }

  const parsedDate = new Date(`${date}T00:00:00`);

  return formatLocaleDate(locale, parsedDate, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getIsoWeekNumber(date: Date) {
  const target = startOfDay(date);
  const dayOfWeek = (target.getDay() + 6) % 7;

  target.setDate(target.getDate() - dayOfWeek + 3);

  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstThursdayDayOfWeek = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstThursdayDayOfWeek + 3);

  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604800000);
}

function formatEventTime(event: CalendarEvent, locale: string, t: ReturnType<typeof createTranslator>) {
  if (event.allDay) {
    return t('agenda.allDay');
  }

  const timeFormat: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
  };

  const formattingLocale = getFormattingLocale(locale);
  const start = new Intl.DateTimeFormat(formattingLocale, timeFormat).format(new Date(event.start));
  const end = new Intl.DateTimeFormat(formattingLocale, timeFormat).format(new Date(event.end));

  return `${start} \u2013 ${end}`;
}

function isCalendarEvent(item: AgendaItem): item is CalendarEvent {
  return 'start' in item;
}

function clampSelectedPanelRatio(ratio: number) {
  return Math.min(Math.max(ratio, MIN_SELECTED_PANEL_RATIO), MAX_SELECTED_PANEL_RATIO);
}

const DOUBLE_CLICK_THRESHOLD_MS = 400;

export function AgendaApp({
  snapshot = null,
  initialMonth,
  today = new Date(),
  locale,
  isRefreshing = false,
  onClose,
  onDateDoubleClick,
}: AgendaAppProps) {
  const resolvedLocale = locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  const t = createTranslator(resolvedLocale);
  const lastClickRef = useRef<{ dateKey: string; time: number } | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const [selectedPanelRatio, setSelectedPanelRatio] = useState(0.4);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const normalizedToday = startOfDay(today);
  const initialDisplayedMonth = startOfDay(initialMonth ?? normalizedToday);
  const [currentMonth, setCurrentMonth] = useState(initialDisplayedMonth);
  const [selectedDate, setSelectedDate] = useState(
    initialMonth ? setDateInMonth(initialDisplayedMonth, normalizedToday.getDate()) : normalizedToday,
  );
  const [mode, setMode] = useState<AgendaMode>('calendar');

  const eventsByDate = useMemo(
    () => groupEventsByDate(snapshot?.events ?? []),
    [snapshot?.events],
  );
  const tasksByDate = useMemo(
    () => groupTasksByDate(snapshot?.tasks ?? []),
    [snapshot?.tasks],
  );
  const weatherByDate = useMemo(
    () => (snapshot?.weather ?? []).reduce<Record<string, WeatherDay>>((days, day) => {
      days[day.date] = day;
      return days;
    }, {}),
    [snapshot?.weather],
  );
  const monthGrid = useMemo(() => buildMonthGrid(currentMonth), [currentMonth]);
  const weekdayLabels = useMemo(() => getWeekdayLabels(resolvedLocale), [resolvedLocale]);
  const selectedDateKey = toDateKey(selectedDate);
  const selectedItems = mode === 'calendar'
    ? eventsByDate[selectedDateKey] ?? []
    : tasksByDate[selectedDateKey] ?? [];
  const selectedWeather = weatherByDate[selectedDateKey] ?? null;
  const selectedWeatherIcon = selectedWeather ? getWeatherIcon(selectedWeather.iconKey) : null;
  const selectedWeatherLabel = selectedWeather
      ? getWeatherConditionLabel(resolvedLocale, selectedWeather.iconKey, selectedWeather.conditionLabel)
    : null;
  const visibleWeatherDateKeys = useMemo(() => {
    const keys = new Set<string>();

    for (let i = 0; i < 8; i++) {
      const date = new Date(
        normalizedToday.getFullYear(),
        normalizedToday.getMonth(),
        normalizedToday.getDate() + i,
      );
      keys.add(toDateKey(date));
    }

    return keys;
  }, [normalizedToday]);

  const upcomingDays = useMemo(() => {
    const days: Array<{ dateKey: string; label: string; items: AgendaItem[] }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(normalizedToday.getFullYear(), normalizedToday.getMonth(), normalizedToday.getDate() + i);
      const key = toDateKey(d);
      const dayItems = mode === 'calendar'
        ? eventsByDate[key] ?? []
        : tasksByDate[key] ?? [];
      if (dayItems.length > 0) {
        days.push({ dateKey: key, label: formatSidebarHeading(d, resolvedLocale), items: dayItems });
      }
    }
    return days;
  }, [normalizedToday, eventsByDate, tasksByDate, mode, resolvedLocale]);

  function handleShiftMonth(delta: number) {
    const nextMonth = shiftMonth(currentMonth, delta);
    setCurrentMonth(nextMonth);
    setSelectedDate(setDateInMonth(nextMonth, selectedDate.getDate()));
  }

  function handleDayClick(date: Date, dateKey: string) {
    setSelectedDate(date);

    const now = Date.now();
    const last = lastClickRef.current;

    if (last && last.dateKey === dateKey && now - last.time < DOUBLE_CLICK_THRESHOLD_MS) {
      onDateDoubleClick?.(date);
      lastClickRef.current = null;
    } else {
      lastClickRef.current = { dateKey, time: now };
    }
  }

  function handleToday() {
    setCurrentMonth(normalizedToday);
    setSelectedDate(normalizedToday);
  }

  const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsDraggingSidebar(true);
    resizeHandleRef.current = e.currentTarget;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handleResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current || !sidebarRef.current) return;

    const sidebar = sidebarRef.current;
    const rect = sidebar.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    setSelectedPanelRatio(clampSelectedPanelRatio(offsetY / rect.height));
  }, []);

  const handleResizeKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    let nextRatio = selectedPanelRatio;

    if (e.key === 'ArrowUp') {
      nextRatio -= KEYBOARD_RESIZE_STEP;
    } else if (e.key === 'ArrowDown') {
      nextRatio += KEYBOARD_RESIZE_STEP;
    } else if (e.key === 'Home') {
      nextRatio = MIN_SELECTED_PANEL_RATIO;
    } else if (e.key === 'End') {
      nextRatio = MAX_SELECTED_PANEL_RATIO;
    } else {
      return;
    }

    e.preventDefault();
    setSelectedPanelRatio(clampSelectedPanelRatio(nextRatio));
  }, [selectedPanelRatio]);

  const finishResizeDrag = useCallback((pointerId: number) => {
    if (!isDraggingRef.current) {
      return;
    }

    isDraggingRef.current = false;
    setIsDraggingSidebar(false);

    const handle = resizeHandleRef.current;

    if (handle?.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }

    resizeHandleRef.current = null;
  }, []);

  const handleResizePointerUp = useCallback((e: React.PointerEvent) => {
    finishResizeDrag(e.pointerId);
  }, [finishResizeDrag]);

  const handleResizePointerCancel = useCallback((e: React.PointerEvent) => {
    finishResizeDrag(e.pointerId);
  }, [finishResizeDrag]);

  return (
    <main className="agenda-shell">
      <header className="agenda-toolbar">
        <div className="agenda-toolbar__section agenda-toolbar__section--primary">
          <div className="agenda-toolbar__group agenda-toolbar__group--nav">
            <button
              type="button"
              className="agenda-toolbar__icon-button agenda-toolbar__icon-button--nav"
              onClick={() => handleShiftMonth(-1)}
              aria-label={t('agenda.previousMonth')}
            >
              <span aria-hidden="true" className="agenda-toolbar__icon-glyph">&lt;</span>
            </button>
            <button
              type="button"
              className="agenda-toolbar__icon-button agenda-toolbar__icon-button--nav"
              onClick={() => handleShiftMonth(1)}
              aria-label={t('agenda.nextMonth')}
            >
              <span aria-hidden="true" className="agenda-toolbar__icon-glyph">&gt;</span>
            </button>
          </div>
          <h1 className="agenda-toolbar__title">{formatMonthHeading(currentMonth, resolvedLocale)}</h1>
          {isRefreshing ? (
            <span className="agenda-toolbar__spinner" role="status" aria-label={t('agenda.refreshing')}>
              <span className="agenda-toolbar__spinner-dot" aria-hidden="true" />
            </span>
          ) : null}
        </div>

        <div className="agenda-toolbar__section agenda-toolbar__section--secondary">
          <div
            className="agenda-toolbar__group agenda-toolbar__group--views"
            role="group"
            aria-label={t('agenda.mode')}
          >
            <button
              type="button"
              className="agenda-toolbar__button"
              onClick={handleToday}
            >
              {t('agenda.today')}
            </button>
            <button
              type="button"
              className="agenda-toolbar__button"
              aria-pressed={mode === 'calendar'}
              onClick={() => setMode('calendar')}
            >
              {t('agenda.calendar')}
            </button>
            <button
              type="button"
              className="agenda-toolbar__button"
              aria-pressed={mode === 'tasks'}
              onClick={() => setMode('tasks')}
            >
              {t('agenda.tasks')}
            </button>
          </div>
          {onClose ? (
            <button
              type="button"
              className="agenda-toolbar__icon-button agenda-toolbar__icon-button--close"
              onClick={onClose}
              aria-label={t('agenda.close')}
            >
              <span aria-hidden="true" className="agenda-toolbar__icon-glyph">x</span>
            </button>
          ) : null}
        </div>
      </header>

      {snapshot && snapshot.errors.length > 0 ? (
        <section className="agenda-banner" role="status">
          {formatSyncIssues(snapshot.errors, t)}
        </section>
      ) : null}

      <div className="agenda-layout">
        <section className="agenda-calendar" aria-label={t('agenda.monthCalendar')}>
          <div className="agenda-weekdays" aria-hidden="true">
            <span className="agenda-weekdays__week-label">{t('agenda.week')}</span>
            {weekdayLabels.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div className="agenda-grid">
            {monthGrid.map((week) => (
              <div key={week[0].dateKey} className="agenda-week-row">
                <span className="agenda-week-label">{t('agenda.week')} {getIsoWeekNumber(week[0].date)}</span>
                {week.map((day) => {
                  const dayItems = mode === 'calendar'
                    ? eventsByDate[day.dateKey] ?? []
                    : tasksByDate[day.dateKey] ?? [];
                  const dayWeather = visibleWeatherDateKeys.has(day.dateKey) ? weatherByDate[day.dateKey] : null;
                  const weatherIcon = dayWeather ? getWeatherIcon(dayWeather.iconKey) : null;
                  const weatherLabel = dayWeather
                    ? getWeatherConditionLabel(resolvedLocale, dayWeather.iconKey, dayWeather.conditionLabel)
                    : null;
                  const visibleItems = dayItems.slice(0, VISIBLE_EVENT_LIMIT);
                  const overflowCount = getOverflowCount(dayItems.length, VISIBLE_EVENT_LIMIT);
                  const isSelected = day.dateKey === selectedDateKey;

                  return (
                    <button
                      key={day.dateKey}
                      type="button"
                      className={[
                        'agenda-day',
                        day.inCurrentMonth ? '' : 'agenda-day--muted',
                        isSelected ? 'agenda-day--selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={formatDayButtonAccessibleLabel(day.date, visibleItems, overflowCount, resolvedLocale, t)}
                      aria-pressed={isSelected}
                      onClick={() => handleDayClick(day.date, day.dateKey)}
                    >
                      <span className="agenda-day__number-row">
                        <span className="agenda-day__number">{day.date.getDate()}</span>
                        {weatherIcon ? (
                          <span
                            className="agenda-day__weather-icon"
                            role="img"
                            aria-label={weatherLabel ?? undefined}
                          >
                            {weatherIcon}
                          </span>
                        ) : null}
                      </span>
                      <span className="agenda-day__events">
                        {visibleItems.map((item) => (
                          <span key={item.id} className="agenda-event-pill">
                            {item.title}
                          </span>
                        ))}
                        {overflowCount > 0 ? (
                          <span className="agenda-overflow-pill">+{overflowCount} {t('agenda.more')}</span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        <aside
          ref={sidebarRef}
          className={`agenda-sidebar${isDraggingSidebar ? ' agenda-sidebar--resizing' : ''}`}
          aria-label={t('agenda.dayDetails')}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerCancel}
        >
          <section
            className="agenda-sidebar__selected"
            aria-label={t('agenda.selectedDay')}
            style={{ flex: `0 0 ${selectedPanelRatio * 100}%` }}
          >
            <div className="agenda-sidebar__selected-header">
              <h2>{formatSidebarHeading(selectedDate, resolvedLocale)}</h2>
              {selectedWeather ? (
                <div className="agenda-sidebar__weather" aria-label={t('agenda.weatherDetails')}>
                  <p className="agenda-sidebar__weather-temperature">{selectedWeather.temperatureDisplay}</p>
                  <p className="agenda-sidebar__weather-detail agenda-sidebar__weather-condition">
                    {selectedWeatherIcon ? (
                      <span className="agenda-sidebar__weather-icon" aria-hidden="true">
                        {selectedWeatherIcon}
                      </span>
                    ) : null}
                    <span>{selectedWeatherLabel}</span>
                  </p>
                  <p className="agenda-sidebar__weather-detail">
                    {t('agenda.precipitation')} {selectedWeather.precipitationChance}%
                  </p>
                </div>
              ) : null}
            </div>
            {selectedItems.length === 0 ? (
              <div className="agenda-empty-state">{t('agenda.noData')}</div>
            ) : (
              <div className="agenda-event-list">
                {selectedItems.map((item) =>
                  isCalendarEvent(item) ? (
                    <article key={item.id} className="agenda-sidebar__event agenda-sidebar__event--calendar">
                      <div className="agenda-sidebar__event-header">
                        <h3 className="agenda-sidebar__event-title">{item.title}</h3>
                        <p className="agenda-sidebar__calendar">{item.calendarName}</p>
                      </div>
                      <p className="agenda-sidebar__time">{formatEventTime(item, resolvedLocale, t)}</p>
                    </article>
                  ) : (
                    <article key={item.id} className="agenda-sidebar__event agenda-sidebar__event--task">
                      <div className="agenda-sidebar__event-header">
                        <h3 className="agenda-sidebar__event-title">{item.title}</h3>
                        <p className="agenda-sidebar__calendar">{item.pageOriginalName}</p>
                      </div>
                      <div className="agenda-sidebar__task-meta">
                        <p className="agenda-sidebar__time">{item.marker}</p>
                        {item.priority ? (
                          <p className="agenda-sidebar__detail">{t('agenda.priority')} {item.priority}</p>
                        ) : null}
                        {formatShortDate(item.scheduled, resolvedLocale) ? (
                          <p className="agenda-sidebar__detail">
                            {t('agenda.scheduled')} {formatShortDate(item.scheduled, resolvedLocale)}
                          </p>
                        ) : null}
                        {formatShortDate(item.deadline, resolvedLocale) ? (
                          <p className="agenda-sidebar__detail">
                            {t('agenda.due')} {formatShortDate(item.deadline, resolvedLocale)}
                          </p>
                        ) : null}
                      </div>
                    </article>
                  ),
                )}
              </div>
            )}
          </section>

          <div
            className="agenda-sidebar__resize-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('agenda.resizeSidebarSections')}
            aria-valuemin={MIN_SELECTED_PANEL_RATIO * 100}
            aria-valuemax={MAX_SELECTED_PANEL_RATIO * 100}
            aria-valuenow={Math.round(selectedPanelRatio * 100)}
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            onKeyDown={handleResizeKeyDown}
          >
            <span className="agenda-sidebar__resize-grip" aria-hidden="true" />
          </div>

          <section
            className="agenda-sidebar__upcoming"
            aria-label={t('agenda.upcoming')}
            style={{ flex: `1 1 0`, minHeight: `${(1 - selectedPanelRatio) * 100}%` }}
          >
            <h2>{t('agenda.upcoming')}</h2>
            {upcomingDays.length === 0 ? (
              <div className="agenda-empty-state">{t('agenda.nothingUpcoming')}</div>
            ) : (
              <div className="agenda-event-list">
                {upcomingDays.map((day) => (
                  <div key={day.dateKey} className="agenda-sidebar__day-group">
                    <h3 className="agenda-sidebar__day-heading">{day.label}</h3>
                    {day.items.map((item) =>
                      isCalendarEvent(item) ? (
                        <article key={item.id} className="agenda-sidebar__event agenda-sidebar__event--calendar">
                          <div className="agenda-sidebar__event-header">
                            <h3 className="agenda-sidebar__event-title">{item.title}</h3>
                            <p className="agenda-sidebar__calendar">{item.calendarName}</p>
                          </div>
                          <p className="agenda-sidebar__time">{formatEventTime(item, resolvedLocale, t)}</p>
                        </article>
                      ) : (
                        <article key={item.id} className="agenda-sidebar__event agenda-sidebar__event--task">
                          <div className="agenda-sidebar__event-header">
                            <h3 className="agenda-sidebar__event-title">{item.title}</h3>
                            <p className="agenda-sidebar__calendar">{item.pageOriginalName}</p>
                          </div>
                          <div className="agenda-sidebar__task-meta">
                            <p className="agenda-sidebar__time">{item.marker}</p>
                          </div>
                        </article>
                      ),
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
