import { NextResponse } from 'next/server'
import type { Annonce } from '@/types/annonce'
import { fetchPAP, fetchSeLoger, fetchLBC, type RawListing } from '@/lib/sources'
import { geocodeAdresse } from '@/lib/geocode'

export const dynamic   = 'force-dynamic'
export const revalidate = 0

const BOUNDS = { minLat: 45.45, maxLat: 45.63, minLng: 5.87, maxLng: 6.13 }

const VILLES_CORRIDOR: Record<string, { lat: number; lng: number; cp: string }> = {
  'barberaz':              { lat: 45.558, lng: 5.945, cp: '73000' },
  'jacob-bellecombette':   { lat: 45.554, lng: 5.959, cp: '73000' },
  'la ravoire':            { lat: 45.550, lng: 5.985, cp: '73490' },
  'saint-baldoph':         { lat: 45.538, lng: 5.993, cp: '73190' },
  'saint-alban-leysse':    { lat: 45.555, lng: 6.015, cp: '73230' },
  'challes-les-eaux':      { lat: 45.538, lng: 6.001, cp: '73190' },
  'challes les eaux':      { lat: 45.538, lng: 6.001, cp: '73190' },
  'barby':                 { lat: 45.530, lng: 6.022, cp: '73230' },
  'myans':                 { lat: 45.518, lng: 5.982, cp: '73800' },
  'sainte-helene-du-lac':  { lat: 45.516, lng: 6.037, cp: '73800' },
  'sainte helene du lac':  { lat: 45.516, lng: 6.037, cp: '73800' },
  'francin':               { lat: 45.510, lng: 6.041, cp: '73800' },
  'arbin':                 { lat: 45.507, lng: 6.051, cp: '73800' },
  'cruet':                 { lat: 45.499, lng: 6.054, cp: '73800' },
  'montmelian':            { lat: 45.504, lng: 6.052, cp: '73800' },
  'montmélian':            { lat: 45.504, lng: 6.052, cp: '73800' },
  'planaise':              { lat: 45.510, lng: 6.060, cp: '73800' },
  'sonnaz':                { lat: 45.577, lng: 5.961, cp: '73000' },
  'bassens':               { lat: 45.580, lng: 5.972, cp: '73000' },
}

function normalizeVille(v: string): string {
  return v.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['']/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function inBounds(lat: number, lng: number): boolean {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat
      && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng
}

function ageJours(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000
}

// Cache : ne cache que si on a des résultats
let cache: { data: Annonce[]; debug: object; ts: number } | null = null
const CACHE_TTL = 15 * 60 * 1000

async function processListing(r: RawListing): Promise<Annonce | null> {
  const age = ageJours(r.pubDate)
  if (age > 30) return null
  if (r.prix !== undefined && r.prix > 850) return null
  if (!r.lien) return null

  const base = {
    id: r.id,
    titre: r.titre || 'Appartement à louer',
    prix: r.prix ?? 0,
    surface: r.surface,
    datePublication: r.pubDate,
    ageJours: age,
    lienAnnonce: r.lien,
    source: r.source,
    description: r.description,
    imageUrl: r.imageUrl,
  }

  // LBC avec coords fournies
  if (r.latLng) {
    const { lat, lng } = r.latLng
    if (inBounds(lat, lng)) {
      return { ...base, ville: r.ville ?? '', codePostal: r.codePostal, latitude: lat, longitude: lng, hasExactCoords: false }
    }
    // Hors corridor → on quand même essaie par ville si dispo
  }

  if (!r.ville && !r.codePostal) return null

  // Ville connue du corridor ?
  const villeNorm = normalizeVille(r.ville ?? '')
  const known = VILLES_CORRIDOR[villeNorm]

  // Essai géocodage adresse précise
  if (r.adresseRue && r.ville) {
    try {
      const geo = await geocodeAdresse(`${r.adresseRue} ${r.ville}`, r.codePostal)
      if (geo && inBounds(geo.lat, geo.lng)) {
        return {
          ...base,
          ville: r.ville,
          codePostal: r.codePostal,
          latitude: geo.lat,
          longitude: geo.lng,
          hasExactCoords: geo.type === 'housenumber' || geo.type === 'street',
        }
      }
    } catch {}
  }

  // Ville connue → coordonnées fixes
  if (known) {
    return {
      ...base,
      ville: r.ville ?? '',
      codePostal: r.codePostal ?? known.cp,
      latitude: known.lat,
      longitude: known.lng,
      hasExactCoords: false,
    }
  }

  // Géocodage par ville via API adresse
  if (r.ville) {
    try {
      const geo = await geocodeAdresse(r.ville, r.codePostal)
      if (geo && inBounds(geo.lat, geo.lng)) {
        return {
          ...base,
          ville: r.ville,
          codePostal: r.codePostal,
          latitude: geo.lat,
          longitude: geo.lng,
          hasExactCoords: false,
        }
      }
    } catch {}
  }

  return null
}

export async function GET() {
  if (cache && cache.data.length > 0 && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json({ annonces: cache.data, cached: true, debug: cache.debug })
  }

  const [papResult, selogerResult, lbcResult] = await Promise.all([
    fetchPAP(),
    fetchSeLoger(),
    fetchLBC(),
  ])

  const debug = {
    pap:     { raw: papResult.listings.length,     urls: papResult.debug },
    seloger: { raw: selogerResult.listings.length, urls: selogerResult.debug },
    lbc:     { raw: lbcResult.listings.length,     urls: lbcResult.debug },
  }

  const allRaw = [...papResult.listings, ...selogerResult.listings, ...lbcResult.listings]

  // Dédupliquer par lien
  const seen = new Set<string>()
  const unique = allRaw.filter(r => {
    if (!r.lien || seen.has(r.lien)) return false
    seen.add(r.lien)
    return true
  })

  // Traiter en parallèle par lots de 10
  const annonces: Annonce[] = []
  const BATCH = 10
  for (let i = 0; i < unique.length; i += BATCH) {
    const results = await Promise.all(unique.slice(i, i + BATCH).map(processListing))
    annonces.push(...results.filter((a): a is Annonce => a !== null))
  }

  annonces.sort((a, b) => a.ageJours - b.ageJours)

  if (annonces.length > 0) {
    cache = { data: annonces, debug, ts: Date.now() }
  }

  return NextResponse.json({ annonces, cached: false, debug })
}
