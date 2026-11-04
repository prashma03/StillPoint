/**
 * Opt-in local photo vault. Image pixels stay in memory by default; a photo
 * lands here only after the user explicitly enables persistent storage for
 * that draft. Drafts store the vault id — never pixels — and deleting a
 * draft deletes its vault photo too.
 */
export type VaultPhoto = {
  id: string
  name: string
  type: string
  blob: Blob
  savedAt: string
}

export type VaultBackend = {
  get(id: string): Promise<VaultPhoto | null>
  set(photo: VaultPhoto): Promise<void>
  del(id: string): Promise<void>
  clear(): Promise<void>
}

export function createPhotoVault(backend: VaultBackend) {
  return {
    async savePhoto(id: string, blob: Blob, name: string, type: string): Promise<void> {
      await backend.set({ id, name, type, blob, savedAt: new Date().toISOString() })
    },
    loadPhoto(id: string): Promise<VaultPhoto | null> {
      return backend.get(id)
    },
    deletePhoto(id: string): Promise<void> {
      return backend.del(id)
    },
    clear(): Promise<void> {
      return backend.clear()
    },
  }
}

export function createMemoryBackend(): VaultBackend {
  const map = new Map<string, VaultPhoto>()
  return {
    get: (id) => Promise.resolve(map.get(id) ?? null),
    set: (photo) => {
      map.set(photo.id, photo)
      return Promise.resolve()
    },
    del: (id) => {
      map.delete(id)
      return Promise.resolve()
    },
    clear: () => {
      map.clear()
      return Promise.resolve()
    },
  }
}

export function vaultAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

const DB_NAME = 'stillpoint-photos'
const STORE_NAME = 'photos'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the photo vault.'))
  })
}

function run<T>(mode: IDBTransactionMode, task: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode)
        const request = task(tx.objectStore(STORE_NAME))
        tx.oncomplete = () => {
          db.close()
          resolve(request.result)
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error ?? new Error('Photo vault write failed.'))
        }
        tx.onabort = () => {
          db.close()
          reject(tx.error ?? new Error('Photo vault write failed.'))
        }
      }),
  )
}

export function indexedDbBackend(): VaultBackend {
  return {
    async get(id) {
      const found = await run('readonly', (store) => store.get(id) as IDBRequest<VaultPhoto | undefined>)
      return found ?? null
    },
    async set(photo) {
      await run('readwrite', (store) => store.put(photo))
    },
    async del(id) {
      await run('readwrite', (store) => store.delete(id))
    },
    async clear() {
      await run('readwrite', (store) => store.clear())
    },
  }
}

let shared: ReturnType<typeof createPhotoVault> | null = null

export function photoVault() {
  if (!shared) shared = createPhotoVault(vaultAvailable() ? indexedDbBackend() : createMemoryBackend())
  return shared
}
