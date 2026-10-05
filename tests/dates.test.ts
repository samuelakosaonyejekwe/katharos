import { describe, expect, it } from 'vitest';
import { addMonths, addWorkingDays, cyprusHolidays, isWorkingDay, orthodoxEaster, workingDaysApart } from '../src/core/dates';

describe('Cyprus calendar', () => {
  it('computes Orthodox Easter', () => {
    expect(orthodoxEaster(2026)).toBe('2026-04-12');
    expect(orthodoxEaster(2025)).toBe('2025-04-20');
    expect(orthodoxEaster(2027)).toBe('2027-05-02');
  });
  it('lists moveable feasts from Easter', () => {
    const d = cyprusHolidays(2026).map((h) => h.date);
    expect(d).toContain('2026-02-23'); // Green Monday
    expect(d).toContain('2026-04-10'); // Good Friday
    expect(d).toContain('2026-04-13'); // Easter Monday
    expect(d).toContain('2026-06-01'); // Kataklysmos
  });
  it('counts working days either side, skipping weekends and holidays', () => {
    expect(workingDaysApart('2026-04-09', '2026-04-15')).toBe(1); // Fri hol, Mon hol, Tue service hol, Wed
    expect(workingDaysApart('2026-04-15', '2026-04-09')).toBe(1);
    expect(workingDaysApart('2026-04-09', '2026-04-15', false)).toBe(2); // Easter Tuesday counted
    expect(isWorkingDay('2026-10-01')).toBe(false);
    expect(addWorkingDays('2026-09-28', 5)).toBe('2026-10-06');
  });
  it('adds calendar months clamped to month end', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-01-15', 6)).toBe('2026-07-15');
  });
});
