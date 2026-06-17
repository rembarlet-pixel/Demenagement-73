// Sources d'annonces : PAP + SeLoger + LeBonCoin

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
  const cleaned = text.replace(/\s/g, '')
  const matches = [...cleaned.matchAll(/(\d{3,4})€/g)]
  for (const m of matches) {
    const n = parseInt(m[1])
    if (n >= 300 && n <= 1200) return n
  }
  // Chercher "XXX euros"
  const m2 = text.match(/(\d{3,4})\s*euros/i)
  if (m2) {
    const n = parseInt(m2[1])
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
  const m = text.match(/\b\d+[a-z]?\s+(?:rue|avenue|av\.|boulevard|bd\.|chemin|allée|impasse|place|route|voie|résidence)\s+[A-Za-zÀ-ÿ\s'-]{3,40}/i)
  return m?.[0]?.trim()
}

function parsePubDate(raw: string): string {
  try { return new Date(raw).toISOString() }
  catch { return new Date().toISOString() }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

// ── Parser RSS générique ──────────────────────────────────────────────────────

function parseRssItems(xml: string, source: 'pap' | 'seloger' | 'leboncoin'): RawListing[] {
  const results: RawListing[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]

    const getTag = (tag: string): string => {
      const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\/${tag}>`))
      return (m?.[1] ?? m?.[2] ?? '').trim()
    }
    const getAttr = (tag: string, attr: string): string => {
      const m = block.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']*)["']`))
      return m?.[1] ?? ''
    }

    const titre   = getTag('title')
    const lien    = getTag('link') || getTag('guid')
    const desc    = getTag('description')
    const pubDate = getTag('pubDate') || getTag('dc:date') || getTag('lastBuildDate')
    const imageUrl = getAttr('enclosure', 'url') || undefined

    if (!lien) continue

    const textBrut   = `${titre} ${stripHtml(desc)}`
    const prix       = extractPrix(textBrut)
    const surface    = extractSurface(textBrut)
    const { ville, codePostal } = extractVille(textBrut)
    const adresseRue = extractAdresseRue(stripHtml(desc))

    results.push({
      id: `${source}-${Buffer.from(lien).toString('base64').slice(0, 16)}`,
      titre: titre.slice(0, 150),
      lien,
      description: stripHtml(desc).slice(0, 600),
      pubDate: parsePubDate(pubDate),
      imageUrl,
      prix,
      surface,
      ville,
      codePostal,
      adresseRue,
      source,
    })
  }
  return results
}

// ── PAP.fr ────────────────────────────────────────────────────────────────────

// Codes postaux du corridor Barberaz → Montmélian
const CP_CORRIDOR = '73000,73190,73230,73490,73800'

const PAP_RSS_URLS = [
  // Savoie (département 73), T3, ≤850€
  `https://www.pap.fr/rss/annonces/locations?typebien[]=appartement&nb_pieces[]=3&prixmax=850&departement=73`,
  `https://www.pap.fr/rss/annonces/locations?typebien[]=appartement&nb_pieces[]=3&prixmax=850&localisation[]=departement-73`,
  `https://www.pap.fr/rss/annonces/locations?typebien[]=appartement&nb_pieces[]=3&prix_max=850&cp=73`,
  `https://www.pap.fr/rss/annonces/locations?annonce[]=34&nb_pieces[]=3&prixmax=850&cp=73`,
  // Plus large (pas de filtre nb pièces, on filtre côté serveur)
  `https://www.pap.fr/rss/annonces/locations?typebien[]=appartement&prixmax=850&departement=73`,
]

export async function fetchPAP(): Promise<{ listings: RawListing[]; tried: string[]; error?: string }> {
  const tried: string[] = []

  for (const url of PAP_RSS_URLS) {
    tried.push(url)
    try {
      const res = await fetch(url, {
        headers: { ...BROWSER_HEADERS, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) continue

      const xml = await res.text()
      if (!xml.includes('<item>')) continue

      const items = parseRssItems(xml, 'pap')
      if (items.length > 0) return { listings: items, tried }
    } catch (e) {
      console.error('[PAP] error:', url, e)
    }
  }

  return { listings: [], tried, error: 'Aucune URL PAP n\'a retourné de résultats' }
}

// ── SeLoger ───────────────────────────────────────────────────────────────────

// SeLoger utilise des codes communes INSEE (73xxx) dans le paramètre "ci"
// T3 = 3 pièces, location (idtt=1), appartement (idtypebien=1)
const SELOGER_RSS_URLS = [
  `https://www.seloger.com/list.htm?ci=73000,73190,73230,73490,73800&idtypebien=1&idtt=1&nb_pieces=3&px_max=850&rss=1`,
  `https://www.seloger.com/list.htm?ci=73000,73190,73230,73490,73800&idtypebien=1&idtt=1&nb_pieces=3&px_max=850&output=rss`,
  `https://www.seloger.com/list.htm?inseecode=73000,73190,73230,73490,73800&idtypebien=1&idtt=1&nb_pieces=3&px_max=850&rss=1`,
  // Sans filtre nb pièces (filtre côté serveur)
  `https://www.seloger.com/list.htm?ci=73000,73190,73230,73490,73800&idtypebien=1&idtt=1&px_max=850&rss=1`,
]

export async function fetchSeLoger(): Promise<{ listings: RawListing[]; tried: string[]; error?: string }> {
  const tried: string[] = []

  for (const url of SELOGER_RSS_URLS) {
    tried.push(url)
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) continue

      const xml = await res.text()
      if (!xml.includes('<item>')) continue

      const items = parseRssItems(xml, 'seloger')
      if (items.length > 0) return { listings: items, tried }
    } catch (e) {
      console.error('[SeLoger] error:', url, e)
    }
  }

  return { listings: [], tried, error: 'Aucune URL SeLoger n\'a retourné de résultats' }
}

// ── LeBonCoin ─────────────────────────────────────────────────────────────────

export async function fetchLBC(): Promise<{ listings: RawListing[]; tried: string[]; error?: string }> {
  const url = 'https://www.leboncoin.fr/recherche?category=10&real_estate_type=2&price=max-850&rooms=3&sort_by=time&sort_order=desc'
  try {
    const res = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        'Accept': 'text/html,application/xhtml+xml',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return { listings: [], tried: [url], error: `HTTP ${res.status}` }

    const html = await res.text()
    const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
    if (!ndMatch) return { listings: [], tried: [url], error: '__NEXT_DATA__ introuvable (bot détecté?)' }

    const data = JSON.parse(ndMatch[1])
    const ads: any[] = data?.props?.pageProps?.searchData?.ads ?? []
    if (ads.length === 0) return { listings: [], tried: [url], error: 'ads[] vide dans __NEXT_DATA__' }

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
    })

    return { listings, tried: [url] }
  } catch (e: any) {
    return { listings: [], tried: [url], error: e?.message ?? String(e) }
  }
}
