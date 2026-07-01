import cors from 'cors'
import express from 'express'
import {
  deleteFavorite,
  insertFavorite,
  listFavorites,
  type FavoriteRow,
} from './db.js'

const app = express()
const PORT = Number(process.env.PORT) || 3001

app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/favorites', (_req, res) => {
  res.json(listFavorites())
})

app.post('/api/favorites', (req, res) => {
  const body = req.body as Partial<FavoriteRow>
  if (
    !body.media_id ||
    !body.folder_id ||
    !body.relative_path ||
    !body.name ||
    !body.kind ||
    !body.root_folder_name
  ) {
    res.status(400).json({ error: 'Missing favorite fields' })
    return
  }
  if (body.kind !== 'image' && body.kind !== 'video') {
    res.status(400).json({ error: 'Invalid kind' })
    return
  }

  const row = insertFavorite({
    media_id: body.media_id,
    folder_id: body.folder_id,
    relative_path: body.relative_path,
    name: body.name,
    kind: body.kind,
    root_folder_name: body.root_folder_name,
  })
  res.status(201).json(row)
})

app.delete('/api/favorites/:mediaId', (req, res) => {
  const removed = deleteFavorite(req.params.mediaId)
  if (!removed) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.status(204).end()
})

app.listen(PORT, () => {
  console.log(`MPFour favorites API http://localhost:${PORT}`)
})
