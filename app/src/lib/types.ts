export type CubeFace = 'autumn' | 'winter' | 'spring' | 'summer' | 'companion' | 'indigenous'

export interface OrgTheme {
  autumn: string
  winter: string
  spring: string
  summer: string
  companion: string
  indigenous: string
  wood: string
  wood_dark: string
}

export interface WeatherLocation {
  lat: number
  lon: number
  label: string
}

export interface Organization {
  id: string
  slug: string
  name: string
  tagline: string | null
  logo_url: string | null
  theme: OrgTheme
  weather_location: WeatherLocation | null
  age_band_labels: string[]
}

export interface PlantAges {
  toddler: string
  preschool: string
  lower: string
  upper: string
  middle: string
  high: string
}

export interface PlantDetails {
  months: string
  difficulty: string
  soil: string
  water: string
  pest: string
  harvest: string
  ages: PlantAges
  observation: string
}

export interface Plant {
  id: string
  org_id: string
  face: CubeFace
  name: string
  emoji: string
  duration: string | null
  image_url: string | null
  companions: string[]
  sort_order: number
  details: PlantDetails
  is_active: boolean
}

export interface EcoGuideEntry {
  id: string
  org_id: string
  tab: string
  title: string
  emoji: string
  sort_order: number
  data: Record<string, unknown>
  is_active: boolean
}

export interface JourneyStageOverride {
  id: string
  org_id: string
  stage_index: number
  stage: string
  emoji: string
  time_label: string
  tip: string
}

export interface BuilderContent {
  id: string
  org_id: string
  builder_key: string
  content: Record<string, unknown>
}
