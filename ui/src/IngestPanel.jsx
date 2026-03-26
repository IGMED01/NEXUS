import { useState, useRef, useCallback } from 'react'

// ── helpers ────────────────────────────────────────────────────────────────
async function apiFetch(method, path, body) {
  try {
    const res = await fetch(path, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  } catch (e) {
    return { ok: false, data: { error: true, message: e.message } }
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = e => resolve(e.target.result)
    reader.onerror = () => reject(new Error('Error reading file'))
    reader.readAsText(file, 'utf-8')
  })
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

const ACCEPTED = ['.txt', '.md', '.mdx', '.json', '.csv', '.log', '.yaml', '.yml', '.pdf']
const ACCEPTED_MIME = ['text/', 'application/json', 'application/pdf', 'text/plain', 'text/markdown']

function isAccepted(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase()
  if (ACCEPTED.includes(ext)) return true
  return ACCEPTED_MIME.some(m => file.type.startsWith(m))
}

// ── sub-components ─────────────────────────────────────────────────────────
function Tag({ children, color }) {
  const colorMap = {
    violet: { bg:'rgba(124,58,237,0.1)', border:'rgba(124,58,237,0.25)', fg:'#a855f7' },
    green:  { bg:'rgba(16,185,129,0.08)', border:'rgba(16,185,129,0.2)', fg:'#10b981' },
    amber:  { bg:'rgba(245,158,11,0.08)', border:'rgba(245,158,11,0.2)', fg:'#f59e0b' },
    red:    { bg:'rgba(239,68,68,0.08)', border:'rgba(239,68,68,0.2)', fg:'#ef4444' },
    muted:  { bg:'var(--surface-3)', border:'var(--border)', fg:'var(--text-3)' },
  }
  const c = colorMap[color] ?? colorMap.muted
  return (
    <span style={{ fontSize:'9px', fontFamily:'JetBrains Mono,monospace', padding:'2px 8px',
      background:c.bg, border:`1px solid ${c.border}`, color:c.fg, display:'inline-flex', alignItems:'center', gap:'4px' }}>
      {children}
    </span>
  )
}

function ChunkCard({ chunk, index }) {
  return (
    <div className="reveal" style={{ background:'var(--surface-2)', border:'1px solid var(--border)',
      borderLeft:'2px solid var(--accent)', padding:'8px 10px', animationDelay:`${index * 40}ms` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
        <span style={{ fontSize:'10px', fontFamily:'JetBrains Mono,monospace', color:'var(--text-3)' }}>chunk {index+1}</span>
        <Tag color="violet">{Math.ceil((chunk.length ?? chunk)/4)} tk</Tag>
      </div>
      <p style={{ fontSize:'11px', color:'var(--text-2)', lineHeight:1.5,
        overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
        {typeof chunk === 'string' ? chunk.slice(0, 160) : JSON.stringify(chunk).slice(0, 160)}
      </p>
    </div>
  )
}

// ── main export ────────────────────────────────────────────────────────────
export default function IngestPanel({ onClose, onIngested }) {
  const [phase, setPhase]         = useState('idle')   // idle | ready | ingesting | done | error
  const [file, setFile]           = useState(null)
  const [content, setContent]     = useState('')
  const [result, setResult]       = useState(null)
  const [dragOver, setDragOver]   = useState(false)
  const [project, setProject]     = useState('')
  const [log, setLog]             = useState([])
  const inputRef                  = useRef(null)

  const addLog = msg => setLog(l => [...l, { t: new Date().toLocaleTimeString('es',{hour12:false}), msg }])

  const loadFile = useCallback(async (f) => {
    if (!isAccepted(f)) {
      setPhase('error')
      setResult({ error: true, message: `Tipo no soportado: ${f.name}. Usá .txt .md .json .csv .yaml` })
      return
    }
    setFile(f)
    setPhase('ready')
    setResult(null)
    setLog([])
    addLog(`Archivo cargado: ${f.name} (${fmtSize(f.size)})`)
    if (f.size > 500_000) addLog('⚠ Archivo grande — se enviará como texto plano')
    try {
      const txt = await readFileAsText(f)
      setContent(txt)
      addLog(`Leído: ~${estimateTokens(txt).toLocaleString()} tokens estimados`)
    } catch (e) {
      setPhase('error')
      setResult({ error: true, message: e.message })
    }
  }, [])

  function onDrop(e) {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) loadFile(f)
  }

  function onInputChange(e) {
    const f = e.target.files[0]
    if (f) loadFile(f)
  }

  async function ingest() {
    if (!file || !content || phase === 'ingesting') return
    setPhase('ingesting')
    addLog('Enviando a /api/remember…')

    const title   = file.name
    const payload = { title, content, type: 'document', scope: 'workspace', ...(project ? { project } : {}) }
    const { ok, data } = await apiFetch('POST', '/api/remember', payload)

    if (!ok) {
      setPhase('error')
      setResult(data)
      addLog('✕ Error: ' + (data.message ?? 'API falló'))
      return
    }

    addLog('✓ Almacenado en memoria NEXUS')
    setResult(data)
    setPhase('done')

    // Build synthetic chunks for preview from content
    const chunkSize = 400
    const rawChunks = []
    for (let i = 0; i < Math.min(content.length, chunkSize * 5); i += chunkSize) {
      rawChunks.push(content.slice(i, i + chunkSize))
    }
    addLog(`Preview: ${rawChunks.length} chunks visibles`)

    if (onIngested) onIngested({ title, chunks: rawChunks, tokens: estimateTokens(content) })
  }

  function reset() {
    setPhase('idle'); setFile(null); setContent(''); setResult(null); setLog([])
  }

  // ── render ─────────────────────────────────────────────────────────
  const panelW = 480

  return (
    <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex', alignItems:'flex-end', justifyContent:'center', pointerEvents:'none' }}>
      {/* backdrop */}
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.55)', backdropFilter:'blur(4px)', pointerEvents:'all' }} />

      {/* panel */}
      <div className="slide-right" style={{
        position:'relative', width:`${panelW}px`, maxWidth:'100vw', maxHeight:'82vh',
        background:'var(--surface)', border:'1px solid var(--border-2)',
        borderBottom:'none', display:'flex', flexDirection:'column', overflow:'hidden',
        pointerEvents:'all', boxShadow:'0 -24px 80px rgba(0,0,0,0.7)',
      }}>
        {/* accent top line */}
        <div style={{ position:'absolute', top:0, left:0, right:0, height:'1px',
          background:'linear-gradient(90deg,transparent,var(--accent) 30%,var(--accent-2) 70%,transparent)' }} />

        {/* header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'12px 16px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <span style={{ fontSize:'14px' }}>📥</span>
            <span style={{ fontSize:'12px', fontWeight:700, letterSpacing:'-0.2px', color:'var(--text-1)' }}>Ingest Document</span>
            <Tag color="violet">NEXUS</Tag>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-3)', cursor:'pointer', fontSize:'16px', lineHeight:1, padding:'2px' }}>✕</button>
        </div>

        {/* body */}
        <div style={{ flex:1, overflowY:'auto', padding:'14px', display:'flex', flexDirection:'column', gap:'10px' }}>

          {/* drop zone */}
          {phase === 'idle' && (
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{
                border:`2px dashed ${dragOver ? 'var(--accent)' : 'var(--border-2)'}`,
                padding:'32px 20px', textAlign:'center', cursor:'pointer',
                background: dragOver ? 'rgba(124,58,237,0.04)' : 'var(--surface-2)',
                transition:'all 0.15s', display:'flex', flexDirection:'column', alignItems:'center', gap:'10px',
              }}>
              <span style={{ fontSize:'32px', opacity:0.5 }}>📄</span>
              <div>
                <p style={{ fontSize:'13px', color:'var(--text-2)', fontWeight:500 }}>Arrastrá un archivo aquí</p>
                <p style={{ fontSize:'11px', color:'var(--text-3)', marginTop:'4px' }}>.txt · .md · .json · .csv · .yaml · .log</p>
              </div>
              <span style={{ fontSize:'11px', color:'var(--accent-2)', borderBottom:'1px solid rgba(168,85,247,0.3)', paddingBottom:'1px' }}>
                o hacé click para seleccionar
              </span>
              <input ref={inputRef} type="file" accept={ACCEPTED.join(',')} onChange={onInputChange} style={{ display:'none' }} />
            </div>
          )}

          {/* file ready card */}
          {(phase === 'ready' || phase === 'ingesting' || phase === 'done' || phase === 'error') && file && (
            <div style={{ background:'var(--surface-2)', border:'1px solid var(--border)', padding:'10px 12px', display:'flex', alignItems:'center', gap:'10px' }}>
              <span style={{ fontSize:'20px' }}>{file.name.endsWith('.pdf') ? '📕' : file.name.endsWith('.md') || file.name.endsWith('.mdx') ? '📝' : '📄'}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:'12px', fontWeight:600, color:'var(--text-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{file.name}</div>
                <div style={{ display:'flex', gap:'6px', marginTop:'3px' }}>
                  <Tag color="muted">{fmtSize(file.size)}</Tag>
                  {content && <Tag color="violet">{estimateTokens(content).toLocaleString()} tk</Tag>}
                </div>
              </div>
              {phase !== 'ingesting' && (
                <button onClick={reset} style={{ background:'none', border:'none', color:'var(--text-3)', cursor:'pointer', fontSize:'13px' }}>↩</button>
              )}
            </div>
          )}

          {/* project field */}
          {(phase === 'ready') && (
            <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
              <label style={{ fontSize:'10px', color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.7px', fontWeight:600 }}>Proyecto (opcional)</label>
              <input value={project} onChange={e => setProject(e.target.value)} placeholder="nexus / mi-proyecto / …"
                style={{ background:'var(--surface-2)', border:'1px solid var(--border)', padding:'6px 10px', fontSize:'12px',
                  fontFamily:'JetBrains Mono,monospace', color:'var(--text-2)', outline:'none', transition:'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor='rgba(124,58,237,0.5)'}
                onBlur={e => e.target.style.borderColor='var(--border)'} />
            </div>
          )}

          {/* content preview */}
          {content && phase === 'ready' && (
            <div style={{ background:'var(--surface-2)', border:'1px solid var(--border)', padding:'8px 10px' }}>
              <div style={{ fontSize:'9px', color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:'5px', fontWeight:600 }}>Preview</div>
              <pre style={{ fontSize:'11px', fontFamily:'JetBrains Mono,monospace', color:'var(--text-3)',
                whiteSpace:'pre-wrap', lineHeight:1.5, maxHeight:'80px', overflow:'hidden', wordBreak:'break-all' }}>
                {content.slice(0, 300)}{content.length > 300 ? '\n…' : ''}
              </pre>
            </div>
          )}

          {/* log */}
          {log.length > 0 && (
            <div style={{ background:'var(--surface-2)', border:'1px solid var(--border)', padding:'8px 10px' }}>
              <div style={{ fontSize:'9px', color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:'5px', fontWeight:600 }}>Log</div>
              {log.map((l,i) => (
                <div key={i} style={{ fontSize:'10px', fontFamily:'JetBrains Mono,monospace', color:'var(--text-3)', lineHeight:1.8 }}>
                  <span style={{ color:'var(--text-3)', opacity:0.5 }}>{l.t} </span>
                  <span style={{ color: l.msg.startsWith('✕') ? 'var(--red)' : l.msg.startsWith('✓') ? 'var(--green)' : 'var(--text-2)' }}>{l.msg}</span>
                </div>
              ))}
            </div>
          )}

          {/* success result */}
          {phase === 'done' && result && !result.error && (
            <div className="glow-flash reveal" style={{ padding:'12px', background:'rgba(16,185,129,0.05)',
              border:'1px solid rgba(16,185,129,0.2)', borderLeft:'2px solid var(--green)', display:'flex', flexDirection:'column', gap:'8px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'7px' }}>
                <span style={{ width:'6px', height:'6px', background:'var(--green)', display:'inline-block', flexShrink:0 }} />
                <span style={{ fontSize:'11px', fontWeight:700, color:'var(--green)', textTransform:'uppercase', letterSpacing:'0.8px' }}>Ingestado</span>
              </div>
              <div style={{ display:'flex', gap:'5px', flexWrap:'wrap' }}>
                <Tag color="green">en memoria</Tag>
                <Tag color="violet">{estimateTokens(content).toLocaleString()} tokens</Tag>
                {result.id && <Tag color="muted">id: {String(result.id).slice(0,8)}</Tag>}
              </div>
              <p style={{ fontSize:'11px', color:'rgba(16,185,129,0.7)', lineHeight:1.5 }}>
                El documento ya está en tu base de conocimiento. Hacé una pregunta en el panel de Query.
              </p>
            </div>
          )}

          {/* error result */}
          {phase === 'error' && result && (
            <div className="reveal" style={{ padding:'12px', background:'rgba(239,68,68,0.05)',
              border:'1px solid rgba(239,68,68,0.2)', borderLeft:'2px solid var(--red)' }}>
              <div style={{ fontSize:'11px', fontWeight:700, color:'var(--red)', marginBottom:'5px', textTransform:'uppercase', letterSpacing:'0.8px' }}>Error</div>
              <p style={{ fontSize:'11px', color:'rgba(239,68,68,0.7)', lineHeight:1.5, fontFamily:'JetBrains Mono,monospace' }}>
                {result.message ?? JSON.stringify(result)}
              </p>
            </div>
          )}

          {/* ingesting loader */}
          {phase === 'ingesting' && (
            <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'10px 12px',
              background:'var(--surface-2)', border:'1px solid var(--border)', borderLeft:'2px solid var(--accent)' }}>
              <div style={{ display:'flex', gap:'4px' }}>
                {[0,1,2].map(i => <span key={i} className="live-dot" style={{ width:'5px', height:'5px',
                  background:'var(--accent-2)', display:'inline-block', animationDelay:`${i*180}ms` }} />)}
              </div>
              <span style={{ fontSize:'12px', color:'var(--text-2)' }}>Procesando en NEXUS…</span>
            </div>
          )}
        </div>

        {/* footer actions */}
        <div style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', flexShrink:0,
          display:'flex', gap:'8px', background:'var(--surface)' }}>
          {phase === 'ready' && (
            <button onClick={ingest} style={{ flex:1, padding:'9px', background:'var(--accent)',
              border:'1px solid transparent', fontSize:'12px', fontWeight:700, fontFamily:'inherit',
              letterSpacing:'0.3px', color:'var(--accent-contrast, #fff)', cursor:'pointer', transition:'all 0.15s',
              display:'flex', alignItems:'center', justifyContent:'center', gap:'6px' }}
              onMouseEnter={e => e.currentTarget.style.opacity='0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity='1'}>
              <span>📥</span> Ingest al Knowledge Base
            </button>
          )}
          {phase === 'done' && (
            <>
              <button onClick={reset} style={{ flex:1, padding:'9px', background:'var(--surface-2)',
                border:'1px solid var(--border)', fontSize:'12px', fontWeight:600, fontFamily:'inherit',
                color:'var(--text-2)', cursor:'pointer', transition:'all 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor='var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor='var(--border)'}>
                + Otro archivo
              </button>
              <button onClick={onClose} style={{ flex:1, padding:'9px', background:'var(--surface-3)',
                border:'1px solid var(--border-2)', fontSize:'12px', fontWeight:600, fontFamily:'inherit',
                color:'var(--text-1)', cursor:'pointer' }}>
                Ir a Query →
              </button>
            </>
          )}
          {phase === 'error' && (
            <button onClick={reset} style={{ flex:1, padding:'9px', background:'var(--surface-2)',
              border:'1px solid var(--border)', fontSize:'12px', fontWeight:600, fontFamily:'inherit',
              color:'var(--text-2)', cursor:'pointer' }}>
              ↩ Reintentar
            </button>
          )}
          {phase === 'idle' && (
            <button onClick={onClose} style={{ flex:1, padding:'9px', background:'none',
              border:'1px solid var(--border)', fontSize:'12px', fontFamily:'inherit',
              color:'var(--text-3)', cursor:'pointer' }}>
              Cancelar
            </button>
          )}
          {phase === 'ingesting' && (
            <div style={{ flex:1, padding:'9px', background:'var(--surface-2)', border:'1px solid var(--border)',
              fontSize:'12px', color:'var(--text-3)', textAlign:'center', fontFamily:'inherit' }}>
              Procesando…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
