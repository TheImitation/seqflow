/**
 * Standalone SVG / PNG snapshots of a live canvas. The diagrams are styled from
 * the app stylesheet, so the export inlines those rules and resolves the CSS
 * variables onto the root element — otherwise the file renders unstyled.
 *
 * A snapshot is a picture of the *diagram*, not of the canvas at this instant:
 * playback dimming, selection, hover and the drag previews are all removed, and
 * everything is measured in viewBox space rather than at the current zoom.
 */
import {
  cleanClassList,
  INTERACTION_ONLY,
  naturalSize,
  pngScaleFor,
  type Size,
} from './snapshotGeometry'

const VARIABLES = [
  '--surface-0',
  '--surface-1',
  '--surface-2',
  '--surface-3',
  '--border',
  '--border-strong',
  '--text',
  '--text-dim',
  '--text-faint',
  '--accent',
  '--accent-soft',
  '--accent-line',
  '--blue',
  '--green',
  '--amber',
  '--red',
  '--violet',
  '--sans',
  '--mono',
]

function collectCss(): string {
  const out: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // cross-origin sheet
    }
    for (const rule of Array.from(rules)) {
      const text = rule.cssText
      // Only the diagram rules matter, and dragging in the whole app stylesheet
      // would bloat every export.
      if (
        /\.(seq-svg|arch-svg|schema-svg|lane-|lifeline|arrow-|block-|note-|contract-badge|packet|arch-(node|edge)|schema-(node|edge)|pin-mark|drop-lane)/.test(
          text,
        )
      ) {
        out.push(text)
      }
    }
  }
  return out.join('\n')
}

export function sizeOf(source: SVGSVGElement): Size {
  return naturalSize(
    source.getAttribute('viewBox'),
    source.getAttribute('width'),
    source.getAttribute('height'),
    { width: source.clientWidth || 1, height: source.clientHeight || 1 },
  )
}

export function svgToString(source: SVGSVGElement, background = '#0b0f16'): string {
  const clone = source.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')

  const computed = getComputedStyle(document.documentElement)
  const vars = VARIABLES.map((name) => `${name}: ${computed.getPropertyValue(name).trim()};`)
  clone.setAttribute('style', vars.join(' '))

  // Titles are hover tooltips in the app; in a flat file they are noise.
  clone.querySelectorAll('title').forEach((node) => node.remove())

  // Invisible hit targets and drag previews: bloat at best, stray marks in
  // editors that ignore `stroke: transparent`.
  clone.querySelectorAll(INTERACTION_ONLY.join(', ')).forEach((node) => node.remove())

  // Playback and selection state, which would otherwise export the diagram
  // faded out with one arrow lit.
  clone.querySelectorAll('[class]').forEach((node) => {
    const raw = node.getAttribute('class') ?? ''
    const cleaned = cleanClassList(raw)
    if (cleaned !== raw) node.setAttribute('class', cleaned)
  })

  // The same dimming is also applied as an inline attribute in places, and it
  // does not respond to the class strip above.
  clone.querySelectorAll('[opacity]').forEach((node) => node.removeAttribute('opacity'))

  // Everything below is positioned in viewBox space, including the background.
  const { width, height } = sizeOf(source)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = collectCss()

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('x', '0')
  rect.setAttribute('y', '0')
  rect.setAttribute('width', String(width))
  rect.setAttribute('height', String(height))
  rect.setAttribute('fill', background)

  clone.insertBefore(rect, clone.firstChild)
  clone.insertBefore(style, clone.firstChild)

  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone)
}

export async function svgToPngBlob(source: SVGSVGElement, scale = 2): Promise<Blob> {
  const markup = svgToString(source)
  const { width, height } = sizeOf(source)
  // A tall sequence diagram at 2x exceeds what some browsers will rasterise,
  // and the failure is a blank canvas rather than an error.
  const applied = pngScaleFor({ width, height }, scale)

  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * applied))
    canvas.height = Math.max(1, Math.round(height * applied))

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get a 2D canvas context.')
    ctx.scale(applied, applied)
    ctx.drawImage(image, 0, 0, width, height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas produced no image.'))),
        'image/png',
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The browser could not rasterise the SVG.'))
    image.src = url
  })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename)
}
