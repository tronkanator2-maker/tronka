import {test, expect} from 'bun:test';
import {parseDate, ageAt} from '../engine.ts';
test('date handling', () => {expect(parseDate('29.02.2024')).not.toBeNull();expect(parseDate('29.02.2025')).toBeNull();expect(ageAt('17.10.2008', new Date('2026-10-17T00:00:00Z'))).toBe(18);});
