// Sources via allorigins.win (proxy CORS qui contourne les blocages IP cloud)

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

export interface SourceResult {
  listings: RawListing[]
  debug: { url: string; status: number; proxyStatus?: number; hasContent: boolean; rawCount: number; error?: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractPrix(text: string): number | undefined {
  const cleaned = text.replace(/[\s ]/g, '')
  for (const m of [...cleaned.matchAll(/(\d{3,4})(?:€|euros?)/gi)]) {
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
    const before = text.slice(Math.max(0, text.indexOf(codePostal) - 60), text.indexOf(codePostal))
    ville = before.match(/([A-ZÀ-Ÿa-zà-ÿ][A-Za-zÀ-ÿ\s'-]{2,30}?)\s*[-–(]?\s*$/)?.[1]?.trim()
  }
  if (!ville) {
    ville = text.match(/(?:à|sur|en)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ\s'-]{2,25}?)(?:\s*[-–(]|\s*\d|\s*$)/u)?.[1]?.trim()
  }
  return { ville, codePostal }
}

function extractAdresseRue(text: string): string | undefined {
  return text.match(/\b\d+[a-z]?\s+(?:rue|avenue|av\.|boulevard|bd\.|chemin|allée|impasse|place|route|résidence)\s+[A-Za-zÀ-ÿ\s'-]{3,40}/i)?.[0]?.trim()
}

function parsePubDate(raw: string): string {
  if (!raw) return new Date().toISOString()
  try { return new Date(raw).toISOString() } catch { return new Date().toISOString() }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

// ── Proxy allorigins.win ──────────────────────────────────────────────────────
// Fait la requête depuis ses serveurs (IP non-cloud) → contourne les blocages PAP/LBC

async function fetchViaProxy(targetUrl: string): Promise<{ content: string | null; proxyStatus: number; targetStatus?: number }> {
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}&timestamp=${Date.now()}`
  try {
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return { content: null, proxyStatus: res.status }
    const json = await res.json()
    const content = json.contents ?? null
    const targetStatus = json.status?.http_code ?? undefined
    return { content, proxyStatus: res.status, targetStatus }
  } catch (e: any) {
    return { content: null, proxyStatus: 0 }
  }
}

// ── Parser RSS générique ──────────────────────────────────────────────────────

function parseRssItems(xml: string, source: 'pap' | 'seloger' | 'leboncoin'): RawListing[] {
  const results: RawListing[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    const getTag = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\/${tag}>`))
      return (m?.[1] ?? m?.[2] ?? '').trim()
    }
    const getAttr = (tag: string, attr: string) =>
      block.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']*)["']`))?.[1] ?? ''

    const titre   = getTag('title')
    const lien    = getTag('link') || getTag('guid')
    const desc    = getTag('description')
    const pubDate = getTag('pubDate') || getTag('dc:date')
    if (!lien) continue

    const textBrut = `${titre} ${stripHtml(desc)}`
    const { ville, codePostal } = extractVille(textBrut)

    results.push({
      id: `${source}-${Buffer.from(lien).toString('base64').slice(0, 16)}`,
      titre: titre.slice(0, 150),
      lien,
      description: stripHtml(desc).slice(0, 600),
      pubDate: parsePubDate(pubDate),
      imageUrl: getAttr('enclosure', 'url') || undefined,
      prix: extractPrix(textBrut),
      surface: extractSurface(textBrut),
      ville,
      codePostal,
      adresseRue: extractAdresseRue(stripHtml(desc)),
      source,
    })
  }
  return results
}

// ── PAP.fr RSS via proxy ──────────────────────────────────────────────────────

const PAP_RSS_URLS = [
  'https://www.pap.fr/rss/annonces/locations?typebien[]=appartement&nb_pieces[]=3&prixmax=850&departement=73',
  'https://www.pap.fr/rss/annonces/locations?typebien[]=appartement&nb_pieces[]=3&prixmax=850&cp=73',
  'https://www.pap.fr/rss/annonces/locations?typebien[]=appartement&prixmax=850&departement=73',
  'https://www.pap.fr/rss/annonces/locations?annonce[]=34&typebien[]=appartement&nb_pieces[]=3&prixmax=850&departement=73',
]

export async function fetchPAP(): Promise<SourceResult> {
  const debug: SourceResult['debug'] = []

  for (const url of PAP_RSS_URLS) {
    const entry = { url, status: 0, proxyStatus: 0, hasContent: false, rawCount: 0 }
    const { content, proxyStatus, targetStatus } = await fetchViaProxy(url)
    entry.proxyStatus = proxyStatus
    entry.status = targetStatus ?? 0

    if (!content) { debug.push(entry); continue }
    entry.hasContent = true

    if (!content.includes('<item>')) {
      entry.error = `Pas d'items RSS (${content.slice(0, 100)})`
      debug.push(entry)
      continue
    }

    const listings = parseRssItems(content, 'pap')
    entry.rawCount = listings.length
    debug.push(entry)
    if (listings.length > 0) return { listings, debug }
  }

  return { listings: [], debug }
}

// ── LeBonCoin via proxy ───────────────────────────────────────────────────────

const LBC_URL = 'https://www.leboncoin.fr/recherche?category=10&real_estate_type=2&price=max-850&rooms=3&sort_by=time&sort_order=desc'

export async function fetchLBC(): Promise<SourceResult> {
  const entry = { url: LBC_URL, status: 0, proxyStatus: 0, hasContent: false, rawCount: 0 }
  const { content, proxyStatus, targetStatus } = await fetchViaProxy(LBC_URL)
  entry.proxyStatus = proxyStatus
  entry.status = targetStatus ?? 0

  if (!content) return { listings: [], debug: [{ ...entry, error: 'Proxy sans contenu' }] }
  entry.hasContent = true

  const ndMatch = content.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!ndMatch) {
    return { listings: [], debug: [{ ...entry, error: `Pas de __NEXT_DATA__ (${content.slice(0, 150)})` }] }
  }

  try {
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
        pubDate: parsePubDate(ad.first_publication_date ?? ''),
        imageUrl: ad.images?.urls?.[0],
        prix: ad.price?.[0],
        surface: surfAttr ? parseInt(surfAttr.value) : extractSurface(ad.subject ?? ''),
        ville: ad.location?.city ?? undefined,
        codePostal: ad.location?.zipcode ?? undefined,
        adresseRue: extractAdresseRue(ad.body ?? ''),
        latLng: (ad.location?.lat && ad.location?.lng) ? { lat: ad.location.lat, lng: ad.location.lng } : undefined,
        source: 'leboncoin' as const,
      }
    }).filter((l: RawListing) => !!l.lien)

    return { listings, debug: [entry] }
  } catch (e: any) {
    return { listings: [], debug: [{ ...entry, error: `Parse error: ${e?.message}` }] }
  }
}

// SeLoger désactivé (bloqé aussi)
export async function fetchSeLoger(): Promise<SourceResult> {
  return { listings: [], debug: [] }
}
