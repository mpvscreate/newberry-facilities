import { useState, useMemo, useCallback, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useOrg } from '../hooks/useOrg'
import { usePlants } from '../hooks/usePlants'
import Cube from '../components/Cube'
import FaceNav from '../components/FaceNav'
import Particles from '../components/Particles'
import PlantModal from '../components/PlantModal'
import type { Plant, OrgTheme } from '../lib/types'

const DEFAULT_THEME: OrgTheme = {
  autumn: '#c0622f', winter: '#4a7fa5', spring: '#6aaa5e',
  summer: '#e8b84b', companion: '#9b6bb5', indigenous: '#5f9e8f',
  wood: '#c8a97a', wood_dark: '#9c7a52',
}

export default function OrgPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const { org, loading: orgLoading, error: orgError } = useOrg(orgSlug)
  const { byFace, loading: plantsLoading, error: plantsError } = usePlants(org?.id)
  const [faceState, setFaceState] = useState({ index: 0, version: 0 })
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null)
  const activeFace = faceState.index

  const theme = useMemo<OrgTheme>(() => org?.theme ?? DEFAULT_THEME, [org])

  const themeVars = useMemo<Record<string, string>>(() => ({
    '--autumn': theme.autumn,
    '--winter': theme.winter,
    '--spring': theme.spring,
    '--summer': theme.summer,
    '--companion': theme.companion,
    '--indigenous': theme.indigenous,
    '--wood': theme.wood,
    '--wood-dark': theme.wood_dark,
    '--bg': '#f7f3ed',
    '--surface': '#faf5ee',
    '--text': '#3d3326',
    '--text2': '#888',
    '--border': 'rgba(200,169,122,0.35)',
    '--card-bg': 'rgba(200,169,122,0.12)',
    '--header-bg': 'rgba(247,243,237,0.93)',
    '--nav-bg': 'rgba(247,243,237,0.93)',
    '--modal-bg': '#faf5ee',
    '--panel-light-autumn': 'linear-gradient(135deg,#fff5ee,#fde8d5)',
    '--panel-light-winter': 'linear-gradient(135deg,#eef5ff,#d5e8f5)',
    '--panel-light-spring': 'linear-gradient(135deg,#efffee,#d5f5d8)',
    '--panel-light-summer': 'linear-gradient(135deg,#fffbee,#fdf0c2)',
    '--panel-light-companion': 'linear-gradient(135deg,#f8eeff,#edd5f5)',
    '--panel-light-indigenous': 'linear-gradient(135deg,#eefaf8,#d5f0ea)',
  }), [theme])

  useEffect(() => {
    const root = document.documentElement
    for (const [key, value] of Object.entries(themeVars)) {
      root.style.setProperty(key, value)
    }
    return () => {
      for (const key of Object.keys(themeVars)) {
        root.style.removeProperty(key)
      }
    }
  }, [themeVars])

  const handleFaceChange = useCallback((index: number) => {
    setFaceState(prev => ({ index, version: prev.version + 1 }))
  }, [])

  const handlePlantClick = useCallback((plant: Plant) => {
    setSelectedPlant(plant)
  }, [])

  const handleModalClose = useCallback(() => {
    setSelectedPlant(null)
  }, [])

  if (orgLoading || plantsLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
      </div>
    )
  }

  if (orgError || plantsError) {
    return (
      <div className="error-container">
        <h1>Something went wrong</h1>
        <p>{orgError || plantsError}</p>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="error-container">
        <h1>Not Found</h1>
        <p>No organization found for "{orgSlug}"</p>
      </div>
    )
  }

  return (
    <div>
      <header className="cube-header">
        <div className="header-brand">
          <h1>{org.name}</h1>
        </div>
      </header>

      <Particles activeFace={activeFace} />

      <Cube
        byFace={byFace}
        theme={theme}
        onPlantClick={handlePlantClick}
        activeFace={activeFace}
        faceVersion={faceState.version}
        onFaceChange={handleFaceChange}
      />

      <FaceNav
        activeFace={activeFace}
        theme={theme}
        onFaceChange={handleFaceChange}
      />

      {selectedPlant && (
        <PlantModal
          plant={selectedPlant}
          theme={theme}
          ageBandLabels={org.age_band_labels}
          onClose={handleModalClose}
        />
      )}
    </div>
  )
}
