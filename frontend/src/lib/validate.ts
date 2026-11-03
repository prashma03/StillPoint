/**
 * Strict scene-graph validation gate. Mirrors backend/validate.py: same error
 * codes, same rules. This gate fails closed on imported or proposed graphs;
 * the alignment engine stays lenient as a backstop and keeps its verdicts.
 *
 * Relationship fields (occludes, is_above, is_below) are carried through as
 * written, but they are unverified: nothing in this build checks them, and
 * the alignment engine never scores them.
 */
import { COORD_MAX, COORD_MIN, FORBIDDEN_NAMES, MIN_USABLE_FOR_VERDICT } from './align'
import type { RoomObject, SceneGraph } from './types'

export type ValidationIssue = { code: string; message: string }

export type ValidationReport = {
  object_count: number
  excluded_people: number
  duplicates: number
  invalid: number
  has_relationships: boolean
  coverage_percent: number | null
  sufficient_for_comparison: boolean
}

export type ValidationResult =
  | { ok: true; graph: SceneGraph; warnings: ValidationIssue[]; report: ValidationReport }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[]; report: ValidationReport }

const RELATIONSHIP_KEYS = ['occludes', 'is_above', 'is_below'] as const
const COORD_KEYS = ['x', 'y', 'width', 'height'] as const

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name || null
}

function emptyReport(): ValidationReport {
  return {
    object_count: 0,
    excluded_people: 0,
    duplicates: 0,
    invalid: 0,
    has_relationships: false,
    coverage_percent: null,
    sufficient_for_comparison: false,
  }
}

export function validateGraph(data: unknown): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const report = emptyReport()

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push({ code: 'not_an_object', message: 'A scene graph must be a JSON object.' })
    return { ok: false, errors, warnings, report }
  }
  const record = data as Record<string, unknown>
  const items = record.room_objects
  if (!Array.isArray(items)) {
    errors.push({ code: 'missing_room_objects', message: 'Expected room_objects: a list of named background objects.' })
    return { ok: false, errors, warnings, report }
  }
  if (items.length === 0) {
    errors.push({ code: 'empty_graph', message: 'No background objects were provided. There is nothing to compare.' })
    return { ok: false, errors, warnings, report }
  }

  const room_objects: RoomObject[] = []
  const seen = new Set<string>()
  items.forEach((item, index) => {
    const where = `Object ${index + 1}`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      report.invalid += 1
      errors.push({ code: 'unreadable_object', message: `${where} is not readable.` })
      return
    }
    const obj = item as Record<string, unknown>
    const name = cleanName(obj.name)
    if (name === null) {
      report.invalid += 1
      errors.push({ code: 'missing_name', message: `${where} needs a name.` })
      return
    }
    if (FORBIDDEN_NAMES.has(name.toLowerCase())) {
      report.excluded_people += 1
      return
    }
    const badCoord = COORD_KEYS.find((key) => {
      const value = obj[key]
      return !isNumber(value) || value < COORD_MIN || value > COORD_MAX
    })
    if (badCoord) {
      report.invalid += 1
      errors.push({
        code: 'bad_coordinates',
        message: `“${name}” needs numeric x, y, width, and height between 0 and 1000.`,
      })
      return
    }
    if (seen.has(name.toLowerCase())) {
      report.duplicates += 1
      errors.push({ code: 'duplicate_name', message: `“${name}” appears more than once. Rename or remove the repeat.` })
      return
    }
    seen.add(name.toLowerCase())
    const rels: Partial<RoomObject> = {}
    for (const key of RELATIONSHIP_KEYS) {
      const value = obj[key]
      if (value === undefined) continue
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        errors.push({ code: 'bad_relationships', message: `“${name}” has a “${key}” field that is not a list of names.` })
        report.invalid += 1
        return
      }
      if (value.length > 0) report.has_relationships = true
      rels[key] = [...value]
    }
    room_objects.push({
      name,
      x: obj.x as number,
      y: obj.y as number,
      width: obj.width as number,
      height: obj.height as number,
      ...rels,
    })
  })

  const coverage = record.coverage_percent
  if (coverage !== undefined) {
    if (!isNumber(coverage)) {
      errors.push({ code: 'bad_coverage', message: 'coverage_percent must be a number when provided.' })
    } else {
      report.coverage_percent = coverage
    }
  }
  const total = record.total_stable_points
  if (total !== undefined && !isNumber(total)) {
    errors.push({ code: 'bad_total', message: 'total_stable_points must be a number when provided.' })
  }

  if (report.excluded_people > 0) {
    warnings.push({
      code: 'people_excluded',
      message: `${report.excluded_people} person-named object(s) were excluded. People are never reference points.`,
    })
  }

  if (errors.length > 0) {
    report.object_count = room_objects.length
    report.sufficient_for_comparison = room_objects.length >= MIN_USABLE_FOR_VERDICT
    return { ok: false, errors, warnings, report }
  }
  if (room_objects.length === 0) {
    errors.push({
      code: 'no_background',
      message: 'Only person-named objects were provided. There is no background evidence to compare.',
    })
    return { ok: false, errors, warnings, report }
  }

  const graph: SceneGraph = { room_objects }
  if (report.coverage_percent !== null) graph.coverage_percent = report.coverage_percent
  if (isNumber(total)) graph.total_stable_points = total
  report.object_count = room_objects.length
  report.sufficient_for_comparison = room_objects.length >= MIN_USABLE_FOR_VERDICT
  if (!report.sufficient_for_comparison) {
    warnings.push({
      code: 'insufficient_detail',
      message: `Only ${room_objects.length} background object(s) provided; a decisive comparison needs at least ${MIN_USABLE_FOR_VERDICT} shared with the other graph.`,
    })
  }
  return { ok: true, graph, warnings, report }
}
