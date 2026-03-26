import { useState, useEffect } from 'react'

// ── Preset themes ─────────────────────────────────────────────────────
export const THEMES = {
  nexus: {
    name: 'Nexus',
    preview: ['#07070e', '#7c3aed', '#a855f7'],
    vars: {
      '--bg':        '#07070e',
      '--surface':   '#0c0c18',
      '--surface-2': '#111121',
      '--surface-3': '#161628',
      '--border':    'rgba(255,255,255,0.055)',
      '--border-2':  'rgba(255,255,255,0.10)',
      '--accent':    '#7c3aed',
      '--accent-2':  '#a855f7',
      '--accent-contrast': '#ffffff',
      '--glow':      'rgba(124,58,237,0.35)',
      '--text-1':    '#e8e8f2',
      '--text-2':    'rgba(232,232,242,0.55)',
      '--text-3':    'rgba(232,232,242,0.28)',
      '--green':     '#10b981',
      '--amber':     '#f59e0b',
      '--red':       '#ef4444',
      '--cyan':      '#06b6d4',
      '--mesh-1':    'rgba(124,58,237,0.06)',
      '--mesh-2':    'rgba(6,182,212,0.04)',
    }
  },
  vercel: {
    name: 'Vercel',
    preview: ['#000000', '#ffffff', '#888888'],
    vars: {
      '--bg':        '#000000',
      '--surface':   '#0a0a0a',
      '--surface-2': '#111111',
      '--surface-3': '#1a1a1a',
      '--border':    'rgba(255,255,255,0.08)',
      '--border-2':  'rgba(255,255,255,0.14)',
      '--accent':    '#ffffff',
      '--accent-2':  '#888888',
      '--accent-contrast': '#000000',
      '--glow':      'rgba(255,255,255,0.1)',
      '--text-1':    '#ededed',
      '--text-2':    'rgba(237,237,237,0.5)',
      '--text-3':    'rgba(237,237,237,0.25)',
      '--green':     '#50e3c2',
      '--amber':     '#f7b955',
      '--red':       '#ff4444',
      '--cyan':      '#79ffe1',
      '--mesh-1':    'rgba(255,255,255,0.02)',
      '--mesh-2':    'rgba(255,255,255,0.01)',
    }
  },
  terminal: {
    name: 'Terminal',
    preview: ['#020b02', '#00ff41', '#00cc33'],
    vars: {
      '--bg':        '#020b02',
      '--surface':   '#040f04',
      '--surface-2': '#071407',
      '--surface-3': '#0a1a0a',
      '--border':    'rgba(0,255,65,0.12)',
      '--border-2':  'rgba(0,255,65,0.22)',
      '--accent':    '#00ff41',
      '--accent-2':  '#00cc33',
      '--accent-contrast': '#020b02',
      '--glow':      'rgba(0,255,65,0.25)',
      '--text-1':    '#ccffcc',
      '--text-2':    'rgba(204,255,204,0.55)',
      '--text-3':    'rgba(204,255,204,0.28)',
      '--green':     '#00ff41',
      '--amber':     '#ffcc00',
      '--red':       '#ff3333',
      '--cyan':      '#00ffff',
      '--mesh-1':    'rgba(0,255,65,0.04)',
      '--mesh-2':    'rgba(0,255,65,0.02)',
    }
  },
  ocean: {
    name: 'Ocean',
    preview: ['#050d1a', '#0ea5e9', '#38bdf8'],
    vars: {
      '--bg':        '#050d1a',
      '--surface':   '#081526',
      '--surface-2': '#0c1d33',
      '--surface-3': '#112540',
      '--border':    'rgba(14,165,233,0.12)',
      '--border-2':  'rgba(14,165,233,0.22)',
      '--accent':    '#0ea5e9',
      '--accent-2':  '#38bdf8',
      '--accent-contrast': '#ffffff',
      '--glow':      'rgba(14,165,233,0.3)',
      '--text-1':    '#e0f2fe',
      '--text-2':    'rgba(224,242,254,0.55)',
      '--text-3':    'rgba(224,242,254,0.28)',
      '--green':     '#34d399',
      '--amber':     '#fbbf24',
      '--red':       '#f87171',
      '--cyan':      '#22d3ee',
      '--mesh-1':    'rgba(14,165,233,0.07)',
      '--mesh-2':    'rgba(56,189,248,0.04)',
    }
  },
  synthwave: {
    name: 'Synthwave',
    preview: ['#0d0017', '#ff2d78', '#bf5af2'],
    vars: {
      '--bg':        '#0d0017',
      '--surface':   '#120020',
      '--surface-2': '#180030',
      '--surface-3': '#1e003e',
      '--border':    'rgba(255,45,120,0.15)',
      '--border-2':  'rgba(255,45,120,0.25)',
      '--accent':    '#ff2d78',
      '--accent-2':  '#bf5af2',
      '--accent-contrast': '#ffffff',
      '--glow':      'rgba(255,45,120,0.35)',
      '--text-1':    '#ffe6f0',
      '--text-2':    'rgba(255,230,240,0.55)',
      '--text-3':    'rgba(255,230,240,0.28)',
      '--green':     '#05ffa1',
      '--amber':     '#ffb800',
      '--red':       '#ff453a',
      '--cyan':      '#65d9f5',
      '--mesh-1':    'rgba(255,45,120,0.07)',
      '--mesh-2':    'rgba(191,90,242,0.05)',
    }
  },
  midnight: {
    name: 'Midnight',
    preview: ['#0b0b14', '#f97316', '#fb923c'],
    vars: {
      '--bg':        '#0b0b14',
      '--surface':   '#10101c',
      '--surface-2': '#161626',
      '--surface-3': '#1c1c30',
      '--border':    'rgba(249,115,22,0.1)',
      '--border-2':  'rgba(249,115,22,0.18)',
      '--accent':    '#f97316',
      '--accent-2':  '#fb923c',
      '--accent-contrast': '#ffffff',
      '--glow':      'rgba(249,115,22,0.3)',
      '--text-1':    '#fff0e6',
      '--text-2':    'rgba(255,240,230,0.55)',
      '--text-3':    'rgba(255,240,230,0.28)',
      '--green':     '#4ade80',
      '--amber':     '#facc15',
      '--red':       '#f87171',
      '--cyan':      '#67e8f9',
      '--mesh-1':    'rgba(249,115,22,0.06)',
      '--mesh-2':    'rgba(251,146,60,0.03)',
    }
  },
}

