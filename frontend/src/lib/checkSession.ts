import type { DetectionSnapshot, Mask, SceneGraph } from './types'
import { settingsStore } from './storage'
import type { Composition, MethodChoice } from './composition'

export type PixelMask = { width: number; height: number; data: Uint8Array }
export type PhotoInput = { file: File | null; label: string; hash: string | null; graph: SceneGraph; masks: Mask[]; pixelMask?: PixelMask | null; confirmed: boolean }
export type CheckSession = { step: number; original: PhotoInput; suspicious: PhotoInput; blind: boolean; viewing: boolean; reviewed: boolean; caseId: string | null; detectedKeypoints?: { source: number; suspect: number } | null; localDetection?: DetectionSnapshot | null; methodChoice?: MethodChoice; composition?: Composition | null }
export const emptyPhoto = (): PhotoInput => ({ file: null, label: '', hash: null, graph: { room_objects: [] }, masks: [], confirmed: false })
export const emptyCheck = (): CheckSession => ({ step: 1, original: emptyPhoto(), suspicious: emptyPhoto(), blind: settingsStore().load().blindMode, viewing: false, reviewed: false, caseId: null, detectedKeypoints: null, localDetection: null })
// Files and redacted Proof media live in JS memory only. Refresh/closing the tab clears them.
let draft: CheckSession | null = null
let media: { caseId: string; original: Blob | null; suspicious: Blob | null; blind: boolean } | null = null
export function getCheckSession() { return draft ?? emptyCheck() }
export function saveCheckSession(value: CheckSession) { draft = value }
export function clearCheckSession() { draft = null; media = null }
export function clearProofMedia() { media = null }
export function setProofMedia(value: NonNullable<typeof media>) { media = value }
export function getProofMedia(caseId: string) { return media?.caseId === caseId ? media : null }
export function proofNeedsViewingChoice(session: Pick<CheckSession, 'blind' | 'viewing'>) { return session.blind || !session.viewing }
