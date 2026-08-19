import { useEffect, useRef, useState } from 'react'
import type { CubeFace } from '../lib/types'

const PARTICLE_EMOJIS: Record<CubeFace, string[]> = {
  autumn:     ['🍂', '🍁', '🌾'],
  winter:     ['❄️', '🌨', '💧'],
  spring:     ['🌸', '🌼', '🦋'],
  summer:     ['☀️', '🦋', '🌻'],
  companion:  ['🌿', '🌱', '🐞'],
  indigenous: ['🐝', '🌺', '🌿'],
}

const FACE_ORDER: CubeFace[] = ['autumn', 'winter', 'spring', 'summer', 'companion', 'indigenous']

interface Props {
  activeFace: number
}

export default function Particles({ activeFace }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [reducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
  const prevFace = useRef(activeFace)

  useEffect(() => {
    if (reducedMotion || document.hidden) return
    if (prevFace.current === activeFace) return
    prevFace.current = activeFace

    const container = containerRef.current
    if (!container) return
    const face = FACE_ORDER[activeFace]
    const emojis = PARTICLE_EMOJIS[face] || ['✨']
    const count = window.innerWidth <= 700 ? 5 : 10

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const p = document.createElement('div')
        p.className = 'particle'
        p.textContent = emojis[Math.floor(Math.random() * emojis.length)]
        p.style.left = `${Math.random() * 100}vw`
        p.style.animationDuration = `${2 + Math.random() * 3}s`
        p.style.animationDelay = `${Math.random() * 0.5}s`
        container.appendChild(p)
        setTimeout(() => p.remove(), 6000)
      }, i * 80)
    }
  }, [activeFace, reducedMotion])

  return <div className="particles-container" ref={containerRef} aria-hidden="true" />
}
