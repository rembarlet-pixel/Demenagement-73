// Sources : parse les pages de résultats HTML (approche __NEXT_DATA__ / JSON embarqué)

export interface RawListing {
  id: string
  titre: string
  lien: string
  description: string
  pubDate: string
  imageUrl?: string
  prix?: number
  surface?: number
  ville?: string
  codePostal?: string
  adresseRue?: string
  latLng?: { lat: number; lng: number }
  source: 'pap' | 'seloger' | 'leboncoin'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractPrix(text: string): number | undefined {
  const cleaned = text.replace(/[\s ]/g, '')
  const matches = [...cleaned.matchAll(/(\d{3,4})(?:€|euros?)/gi)]
  for (const m of matches) {
    const n = parseInt(m[1])
    if (n >= 300 && n <= 1200) return n
  }
  return undefined
}

function extractSurface(text: string): number | undefined {
  const m = text.match(/(\d{2,3})\s*m[²2]/i)
  if (!m) return undefined
  const n = parseInt(m[1])
  return n >= 20 && n <= 300 ? n : undefined
}

function extractVille(text: string): { ville?: string; codePostal?: string } {
  const cpMatch = text.match(/\b(73\d{3})\b/)
  const codePostal = cpMatch?.[1]
  let ville: string | undefined

  if (codePostal) {
    const idx = text.indexOf(codePostal)
    const before = text.slice(Math.max(0, idx - 60), idx)
    const m = before.match(/([A-ZÀ-Ÿa-zà-ÿ][A-Za-zÀ-ÿ\s'-]{2,30}?)\s*[-–(]?\s*$/)
    ville = m?.[1]?.trim()
  }
  if (!ville) {
    const m = text.match(/(?:à|sur|en)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ\s'-]{2,25}?)(?:\s*[-–(]|\s*\d|\s*$)/u)
    ville = m?.[1]?.trim()
  }
  return { ville, codePostal }
}

function extractAdresseRue(text: string): string | undefined {
  const m = text.match(/\b\d+[a-z]?\s+(?:rue|avenue|av\.|boulevard|bd\.|chemin|allée|impasse|place|route|résidence)\s+[A-Za-zÀ-ÿ\s'-]{3,40}/i)
  return m?.[0]?.trim()
}

function parsePubDate(raw: string): string {
  if (!raw) return new Date().toISOString()
  try { return new Date(raw).toISOString() }
  catch { return new Date().toISOString() }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Cache-Control': 'no-cache',
}

export interface SourceResult {
  listings: RawListing[]
  debug: { url: string; status: number; hasNextData: boolean; rawCount: number; error?: string }[]
}

// ── PAP.fr ────────────────────────────────────────────────────────────────────

// PAP est un site Next.js — on parse leur __NEXT_DATA__
const PAP_URLS = [
  'https://www.pap.fr/annonce/locations-appartement-savoie-g384-t_3-p_x_850',
  'https://www.pap.fr/annonce/locations-appartement-savoie-g73-t_3-p_x_850',
  'https://www.pap.fr/annonce/locations-appartement-rhone-alpes-savoie-g384-t_3-p_x_850',
  'https://www.pap.fr/annonce/locations-appartement-t_3-p_x_850?cp=73',
]

function parsePAPListings(items: any[]): RawListing[] {
  return items.map((item: any, i: number) => {
    const titre  = item.titre ?? item.title ?? item.libelle ?? ''
    const lien   = item.url ? `https://www.pap.fr${item.url}` : (item.lien ?? item.link ?? '')
    const prix   = item.prix ?? item.loyer ?? item.price ?? extractPrix(titre)
    const ville  = item.ville ?? item.city ?? item.localisation?.ville ?? ''
    const cp     = item.codePostal ?? item.cp ?? item.zipCode ?? ''
    const desc   = item.description ?? item.texte ?? item.body ?? ''
    const date   = item.dateCreation ?? item.date ?? item.publishedAt ?? item.updatedAt ?? ''
    const lat    = item.latitude ?? item.lat ?? item.geo?.lat
    const lng    = item.longitude ?? item.lng ?? item.lon ?? item.geo?.lng

    return {
      id: `pap-${item.id ?? item.idAnnonce ?? i}`,
      titre: String(titre).slice(0, 150),
      lien,
      description: stripHtml(String(desc)).slice(0, 600),
      pubDate: parsePubDate(String(date)),
      prix: prix ? parseInt(String(prix)) : undefined,
      surface: item.surface ?? item.surfaceHabitable ?? extractSurface(titre + ' ' + desc),
      ville: String(ville),
      codePostal: String(cp),
      adresseRue: item.adresse ?? extractAdresseRue(String(desc)),
      latLng: lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : undefined,
      source: 'pap',
    }
  }).filter(l => l.lien)
}

export async function fetchPAP(): Promise<SourceResult> {
  const debug: SourceResult['debug'] = []

  for (const url of PAP_URLS) {
    const entry: SourceResult['debug'][0] = { url, status: 0, hasNextData: false, rawCount: 0 }
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(12000) })
      entry.status = res.status
      if (!res.ok) { debug.push(entry); continue }

      const html = await res.text()
      const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)

      if (!ndMatch) { debug.push(entry); continue }
      entry.hasNextData = true

      const data = JSON.parse(ndMatch[1])
      const pp = data?.props?.pageProps

      // Chercher les annonces dans toutes les structures possibles
      const candidates = [
        pp?.annonces, pp?.listings, pp?.results, pp?.items, pp?.ads,
        pp?.searchResults?.annonces, pp?.searchResults?.listings, pp?.searchResults?.ads,
        pp?.data?.annonces, pp?.data?.listings,
        data?.props?.initialState?.annonces,
      ]
      const items = candidates.find(c => Array.isArray(c) && c.length > 0)

      if (items) {
        const listings = parsePAPListings(items)
        entry.rawCount = listings.length
        debug.push(entry)
        if (listings.length > 0) return { listings, debug }
      } else {
        // Debug : log les clés disponibles pour comprendre la structure
        entry.error = `Clés pageProps: ${Object.keys(pp ?? {}).join(', ')}`
        debug.push(entry)
      }
    } catch (e: any) {
      entry.error = e?.message
      debug.push(entry)
    }
  }

  return { listings: [], debug }
}

// ── LeBonCoin ─────────────────────────────────────────────────────────────────

const LBC_URLS = [
  'https://www.leboncoin.fr/recherche?category=10&real_estate_type=2&price=max-850&rooms=3&sort_by=time&sort_order=desc',
  // Recherche géographique centrée sur la Savoie (fallback)
  'https://www.leboncoin.fr/recherche?category=10&real_estate_type=2&price=max-850&rooms=3',
]

export async function fetchLBC(): Promise<SourceResult> {
  const debug: SourceResult['debug'] = []

  for (const url of LBC_URLS) {
    const entry: SourceResult['debug'][0] = { url, status: 0, hasNextData: false, rawCount: 0 }
    try {
      const res = await fetch(url, {
        headers: {
          ...BROWSER_HEADERS,
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Upgrade-Insecure-Requests': '1',
        },
        signal: AbortSignal.timeout(12000),
      })
      entry.status = res.status
      if (!res.ok) { debug.push(entry); continue }

      const html = await res.text()
      const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
      if (!ndMatch) { debug.push(entry); continue }

      entry.hasNextData = true
      const data = JSON.parse(ndMatch[1])
      const ads: any[] = data?.props?.pageProps?.searchData?.ads ?? []
      entry.rawCount = ads.length

      const listings: RawListing[] = ads.map((ad: any) => {
        const surfAttr = (ad.attributes ?? []).find((a: any) => a.key === 'square')
        return {
          id: `lbc-${ad.list_id ?? Date.now()}`,
          titre: (ad.subject ?? '').slice(0, 150),
          lien: ad.url ? (ad.url.startsWith('http') ? ad.url : `https://www.leboncoin.fr${ad.url}`) : '',
          description: (ad.body ?? '').slice(0, 600),
          pubDate: parsePubDate(ad.first_publication_date ?? ad.index_date ?? ''),
          imageUrl: ad.images?.urls?.[0],
          prix: ad.price?.[0],
          surface: surfAttr ? parseInt(surfAttr.value) : extractSurface(ad.subject ?? ''),
          ville: ad.location?.city ?? undefined,
          codePostal: ad.location?.zipcode ?? undefined,
          adresseRue: extractAdresseRue(ad.body ?? ''),
          latLng: (ad.location?.lat && ad.location?.lng) ? { lat: ad.location.lat, lng: ad.location.lng } : undefined,
          source: 'leboncoin',
        }
      }).filter((l: RawListing) => l.lien)

      debug.push(entry)
      if (listings.length > 0) return { listings, debug }
    } catch (e: any) {
      entry.error = e?.message
      debug.push(entry)
    }
  }

  return { listings: [], debug }
}

// SeLoger désactivé (URLs incorrectes, à reconfigurer)
export async function fetchSeLoger(): Promise<SourceResult> {
  return { listings: [], debug: [{ url: 'désactivé', status: 0, hasNextData: false, rawCount: 0, error: 'URLs à vérifier manuellement' }] }
}
