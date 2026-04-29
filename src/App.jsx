import { useState } from 'react'
import DzibCalculations from '../dzib_calculations'
import './App.css'

function App() {
  const [page, setPage] = useState('home')

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
