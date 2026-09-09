import type { FileChild } from 'docx'
import type { DiagramId, ReportBlock, ReportDocument } from './reportContent'

/**
 * Render a `ReportDocument` as a real Word file.
 *
 * Everything about `docx` is loaded on demand. That is not incidental: the
 * library plus its zip dependency is comparable in size to this app's entire
 * bundle, and most sessions never export a report. `verbatimModuleSyntax` is
 * on, so **only `import type` may appear at the top of this file** — a value
 * import of something like `HeadingLevel` would pull the whole library into the
 * eager graph and quietly turn the dynamic import below into decoration.
 * Everything runtime is destructured off the namespace object instead.
 */

export type PageSize = 'a4' | 'letter'

export interface DocxOptions {
  pageSize: PageSize
  images: Map<DiagramId, ArrayBuffer>
}

/** Printable width in points, at the 1-inch margins set below. */
const PAGE: Record<PageSize, { widthPt: number; heightPt: number; landscapeWidthPt: number }> = {
  // 210mm − 50.8mm = 159.2mm; 297mm − 50.8mm = 246.2mm.
  a4: { widthPt: 451.3, heightPt: 697.9, landscapeWidthPt: 697.9 },
  // 8.5in − 2in, 11in − 2in.
  letter: { widthPt: 468, heightPt: 648, landscapeWidthPt: 648 },
}

/** CSS pixels to points: SVG user units are 96 per inch, points are 72. */
const PX_TO_PT = 0.75

