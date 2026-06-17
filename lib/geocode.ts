export interface GeoResult {
  lat: number
  lng: number
  type: 'housenumber' | 'street' | 'locality' | 'municipality'
  label: string
}

export async function geocodeAdresse(q: string, cp?: string): Promise<GeoResult | null> {
  try {
    const url = new URL('https://api-adresse.data.gouv.fr/search/')
    url.searchParams.set('q', q)
    url.searchParams.set('limit', '1')
    if (cp) url.searchParams.set('postcode', cp)

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const json = await res.json()
    const feat = json.features?.[0]
    if (!feat) return null

    return {
      lat: feat.geometry.coordinates[1],
      lng: feat.geometry.coordinates[0],
      type: feat.properties.type,
      label: feat.properties.label,
    }
  } catch {
    return null
  }
}

export async function geocodeBatch(items: Array<{ q: string; cp?: string }>): Promise<Array<GeoResult | null>> {
  const BATCH = 10
  const results: Array<GeoResult | null> = []
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH)
    const batch = await Promise.all(slice.map(({ q, cp }) => geocodeAdresse(q, cp)))
    results.push(...batch)
  }
  return results
}
