import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'seqflow'
const PROJECTS = 'projects'
const META = 'meta'
/** v1 kept a single autosaved document under this key in `projects`. */
const LEGACY_CURRENT = 'current'
const CURRENT_ID = 'currentProjectId'
const VERSION = 2

export interface StoredProject {
  /** SeqFlow project format version, so old files stay importable. */
  version: 1
  id: string
  name: string
  dsl: string
  createdAt: string
  savedAt: string
}

/** What the project switcher lists — no `dsl`, so it stays cheap. */
export type ProjectSummary = Omit<StoredProject, 'dsl' | 'version'>

let dbPromise: Promise<IDBPDatabase> | undefined

function db() {
  dbPromise ??= openDB(DB_NAME, VERSION, {
    upgrade(database, oldVersion) {
      if (!database.objectStoreNames.contains(PROJECTS)) {
        database.createObjectStore(PROJECTS)
      }
      if (!database.objectStoreNames.contains(META)) {
        database.createObjectStore(META)
      }
      // v1 -> v2 migration happens on first read, where the transaction can
      // span both stores; see `migrateLegacy`.
      void oldVersion
    },
  })
  return dbPromise
}

export function newProjectId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Never let storage failures break the app — it is just less persistent. */
async function safely<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch {
    // Private browsing and some lockdown modes block IndexedDB entirely.
    return fallback
  }
}

/* --------------------------------------------------------------- projects */

export async function listProjects(): Promise<ProjectSummary[]> {
  return safely(async () => {
    const database = await db()
    await migrateLegacy(database)
    const all = (await database.getAll(PROJECTS)) as StoredProject[]
    return all
      .filter((p) => p && typeof p.dsl === 'string' && p.id)
      .map(({ id, name, createdAt, savedAt }) => ({ id, name, createdAt, savedAt }))
      .sort((a, z) => z.savedAt.localeCompare(a.savedAt))
  }, [])
}

export async function loadProject(id: string): Promise<StoredProject | null> {
  return safely(async () => {
    const value = (await (await db()).get(PROJECTS, id)) as StoredProject | undefined
    return value ?? null
  }, null)
}

export async function saveProject(project: StoredProject): Promise<boolean> {
  return safely(async () => {
    await (await db()).put(PROJECTS, project, project.id)
    return true
  }, false)
}

export async function deleteProject(id: string): Promise<boolean> {
  return safely(async () => {
    await (await db()).delete(PROJECTS, id)
    return true
  }, false)
}

export async function getCurrentProjectId(): Promise<string | null> {
  return safely(async () => {
    const database = await db()
    await migrateLegacy(database)
    return ((await database.get(META, CURRENT_ID)) as string | undefined) ?? null
  }, null)
}

export async function setCurrentProjectId(id: string): Promise<void> {
  await safely(async () => {
    await (await db()).put(META, id, CURRENT_ID)
  }, undefined)
}

export function makeProject(name: string, dsl: string): StoredProject {
  const now = new Date().toISOString()
  return { version: 1, id: newProjectId(), name, dsl, createdAt: now, savedAt: now }
}

/** `Order flow` next to an existing `Order flow` becomes `Order flow 2`. */
export function uniqueProjectName(existing: ProjectSummary[], base: string): string {
  const trimmed = base.trim() || 'Untitled'
  if (!existing.some((p) => p.name === trimmed)) return trimmed
  let n = 2
  while (existing.some((p) => p.name === `${trimmed} ${n}`)) n++
  return `${trimmed} ${n}`
}

/* -------------------------------------------------------------- migration */

/**
 * Shared promise, not a boolean: callers run concurrently (`Promise.all` on
 * boot), and a flag would let the second one read the store while the first is
 * still writing to it.
 */
let migration: Promise<void> | undefined

function migrateLegacy(database: IDBPDatabase): Promise<void> {
  migration ??= runMigration(database)
  return migration
}

/**
 * v1 autosaved one unnamed document under a fixed key. Promote it to a real
 * project so nothing anyone had open is lost when they upgrade.
 */
async function runMigration(database: IDBPDatabase): Promise<void> {
  const legacy = (await database.get(PROJECTS, LEGACY_CURRENT)) as
    | { dsl?: string; name?: string; savedAt?: string }
    | undefined
  if (!legacy || typeof legacy.dsl !== 'string') return

  const project = makeProject(legacy.name || 'Recovered project', legacy.dsl)
  if (legacy.savedAt) project.savedAt = legacy.savedAt
  await database.put(PROJECTS, project, project.id)
  await database.delete(PROJECTS, LEGACY_CURRENT)
  if (!(await database.get(META, CURRENT_ID))) {
    await database.put(META, project.id, CURRENT_ID)
  }
}

/* --------------------------------------------------------- file import/export */

export function projectToJson(name: string, dsl: string): string {
  return JSON.stringify(makeProject(name, dsl), null, 2) + '\n'
}

export function projectFromJson(raw: string): StoredProject {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('That file is not a SeqFlow project.')
  }
  const value = parsed as Partial<StoredProject>
  if (typeof value.dsl !== 'string') {
    throw new Error('That project file has no `dsl` field.')
  }
  if (value.version !== undefined && value.version !== 1) {
    throw new Error(`Unsupported project version ${String(value.version)}.`)
  }
  // The id is deliberately regenerated: importing the same file twice should
  // give you two projects, not silently overwrite the first.
  const project = makeProject(
    typeof value.name === 'string' ? value.name : 'Imported project',
    value.dsl,
  )
  if (typeof value.createdAt === 'string') project.createdAt = value.createdAt
  return project
}
