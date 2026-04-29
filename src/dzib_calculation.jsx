import { useState } from 'react'

const RATES = {
  apsaimniekosana: 0.45,
  uzkrajumi: 0.20,
  elektriba: 2.80,
}

const emptyForm = {
  dzivoklis: '',
  platiba: '',
  aukstaisUdens: '',
  karstaisUdens: '',
  apkure: '',
}

export default function DzibCalculation({ onBack }) {
  const [form, setForm] = useState(emptyForm)
  const [rezultats, setRezultats] = useState(null)

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  function aprekina(e) {
    e.preventDefault()
    const p = parseFloat(form.platiba) || 0
    const au = parseFloat(form.aukstaisUdens) || 0
    const ku = parseFloat(form.karstaisUdens) || 0
    const apk = parseFloat(form.apkure) || 0

    const rindas = [
      { nos: 'Apsaimniekošanas maksa', daudzums: `${p} m²`, tarifs: RATES.apsaimniekosana, summa: p * RATES.apsaimniekosana },
      { nos: 'Uzkrājumu fonds', daudzums: `${p} m²`, tarifs: RATES.uzkrajumi, summa: p * RATES.uzkrajumi },
      { nos: 'Elektrība koplietošanas telpās', daudzums: '–', tarifs: RATES.elektriba, summa: RATES.elektriba },
      { nos: 'Aukstais ūdens', daudzums: `${au} m³`, tarifs: 1.05, summa: au * 1.05 },
      { nos: 'Karstais ūdens', daudzums: `${ku} m³`, tarifs: 4.20, summa: ku * 4.20 },
      { nos: 'Apkure', daudzums: `${apk} m²`, tarifs: 0.68, summa: apk * 0.68 },
    ]
    const kopa = rindas.reduce((s, r) => s + r.summa, 0)
    setRezultats({ rindas, kopa })
  }

  function notirit() {
    setForm(emptyForm)
    setRezultats(null)
  }

  return (
    <div className="calc-page">
      <header className="navbar">
        <div className="navbar-inner">
          <div className="navbar-brand">
            <span className="brand-main">Brīvības 166</span>
            <span className="brand-sub">Rēķinu sagatavošana</span>
          </div>
          <button className="btn btn-outline" onClick={onBack}>← Atpakaļ</button>
        </div>
      </header>

      <main className="calc-main">
        <h2 className="section-title">Rēķina aprēķins</h2>

        <form className="calc-form" onSubmit={aprekina}>
          <div className="calc-row">
            <label>Dzīvokļa Nr.</label>
            <input name="dzivoklis" value={form.dzivoklis} onChange={handleChange} placeholder="piem. 12" required />
          </div>
          <div className="calc-row">
            <label>Platība (m²)</label>
            <input name="platiba" type="number" min="0" step="0.01" value={form.platiba} onChange={handleChange} placeholder="piem. 52.4" required />
          </div>
          <div className="calc-row">
            <label>Aukstais ūdens (m³)</label>
            <input name="aukstaisUdens" type="number" min="0" step="0.001" value={form.aukstaisUdens} onChange={handleChange} placeholder="piem. 3.5" required />
          </div>
          <div className="calc-row">
            <label>Karstais ūdens (m³)</label>
            <input name="karstaisUdens" type="number" min="0" step="0.001" value={form.karstaisUdens} onChange={handleChange} placeholder="piem. 2.1" required />
          </div>
          <div className="calc-row">
            <label>Apkure (m²)</label>
            <input name="apkure" type="number" min="0" step="0.01" value={form.apkure} onChange={handleChange} placeholder="piem. 52.4" required />
          </div>
          <div className="calc-actions">
            <button type="submit" className="btn btn-primary">Aprēķināt</button>
            <button type="button" className="btn btn-outline" onClick={notirit}>Notīrīt</button>
          </div>
        </form>

        {rezultats && (
          <div className="calc-result">
            <h3>Rēķins — dzīvoklis Nr. {form.dzivoklis}</h3>
            <table className="calc-table">
              <thead>
                <tr>
                  <th>Pakalpojums</th>
                  <th>Daudzums</th>
                  <th>Tarifs (€)</th>
                  <th>Summa (€)</th>
                </tr>
              </thead>
              <tbody>
                {rezultats.rindas.map((r) => (
                  <tr key={r.nos}>
                    <td>{r.nos}</td>
                    <td>{r.daudzums}</td>
                    <td>{r.tarifs.toFixed(2)}</td>
                    <td>{r.summa.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="3"><strong>Kopā</strong></td>
                  <td><strong>{rezultats.kopa.toFixed(2)} €</strong></td>
                </tr>
              </tfoot>
            </table>
            <p className="calc-note">Apmaksas termiņš — līdz kārtējā mēneša 20. datumam.</p>
          </div>
        )}
      </main>
    </div>
  )
}
