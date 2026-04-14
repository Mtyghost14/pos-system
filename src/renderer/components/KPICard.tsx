interface KPICardProps {
  label: string
  value: string
  icon?: string
  color?: string
  subtitle?: string
}

const accents: Record<string, { gradient: string; glow: string; text: string }> = {
  blue:   { gradient: 'linear-gradient(145deg, #6b9cf0, #4d7ee8)', glow: 'rgba(77,126,232,0.35)',  text: '#4d7ee8' },
  green:  { gradient: 'linear-gradient(145deg, #46cf80, #2fa85d)', glow: 'rgba(47,168,93,0.35)',   text: '#2fa85d' },
  yellow: { gradient: 'linear-gradient(145deg, #fbc84a, #e8a91a)', glow: 'rgba(232,169,26,0.35)',  text: '#c98f00' },
  red:    { gradient: 'linear-gradient(145deg, #e8504c, #cc2f2a)', glow: 'rgba(204,47,42,0.35)',   text: '#cc2f2a' },
  purple: { gradient: 'linear-gradient(145deg, #b47ee8, #9058cc)', glow: 'rgba(144,88,204,0.35)',  text: '#9058cc' },
  gray:   { gradient: 'linear-gradient(145deg, #c8cdd5, #adb4be)', glow: 'rgba(150,160,175,0.3)',  text: '#7a8796' },
}

export default function KPICard({ label, value, icon, color = 'blue', subtitle }: KPICardProps) {
  const accent = accents[color] || accents.blue

  return (
    <div
      style={{
        background: 'var(--nm-bg)',
        borderRadius: 20,
        padding: '20px 22px',
        boxShadow: 'var(--nm-raised)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative glow blob */}
      <div style={{
        position: 'absolute', top: -20, right: -20,
        width: 80, height: 80, borderRadius: '50%',
        background: `radial-gradient(circle, ${accent.glow} 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      {/* Icon */}
      {icon && (
        <div style={{
          width: 42, height: 42, borderRadius: 13,
          background: accent.gradient,
          boxShadow: `3px 3px 8px ${accent.glow}, -2px -2px 6px rgba(255,255,255,0.6)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, marginBottom: 4,
        }}>
          {icon}
        </div>
      )}

      {/* Value */}
      <div style={{
        fontSize: 26, fontWeight: 900, color: 'var(--nm-text)',
        letterSpacing: '-0.02em', lineHeight: 1,
      }}>
        {value}
      </div>

      {/* Label */}
      <div style={{
        fontSize: 12, fontWeight: 700, color: 'var(--nm-text-muted)',
        letterSpacing: '0.04em', textTransform: 'uppercase',
      }}>
        {label}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <div style={{
          fontSize: 11, fontWeight: 600, color: 'var(--nm-text-light)',
          marginTop: 2,
        }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}
