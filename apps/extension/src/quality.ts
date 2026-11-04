import type { Candidate } from '@mediahunter/contracts';

export function groupVariants<T extends Candidate>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.groupKey ? item.mediaType + ':' + item.groupKey : item.url;
    const variants = groups.get(key) ?? [];
    variants.push(item);
    groups.set(key, variants);
  }
  return [...groups].map(([id, variants]) => ({
    id,
    variants: [...variants].sort((left, right) => {
      const pixels = (item: Candidate) => (item.width ?? 0) * (item.height ?? 0);
      return pixels(right) - pixels(left);
    }),
  }));
}
