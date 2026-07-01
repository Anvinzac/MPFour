import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = join(__dirname, 'data', 'favorites.db')

mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)

db.exec(`
  CREATE TABLE IF NOT EXISTS favorites (
    media_id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
    root_folder_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`)

export interface FavoriteRow {
  media_id: string
  folder_id: string
  relative_path: string
  name: string
  kind: 'image' | 'video'
  root_folder_name: string
  created_at: number
}

export function listFavorites(): FavoriteRow[] {
  return db
    .prepare(
      `SELECT media_id, folder_id, relative_path, name, kind, root_folder_name, created_at
       FROM favorites ORDER BY created_at DESC`,
    )
    .all() as FavoriteRow[]
}

export function insertFavorite(row: Omit<FavoriteRow, 'created_at'>): FavoriteRow {
  const created_at = Date.now()
  db.prepare(
    `INSERT INTO favorites (media_id, folder_id, relative_path, name, kind, root_folder_name, created_at)
     VALUES (@media_id, @folder_id, @relative_path, @name, @kind, @root_folder_name, @created_at)
     ON CONFLICT(media_id) DO UPDATE SET
       folder_id = excluded.folder_id,
       relative_path = excluded.relative_path,
       name = excluded.name,
       kind = excluded.kind,
       root_folder_name = excluded.root_folder_name`,
  ).run({ ...row, created_at })
  return { ...row, created_at }
}

export function deleteFavorite(mediaId: string): boolean {
  const result = db
    .prepare(`DELETE FROM favorites WHERE media_id = ?`)
    .run(mediaId)
  return result.changes > 0
}
