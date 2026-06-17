'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Annonce } from '@/types/annonce'
import { COULEURS, couleurDot, couleurParAge } from '@/types/annonce'

// ── Corridor Barberaz → Montmélian ───────────────────────────────────────────
const MAP_CENTER: [number, number] = [45.527, 5.998]
const MAP_ZOOM   = 12
const MAP_BOUNDS: [[number, number], [number, number]] = [[45.42, 5.84], [45.65, 6.16]]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatAge(jours: number): string {
  if (jours < 1)  return "aujourd'hui"
  if (jours < 2)  return 'hier'
  return `il y a ${Math.round(jours)} j`
}

function sourceLabel(s: string): string {
  if (s === 'pap')       return 'PAP.fr'
  if (s === 'leboncoin') return 'LeBonCoin'
  return s
}

function messageContact(a: Annonce): string {
  return `Bonjour,\n\nJe suis intéressé par votre appartement T3 à ${a.ville} au prix de ${a.prix}€/mois charges comprises (annonce du ${formatDate(a.datePublication)}).\n\nPouvez-vous me confirmer les disponibilités et me donner davantage d'informations ?\n\nCordialement,\nRémi`
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CityCluster = {
  ville: string
  latitude: number
  longitude: number
  annonces: Annonce[]
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function Carte() {
  const [annonces,  setAnnonces]  = useState<Annonce[]>([])
  const [loading,   setLoading]   = useState(true)
  const [erreur,    setErreur]    = useState<string | null>(null)
  const [selected,  setSelected]  = useState<Annonce | null>(null)
  const [cluster,   setCluster]   = useState<CityCluster | null>(null)
  const [copied,    setCopied]    = useState(false)

  useEffect(() => {
    fetch('/api/annonces')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { setAnnonces(d.annonces ?? []); setLoading(false) })
      .catch(e => { setErreur(e.message); setLoading(false) })
  }, [])

  // Annonces avec adresse précise → dots colorés
  const exactAnnonces = useMemo(
    () => annonces.filter(a => a.hasExactCoords),
    [annonces]
  )

  // Annonces sans adresse → groupées par ville → dots violets
  const cityClusters = useMemo<CityCluster[]>(() => {
    const groups: Record<string, CityCluster> = {}
    for (const a of annonces.filter(x => !x.hasExactCoords)) {
      const key = a.ville.toLowerCase().trim()
      if (!groups[key]) {
        groups[key] = { ville: a.ville, latitude: a.latitude, longitude: a.longitude, annonces: [] }
      }
      groups[key].annonces.push(a)
    }
    return Object.values(groups)
  }, [annonces])

  const closePanel = useCallback(() => {
    setSelected(null)
    setCluster(null)
    setCopied(false)
  }, [])

  const handleCopy = useCallback((a: Annonce) => {
    navigator.clipboard.writeText(messageContact(a)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }).catch(() => {
      // Fallback si clipboard bloqué
      const ta = document.createElement('textarea')
      ta.value = messageContact(a)
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }, [])

  const counts = {
    vert:   exactAnnonces.filter(a => a.ageJours <= 7).length,
    jaune:  exactAnnonces.filter(a => a.ageJours > 7 && a.ageJours <= 14).length,
    rouge:  exactAnnonces.filter(a => a.ageJours > 14).length,
    violet: annonces.filter(a => !a.hasExactCoords).length,
  }

  return (
    <div style={{ height: '100dvh', position: 'relative', background: '#050d1a' }}>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .panel-slide { animation: slideUp 0.22s cubic-bezier(.22,.68,0,1.2); }
        .listing-row:hover { border-color: rgba(59,130,246,0.4) !important; background: #1a2e48 !important; }
        .btn-voir:hover { background: #1d4ed8 !important; }
        .btn-copier:hover { background: #1e3a5f !important; }
      `}</style>

      <MapContainer
        center={MAP_CENTER}
        zoom={MAP_ZOOM}
        maxBounds={MAP_BOUNDS}
        maxBoundsViscosity={0.85}
        minZoom={10}
        maxZoom={17}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />

        {/* Dots colorés — adresse précise */}
        {exactAnnonces.map(a => {
          const cle   = couleurDot(a.ageJours, true)
          const color = COULEURS[cle]
          return (
            <CircleMarker
              key={a.id}
              center={[a.latitude, a.longitude]}
              radius={13}
              pathOptions={{ color: color.stroke, fillColor: color.fill, fillOpacity: 0.92, weight: 2 }}
              eventHandlers={{ click: () => { setSelected(a); setCluster(null); setCopied(false) } }}
            />
          )
        })}

        {/* Dots violets — clusters par ville */}
        {cityClusters.map(c => (
          <CircleMarker
            key={`cluster-${c.ville}`}
            center={[c.latitude, c.longitude]}
            radius={16}
            pathOptions={{ color: COULEURS.violet.stroke, fillColor: COULEURS.violet.fill, fillOpacity: 0.9, weight: 2.5 }}
            eventHandlers={{ click: () => { setCluster(c); setSelected(null); setCopied(false) } }}
          />
        ))}
      </MapContainer>

      {/* ── HUD haut gauche ── */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 1000,
        background: 'rgba(5,13,26,0.93)',
        border: '1px solid rgba(59,130,246,0.25)',
        borderRadius: 12, padding: '10px 14px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        backdropFilter: 'blur(8px)',
        minWidth: 175,
      }}>
        <div style={{ fontSize: 9, letterSpacing: 2.5, color: '#3b82f6', textTransform: 'uppercase', marginBottom: 10, fontWeight: 700 }}>
          Appart 73 · T3 ≤ 850€
        </div>
        {loading ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>Chargement des annonces...</div>
        ) : erreur ? (
          <div style={{ color: '#ef4444', fontSize: 12 }}>Erreur : {erreur}</div>
        ) : (
          <>
            <LegendeDot color={COULEURS.vert.fill}   label={`${counts.vert} · 1–7 jours`} />
            <LegendeDot color={COULEURS.jaune.fill}  label={`${counts.jaune} · 8–14 jours`} />
            <LegendeDot color={COULEURS.rouge.fill}  label={`${counts.rouge} · 15–30 jours`} />
            <LegendeDot color={COULEURS.violet.fill} label={`${counts.violet} · par ville`} />
            <div style={{ marginTop: 8, borderTop: '1px solid rgba(59,130,246,0.1)', paddingTop: 7, fontSize: 11, color: '#475569' }}>
              {annonces.length} annonce{annonces.length !== 1 ? 's' : ''} au total
            </div>
          </>
        )}
      </div>

      {/* ── Panel bas — annonce seule ── */}
      {selected && (
        <BottomPanel onClose={closePanel}>
          <AnnonceDetail
            annonce={selected}
            onCopy={() => handleCopy(selected)}
            copied={copied}
          />
        </BottomPanel>
      )}

      {/* ── Panel bas — cluster ville ── */}
      {cluster && !selected && (
        <BottomPanel onClose={closePanel}>
          <ClusterDetail
            cluster={cluster}
            onSelect={a => { setSelected(a); setCopied(false) }}
          />
        </BottomPanel>
      )}
    </div>
  )
}

// ── Sous-composants ───────────────────────────────────────────────────────────

function LegendeDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <span style={{
        width: 10, height: 10, borderRadius: '50%', background: color,
        flexShrink: 0, display: 'inline-block', boxShadow: `0 0 4px ${color}66`,
      }} />
      <span style={{ color: '#94a3b8', fontSize: 11 }}>{label}</span>
    </div>
  )
}

function BottomPanel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="panel-slide"
      style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2000,
        background: '#0c1628',
        border: '1px solid rgba(59,130,246,0.18)',
        borderBottom: 'none',
        borderRadius: '18px 18px 0 0',
        maxHeight: '72vh',
        overflowY: 'auto',
        padding: '0 20px 36px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.6)',
      }}
    >
      {/* Barre de drag + bouton fermeture */}
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        padding: '12px 0 8px', position: 'relative',
      }}>
        <div style={{ width: 36, height: 4, background: '#1e3a5f', borderRadius: 2 }} />
        <button
          onClick={onClose}
          style={{
            position: 'absolute', right: 0, top: 8,
            background: 'none', border: 'none', color: '#475569',
            cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '2px 4px',
          }}
        >
          ×
        </button>
      </div>
      {children}
    </div>
  )
}

function AgeBadge({ ageJours }: { ageJours: number }) {
  const c = couleurParAge(ageJours)
  const col = COULEURS[c]
  return (
    <span style={{
      background: col.fill + '20',
      color: col.fill,
      border: `1px solid ${col.fill}40`,
      borderRadius: 100,
      padding: '3px 10px',
      fontSize: 11,
      fontWeight: 600,
      whiteSpace: 'nowrap',
    }}>
      {formatAge(ageJours)}
    </span>
  )
}

function AnnonceDetail({
  annonce: a,
  onCopy,
  copied,
}: {
  annonce: Annonce
  onCopy: () => void
  copied: boolean
}) {
  return (
    <>
      {/* Titre + badge âge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700, lineHeight: 1.4, margin: 0, flex: 1 }}>
          {a.titre}
        </h2>
        <AgeBadge ageJours={a.ageJours} />
      </div>

      {/* Chips : prix + surface + ville */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Chip
          top={<><span style={{ color: '#3b82f6', fontSize: 22, fontWeight: 800 }}>{a.prix}</span><span style={{ color: '#64748b', fontSize: 14 }}>€</span></>}
          bottom="CC / mois"
        />
        {a.surface && (
          <Chip
            top={<span style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700 }}>{a.surface} m²</span>}
            bottom="surface"
          />
        )}
        <Chip
          top={<span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{a.ville}</span>}
          bottom={a.codePostal ?? '73'}
        />
      </div>

      {/* Description */}
      {a.description && (
        <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.7, marginBottom: 14 }}>
          {a.description.length > 240 ? a.description.slice(0, 237) + '…' : a.description}
        </p>
      )}

      {/* Méta */}
      <div style={{ color: '#475569', fontSize: 11, marginBottom: 18 }}>
        Source : <span style={{ color: '#64748b' }}>{sourceLabel(a.source)}</span>
        {' · '}Publiée le <span style={{ color: '#64748b' }}>{formatDate(a.datePublication)}</span>
      </div>

      {/* Boutons */}
      <div style={{ display: 'flex', gap: 10 }}>
        <a
          href={a.lienAnnonce}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-voir"
          style={{
            flex: 1, display: 'block', padding: '14px', textAlign: 'center',
            background: '#1e40af',
            color: '#fff',
            borderRadius: 12,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 700,
            transition: 'background 0.15s',
          }}
        >
          Voir l'annonce →
        </a>
        <button
          onClick={onCopy}
          className="btn-copier"
          style={{
            flex: 1, padding: '14px',
            background: copied ? '#15803d' : '#132030',
            color: copied ? '#fff' : '#94a3b8',
            border: `1px solid ${copied ? '#15803d' : '#1e3a5f'}`,
            borderRadius: 12,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 700,
            transition: 'all 0.2s',
          }}
        >
          {copied ? '✓ Message copié !' : 'Copier le message'}
        </button>
      </div>
    </>
  )
}

function ClusterDetail({
  cluster,
  onSelect,
}: {
  cluster: CityCluster
  onSelect: (a: Annonce) => void
}) {
  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 800, margin: '0 0 3px' }}>
          {cluster.ville}
        </h2>
        <div style={{ color: '#64748b', fontSize: 12 }}>
          {cluster.annonces.length} annonce{cluster.annonces.length > 1 ? 's' : ''} — cliquer pour le détail
        </div>
      </div>

      {cluster.annonces.map(a => (
        <div
          key={a.id}
          className="listing-row"
          onClick={() => onSelect(a)}
          style={{
            background: '#132030',
            borderRadius: 12,
            padding: '13px 15px',
            marginBottom: 10,
            cursor: 'pointer',
            border: '1px solid rgba(59,130,246,0.08)',
            transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 4,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {a.titre}
              </div>
              <div style={{ color: '#475569', fontSize: 11 }}>{sourceLabel(a.source)}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
              <span style={{ color: '#3b82f6', fontWeight: 800, fontSize: 16 }}>{a.prix}€</span>
              <AgeBadge ageJours={a.ageJours} />
            </div>
          </div>
        </div>
      ))}
    </>
  )
}

function Chip({ top, bottom }: { top: React.ReactNode; bottom: string }) {
  return (
    <div style={{
      background: '#132030',
      borderRadius: 10,
      padding: '8px 14px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>{top}</div>
      <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{bottom}</div>
    </div>
  )
}
