import type { CubeFace, OrgTheme } from '../lib/types'

const FACE_ORDER: CubeFace[] = ['autumn', 'winter', 'spring', 'summer', 'companion', 'indigenous']
const FACE_LABELS: Record<CubeFace, string> = {
  autumn: 'Autumn', winter: 'Winter', spring: 'Spring',
  summer: 'Summer', companion: 'Companion', indigenous: 'Indigenous',
}

interface Props {
  activeFace: number
  theme: OrgTheme
  onFaceChange: (index: number) => void
}

export default function FaceNav({ activeFace, theme, onFaceChange }: Props) {
  return (
    <nav className="face-nav" role="tablist" aria-label="Cube face navigation">
      {FACE_ORDER.map((face, i) => (
        <button
          key={face}
          className={`face-btn${i === activeFace ? ' active' : ''}`}
          style={{ background: theme[face] }}
          role="tab"
          aria-selected={i === activeFace}
          aria-label={FACE_LABELS[face]}
          onClick={() => onFaceChange(i)}
        />
      ))}
    </nav>
  )
}
