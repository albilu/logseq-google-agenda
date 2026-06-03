import { buildMonthGrid, getOverflowCount, toDateKey } from './month-grid';

describe('toDateKey', () => {
  it('formats a local date as yyyy-mm-dd', () => {
    expect(toDateKey(new Date(2024, 4, 6, 15, 30))).toBe('2024-05-06');
  });
});

describe('buildMonthGrid', () => {
  it('builds a monday-first six-week grid as weeks of day cells', () => {
    const grid = buildMonthGrid(new Date(2024, 4, 1)) as unknown[];

    expect(grid).toHaveLength(6);

    for (const week of grid) {
      expect(week).toHaveLength(7);
    }

    expect((grid[0] as any[])[0]).toMatchObject({
      dateKey: '2024-04-29',
      inCurrentMonth: false,
    });
    expect((grid[0] as any[])[2]).toMatchObject({
      dateKey: '2024-05-01',
      inCurrentMonth: true,
    });
    expect((grid[5] as any[])[6]).toMatchObject({
      dateKey: '2024-06-09',
      inCurrentMonth: false,
    });
  });
});

describe('getOverflowCount', () => {
  it('returns the number of hidden events beyond the default visible limit', () => {
    expect(getOverflowCount(5)).toBe(2);
  });

  it('clamps the overflow count at zero', () => {
    expect(getOverflowCount(2)).toBe(0);
  });
});
