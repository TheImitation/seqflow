import type { DatabaseTable, DataModelField } from '../dsl/ast'
import { tablesForParticipant } from '../dsl/schema'
import { useStore } from '../state/store'

/**
 * Read-only — tables are authored as DSL text (a `table` block), the same
 * way every other project artifact in this app is authored. This view exists
 * to answer "what does this database actually hold," not to edit it.
 */
export function DatabaseSchema({ participantId }: { participantId: string }) {
  const doc = useStore((s) => s.doc)
  const tables = tablesForParticipant(doc, participantId)

  return (
    <div className="content" style={{ gap: 12 }}>
      {!tables.length && (
        <p className="hint">
          No <code>table</code> block references this participant yet — add one with{' '}
          <code>
            table Name @{participantId} {'{'} ... {'}'}
          </code>
          .
        </p>
      )}
      {tables.map((t) => (
        <TableCard key={t.name} table={t} />
      ))}
    </div>
  )
}

export function TableCard({ table }: { table: DatabaseTable }) {
  return (
    <section className="section">
      <header>
        {table.name}
        <span className="spacer" />
        {table.primaryKey?.length ? <span className="hint">PK {table.primaryKey.join(', ')}</span> : null}
      </header>
      <div className="content">
        {table.description && <p className="hint">{table.description}</p>}
        <ColumnTable columns={table.columns} primaryKey={table.primaryKey} foreignKeys={table.foreignKeys} />
        {table.foreignKeys.map((fk) => (
          <p className="hint" key={fk.column}>
            <code>{fk.column}</code> → <code>{fk.refTable}.{fk.refColumn}</code>
          </p>
        ))}
        {table.indexes.map((idx, i) => (
          <p className="hint" key={i}>
            index: <code>{idx.join(', ')}</code>
          </p>
        ))}
      </div>
    </section>
  )
}

function ColumnTable({
  columns,
  primaryKey,
  foreignKeys,
  depth = 0,
}: {
  columns: DataModelField[]
  primaryKey?: string[]
  foreignKeys: { column: string }[]
  depth?: number
}) {
  if (!columns.length) return <p className="hint">No columns yet.</p>

  return (
    <table className="grid">
      {depth === 0 && (
        <thead>
          <tr>
            <th>Column</th>
            <th>Type</th>
            <th className="req">Key</th>
          </tr>
        </thead>
      )}
      <tbody>
        {columns.map((col, i) => (
          <ColumnRow
            key={`${col.name}-${i}`}
            column={col}
            primaryKey={primaryKey}
            foreignKeys={foreignKeys}
            depth={depth}
          />
        ))}
      </tbody>
    </table>
  )
}

function ColumnRow({
  column,
  primaryKey,
  foreignKeys,
  depth,
}: {
  column: DataModelField
  primaryKey?: string[]
  foreignKeys: { column: string }[]
  depth: number
}) {
  const isPk = primaryKey?.includes(column.name)
  const isFk = foreignKeys.some((fk) => fk.column === column.name)

  return (
    <>
      <tr>
        <td style={{ paddingLeft: depth * 14 }}>
          <code>{column.name}</code>
          {column.required && <span className="hint"> *</span>}
        </td>
        <td>{typeLabel(column)}</td>
        <td className="req">{isPk ? 'PK' : isFk ? 'FK' : ''}</td>
      </tr>
      {column.children?.length ? (
        <tr>
          <td colSpan={3} style={{ padding: 0 }}>
            <ColumnTable columns={column.children} foreignKeys={[]} depth={depth + 1} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

function typeLabel(f: DataModelField): string {
  if (f.type === 'enum') return `enum(${(f.enumValues ?? []).join('|')})`
  if (f.type === 'vector') return `vector(${f.example})`
  return f.type
}
