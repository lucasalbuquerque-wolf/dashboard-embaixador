import { useState, useRef, useEffect } from 'react'
import { DayPicker } from 'react-day-picker'
import { ptBR } from 'date-fns/locale'
import 'react-day-picker/style.css'

const pad = (n) => String(n).padStart(2, '0')
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const fmt = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

function presets() {
  const t = new Date(); const tISO = toISO(t)
  const y = t.getFullYear(), m = t.getMonth()
  return [
    ['Hoje', { from: tISO, to: tISO }],
    ['Ontem', { from: toISO(addDays(t, -1)), to: toISO(addDays(t, -1)) }],
    ['Últimos 7 dias', { from: toISO(addDays(t, -6)), to: tISO }],
    ['Últimos 30 dias', { from: toISO(addDays(t, -29)), to: tISO }],
    ['Últimos 90 dias', { from: toISO(addDays(t, -89)), to: tISO }],
    ['Este mês', { from: toISO(new Date(y, m, 1)), to: tISO }],
    ['Mês passado', { from: toISO(new Date(y, m - 1, 1)), to: toISO(new Date(y, m, 0)) }],
    ['Este ano', { from: `${y}-01-01`, to: tISO }],
    ['Ano passado', { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }],
    ['Tudo (desde 2026)', { from: '2026-01-01', to: tISO }],
  ]
}
function comparePresets(range) {
  const fr = fromISO(range.from), tt = fromISO(range.to)
  const len = Math.round((tt - fr) / 86400000)
  return [
    ['Período anterior', { from: toISO(addDays(fr, -1 - len)), to: toISO(addDays(fr, -1)) }],
    ['Mesmo período, ano passado', { from: `${+range.from.slice(0, 4) - 1}${range.from.slice(4)}`, to: `${+range.to.slice(0, 4) - 1}${range.to.slice(4)}` }],
  ]
}

export default function DateRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState('range')
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const active = editing === 'compare' ? (value.compareRange || value.range) : value.range
  const onSelect = (s) => {
    if (!s?.from) return
    const r = { from: toISO(s.from), to: toISO(s.to || s.from) }
    onChange(editing === 'compare' ? { ...value, compareRange: r } : { ...value, range: r })
  }
  const toggleCompare = (on) => { onChange({ ...value, compareOn: on, compareRange: value.compareRange || comparePresets(value.range)[0][1] }); setEditing(on ? 'compare' : 'range') }
  const isOn = (r) => active.from === r.from && active.to === r.to

  return (
    <div className="drp" ref={ref}>
      <button className="drp-btn" onClick={() => setOpen(!open)}>
        📅 {fmt(value.range.from)} – {fmt(value.range.to)}
        {value.compareOn && value.compareRange && <span className="muted small"> vs {fmt(value.compareRange.from)}–{fmt(value.compareRange.to)}</span>}
      </button>
      {open && (
        <div className="drp-pop">
          <div className="drp-body">
            <div className="drp-presets">
              {presets().map(([name, r]) => (
                <button key={name} className={editing === 'range' && isOn(r) ? 'on' : ''}
                  onClick={() => { setEditing('range'); onChange({ ...value, range: r }) }}>{name}</button>
              ))}
              <label className="switch"><input type="checkbox" checked={value.compareOn} onChange={(e) => toggleCompare(e.target.checked)} /><span className="slider" /><span className="small">Comparar</span></label>
              {value.compareOn && (
                <div className="drp-cmp-presets">
                  {comparePresets(value.range).map(([name, r]) => (
                    <button key={name} className={editing === 'compare' && isOn(r) ? 'on' : ''}
                      onClick={() => { setEditing('compare'); onChange({ ...value, compareRange: r }) }}>{name}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="drp-cal">
              <div className="drp-editing small">Editando: <strong>{editing === 'compare' ? 'comparação' : 'período'}</strong> <span className="muted">— {fmt(active.from)} a {fmt(active.to)}</span></div>
              <DayPicker mode="range" numberOfMonths={2} locale={ptBR} selected={{ from: fromISO(active.from), to: fromISO(active.to) }} onSelect={onSelect} defaultMonth={fromISO(active.from)} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
