import { useState } from 'react'
import { DraftField } from '../components/DraftField'
import { useDismiss } from '../components/useDismiss'
import type { DataModel, DataModelField, FieldType } from '../dsl/ast'
import { exampleValue } from '../export/jsonSchema'
import { useStore } from '../state/store'
import { insertShape, SHAPE_TEMPLATES, type ShapeTemplate } from './dataTemplates'
import {
  addField,
  FIELD_TYPES,
  moveField,
  removeField,
  updateField,
  validateFieldName,
  type FieldPath,
} from './modelEdit'

/**
 * The request/message body, editable in place. `model` blocks have no other UI,
 * so this is the only way to build one without writing the DSL by hand.
 */
export function FieldTree({ model }: { model: DataModel | undefined }) {
  const mutate = useStore((s) => s.mutate)
  const [shapeInto, setShapeInto] = useState<FieldPath | null>(null)

  if (!model) {
    return (
      <p className="hint">
        No body model yet. Pick one above, or create one and add fields here.
      </p>
    )
  }

  const edit = (fn: (m: DataModel) => void) =>
    mutate((draft) => {
      const m = draft.dataModels.find((x) => x.name === model.name)
      if (m) fn(m)
    })

  return (
    <div className="field-tree">
      {!model.fields.length && (
        <p className="hint" style={{ margin: '0 0 6px' }}>
          {model.name} is empty.
        </p>
      )}
      {model.fields.map((field, i) => (
        <FieldRow
          key={`${field.name}-${i}`}
          model={model}
          field={field}
          path={[i]}
          depth={0}
          siblings={model.fields.length}
          edit={edit}
          onAddShape={setShapeInto}
        />
      ))}
      <div className="field-row" style={{ marginTop: 6 }}>
        <button className="btn sm" onClick={() => edit((m) => void addField(m, []))}>
          + Field
        </button>
        <button className="btn sm" onClick={() => setShapeInto([])}>
          + Shape…
        </button>
      </div>

      {shapeInto && (
        <ShapePicker
          onClose={() => setShapeInto(null)}
          onPick={(shape) =>
            edit((m) => {
              const list = containerFor(m, shapeInto)
              if (list) insertShape(list, shape)
            })
          }
        />
      )}
    </div>
  )
}

function FieldRow({
  model,
  field,
  path,
  depth,
  siblings,
  edit,
  onAddShape,
}: {
  model: DataModel
  field: DataModelField
  path: FieldPath
  depth: number
  siblings: number
  edit: (fn: (m: DataModel) => void) => void
  onAddShape: (path: FieldPath) => void
}) {
  const [open, setOpen] = useState(depth < 1)
  const [expanded, setExpanded] = useState(false)
  const container = field.type === 'object' || field.type === 'array'
  const index = path[path.length - 1]

  return (
    <>
      <div className={`row${expanded ? ' editing' : ''}`} style={{ ['--depth' as string]: depth }}>
        <span
          className="twist"
          role={container ? 'button' : undefined}
          onClick={() => container && setOpen((o) => !o)}
        >
          {container ? (open ? '▾' : '▸') : ''}
        </span>

        <button
          className="name as-button"
          onClick={() => setExpanded((e) => !e)}
          title="Edit this field"
        >
          {field.name}
        </button>
        <span className="type">
          {field.type === 'enum'
            ? `enum[${(field.enumValues ?? []).join('|')}]`
            : field.type}
        </span>
        {field.required && <span className="req">*</span>}
        {!container && (
          <span className="ex" title={String(exampleValue(field))}>
            {formatExample(exampleValue(field))}
          </span>
        )}
      </div>

      {expanded && (
        <div className="field-editor" style={{ ['--depth' as string]: depth }}>
          <DraftField
            label="NAME"
            value={field.name}
            commitOn="blur"
            validate={(next) => validateFieldName(model, path, next)}
            onCommit={(name) => edit((m) => void updateField(m, path, { name: name.trim() }))}
          />

          <div className="field-row">
            <label className="field">
              <span>TYPE</span>
              <select
                value={field.type}
                onChange={(e) =>
                  edit((m) => void updateField(m, path, { type: e.target.value as FieldType }))
                }
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="check" style={{ alignSelf: 'flex-end', paddingBottom: 5 }}>
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) =>
                  edit((m) => void updateField(m, path, { required: e.target.checked }))
                }
              />
              <span>Required</span>
            </label>
          </div>

          {field.type === 'enum' && (
            <DraftField
              label="VALUES (comma separated)"
              value={(field.enumValues ?? []).join(',')}
              commitOn="blur"
              onCommit={(raw) =>
                edit(
                  (m) =>
                    void updateField(m, path, {
                      enumValues: raw
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean),
                    }),
                )
              }
            />
          )}

          {!container && (
            <DraftField
              label="EXAMPLE"
              value={field.example === undefined ? '' : String(field.example)}
              commitOn="blur"
              placeholder="optional"
              onCommit={(raw) =>
                edit((m) => void updateField(m, path, { example: parseExample(raw) }))
              }
            />
          )}

          <div className="field-row">
            <button
              className="btn sm"
              disabled={index === 0}
              onClick={() => edit((m) => void moveField(m, path, -1))}
            >
              ↑
            </button>
            <button
              className="btn sm"
              disabled={index >= siblings - 1}
              onClick={() => edit((m) => void moveField(m, path, 1))}
            >
              ↓
            </button>
            {container && (
              <>
                <button className="btn sm" onClick={() => edit((m) => void addField(m, path))}>
                  + Child
                </button>
                <button className="btn sm" onClick={() => onAddShape(path)}>
                  + Shape…
                </button>
              </>
            )}
            <button
              className="btn sm danger"
              onClick={() => {
                setExpanded(false)
                edit((m) => void removeField(m, path))
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {container &&
        open &&
        (field.children ?? []).map((child, i) => (
          <FieldRow
            key={`${child.name}-${i}`}
            model={model}
            field={child}
            path={[...path, i]}
            depth={depth + 1}
            siblings={(field.children ?? []).length}
            edit={edit}
            onAddShape={onAddShape}
          />
        ))}
    </>
  )
}

function ShapePicker({
  onClose,
  onPick,
}: {
  onClose: () => void
  onPick: (shape: ShapeTemplate) => void
}) {
  useDismiss(onClose)

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Field shapes">
        <header>
          <h2>Add a shape</h2>
          <span className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="body">
          <p className="hint" style={{ marginBottom: 14 }}>
            Field groups that recur across requests. They are inserted into this level,
            renamed around any name you already use.
          </p>
          <div className="gallery">
            {SHAPE_TEMPLATES.map((shape) => (
              <button
                key={shape.id}
                onClick={() => {
                  onPick(shape)
                  onClose()
                }}
              >
                <span className="name">{shape.name}</span>
                <span className="blurb">{shape.blurb}</span>
                <span className="teaches">
                  {shape.fields.map((x) => x.name).join(', ')}
                </span>
              </button>
            ))}
          </div>
        </div>
        <footer>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  )
}

/** The field list a container path points at, creating children as needed. */
function containerFor(model: DataModel, path: FieldPath): DataModelField[] | undefined {
  let list = model.fields
  for (const index of path) {
    const child = list[index]
    if (!child) return undefined
    child.children ??= []
    list = child.children
  }
  return list
}

function formatExample(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value) ?? ''
}

/** Keep numbers and booleans typed; everything else stays a string. */
function parseExample(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  const n = Number(trimmed)
  return Number.isFinite(n) && trimmed !== '' ? n : trimmed
}
