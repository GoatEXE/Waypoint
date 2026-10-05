import { useStore, useViewport } from '../store';

export const SIDEBAR_W = 236;
export const PANE_W = 388;
/** Below this viewport width the side pane overlays the content instead of docking. */
export const PANE_DOCK_MIN = 1280;

/** Two columns (main + 290px aside) when the content area has room, else a single stacked column. */
export function useSplitCols() {
  const vw = useViewport();
  const { state } = useStore();
  const docked = state.pane.open && vw >= PANE_DOCK_MIN;
  return vw - SIDEBAR_W - (docked ? PANE_W : 0) < 860 ? 'minmax(0,1fr)' : 'minmax(0,1fr) 290px';
}