// ── Apply theme to DOM ────────────────────────────────────────────────
export function applyTheme(vars) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v)
  }
  // Update mesh gradient on body
  const m1 = vars['--mesh-1'] ?? 'rgba(124,58,237,0.06)'
  const m2 = vars['--mesh-2'] ?? 'rgba(6,182,212,0.04)'
  document.body.style.backgroundImage = `
    radial-gradient(ellipse 80% 50% at 20% 0%, ${m1} 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 100%, ${m2} 0%, transparent 60%)
  `
}

// ── Persist / load ────────────────────────────────────────────────────
export function loadSavedTheme() {
  try {
    const saved = localStorage.getItem('nexus-theme')
    if (saved) {
      const parsed = JSON.parse(saved)
      applyTheme(parsed.vars)
      return parsed
    }
  } catch {}
  return { id: 'nexus', vars: THEMES.nexus.vars }
}

export function saveTheme(id, vars) {
  localStorage.setItem('nexus-theme', JSON.stringify({ id, vars }))
}

// ── ColorVar row ──────────────────────────────────────────────────────
function ColorRow({ label, varName, value, onChange }) {
  // Only show if it's a hex color (not rgba)
  const isHex = /^#[0-9a-f]{3,8}$/i.test(value?.trim())
  if (!isHex) return null

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 0' }}>
      <span style={{ fontSize:'11px', color:'var(--text-3)', fontFamily:'JetBrains Mono,monospace' }}>{varName}</span>
      <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
        <input
          type="color"
          value={value?.trim()}
          onChange={e => onChange(varName, e.target.value)}
          style={{
            width:'24px', height:'24px', border:'1px solid var(--border-2)',
            background:'none', cursor:'pointer', padding:'1px'
          }}
        />
        <span style={{ fontSize:'10px', fontFamily:'JetBrains Mono,monospace', color:'var(--text-3)', width:'60px' }}>
          {value}
        </span>
      </div>
    </div>
  )
}

