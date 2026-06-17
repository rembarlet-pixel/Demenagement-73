// Sources d'annonces : PAP RSS + LeBonCoin (extraction __NEXT_DATA__)

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
  source: 'pap' | 'leboncoin'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractPrix(text: string): number | undefined {
  // Patterns: "750€/mois", "800 €/mois", "750€cc", "800€ charges comprises"
  const cleaned = text.replace(/\s/g, '')
  const matches = [...cleaned.matchAll(/(\d{3,4})€/g)]
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
  // Code postal 73xxx
  const cpMatch = text.match(/\b(73\d{3})\b/)
  const codePostal = cpMatch?.[1]

  // Ville après "à", "sur", "en", ou devant le code postal
  let ville: string | undefined
  if (codePostal) {
    const beforeCp = text.slice(0, text.indexOf(codePostal))
    const villeMatch = beforeCp.match(/([A-ZÀ-Ÿ][A-Za-zÀ-ÿ\s'-]{2,30})\s*[-–(]?\s*$/)
    ville = villeMatch?.[1]?.trim()
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
  try {
    return new Date(raw).toISOString()
  } catch {
    return new Date().toISOString()
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── PAP RSS ───────────────────────────────────────────────────────────────────

const PAP_RSS_URLS = [
  'https://www.pap.fr/rss/annonces/locations?typebien[]=appartement&nb_pieces[]=3&prixmax=850&localisation[]=departement-73',
  'https://www.pap.fr/rss/annonces/locations?typebien[]=appartement&nb_pieces[]=3&prix_max=850&departement=73',
  'https://www.pap.fr/rss/annonces/locations?typebien[]=appartement&nb_pieces[]=3&prixmax=850&cp=73',
]

function parseRssItems(xml: string): RawListing[] {
  const results: RawListing[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    const getTag = (tag: string): string => {
      const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`))
      return (m?.[1] ?? m?.[2] ?? '').trim()
    }
    const getAttr = (tag: string, attr: string): string => {
      const m = block.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']*)["']`))
      return m?.[1] ?? ''
    }

    const titre  = getTag('title')
    const lien   = getTag('link') || getTag('guid')
    const desc   = getTag('description')
    const pubDate = getTag('pubDate')
    const imageUrl = getAttr('enclosure', 'url') || undefined

    const textBrut = `${titre} ${stripHtml(desc)}`
    const prix     = extractPrix(textBrut)
    const surface  = extractSurface(textBrut)
    const { ville, codePostal } = extractVille(textBrut)
    const adresseRue = extractAdresseRue(stripHtml(desc))

    if (!lien) continue

    results.push({
      id: `pap-${Buffer.from(lien).toString('base64').slice(0, 12)}`,
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
      source: 'pap',
    })
  }

  return results
}

export async function fetchPAP(): Promise<RawListing[]> {
  for (const url of PAP_RSS_URLS) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) continue
      const xml = await res.text()
      const items = parseRssItems(xml)
      if (items.length > 0) return items
    } catch (e) {
      console.error('[PAP] fetch failed:', url, e)
    }
  }
  return []
}

// ── LeBonCoin ─────────────────────────────────────────────────────────────────

export async function fetchLBC(): Promise<RawListing[]> {
  // LeBonCoin n'a pas de RSS public - on parse le __NEXT_DATA__ de leur page de recherche
  const url = 'https://www.leboncoin.fr/recherche?category=10&real_estate_type=2&price=max-850&rooms=3&sort_by=time&sort_order=desc'
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return []

    const html = await res.text()
    const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
    if (!ndMatch) return []

    const data = JSON.parse(ndMatch[1])
    const ads: any[] = data?.props?.pageProps?.searchData?.ads ?? []

    return ads.map((ad: any) => {
      const prix    = ad.price?.[0]
      const titre   = ad.subject ?? ''
      const lien    = ad.url
        ? (ad.url.startsWith('http') ? ad.url : `https://www.leboncoin.fr${ad.url}`)
        : ''
      const desc    = ad.body ?? ''
      const pubDate = parsePubDate(ad.first_publication_date ?? ad.index_date ?? '')
      const ville   = ad.location?.city ?? ''
      const cp      = ad.location?.zipcode ?? ''
      const lat     = ad.location?.lat
      const lng     = ad.location?.lng
      const imgUrl  = ad.images?.urls?.[0]

      const surfAttr = (ad.attributes ?? []).find((a: any) => a.key === 'square')
      const surface  = surfAttr ? parseInt(surfAttr.value) : extractSurface(titre + ' ' + desc)
      const adresseRue = extractAdresseRue(desc)

      return {
        id: `lbc-${ad.list_id ?? Date.now()}`,
        titre: titre.slice(0, 150),
        lien,
        description: desc.trim().slice(0, 600),
        pubDate,
        imageUrl: imgUrl,
        prix,
        surface,
        ville: ville || undefined,
        codePostal: cp || undefined,
        adresseRue,
        latLng: lat && lng ? { lat, lng } : undefined,
        source: 'leboncoin',
      } satisfies RawListing
    })
  } catch (e) {
    console.error('[LBC] fetch failed:', e)
    return []
  }
}
