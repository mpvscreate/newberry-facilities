import { useRef, useEffect, useCallback, useState } from 'react'
import type { Plant, CubeFace, OrgTheme } from '../lib/types'

const FACE_ORDER: CubeFace[] = ['autumn', 'winter', 'spring', 'summer', 'companion', 'indigenous']
const FACE_LABELS: Record<CubeFace, string> = {
  autumn: 'Autumn', winter: 'Winter', spring: 'Spring',
  summer: 'Summer', companion: 'Companion', indigenous: 'Indigenous',
}

const FACE_ROTATIONS: [number, number][] = [
  [-20,    0],   // front  — autumn
  [-20,  180],   // back   — winter
  [-20,   90],   // right  — spring
  [-20,  -90],   // left   — summer
  [ 70,    0],   // top    — companion
  [-110,   0],   // bottom — indigenous
]

const DRAG_THRESHOLD = 8

interface Props {
  byFace: Record<CubeFace, Plant[]>
  theme: OrgTheme
  onPlantClick: (plant: Plant) => void
  activeFace: number
  faceVersion: number
  onFaceChange: (index: number) => void
}

export default function Cube({ byFace, theme, onPlantClick, activeFace, faceVersion, onFaceChange }: Props) {
  const cubeRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const baseRX = useRef(FACE_ROTATIONS[0][0])
  const baseRY = useRef(FACE_ROTATIONS[0][1])
  const cubeScale = useRef(1)
  const isDragging = useRef(false)
  const pointerDown = useRef(false)
  const lastX = useRef(0)
  const lastY = useRef(0)
  const rafPending = useRef(false)
  const swipeStart = useRef({ x: 0, y: 0, t: 0 })
  const pinchDist0 = useRef(0)
  const pinchScale0 = useRef(1)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleRaf = useRef<number | null>(null)
  const faceIdx = useRef(activeFace)
  const wasDrag = useRef(false)
  const [reducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => { faceIdx.current = activeFace }, [activeFace])

  const applyRotation = useCallback(() => {
    const el = cubeRef.current
    if (el) {
      el.style.transform = `rotateX(${baseRX.current}deg) rotateY(${baseRY.current}deg) scale(${cubeScale.current})`
    }
    rafPending.current = false
  }, [])

  const scheduleRotation = useCallback(() => {
    if (!rafPending.current) {
      rafPending.current = true
      requestAnimationFrame(applyRotation)
    }
  }, [applyRotation])

  const stopIdle = useCallback(() => {
    if (idleRaf.current) { cancelAnimationFrame(idleRaf.current); idleRaf.current = null }
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null }
  }, [])

  const idleTick = useCallback(() => {
    if (!pointerDown.current && !isDragging.current && !document.hidden) {
      baseRY.current += 0.18
      const el = cubeRef.current
      if (el) {
        el.style.transform = `rotateX(${baseRX.current}deg) rotateY(${baseRY.current}deg) scale(${cubeScale.current})`
      }
    }
    idleRaf.current = requestAnimationFrame(idleTick)
  }, [])

  const startIdle = useCallback(() => {
    if (reducedMotion) return
    if (!idleRaf.current) idleRaf.current = requestAnimationFrame(idleTick)
  }, [reducedMotion, idleTick])

  const resetIdle = useCallback(() => {
    stopIdle()
    idleTimer.current = setTimeout(startIdle, 5000)
  }, [stopIdle, startIdle])

  const rotateTo = useCallback((fi: number) => {
    const [rx, ry] = FACE_ROTATIONS[fi]
    baseRX.current = rx
    baseRY.current = ry
    const el = cubeRef.current
    if (el) {
      el.style.transition = 'transform .6s ease'
      el.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) scale(${cubeScale.current})`
    }
  }, [])

  useEffect(() => {
    rotateTo(activeFace)
  }, [activeFace, faceVersion, rotateTo])

  useEffect(() => {
    const cube = cubeRef.current
    const stage = stageRef.current
    if (!cube || !stage) return

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      isDragging.current = false
      wasDrag.current = false
      pointerDown.current = true
      lastX.current = e.clientX
      lastY.current = e.clientY
      cube.style.transition = 'none'
      stopIdle()
      document.body.classList.add('is-dragging-cube')
      e.preventDefault()
    }

    const onMouseMove = (e: MouseEvent) => {
      const overStage = (e.target instanceof Node) && stage.contains(e.target as Node)
      document.body.classList.toggle('is-dragging-cube', pointerDown.current && overStage)
      if (pointerDown.current && e.buttons === 0) {
        isDragging.current = false
        pointerDown.current = false
        document.body.classList.remove('is-dragging-cube')
        resetIdle()
        return
      }
      const dx = e.clientX - lastX.current
      const dy = e.clientY - lastY.current
      lastX.current = e.clientX
      lastY.current = e.clientY
      if (!pointerDown.current || !overStage) return
      if (!isDragging.current && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
      isDragging.current = true
      wasDrag.current = true
      baseRY.current += dx * 0.4
      baseRX.current -= dy * 0.4
      scheduleRotation()
    }

    const onMouseUp = () => {
      isDragging.current = false
      pointerDown.current = false
      document.body.classList.remove('is-dragging-cube')
      resetIdle()
    }

    const onBlur = () => {
      isDragging.current = false
      pointerDown.current = false
      document.body.classList.remove('is-dragging-cube')
      resetIdle()
    }

    const onTouchStart = (e: TouchEvent) => {
      pointerDown.current = true
      stopIdle()
      cube.style.transition = 'none'
      if (e.touches.length === 1) {
        isDragging.current = false
        lastX.current = e.touches[0].clientX
        lastY.current = e.touches[0].clientY
        swipeStart.current = { x: lastX.current, y: lastY.current, t: Date.now() }
      }
      if (e.touches.length === 2) {
        isDragging.current = false
        pinchDist0.current = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        )
        pinchScale0.current = cubeScale.current
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!pointerDown.current) return
      if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        )
        cubeScale.current = Math.min(1.8, Math.max(0.65, pinchScale0.current * (d / pinchDist0.current)))
        scheduleRotation()
        return
      }
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - lastX.current
        const dy = e.touches[0].clientY - lastY.current
        if (!isDragging.current && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
        isDragging.current = true
        baseRY.current += dx * 0.4
        baseRX.current -= dy * 0.4
        lastX.current = e.touches[0].clientX
        lastY.current = e.touches[0].clientY
        scheduleRotation()
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!isDragging.current && e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - swipeStart.current.x
        const dy = e.changedTouches[0].clientY - swipeStart.current.y
        const dt = Date.now() - swipeStart.current.t
        if (dt < 400 && Math.abs(dx) > 55 && Math.abs(dy) < 55) {
          const dir = dx < 0 ? 1 : -1
          const next = ((faceIdx.current + dir) + 6) % 6
          onFaceChange(next)
        }
      }
      isDragging.current = false
      if (e.touches.length === 0) { pointerDown.current = false; resetIdle() }
    }

    const onTouchCancel = () => {
      isDragging.current = false
      pointerDown.current = false
      resetIdle()
    }

    let lastTapTime = 0
    const onDoubleTap = (e: TouchEvent) => {
      if (e.changedTouches.length === 1 && !isDragging.current) {
        const now = Date.now()
        if (now - lastTapTime < 300) {
          cubeScale.current = 1
          cube.style.transition = 'transform .4s ease'
          cube.style.transform = `rotateX(${baseRX.current}deg) rotateY(${baseRY.current}deg) scale(1)`
          setTimeout(() => { cube.style.transition = 'none' }, 420)
        }
        lastTapTime = now
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) stopIdle(); else resetIdle()
    }

    cube.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onBlur)
    cube.addEventListener('touchstart', onTouchStart, { passive: true })
    stage.addEventListener('touchmove', onTouchMove, { passive: true })
    stage.addEventListener('touchend', onTouchEnd)
    stage.addEventListener('touchcancel', onTouchCancel)
    stage.addEventListener('touchend', onDoubleTap, { passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)

    resetIdle()

    return () => {
      cube.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onBlur)
      cube.removeEventListener('touchstart', onTouchStart)
      stage.removeEventListener('touchmove', onTouchMove)
      stage.removeEventListener('touchend', onTouchEnd)
      stage.removeEventListener('touchcancel', onTouchCancel)
      stage.removeEventListener('touchend', onDoubleTap)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopIdle()
    }
  }, [scheduleRotation, resetIdle, stopIdle, onFaceChange])

  const handlePanelClick = useCallback((plant: Plant) => {
    if (!wasDrag.current) onPlantClick(plant)
  }, [onPlantClick])

  return (
    <div className="cube-scene" ref={stageRef}>
      <div className="cube-stage">
        <div
          className="cube-wrapper"
          ref={cubeRef}
          style={{ transform: `rotateX(${FACE_ROTATIONS[activeFace][0]}deg) rotateY(${FACE_ROTATIONS[activeFace][1]}deg)` }}
        >
          {FACE_ORDER.map((face) => (
            <div key={face} className="cube-face" data-season={face} style={{
              '--face-color': theme[face],
              boxShadow: `0 0 0 4px ${theme[face]}`,
            } as React.CSSProperties}>
              {byFace[face].map((plant) => (
                <div
                  key={plant.id}
                  className="panel"
                  data-season={face}
                  role="button"
                  tabIndex={0}
                  aria-label={`${plant.name}, ${plant.duration ?? ''} — open details`}
                  onClick={() => handlePanelClick(plant)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handlePanelClick(plant)
                    }
                  }}
                >
                  <span className="p-emoji">{plant.emoji}</span>
                  <span className="p-name">{plant.name}</span>
                  {plant.duration && <span className="p-dur">{plant.duration}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="cube-hint" aria-live="polite">
        {FACE_LABELS[FACE_ORDER[activeFace]]} — drag to explore, click a plant for details
      </div>
    </div>
  )
}
