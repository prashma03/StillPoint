export async function sha256(file: Blob): Promise<string | null> {
  try {
    const bytes = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

export async function readText(file: Blob): Promise<string> {
  return file.text()
}
