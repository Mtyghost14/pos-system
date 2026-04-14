interface TabDef {
  id: string
  label: string
}

interface PageShellProps {
  title: string
  tabs: TabDef[]
  activeTab: string
  onTabChange: (id: string) => void
  message?: string
  messageType?: 'ok' | 'err'
  children: React.ReactNode
}

export default function PageShell({ title, tabs, activeTab, onTabChange, message, messageType = 'ok', children }: PageShellProps) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--nm-bg)' }}>
      {/* Header */}
      <div style={{
        background: 'var(--nm-bg)',
        boxShadow: '0 3px 10px var(--nm-shadow-dark), 0 -1px 4px var(--nm-shadow-light)',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexShrink: 0,
        zIndex: 5,
      }}>
        <h1 style={{
          margin: 0, fontSize: 16, fontWeight: 900,
          color: 'var(--nm-text)', letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}>
          {title}
        </h1>
        {message && (
          <span style={{
            padding: '4px 14px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            background: messageType === 'ok'
              ? 'linear-gradient(145deg, #46cf80, #2fa85d)'
              : 'linear-gradient(145deg, #e8504c, #cc2f2a)',
            color: 'white',
            boxShadow: messageType === 'ok'
              ? '2px 2px 6px rgba(47,168,93,0.35)'
              : '2px 2px 6px rgba(204,47,42,0.35)',
          }}>
            {message}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        background: 'var(--nm-bg)',
        padding: '10px 16px',
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        flexShrink: 0,
        boxShadow: '0 2px 8px var(--nm-shadow-dark), 0 -1px 3px var(--nm-shadow-light)',
      }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            style={{
              padding: '7px 16px',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 800,
              whiteSpace: 'nowrap',
              fontFamily: 'Nunito, sans-serif',
              transition: 'all 0.18s ease',
              background: 'var(--nm-bg)',
              boxShadow: activeTab === t.id ? 'var(--nm-inset)' : 'var(--nm-raised-sm)',
              color: activeTab === t.id ? 'var(--nm-accent)' : 'var(--nm-text-muted)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div
        className="nm-scroll"
        style={{ flex: 1, overflowY: 'auto', padding: 16 }}
      >
        {children}
      </div>
    </div>
  )
}
