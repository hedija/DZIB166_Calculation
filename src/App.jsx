import { useState, useEffect } from 'react'
import DzibCalculations from '../dzib_calculations'
import { supabase } from '../supabase'
import './App.css'

const MONTHS_LV = ["Janvāris","Februāris","Marts","Aprīlis","Maijs","Jūnijs",
                   "Jūlijs","Augusts","Septembris","Oktobris","Novembris","Decembris"]

function formatPeriod(period) {
  const [year, month] = period.split('-')
  const m = parseInt(month)
  return `${MONTHS_LV[m - 1] || month} ${year}`
}

function App() {
  const [page, setPage] = useState('home')
  const [mutualSettl, setMutualSettl] = useState({ persons: [], rows: [] })
  const [docPeriods, setDocPeriods] = useState([])

  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'mutual_settlements').maybeSingle()
      .then(({ data }) => {
        if (data?.value && typeof data.value === 'object') {
          setMutualSettl({
            persons: Array.isArray(data.value.persons) ? data.value.persons : [],
            rows:    Array.isArray(data.value.rows)    ? data.value.rows    : [],
          })
        }
      })
  }, [])

  useEffect(() => {
    async function loadDocs() {
      const { data: topItems } = await supabase.storage.from('Invoices').list('', {
        limit: 100, sortBy: { column: 'name', order: 'desc' }
      })
      if (!topItems || topItems.length === 0) return
      const folderItems = topItems.filter(item => !item.metadata)
      const periods = await Promise.all(
        folderItems.map(async folder => {
          const { data: files } = await supabase.storage.from('Invoices').list(folder.name, {
            limit: 200, sortBy: { column: 'name', order: 'asc' }
          })
          return {
            period: folder.name,
            files: (files || []).filter(f => f.metadata).map(f => f.name)
          }
        })
      )
      setDocPeriods(periods.filter(p => p.files.length > 0))
    }
    loadDocs()
  }, [])

  if (page === 'calculation') {
    return <DzibCalculations onBack={() => setPage('home')} />
  }

  return (
    <>
      <header className="navbar">
        <div className="navbar-inner">
          <div className="navbar-brand">
            <span className="brand-main">Brīvības 166</span>
            <span className="brand-sub">Dzīvokļu īpašnieku biedrība</span>
          </div>
        </div>
      </header>

      <section id="hero">
        <div className="hero-content">
          <div className="hero-badge">Rīga, Latvija</div>
          <h1>
            Dzīvokļu īpašnieku biedrība
            <br />
            <span className="hero-name">„Brīvības 166"</span>
          </h1>
          <p className="hero-desc">
            Rūpējamies par ēkas uzturēšanu, iedzīvotāju komfortu un skaidru sadarbību.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={() => setPage('calculation')}>
              Rēķinu sagatavošana
            </button>
          </div>
        </div>
      </section>

      {mutualSettl.persons.length > 0 && mutualSettl.rows.length > 0 && (() => {
        const { persons, rows } = mutualSettl
        const totals = persons.map((_, pi) =>
          Math.round(rows.reduce((s, r) => s + (parseFloat(r.amounts?.[pi]) || 0), 0) * 100) / 100
        )
        return (
          <section id="norekini">
            <div className="section-inner">
              <h2 className="section-title">Savstarpējie norēķini</h2>
              <div className="norek-cards">
                {persons.map((p, pi) => {
                  const t = totals[pi]
                  const pos = t > 0, neg = t < 0
                  return (
                    <div key={pi} className={`norek-card${pos ? ' norek-pos' : neg ? ' norek-neg' : ''}`}>
                      <div className="norek-name">{p || `Persona ${pi + 1}`}</div>
                      <div className="norek-amount">{pos ? '+' : ''}{t.toFixed(2)} €</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        )
      })()}

      {docPeriods.length > 0 && (
        <section id="dokumenti" className="section-alt">
          <div className="section-inner">
            <h2 className="section-title">Dokumenti</h2>
            <div className="doc-periods">
              {docPeriods.map(({ period, files }) => (
                <div key={period} className="doc-period">
                  <div className="doc-period-header">{formatPeriod(period)}</div>
                  <div className="doc-files">
                    {files.map(filename => {
                      const url = supabase.storage.from('Invoices').getPublicUrl(`${period}/${filename}`).data.publicUrl
                      const isXlsx = filename.endsWith('.xlsx')
                      return (
                        <div key={filename} className="doc-file">
                          <span className={`doc-file-type ${isXlsx ? 'doc-xlsx' : 'doc-pdf'}`}>
                            {isXlsx ? 'XLSX' : 'PDF'}
                          </span>
                          <a href={url} target="_blank" rel="noreferrer">{filename}</a>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section id="kontakti" className="section-alt">
        <div className="section-inner">
          <h2 className="section-title">Kontakti</h2>
          <div className="contact-info">
            <div className="contact-item">
              <span className="contact-label">Adrese</span>
              <span>Brīvības iela 166, Rīga, LV-1012</span>
            </div>
            <div className="contact-item">
              <span className="contact-label">Tālrunis</span>
              <a href="tel:+37100000000">+371 29225665</a>
            </div>
            <div className="contact-item">
              <span className="contact-label">E-pasts</span>
              <a href="mailto:brivibas166riga@gmail.com">brivibas166riga@gmail.com</a>
            </div>
          </div>
        </div>
      </section>

      <footer className="footer">
        <p>© 2026 Dzīvokļu īpašnieku biedrība „Brīvības 166". Visas tiesības aizsargātas.</p>
      </footer>
    </>
  )
}

export default App
