export function parseTimeToSeconds(timeString: string): number {
  const normalized = timeString.trim();
  if (!normalized) {
    return Number.NaN;
  }

  if (!normalized.includes(':')) {
    return Number.parseFloat(normalized);
  }

  const parts = normalized.split(':').map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part === '')) {
    return Number.NaN;
  }

  return parts.reduce((totalSeconds, part) => {
    const value = Number.parseFloat(part);
    return Number.isFinite(value) ? totalSeconds * 60 + value : Number.NaN;
  }, 0);
}
