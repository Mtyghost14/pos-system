import { useState, useRef, useEffect } from 'react'
import type { Product } from '../types'

interface SearchInputProps {
  onSelect: (product: Product) => void
  placeholder?: string
  autoFocus?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
}

export default function SearchInput({ onSelect, placeholder, autoFocus, inputRef: externalRef }: SearchInputProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const internalRef = useRef<HTMLInputElement>(null)
  const ref: React.RefObject<HTMLInputElement> = (externalRef as React.RefObject<HTMLInputElement>) || internalRef
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const handleChange = (v: string) => {
    setQuery(v)
    clearTimeout(timerRef.current)
    if (!v.trim()) { setResults([]); setOpen(false); return }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      const res = await window.api.getProducts(v)
      setResults(res)
      setOpen(true)
      setLoading(false)
    }, 200)
  }

  const handleSelect = (p: Product) => {
    onSelect(p)
    setQuery('')
    setResults([])
    setOpen(false)
    ref.current?.focus()
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
          fontSize: 14, pointerEvents: 'none', opacity: 0.5,
        }}>🔍</span>
        <input
          ref={ref}
          value={query}
          onChange={e => handleChange(e.target.value)}
          placeholder={placeholder || 'Buscar producto...'}
          className="nm-input"
          autoComplete="off"
          style={{
            width: '100%',
            padding: '10px 14px 10px 38px',
            fontSize: 14,
          }}
        />
        {loading && (
          <span style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            fontSize: 12, color: 'var(--nm-text-light)',
          }}>⏳</span>
        )}
      </div>

      {open && results.length > 0 && (
        <div
          className="nm-scroll"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
            background: 'var(--nm-bg)',
            borderRadius: 14,
            boxShadow: 'var(--nm-raised)',
            maxHeight: 240,
            overflowY: 'auto',
            marginTop: 6,
          }}
        >
          {results.map((p, i) => (
            <div
              key={p.id}
              onClick={() => handleSelect(p)}
              style={{
                padding: '10px 14px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: i < results.length - 1
                  ? '1px solid transparent'
                  : 'none',
                transition: 'background 0.12s ease',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.background = 'rgba(91,141,238,0.06)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.background = 'transparent'
              }}
            >
              <div>
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--nm-text)' }}>{p.name}</span>
                <span style={{ fontSize: 11, color: 'var(--nm-text-light)', marginLeft: 8, fontWeight: 600 }}>{p.code}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--nm-accent)' }}>
                  ${p.price.toFixed(2)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--nm-text-light)', fontWeight: 600 }}>
                  {p.category_name}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && !loading && results.length === 0 && query.length > 1 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'var(--nm-bg)',
          borderRadius: 14,
          boxShadow: 'var(--nm-raised)',
          padding: '14px 16px',
          marginTop: 6,
          fontSize: 13,
          color: 'var(--nm-text-muted)',
          fontWeight: 600,
          textAlign: 'center',
        }}>
          Sin resultados para "{query}"
        </div>
      )}
    </div>
  )
}
