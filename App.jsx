import { useState } from 'react'
import './App.css'

function App() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <header className="navbar">
        <div className="navbar-inner">
          <div className="navbar-brand">
            <span className="brand-main">Brīvības 166</span>
            <span className="brand-sub">Dzīvokļu īpašnieku biedrība</span>
          </div>
          <nav className={`nav-links ${menuOpen ? 'open' : ''}`}>
            <a href="#par-mums" onClick={() => setMenuOpen(false)}>Par mums</a>
            <a href="#rekinи" onClick={() => setMenuOpen(false)}>Rēķini</a>
            <a href="#jaunumi" onClick={() => setMenuOpen(false)}>Jaunumi</a>
            <a href="#kontakti" onClick={() => setMenuOpen(false)}>Kontakti</a>
          </nav>
          <button
            className={`menu-toggle ${menuOpen ? 'open' : ''}`}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Izvēlne"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
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
            <a href="#kontakti" className="btn btn-primary">Sazināties ar mums</a>
            <a href="#par-mums" className="btn btn-outline">Uzzināt vairāk</a>
          </div>
        </div>
      </section>

      <section id="par-mums">
        <div className="section-inner">
          <h2 className="section-title">Par biedrību</h2>
          <p className="section-sub">
            Mēs esam dzīvokļu īpašnieku biedrība, kas dibināta, lai nodrošinātu Brīvības
            ielas 166 daudzdzīvokļu mājas kvalitatīvu apsaimniekošanu un iedzīvotāju
            interešu pārstāvību.
          </p>
          <div className="cards">
            <div className="card">
              <div className="card-icon">🏢</div>
              <h3>Apsaimniekošana</h3>
              <p>Kārtojam mājas kopējo telpu un inženiersistēmu uzturēšanu un remontus.</p>
            </div>
            <div className="card">
              <div className="card-icon">🤝</div>
              <h3>Pārstāvība</h3>
              <p>
                Pārstāvam dzīvokļu īpašnieku intereses attiecībās ar pašvaldību un
                pakalpojumu sniedzējiem.
              </p>
            </div>
            <div className="card">
              <div className="card-icon">📋</div>
              <h3>Pārskatāmība</h3>
              <p>
                Regulāri informējam iedzīvotājus par izdevumiem, lēmumiem un ēkas stāvokli.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="rekinи" className="section-alt">
        <div className="section-inner">
          <h2 className="section-title">Rēķinu sagatavošana</h2>
          <p className="section-sub">
            Katru mēnesi sagatavosim precīzus rēķinus par mājas apsaimniekošanas
            pakalpojumiem. Rēķini atspoguļo reālos izdevumus un ir pieejami digitālā
            formātā.
          </p>
          <div className="invoice-grid">
            <div className="invoice-item">
              <div className="invoice-icon">💡</div>
              <div>
                <h4>Komunālie pakalpojumi</h4>
                <p>Apkure, aukstais ūdens, kanalizācija, elektrība koplietošanas telpās.</p>
              </div>
            </div>
            <div className="invoice-item">
              <div className="invoice-icon">🔧</div>
              <div>
                <h4>Apsaimniekošanas maksa</h4>
                <p>Mājas kopīpašuma uzturēšana, tīrīšana.</p>
              </div>
            </div>
            <div className="invoice-item">
              <div className="invoice-icon">🏦</div>
              <div>
                <h4>Uzkrājumu fonds</h4>
                <p>Iemaksas mājas remontdarbu un atjaunošanas uzkrājumu fondā.</p>
              </div>
            </div>
            <div className="invoice-item">
              <div className="invoice-icon">📅</div>
              <div>
                <h4>Maksājumu termiņš</h4>
                <p>Rēķini jāapmaksā līdz katra mēneša 20. datumam.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="jaunumi">
        <div className="section-inner">
          <h2 className="section-title">Jaunumi un paziņojumi</h2>
          <div className="news-list">
            <article className="news-item">
              <div className="news-date">2026. gada aprīlis</div>
              <h3>Kopsapulce — 15. maijā</h3>
              <p>
                Aicinām visus dzīvokļu īpašniekus uz ikgadējo kopsapulci. Darba kārtībā —
                2025. gada finanšu pārskats un 2026. gada budžets.
              </p>
            </article>
            <article className="news-item">
              <div className="news-date">2026. gada marts</div>
              <h3>Jumta remonts pabeigts</h3>
              <p>
                Informējam, ka plānotie jumta hidroizolācijas darbi ir veiksmīgi pabeigti.
                Paldies par pacietību būvdarbu laikā.
              </p>
            </article>
            <article className="news-item">
              <div className="news-date">2026. gada janvāris</div>
              <h3>Jauns atkritumu šķirošanas punkts</h3>
              <p>
                Pagalmā uzstādīti jauni šķiroto atkritumu konteineri — papīram, plastmasai
                un stiklam.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section id="kontakti" className="section-alt">
        <div className="section-inner">
          <h2 className="section-title">Kontakti</h2>
          <div className="contact-grid">
            <div className="contact-info">
              <div className="contact-item">
                <span className="contact-label">Adrese</span>
                <span>Brīvības iela 166, Rīga, LV-1012</span>
              </div>
              <div className="contact-item">
                <span className="contact-label">Tālrunis</span>
                <a href="tel:+37100000000">+371 00 000 000</a>
              </div>
              <div className="contact-item">
                <span className="contact-label">E-pasts</span>
                <a href="mailto:info@brivibas166.lv">info@brivibas166.lv</a>
              </div>
              <div className="contact-item">
                <span className="contact-label">Darba laiks</span>
                <span>Pirmdiena – Piektdiena: 9:00–17:00</span>
              </div>
            </div>
            <div className="contact-form">
              <h3>Rakstiet mums</h3>
              <form onSubmit={(e) => e.preventDefault()}>
                <input type="text" placeholder="Jūsu vārds" required />
                <input type="email" placeholder="E-pasta adrese" required />
                <textarea placeholder="Jūsu ziņojums" rows="4" required></textarea>
                <button type="submit" className="btn btn-primary">Nosūtīt</button>
              </form>
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
