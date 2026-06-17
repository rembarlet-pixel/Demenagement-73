export interface Annonce {
  id: string
  titre: string
  prix: number
  surface?: number
  ville: string
  codePostal?: string
  latitude: number
  longitude: number
  hasExactCoords: boolean
  datePublication: string  // ISO string
  ageJours: number
  lienAnnonce: string
  source: 'pap' | 'seloger' | 'leboncoin' | 'autre'
  description?: string
  imageUrl?: string
}

export const COULEURS = {
  vert:   { fill: '#22c55e', stroke: '#15803d' },
  jaune:  { fill: '#eab308', stroke: '#a16207' },
  rouge:  { fill: '#ef4444', stroke: '#b91c1c' },
  violet: { fill: '#a855f7', stroke: '#7e22ce' },
} as const

export type CouleurDot = keyof typeof COULEURS

export function couleurDot(ageJours: number, hasExactCoords: boolean): CouleurDot {
  if (!hasExactCoords) return 'violet'
  if (ageJours <= 7)   return 'vert'
  if (ageJours <= 14)  return 'jaune'
  return 'rouge'
}

export function couleurParAge(ageJours: number): Exclude<CouleurDot, 'violet'> {
  if (ageJours <= 7)  return 'vert'
  if (ageJours <= 14) return 'jaune'
  return 'rouge'
}
