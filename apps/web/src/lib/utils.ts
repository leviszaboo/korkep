export function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);

  if (seconds < 60) return 'most recently';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return new Date(date).toLocaleDateString('hu-HU', {
    month: 'short',
    day: 'numeric',
  });
}

export function isFresh(date: string): boolean {
  return Date.now() - new Date(date).getTime() < 3600_000;
}

export function biasLabel(rating: string): string {
  const labels: Record<string, string> = {
    left: 'Left',
    'center-left': 'Center-Left',
    center: 'Center',
    'center-right': 'Center-Right',
    right: 'Right',
  };
  return labels[rating] ?? rating;
}
