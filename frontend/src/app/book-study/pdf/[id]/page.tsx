'use client'

import { use, useEffect, useState } from 'react'
import TopBar from '@/components/layout/TopBar'
import PdfReader from '@/components/book/PdfReader'
import { listPdfBooks } from '@/lib/api/client'

export default function PdfBookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [title, setTitle] = useState('')

  useEffect(() => {
    listPdfBooks()
      .then((books) => setTitle(books.find((b) => b.id === id)?.title ?? ''))
      .catch(() => {})
  }, [id])

  return (
    <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#e8e8e6' }}>
      <TopBar right={<span />} />
      <PdfReader bookId={id} title={title || id} />
    </main>
  )
}
