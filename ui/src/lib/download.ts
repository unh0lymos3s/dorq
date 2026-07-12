/** Client-side export helpers for the artifact rail: SVG charts → PNG,
 *  curve/series data → CSV. No server round-trips. */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadCsv(rows: (string | number | null)[][], filename: string): void {
  const text = rows
    .map(r =>
      r
        .map(cell => {
          if (cell == null) return ''
          const s = String(cell)
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    )
    .join('\n')
  downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename)
}

/** Charts are styled through CSS classes + custom properties, which a
 *  serialized SVG loses — copy the computed values onto each node first. */
const STYLE_PROPS = [
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight',
  'letter-spacing', 'text-anchor', 'dominant-baseline',
] as const

function inlineComputedStyles(src: Element, dst: Element): void {
  const cs = window.getComputedStyle(src)
  let style = ''
  for (const prop of STYLE_PROPS) {
    const v = cs.getPropertyValue(prop)
    if (v) style += `${prop}:${v};`
  }
  dst.setAttribute('style', style)
  for (let i = 0; i < src.children.length; i++) {
    inlineComputedStyles(src.children[i], dst.children[i])
  }
}

function svgToImage(svg: SVGSVGElement, width: number, height: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineComputedStyles(svg, clone)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  const markup = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG rasterization failed')) }
    img.src = url
  })
}

/** Rasterize one or more SVG elements (stacked vertically, in order) into a
 *  single PNG download at 2× resolution on the current theme background. */
export async function downloadSvgsAsPng(svgs: SVGSVGElement[], filename: string): Promise<void> {
  const sizes = svgs.map(svg => {
    const r = svg.getBoundingClientRect()
    return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) }
  })
  const pad = 16
  const width = Math.max(...sizes.map(s => s.w)) + pad * 2
  const height = sizes.reduce((acc, s) => acc + s.h, 0) + pad * 2

  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.scale(scale, scale)
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#050505'
  ctx.fillRect(0, 0, width, height)

  let yOffset = pad
  for (let i = 0; i < svgs.length; i++) {
    const img = await svgToImage(svgs[i], sizes[i].w, sizes[i].h)
    ctx.drawImage(img, pad, yOffset, sizes[i].w, sizes[i].h)
    yOffset += sizes[i].h
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  )
  downloadBlob(blob, filename)
}
