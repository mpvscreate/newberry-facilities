import { useEffect, useRef, useCallback } from 'react'
import type { Plant, CubeFace, OrgTheme } from '../lib/types'

const FACE_LABELS: Record<CubeFace, string> = {
  autumn: 'Autumn Planting', winter: 'Winter Planting', spring: 'Spring Planting',
  summer: 'Summer Planting', companion: 'Companion Planting', indigenous: 'Indigenous & Pollinator',
}
const FACE_EMOJIS: Record<CubeFace, string> = {
  autumn: '🍂', winter: '❄️', spring: '🌸',
  summer: '☀️', companion: '🌿', indigenous: '🐝',
}
const AGE_KEYS = ['toddler', 'preschool', 'lower', 'upper', 'middle', 'high'] as const
const AGE_DISPLAY: Record<string, string> = {
  toddler: 'Toddler', preschool: 'Preschool', lower: 'Lower Primary',
  upper: 'Upper Primary', middle: 'Middle School', high: 'High School',
}

interface Props {
  plant: Plant
  theme: OrgTheme
  ageBandLabels?: string[]
  onClose: () => void
}

export default function PlantModal({ plant, theme, ageBandLabels, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const face = plant.face
  const details = plant.details
  const difficulty = typeof details.difficulty === 'string'
    ? parseInt(details.difficulty, 10) || 0
    : (details.difficulty as unknown as number) || 0

  useEffect(() => {
    setTimeout(() => closeRef.current?.focus(), 80)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Tab') {
      const overlay = overlayRef.current
      if (!overlay) return
      const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus()
      }
    }
  }, [onClose])

  const ageLabels = ageBandLabels && ageBandLabels.length === 6
    ? Object.fromEntries(AGE_KEYS.map((k, i) => [k, ageBandLabels[i]]))
    : AGE_DISPLAY

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="modal-plant-name">
        <button className="modal-close" ref={closeRef} onClick={onClose} aria-label="Close plant details">
          ✕
        </button>
        <span className="modal-emoji">{plant.emoji}</span>
        <span className="modal-season-badge" style={{ background: theme[face] }}>
          {FACE_LABELS[face]}
        </span>
        <h2 id="modal-plant-name">{plant.name}</h2>
        <p className="modal-subtitle">
          {FACE_EMOJIS[face]} {FACE_LABELS[face]} · {plant.duration}
        </p>

        <div className="info-grid">
          <div className="info-card">
            <div className="label">Planting Months</div>
            <div className="value">{details.months}</div>
          </div>
          <div className="info-card">
            <div className="label">Duration</div>
            <div className="value">{plant.duration}</div>
          </div>
          <div className="info-card">
            <div className="label">Difficulty</div>
            <div className="value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="difficulty-dots">
                {[1, 2, 3].map(i => (
                  <div key={i} className={`dot${i <= difficulty ? ' filled' : ''}`} />
                ))}
              </div>
              <span>{['', 'Easy', 'Medium', 'Hard'][difficulty] || ''}</span>
            </div>
          </div>
          <div className="info-card">
            <div className="label">Water</div>
            <div className="value">{details.water}</div>
          </div>
          <div className="info-card full">
            <div className="label">Soil Preparation</div>
            <div className="value">{details.soil}</div>
          </div>
          <div className="info-card full">
            <div className="label">Companion Plants</div>
            <div className="value">{plant.companions?.join(', ')}</div>
          </div>
          <div className="info-card full">
            <div className="label">Organic Pest Control</div>
            <div className="value">{details.pest}</div>
          </div>
          <div className="info-card full">
            <div className="label">Harvest Indicator</div>
            <div className="value">{details.harvest}</div>
          </div>
        </div>

        <div className="section-title">Age-Appropriate Activities</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {AGE_KEYS.map(age => {
            const text = details.ages?.[age]
            if (!text) return null
            return (
              <div className="tip-box" key={age}>
                <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text2)', marginBottom: 3 }}>
                  {ageLabels[age] || age}
                </div>
                {text}
              </div>
            )
          })}
        </div>

        {details.observation && (
          <>
            <div className="section-title">Montessori Observation Prompt</div>
            <div className="tip-box">{details.observation}</div>
          </>
        )}
      </div>
    </div>
  )
}
