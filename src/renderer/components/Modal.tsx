import { useEffect } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export default function Modal({ title, onClose, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const maxWidths = { sm: 420, md: 560, lg: 720, xl: 960 }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        background: 'rgba(180, 190, 200, 0.5)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          background: 'var(--nm-bg)',
          borderRadius: 24,
          boxShadow: 'var(--nm-raised-lg)',
          width: '100%',
          maxWidth: maxWidths[size],
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px',
          boxShadow: '0 2px 0 var(--nm-shadow-light), 0 3px 0 var(--nm-shadow-dark)',
          flexShrink: 0,
        }}>
          <h2 style={{
            margin: 0, fontSize: 18, fontWeight: 900,
            color: 'var(--nm-text)', letterSpacing: '-0.01em',
          }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="nm-btn"
            style={{
              width: 36, height: 36, borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, color: 'var(--nm-text-muted)',
              fontWeight: 400, padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div
          className="nm-scroll"
          style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
