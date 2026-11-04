// Annotated frame ranges of a replay, from `regions` in public/replays/index.json
// (on an entry or a table row, next to its `file`):
//
//   "regions": [
//     { "from": 0, "label": "Menus and intro" },
//     { "from": 1690, "to": 2904, "label": "Route to BoB", "note": "…", "color": "#f59e0b" }
//   ]
//
// `to` defaults to the next region's `from` (or the end of the replay);
// `note` and `color` are optional.
//
// A replay index.json doesn't list gets them from a `regions.json` next to it
// (the same list, as objective-rrt-v2's `legs` writes beside route.m64).

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const COLORS = ['#60a5fa', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#22d3ee'];

const pathOf = (url) => new URL(url, window.location.href).pathname;

/** Sorted, with `to` filled in and a colour each; drops entries without a `from`. */
export function normalizeRegions(list, total) {
  const sorted = (Array.isArray(list) ? list : [])
    .filter((r) => Number.isFinite(r?.from))
    .sort((a, b) => a.from - b.from);
  return sorted.map((r, i) => ({
    from: Math.max(0, r.from),
    to: Math.min(total, Number.isFinite(r.to) ? r.to : (sorted[i + 1]?.from ?? total)),
    label: r.label ?? `Region ${i + 1}`,
    note: r.note,
    color: r.color ?? COLORS[i % COLORS.length],
  }));
}

/** The regions index.json gives the replay at `source` (a URL), else those of a regions.json beside it, or []. */
export async function regionsFor(source, total) {
  if (!source) return [];
  return (await indexRegions(source, total)) ?? (await siblingRegions(source, total));
}

async function siblingRegions(source, total) {
  try {
    const url = new URL('regions.json', new URL(source, window.location.href));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
    const r = await fetch(url);
    if (!r.ok || !/json/.test(r.headers.get('content-type') ?? '')) return [];
    const list = await r.json();
    return Array.isArray(list) ? normalizeRegions(list, total) : [];
  } catch {
    return [];
  }
}

async function indexRegions(source, total) {
  try {
    const r = await fetch(`${BASE}replays/index.json`);
    if (!r.ok) return null;
    const target = pathOf(source);
    for (const ex of await r.json()) {
      const rows = (ex.table?.rows ?? []).filter((row) => !Array.isArray(row));
      for (const item of [ex, ...rows]) {
        if (item.file && item.regions && pathOf(`${BASE}replays/${item.file}`) === target) {
          return normalizeRegions(item.regions, total);
        }
      }
    }
  } catch {
    // No annotations, then.
  }
  return null;
}

/** The region `frame` is in, or null. */
export const regionAt = (regions, frame) => regions.find((r) => frame >= r.from && frame < r.to) ?? null;
