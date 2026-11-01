import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function Mark({ size = 28, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <svg
      className={animate ? 'mark is-anim' : 'mark'}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path d="M16 5.2 26.2 16 16 26.8 5.8 16Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="16" cy="5.2" r="1.7" />
      <circle cx="26.2" cy="16" r="1.7" />
      <circle cx="16" cy="26.8" r="1.7" />
      <circle cx="5.8" cy="16" r="1.7" />
      <circle cx="16" cy="16" r="2.15" />
    </svg>
  )
}

type ButtonProps = {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
  to?: string
  type?: 'button' | 'submit'
  disabled?: boolean
  onClick?: () => void
  className?: string
  pressed?: boolean
}

export function Button({
  children,
  variant = 'primary',
  to,
  type = 'button',
  disabled,
  onClick,
  className = '',
  pressed,
}: ButtonProps) {
  const cls = `btn btn-${variant} ${className}`.trim()
  if (to && !disabled) {
    return (
      <Link className={cls} to={to} onClick={onClick}>
        {children}
      </Link>
    )
  }
  return (
    <button className={cls} type={type} disabled={disabled} onClick={onClick} aria-pressed={pressed}>
      {children}
    </button>
  )
}

export function PageHeader({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: string }) {
  return (
    <header className="page-head">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="lede">{lede}</p>
    </header>
  )
}

export function MetricList({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="metrics">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd className="num">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(query.matches)
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])
  return reduced
}

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title === 'Home' ? 'Stillpoint — Proof without seeing.' : `Stillpoint — ${title}`
  }, [title])
}

export function Dialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="dialog-title"
    >
      <h2 id="dialog-title">{title}</h2>
      {children}
      <div className="actions">
        <Button onClick={onConfirm}>{confirmLabel}</Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </dialog>
  )
}
