'use client'
import dynamic from 'next/dynamic'

const Carte = dynamic(() => import('@/components/Carte'), { ssr: false })

export default function Page() {
  return <Carte />
}
