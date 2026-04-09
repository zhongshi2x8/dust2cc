export interface VisibleChartMarkerPoint {
  kind: string;
  value: number;
}

export function getVisibleChartMarkerPoints<T extends VisibleChartMarkerPoint>(
  siteName: string | undefined,
  points: T[],
): T[] {
  const filtered = points.filter((point) => Number.isFinite(point.value));

  // SteamDT now uses the same marker set as CSQAQ.
  if (siteName === 'steamdt' || siteName === 'csqaq' || !siteName) {
    return filtered;
  }

  return filtered;
}
