import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../../data/export')
const destination = resolve(here, '../public/data')
const publicPhotos = resolve(here, '../public/photos')

try {
  await stat(source)
  await mkdir(destination, { recursive: true })
  const entries = await readdir(source)
  await Promise.all(entries.map((entry) => cp(join(source, entry), join(destination, entry), {
    recursive: true,
    force: true,
  })))
  // API documents retain `/photos/<id>.jpg`; mirror exported images there as
  // well as under `/data/photos` so a static deployment needs no backend.
  try {
    await stat(join(source, 'photos'))
    await mkdir(publicPhotos, { recursive: true })
    await cp(join(source, 'photos'), publicPhotos, { recursive: true, force: true })
  } catch (photoError) {
    if (!(photoError && typeof photoError === 'object' && 'code' in photoError && photoError.code === 'ENOENT')) {
      throw photoError
    }
  }
  console.log(`Synced ${source} to ${destination}`)
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
    console.warn(`No export directory at ${source}; nothing to sync yet.`)
    process.exitCode = 0
  } else {
    throw error
  }
}
