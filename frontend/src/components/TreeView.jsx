import { useEffect, useRef } from 'react';
import { mountTree } from '../tree/treeview';
import { romGeometry } from '../tree/romGeometry';

// The Objective-RRT tree server (objective-rrt/tools/viz.py), reached through
// the dev server's /obrrt proxy (vite.config.js); VITE_OBRRT_API overrides it.
const OBRRT_API = import.meta.env.VITE_OBRRT_API ?? '/obrrt';
// Static exports (objective-rrt/tools/export_tree.py), used when the server
// isn't there, e.g. on GitHub Pages. They are too big for the repo: they live on
// their own Cloudflare Pages project (sm64coin's "Viewer trees" workflow deploys them from the tag trees-2026-11-26). For local
// files set VITE_TREES_URL=/trees/ and put the exports in frontend/public/trees/.
const STATIC_BASE = (import.meta.env.VITE_TREES_URL ?? 'https://sm64-trees.pages.dev/').replace(/\/?$/, '/');

/**
 * The live search-tree view. `state` ({ run, zone, node }) restores where the
 * user was; `onState` reports changes; `onPlay({ url, start, title, state })`
 * opens a state's replay; `onBack` returns to the replay list.
 */
export default function TreeView({ state, onState, onPlay, onBack }) {
  const root = useRef(null);
  const handlers = useRef({ onState, onPlay, onBack });
  handlers.current = { onState, onPlay, onBack };

  useEffect(() => {
    const dispose = mountTree(root.current, {
      api: OBRRT_API,
      staticBase: STATIC_BASE,
      geometry: romGeometry,
      staticOnly: state?.static === '1',
      run: state?.run,
      zone: state?.zone,
      node: state?.node != null ? Number(state.node) : null,
      onState: (s) => handlers.current.onState?.(s),
      onPlay: (p) => handlers.current.onPlay?.(p),
      onBack: () => handlers.current.onBack?.(),
    });
    return dispose;
    // Mounted once; later state changes come from inside the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={root} />;
}
