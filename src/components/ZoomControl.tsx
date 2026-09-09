import type { useZoom } from './useZoom'

export function ZoomControl({ zoom }: { zoom: ReturnType<typeof useZoom> }) {
  return (
    <>
      <button
        className="btn ghost sm"
        onClick={zoom.zoomOut}
        title="Zoom out"
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        className="btn ghost sm"
        onClick={zoom.reset}
        title="Actual size"
        style={{ minWidth: 42, justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }}
      >
        {Math.round(zoom.scale * 100)}%
      </button>
      <button
        className="btn ghost sm"
        onClick={zoom.zoomIn}
        title="Zoom in"
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        className={`btn ghost sm${zoom.isFit ? ' active' : ''}`}
        onClick={zoom.setFit}
        title="Fit to pane width"
      >
        Fit
      </button>
    </>
  )
}