export async function renderDocx(
  report: ReportDocument,
  options: DocxOptions,
): Promise<Blob> {
  const docx = await import('docx')
  const {
    AlignmentType,
    Document,
    HeadingLevel,
    ImageRun,
    Packer,
    PageNumber,
    Paragraph,
    Table,
    TableCell,
    TableLayoutType,
    TableRow,
    TextRun,
    WidthType,
    convertInchesToTwip,
  } = docx

  const page = PAGE[options.pageSize]
  const bodyTwips = Math.round(page.widthPt * 20) // points → twips

  const heading = (level: 1 | 2 | 3) =>
    level === 1
      ? HeadingLevel.HEADING_1
      : level === 2
        ? HeadingLevel.HEADING_2
        : HeadingLevel.HEADING_3

  const caption = (text: string) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 240 },
      children: [new TextRun({ text, italics: true, size: 18, color: '666666' })],
    })

  const tableTitle = (text: string) =>
    new Paragraph({
      spacing: { before: 160, after: 60 },
      keepNext: true,
      children: [new TextRun({ text, bold: true, size: 20 })],
    })

  const cell = (text: string, width: number, header = false) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      shading: header ? { fill: 'F2F2F2' } : undefined,
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: header, size: 18 })],
        }),
      ],
    })

  const renderBlock = (block: ReportBlock): FileChild[] => {
    switch (block.kind) {
      case 'heading':
        return [
          new Paragraph({
            text: block.text,
            heading: heading(block.level),
            spacing: { before: block.level === 1 ? 360 : 240, after: 120 },
          }),
        ]

      case 'para':
        return [
          new Paragraph({
            spacing: { after: 160 },
            children: [
              new TextRun({
                text: block.text,
                size: 22,
                // Quoted from the document rather than generated, so the
                // reader can tell the two apart.
                italics: block.quoted,
                color: block.quoted ? '444444' : undefined,
              }),
            ],
          }),
        ]

      case 'callout':
        return [
          new Paragraph({
            spacing: { before: 120, after: 200 },
            // A left rule rather than a fill: it survives Word's own theming.
            border: {
              left: {
                style: docx.BorderStyle.SINGLE,
                size: 18,
                space: 12,
                color: block.tone === 'warn' ? 'C0504D' : 'A0A0A0',
              },
            },
            indent: { left: 180 },
            children: [
              new TextRun({
                text: block.text,
                size: 20,
                italics: true,
                color: block.tone === 'warn' ? 'A33A37' : '555555',
              }),
            ],
          }),
        ]

      case 'bullets':
        return block.items.map(
          (item) =>
            new Paragraph({
              text: item,
              bullet: { level: 0 },
              spacing: { after: 80 },
            }),
        )

      case 'metrics': {
        // Two columns of label/value pairs reads better on a page than eight
        // narrow ones, and never overflows the printable width.
        const half = Math.ceil(block.items.length / 2)
        const widths = [Math.round(bodyTwips * 0.3), Math.round(bodyTwips * 0.2)]
        const pairWidths = [...widths, ...widths]
        const rows = Array.from({ length: half }, (_, i) => {
          const left = block.items[i]
          const right = block.items[i + half]
          const cells = [
            cell(left.label, pairWidths[0], true),
            cell(left.note ? `${left.value} — ${left.note}` : left.value, pairWidths[1]),
          ]
          if (right) {
            cells.push(
              cell(right.label, pairWidths[2], true),
              cell(right.note ? `${right.value} — ${right.note}` : right.value, pairWidths[3]),
            )
          } else {
            cells.push(cell('', pairWidths[2]), cell('', pairWidths[3]))
          }
          return new TableRow({ children: cells })
        })
        return [
          new Table({
            layout: TableLayoutType.FIXED,
            width: { size: bodyTwips, type: WidthType.DXA },
            columnWidths: pairWidths,
            rows,
          }),
          new Paragraph({ text: '', spacing: { after: 120 } }),
        ]
      }

      case 'table': {
        const columns = block.head.length
        const widths = columnWidths(block, bodyTwips)
        // Above the table, unlike a figure caption: a caption like
        // "Participants" reads as the table's title, and a title printed
        // underneath its table looks like a mistake.
        const out: FileChild[] = block.caption ? [tableTitle(block.caption)] : []
        out.push(
          new Table({
            layout: TableLayoutType.FIXED,
            width: { size: bodyTwips, type: WidthType.DXA },
            columnWidths: widths,
            rows: [
              // `tableHeader` makes the row repeat across a page break, which
              // the long coverage and outcome tables need.
              new TableRow({
                tableHeader: true,
                children: block.head.map((h, i) => cell(h, widths[i], true)),
              }),
              ...block.rows.map(
                (row) =>
                  new TableRow({
                    children: Array.from({ length: columns }, (_, i) =>
                      cell(row[i] ?? '', widths[i]),
                    ),
                  }),
              ),
            ],
          }),
        )
        out.push(new Paragraph({ text: '', spacing: { after: 200 } }))
        return out
      }

      case 'image': {
        const data = options.images.get(block.id)
        if (!data) return []
        const fit = fitImage(block.id, data, page)
        if (!fit) return []
        return [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 160 },
            children: [
              new ImageRun({
                // Required from docx v9 — omitting it fails obscurely.
                type: 'png',
                data,
                transformation: { width: fit.width, height: fit.height },
                altText: { name: block.id, description: block.alt, title: block.caption },
              }),
            ],
          }),
          caption(block.caption),
        ]
      }
    }
  }

  const children = report.blocks.flatMap(renderBlock)

  const doc = new Document({
    creator: 'SeqFlow',
    title: report.title,
    description: report.subtitle,
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size:
              options.pageSize === 'a4'
                ? { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) }
                : { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) },
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        footers: {
          default: new docx.Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    size: 18,
                    color: '888888',
                    children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            text: report.title,
            heading: HeadingLevel.TITLE,
            spacing: { after: 80 },
          }),
          new Paragraph({
            spacing: { after: 40 },
            children: [new TextRun({ text: report.subtitle, size: 26, color: '444444' })],
          }),
          new Paragraph({
            spacing: { after: 320 },
            children: [new TextRun({ text: report.byline, size: 18, color: '777777' })],
          }),
          ...children,
        ],
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  // Some versions hand back a generic blob type, and Word objects on open.
  return new Blob([await blob.arrayBuffer()], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

/* ----------------------------------------------------------------- helpers */

/**
 * Fit a captured diagram inside the printable box.
 *
 * Both dimensions are clamped, not just the width: Word will not split an
 * inline image across a page break, so an image taller than the body area is
 * clipped rather than flowed.
 */
function fitImage(
  id: DiagramId,
  data: ArrayBuffer,
  page: { widthPt: number; heightPt: number },
): { width: number; height: number } | null {
  const size = pngSize(data)
  if (!size) return null

  // The PNG was rasterised at 2×, so its pixels are twice the viewBox units.
  const naturalW = (size.width / 2) * PX_TO_PT
  const naturalH = (size.height / 2) * PX_TO_PT
  const scale = Math.min(1, page.widthPt / naturalW, page.heightPt / naturalH)
  void id

  return {
    width: Math.max(1, Math.round(naturalW * scale)),
    height: Math.max(1, Math.round(naturalH * scale)),
  }
}

/**
 * Pixel dimensions straight out of the PNG's IHDR chunk. Reading the file is
 * more reliable than trusting a separately-passed size to still match after
 * `pngScaleFor` may have reduced the rasterisation scale.
 */
function pngSize(data: ArrayBuffer): { width: number; height: number } | null {
  const view = new DataView(data)
  if (view.byteLength < 24) return null
  // 0x89 'P' 'N' 'G'
  if (view.getUint32(0) !== 0x89504e47) return null
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/**
 * Column widths summing to exactly the printable width — Word renormalises a
 * table whose columns do not add up, silently ignoring the layout. Columns are
 * weighted by their widest cell so a "#" column does not get the same space as
 * a sentence.
 */
function columnWidths(
  block: Extract<ReportBlock, { kind: 'table' }>,
  total: number,
): number[] {
  const weights = block.head.map((head, i) => {
    const longest = block.rows.reduce((n, row) => Math.max(n, (row[i] ?? '').length), head.length)
    // Clamped so one long sentence cannot squeeze every other column to nothing.
    return Math.min(Math.max(longest, 4), 44)
  })
  const sum = weights.reduce((a, b) => a + b, 0)

  const widths = weights.map((w) => Math.floor((w / sum) * total))
  // Hand the rounding remainder to the widest column.
  const drift = total - widths.reduce((a, b) => a + b, 0)
  const widest = weights.indexOf(Math.max(...weights))
  widths[widest] += drift
  return widths
}
