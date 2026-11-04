import { clientToImageCoords } from './landmarks'
import type { RoomObject } from './types'

export const PROTECT_CATEGORIES = ['window', 'door', 'desk', 'bed', 'poster', 'chair', 'shelf', 'table', 'rug', 'other'] as const
export type ProtectCategory = (typeof PROTECT_CATEGORIES)[number]
export type VisualSuggestion = { id: string; x: number; y: number; width: number; height: number; label: string; accepted: boolean }

export function canAdvanceProtectStep(step: number, hasPhoto: boolean, maskConfirmed: boolean, importedConfirmed: boolean) {
  if (step === 1) return hasPhoto
  if (step === 2) return hasPhoto && (maskConfirmed || importedConfirmed)
  return false
}

export function validatePhotoSelection(file: { name: string; type: string; size: number }) {
  if (file.size > 20 * 1024 * 1024) return 'That file is larger than 20 MB. Choose a smaller image.'
  const isJson = file.type.includes('json') || file.name.toLowerCase().endsWith('.json')
  if (isJson) return null
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type.toLowerCase())) return 'Unsupported format. Choose a JPEG, PNG, or WebP photograph.'
  return null
}

export function categoryLabel(category: ProtectCategory) {
  return category === 'other' ? 'Other background feature' : category[0].toUpperCase() + category.slice(1)
}

export function nextPointName(category: ProtectCategory, graph: RoomObject[]): string {
  const base = category === 'other' ? 'other background feature' : category
  if (!graph.some((point) => point.name === base)) return base
  let index = 2
  while (graph.some((point) => point.name === `${base} ${index}`)) index += 1
  return `${base} ${index}`
}

export function placeManualAnnotation(category: ProtectCategory, x: number, y: number, graph: RoomObject[]): RoomObject | null {
  const name = nextPointName(category, graph)
  return { name, x, y, width: 0, height: 0, pointOrigin: 'manual', confirmed: true }
}

export function suggestionFromRegion(region: { x: number; y: number; width: number; height: number }, index: number): VisualSuggestion {
  return { id: `region-${index}-${region.x}-${region.y}`, ...region, label: 'Unidentified object', accepted: false }
}

export function acceptVisualSuggestion(suggestion: VisualSuggestion, graph: RoomObject[], category: ProtectCategory): RoomObject | null {
  if (suggestion.accepted) return null
  return {
    name: nextPointName(category, graph),
    x: suggestion.x,
    y: suggestion.y,
    width: suggestion.width,
    height: suggestion.height,
    pointOrigin: 'local',
    confirmed: true,
  }
}

export function imageClickToCoordinates(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) {
  const coords = clientToImageCoords(clientX, clientY, rect)
  return { x: Math.round(coords.x), y: Math.round(coords.y) }
}
