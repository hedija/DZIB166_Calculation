// Pure calculation functions — no React, no Supabase, no Vite imports.
// Importable in tests without any mocking.

export function renderFnText(text, ctx) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? `{{${k}}}`);
}

export function mergeData(atskaite, alokData, config) {
  const am = {};
  for (const a of alokData) am[a.dz] = a;
  return atskaite.apartments.map(apt => {
    const al = am[apt.dz] || {}, cfg = config[apt.dz] || {};
    const cenaM2     = al.cenaM2     ?? 0;
    const totalArea  = cfg.area      ?? 0;
    const heatedArea = al.platiba    ?? cfg.heatedArea ?? totalArea;
    const cenaV      = al.cenaVieniba ?? 0;
    const alokV      = al.alokVienibas ?? 0;
    const pvn        = al.pvnLikme   ?? 0;
    const pvnK       = 1 + pvn / 100;
    return {
      ...apt,
      area: totalArea, heatedArea,
      residents: cfg.residents ?? 0,
      email: cfg.email ?? "",
      owner: cfg.owner || apt.owner,
      irnieks: al.irnieks ?? (cfg.owner || apt.owner),
      ligums: al.ligums ?? "",
      cenaM2, cenaVieniba: cenaV, alokVienibas: alokV, pvnLikme: pvn,
      cenaM2ArPVN:       cenaM2 * pvnK,
      cenaVienArPVN:     cenaV  * pvnK,
      maksPlatibaiArPVN: cenaM2 * heatedArea * pvnK,
      maksVienibamArPVN: cenaV  * alokV      * pvnK,
      kopsumma:          cenaM2 * heatedArea * pvnK + cenaV * alokV * pvnK,
    };
  });
}

/**
 * Compute per-apartment billing amounts from merged apartment data.
 *
 * @param {object} apt            - merged apartment (from mergeData)
 * @param {object} tariffs        - { tAU, tKU, tApsam, tRem, tSiltmez, cirkulTarif, lietusMen, tKoplEl }
 * @param {number} atkritumiPerPers - waste cost per person (pre-computed: wasteTotal / totalResidents)
 * @param {object} [cfg]          - apartment config, expects cfg.circGroup
 * @param {boolean} [heatingIncluded] - whether apkure positions are active
 * @returns {{ rAU, rKU, rCirk, rLietus, rAtk, rKoplEl, rApsam, rRem, rSiltmez, rApkM2, rApkAlok }}
 */
export function calcAptBill(apt, tariffs, atkritumiPerPers, cfg = {}, heatingIncluded = false) {
  const { tAU, tKU, tApsam, tRem, tSiltmez, cirkulTarif, lietusMen, tKoplEl } = tariffs;
  const r2     = v => Math.round(v * 100) / 100;
  const cirkulGrupas = parseFloat(cfg.circGroup) || 0;

  const rAU      = r2(apt.auKopa * tAU);
  const rKU      = r2(apt.kuKopa * tKU);
  const rCirk    = r2(cirkulGrupas * (cirkulTarif || 0));
  const rLietus  = r2(lietusMen);
  const rAtk     = r2(atkritumiPerPers * (apt.residents || 0));
  const rKoplEl  = r2(tKoplEl);
  const rApsam   = r2(apt.area * tApsam);
  const rRem     = r2(apt.area * tRem);
  const rSiltmez = r2(apt.area * tSiltmez);
  const rApkM2   = heatingIncluded ? r2(apt.maksPlatibaiArPVN) : 0;
  const rApkAlok = heatingIncluded ? r2(apt.maksVienibamArPVN) : 0;

  return { rAU, rKU, rCirk, rLietus, rAtk, rKoplEl, rApsam, rRem, rSiltmez, rApkM2, rApkAlok };
}

export function numVardiem(amount) {
  const cents = Math.round(amount * 100);
  const eur   = Math.floor(cents / 100);
  const cnt   = cents % 100;
  const ones  = ["","viens","divi","trīs","četri","pieci","seši","septiņi","astoņi","deviņi"];
  const teens = ["desmit","vienpadsmit","divpadsmit","trīspadsmit","četrpadsmit","piecpadsmit",
                 "sešpadsmit","septiņpadsmit","astoņpadsmit","deviņpadsmit"];
  const tns   = ["","","divdesmit","trīsdesmit","četrdesmit","piecdesmit",
                 "sešdesmit","septiņdesmit","astoņdesmit","deviņdesmit"];

  function nn(n) {
    if (!n) return "";
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    const t = Math.floor(n / 10), o = n % 10;
    return tns[t] + (o ? " " + ones[o] : "");
  }
  function nnn(n) {
    const h = Math.floor(n / 100), re = n % 100;
    const hs = h === 1 ? "simts" : h > 1 ? ones[h] + " simti" : "";
    const tail = nn(re);
    return hs + (hs && tail ? " " : "") + tail;
  }

  let s;
  if (eur === 0) {
    s = "nulle eiro";
  } else if (eur < 1000) {
    s = nnn(eur) + " eiro";
  } else {
    const th = Math.floor(eur / 1000), re = eur % 1000;
    s = (th === 1 ? "tūkstotis" : nn(th) + " tūkstoši") + (re ? " " + nnn(re) : "") + " eiro";
  }
  s += cnt === 0 ? " 00 centu" : " " + String(cnt).padStart(2, "0") + " centi";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
