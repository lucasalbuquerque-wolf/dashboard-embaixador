import { FAQ } from './lib/faq'

export default function FaqModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Como o dashboard funciona</h2>
          <button className="modal-close" onClick={onClose} title="fechar">×</button>
        </div>
        <div className="modal-body faq">
          {FAQ.map((g) => (
            <div key={g.cat} className="faq-group">
              <div className="faq-cat">{g.cat}</div>
              {g.items.map((it, i) => (
                <details key={i} className="faq-item">
                  <summary>{it.q}</summary>
                  <div className="faq-a">{it.a}</div>
                </details>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