// ── ThemePanel component ───────────────────────────────────────────────
export default function ThemePanel({ onClose }) {
  const [activeId, setActiveId] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nexus-theme') ?? '{}').id ?? 'nexus' } catch { return 'nexus' }
  })
  const [customVars, setCustomVars] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('nexus-theme') ?? '{}')
      return saved.vars ?? THEMES.nexus.vars
    } catch { return THEMES.nexus.vars }
  })
  const [tab, setTab] = useState('presets') // 'presets' | 'custom'

  function selectPreset(id) {
    setActiveId(id)
    const vars = THEMES[id].vars
    setCustomVars(vars)
    applyTheme(vars)
    saveTheme(id, vars)
  }

  function updateVar(varName, value) {
    const next = { ...customVars, [varName]: value }
    setCustomVars(next)
    setActiveId('custom')
    applyTheme(next)
    saveTheme('custom', next)
  }

  function exportCSS() {
    const lines = [':root {', ...Object.entries(customVars).map(([k,v]) => `  ${k}: ${v};`), '}']
    const blob = new Blob([lines.join('\n')], { type:'text/css' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'nexus-theme.css'; a.click()
    URL.revokeObjectURL(url)
  }

  // Editable color vars (hex only)
  const editableVars = ['--bg','--surface','--surface-2','--accent','--accent-2','--text-1','--green','--amber','--red','--cyan']

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:90, background:'rgba(0,0,0,0.4)', backdropFilter:'blur(2px)' }} />

      {/* Panel */}
      <div style={{
        position:'fixed', top:0, right:0, bottom:0, zIndex:100,
        width:'280px', background:'var(--surface)',
        borderLeft:'1px solid var(--border-2)',
        display:'flex', flexDirection:'column',
        animation:'slidePanel 0.2s cubic-bezier(0.16,1,0.3,1) both'
      }}>
        <style>{`
          @keyframes slidePanel {
            from { transform: translateX(280px); opacity: 0; }
            to   { transform: translateX(0);     opacity: 1; }
          }
        `}</style>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'12px 16px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <span style={{ fontSize:'11px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.9px', color:'var(--text-2)' }}>
            🎨 Theme Studio
          </span>
          <button onClick={onClose} style={{
            background:'none', border:'none', color:'var(--text-3)', cursor:'pointer',
            fontSize:'16px', lineHeight:1, padding:'2px 4px',
            transition:'color 0.15s'
          }}
          onMouseEnter={e=>e.target.style.color='var(--text-1)'}
          onMouseLeave={e=>e.target.style.color='var(--text-3)'}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          {['presets','custom'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                flex:1, padding:'8px', background:'none', border:'none', cursor:'pointer',
                fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.6px',
                color: tab===t ? 'var(--accent)' : 'var(--text-3)',
                borderBottom: tab===t ? '2px solid var(--accent)' : '2px solid transparent',
                transition:'all 0.15s'
              }}>
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex:1, overflowY:'auto', padding:'12px' }}>

          {tab === 'presets' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
              {Object.entries(THEMES).map(([id, theme]) => (
                <button key={id} onClick={() => selectPreset(id)}
                  style={{
                    display:'flex', alignItems:'center', gap:'12px',
                    padding:'10px 12px', background: activeId===id ? 'var(--surface-3)' : 'var(--surface-2)',
                    border:`1px solid ${activeId===id ? 'var(--accent)' : 'var(--border)'}`,
                    cursor:'pointer', textAlign:'left', transition:'all 0.15s',
                    position:'relative'
                  }}
                  onMouseEnter={e=>{ if(activeId!==id) e.currentTarget.style.borderColor='var(--border-2)' }}
                  onMouseLeave={e=>{ if(activeId!==id) e.currentTarget.style.borderColor='var(--border)' }}>

                  {/* Color swatches */}
                  <div style={{ display:'flex', gap:'3px', flexShrink:0 }}>
                    {theme.preview.map((c, i) => (
                      <div key={i} style={{ width:'16px', height:'28px', background:c, border:'1px solid rgba(255,255,255,0.1)' }} />
                    ))}
                  </div>

                  <div>
                    <div style={{ fontSize:'12px', fontWeight:600, color:'var(--text-1)', marginBottom:'2px' }}>{theme.name}</div>
                    <div style={{ fontSize:'10px', color:'var(--text-3)', fontFamily:'JetBrains Mono,monospace' }}>
                      {theme.vars['--accent']}
                    </div>
                  </div>

                  {activeId === id && (
                    <div style={{ marginLeft:'auto', width:'6px', height:'6px', background:'var(--accent)', flexShrink:0 }} />
                  )}
                </button>
              ))}
            </div>
          )}

          {tab === 'custom' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
              <p style={{ fontSize:'10px', color:'var(--text-3)', marginBottom:'8px', lineHeight:1.5 }}>
                Editá los CSS variables directamente. Se guardan en localStorage.
              </p>
              {editableVars.map(v => (
                <ColorRow
                  key={v}
                  varName={v}
                  value={customVars[v]}
                  onChange={updateVar}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding:'10px 12px', borderTop:'1px solid var(--border)', display:'flex', gap:'6px', flexShrink:0 }}>
          <button onClick={exportCSS}
            style={{ flex:1, padding:'7px', background:'var(--surface-2)', border:'1px solid var(--border-2)',
              fontSize:'10px', fontWeight:600, color:'var(--text-2)', cursor:'pointer',
              fontFamily:'inherit', letterSpacing:'0.3px', textTransform:'uppercase', transition:'all 0.15s' }}
            onMouseEnter={e=>{e.target.style.borderColor='var(--accent)';e.target.style.color='var(--accent)'}}
            onMouseLeave={e=>{e.target.style.borderColor='var(--border-2)';e.target.style.color='var(--text-2)'}}>
            Export CSS
          </button>
          <button onClick={() => selectPreset('nexus')}
            style={{ flex:1, padding:'7px', background:'var(--surface-2)', border:'1px solid var(--border-2)',
              fontSize:'10px', fontWeight:600, color:'var(--text-2)', cursor:'pointer',
              fontFamily:'inherit', letterSpacing:'0.3px', textTransform:'uppercase', transition:'all 0.15s' }}
            onMouseEnter={e=>{e.target.style.borderColor='var(--border-2)';e.target.style.color='var(--text-1)'}}
            onMouseLeave={e=>{e.target.style.borderColor='var(--border-2)';e.target.style.color='var(--text-2)'}}>
            Reset
          </button>
        </div>
      </div>
    </>
  )
}
