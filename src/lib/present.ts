import { MIN_USABLE_FOR_DERIVATIVE } from './align'
import type { AlignResult, Presentation } from './types'

/**
 * Wording for a real engine result.
 * Does not change the verdict. Low evidence stays "No link found" when that is what the engine returned.
 */
export function present(result: AlignResult): Presentation {
  if (result.verdict === 'Likely derivative') {
    return {
      state: 'likely_derivative',
      tone: 'success',
      label: 'Likely derivative',
      summary: 'The visible backgrounds strongly align from the same viewpoint.',
      note: null,
    }
  }

  if (result.verdict === 'No link found') {
    const thin = result.usable_points < MIN_USABLE_FOR_DERIVATIVE
    return {
      state: 'no_link',
      tone: 'slate',
      label: 'No link found',
      summary: 'No reliable visual connection was established.',
      note: thin
        ? `Only ${result.usable_points} shared background objects were available. This does not prove the images are unrelated.`
        : 'This does not prove the images are unrelated.',
    }
  }

  if (result.usable_points < MIN_USABLE_FOR_DERIVATIVE) {
    return {
      state: 'insufficient_background',
      tone: 'amber',
      label: 'Cannot determine',
      summary: 'Not enough background is visible.',
      note: `The engine returned Cannot determine. Fewer than ${MIN_USABLE_FOR_DERIVATIVE} shared background objects were available.`,
    }
  }

  // Enough shared points, middling agreement: distinguish a uniform shift
  // (consistent with a crop or resize) from genuinely scattered movement
  // (consistent with a different viewpoint). Informational only.
  if (result.uniform_shift) {
    return {
      state: 'different_viewpoint',
      tone: 'amber',
      label: 'Cannot determine',
      summary: 'The viewpoints do not align closely enough to establish a reliable connection.',
      note: 'All shared points moved together, which is consistent with a crop or resize rather than a moved camera. The engine stays conservative: this note never upgrades a verdict.',
    }
  }

  return {
    state: 'different_viewpoint',
    tone: 'amber',
    label: 'Cannot determine',
    summary: 'The viewpoints do not align closely enough to establish a reliable connection.',
    note: null,
  }
}

export function protectionLabel(result: AlignResult | null): 'Protected' | 'Limited protection' | 'Not protected' | 'Not available' {
  if (!result) return 'Not available'
  if (result.verdict === 'Likely derivative') return 'Protected'
  if (result.verdict === 'Cannot determine') return 'Limited protection'
  return 'Not protected'
}
