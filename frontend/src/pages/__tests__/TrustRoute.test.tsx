// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { CaseProvider } from '../../components/case'
import { Trust } from '../Trust'

afterEach(() => { cleanup(); sessionStorage.clear() })

describe('Trust dashboard', () => {
  it('opens a dedicated detail panel, returns to the dashboard, and reports verification as unavailable', () => {
    render(createElement(MemoryRouter, null, createElement(CaseProvider, null, createElement(Trust))))
    expect(screen.getByRole('heading', { name: 'Trust is built on transparency.' })).toBeTruthy()
    expect(screen.getAllByRole('button').filter(button => /Evidence Integrity|Privacy & Consent|Analysis Limits|Verify a Report/.test(button.textContent ?? '')).length).toBe(4)
    expect(document.querySelectorAll('.trust-welcome-art .sp-companion')).toHaveLength(1)
    expect(document.querySelectorAll('.trust-topic-art svg')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: /Evidence Integrity/ }))
    expect(screen.getByRole('button', { name: /Back to Trust/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Four independent evidence categories' })).toBeTruthy()
    expect(document.querySelector('.sp-companion')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Back to Trust/ }))
    fireEvent.click(screen.getByRole('button', { name: /Verify a Report/ }))
    expect(screen.getByText('Unavailable in this build')).toBeTruthy()
    expect(screen.getByText(/cannot verify a report signature/)).toBeTruthy()
  })
})
