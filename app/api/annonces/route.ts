import { NextResponse } from 'next/server'
import type { Annonce } from '@/types/annonce'
import { fetchPAP, fetchLBC } from '@/lib/sources'
import { geocodeAdresse, geocodeBatch } from '@/lib/geocode'

export const dynamic   = 'force-dynamic'
export const revalidate = 0

// Corridor Barberaz → Montmélian (73), avec marge
const BOUNDS = { minLat: 45.45, maxLat: 45.63, minLng: 5.87, maxLng: 6.13 }

// Villes connues du corridor avec leur centre approximatif (pour purple dots)
const VILLES_CORRIDOR: Record<string, { lat: number; lng: number; cp: string }> = {
  'barberaz':              { lat: 45.558, lng: 5.945, cp: '73000' },
  'jacob-bellecombette':   { lat: 45.554, lng: 5.959, cp: '73000' },
  'la ravoire':            { lat: 45.550, lng: 5.985, cp: '73490' },
  'saint-baldoph':         { lat: 45.538, lng: 5.993, cp: '73190' },
  'saint-alban-leysse':    { lat: 45.555, lng: 6.015, cp: '73230' },
  'challes-les-eaux':      { lat: 45.538, lng: 6.001, cp: '73190' },
  'barby':                 { lat: 45.530, lng: 6.022, cp: '73230' },
  'myans':                 { lat: 45.518, lng: 5.982, cp: '73800' },
  'sainte-helene-du-lac':  { lat: 45.516, lng: 6.037, cp: '73800' },
  'francin':               { lat: 45.510, lng: 6.041, cp: '73800' },
  'arbin':                 { lat: 45.507, lng: 6.051, cp: '73800' },
  'cruet':                 { lat: 45.499, lng: 6.054, cp: '73800' },
  'montmelian':            { lat: 45.504, lng: 6.052, cp: '73800' },
  'planaise':              { lat: 45.510, lng: 6.060, cp: '73800' },
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

// Cache mémoire simple (15 min)
let cache: { data: Annonce[]; ts: number } | null = null
const CACHE_TTL = 15 * 60 * 1000

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json({ annonces: cache.data, cached: true })
  }

  // ── 1. Fetch toutes les sources en parallèle ──────────────────────────────
  const [papRaw, lbcRaw] = await Promise.all([fetchPAP(), fetchLBC()])
  const allRaw = [...papRaw, ...lbcRaw]

  // ── 2. Dédupliquer par lien ───────────────────────────────────────────────
  const seen = new Set<string>()
  const unique = allRaw.filter(r => {
    if (!r.lien || seen.has(r.lien)) return false
    seen.add(r.lien)
    return true
  })

  // ── 3. Filtres rapides : prix, date ───────────────────────────────────────
  const MAX_JOURS = 30
  const filtered = unique.filter(r => {
    if (r.prix !== undefined && r.prix > 850) return false
    const age = ageJours(r.pubDate)
    if (age > MAX_JOURS) return false
    return true
  })

  // ── 4. Geocoding ──────────────────────────────────────────────────────────
  const annonces: Annonce[] = []

  await Promise.all(filtered.map(async (r) => {
    const age = ageJours(r.pubDate)
    const base = {
      id: r.id,
      titre: r.titre,
      prix: r.prix ?? 0,
      surface: r.surface,
      datePublication: r.pubDate,
      ageJours: age,
      lienAnnonce: r.lien,
      source: r.source,
      description: r.description,
      imageUrl: r.imageUrl,
    }

    // Cas LBC avec coords : vérifier qu'elles sont dans le corridor
    if (r.latLng) {
      const { lat, lng } = r.latLng
      if (inBounds(lat, lng)) {
        annonces.push({
          ...base,
          ville: r.ville ?? '',
          codePostal: r.codePostal,
          latitude: lat,
          longitude: lng,
          hasExactCoords: false,  // LBC obfusque l'adresse exacte
        })
      }
      return
    }

    // Ville connue du corridor ?
    const villeNorm = normalizeVille(r.ville ?? '')
    const villeCorridorData = VILLES_CORRIDOR[villeNorm]

    if (r.adresseRue && r.ville) {
      // Essayer de geocoder l'adresse précise
      const q   = `${r.adresseRue} ${r.ville}`
      const geo = await geocodeAdresse(q, r.codePostal)
      if (geo && inBounds(geo.lat, geo.lng)) {
        const hasExact = geo.type === 'housenumber' || geo.type === 'street'
        annonces.push({
          ...base,
          ville: r.ville,
          codePostal: r.codePostal,
          latitude: geo.lat,
          longitude: geo.lng,
          hasExactCoords: hasExact,
        })
        return
      }
    }

    if (r.ville) {
      // Geocoder par ville
      const knownPos = villeCorridorData
      if (knownPos) {
        annonces.push({
          ...base,
          ville: r.ville,
          codePostal: r.codePostal ?? knownPos.cp,
          latitude: knownPos.lat,
          longitude: knownPos.lng,
          hasExactCoords: false,
        })
        return
      }

      // Ville inconnue : geocoder via l'API adresse
      const geo = await geocodeAdresse(r.ville, r.codePostal)
      if (geo && inBounds(geo.lat, geo.lng)) {
        annonces.push({
          ...base,
          ville: r.ville,
          codePostal: r.codePostal,
          latitude: geo.lat,
          longitude: geo.lng,
          hasExactCoords: false,
        })
      }
      // Si hors corridor → on ignore
    }
  }))

  // ── 5. Trier du plus récent au plus ancien ────────────────────────────────
  annonces.sort((a, b) => a.ageJours - b.ageJours)

  cache = { data: annonces, ts: Date.now() }
  return NextResponse.json({ annonces, cached: false })
}
