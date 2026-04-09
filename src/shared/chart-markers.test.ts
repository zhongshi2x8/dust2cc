import { describe, expect, it } from 'vitest';
import { getVisibleChartMarkerPoints } from './chart-markers';

describe('getVisibleChartMarkerPoints', () => {
  const points = [
    { kind: 'latest', value: 190.8 },
    { kind: 'target', value: 195.8 },
    { kind: 'ma20', value: 185.1 },
    { kind: 'buy_zone', value: 175.4 },
    { kind: 'support', value: 174.4 },
    { kind: 'stop_loss', value: 170.5 },
    { kind: 'low', value: 108.5 },
  ];

  it('keeps the full marker set for steamdt charts', () => {
    expect(getVisibleChartMarkerPoints('steamdt', points)).toEqual(points);
  });

  it('keeps the full marker set for csqaq charts', () => {
    expect(getVisibleChartMarkerPoints('csqaq', points)).toEqual(points);
  });
});
