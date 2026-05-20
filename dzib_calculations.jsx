import React, { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "./supabase";
import INVOICE_CSS from "./src/invoice.css?raw";
import "./src/dzib_calculations.css";
import { numVardiem, renderFnText, mergeData } from "./src/calc.js";
import _fontRegularUrl from "./src/assets/fonts/Roboto-Regular.ttf?url";
import _fontBoldUrl    from "./src/assets/fonts/Roboto-Bold.ttf?url";
import _fontItalicUrl  from "./src/assets/fonts/Roboto-Italic.ttf?url";

const MNES = ["Janvāris","Februāris","Marts","Aprīlis","Maijs","Jūnijs",
              "Jūlijs","Augusts","Septembris","Oktobris","Novembris","Decembris"];

// Sorts apartment IDs: pure numbers first (numerically), numbers+letter last (e.g. 15a after 22)
const aptSortKey = x => {
  const m = String(x).trim().match(/^(\d+)([a-zA-Z]*)$/);
  if (!m) return [2, 0, String(x)];
  return [m[2] ? 1 : 0, parseInt(m[1]), m[2].toLowerCase()];
};
const sortApts = arr => [...arr].sort((a, b) => {
  const [ta, na, sa] = aptSortKey(a), [tb, nb, sb] = aptSortKey(b);
  return ta !== tb ? ta - tb : na !== nb ? na - nb : sa < sb ? -1 : sa > sb ? 1 : 0;
});

let _fontsRegistered = false;
async function ensureFonts(pdfLib) {
  if (_fontsRegistered) return;
  const toDataUrl = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Font ${url}: ${res.status} ${res.statusText}`);
    const blob = await res.blob();
    return new Promise(resolve => { const r = new FileReader(); r.onloadend = () => resolve(r.result); r.readAsDataURL(blob); });
  };
  const [reg, bold, ital] = await Promise.all([
    toDataUrl(_fontRegularUrl),
    toDataUrl(_fontBoldUrl),
    toDataUrl(_fontItalicUrl),
  ]);
  pdfLib.Font.register({ family: 'Roboto', fonts: [
    { src: reg,  fontWeight: 'normal', fontStyle: 'normal' },
    { src: bold, fontWeight: 'bold',   fontStyle: 'normal' },
    { src: ital, fontWeight: 'normal', fontStyle: 'italic' },
  ]});
  _fontsRegistered = true;
}

// xlsx-js-style is ~800 kB — load it lazily on first use so the initial bundle stays small
let XLSX = null;
async function ensureXLSX() {
  if (!XLSX) XLSX = await import('xlsx-js-style');
}

// ─── DB helpers ────────────────────────────────────────────────────────────
async function saveCfgDb(config) {
  try {
    const rows = Object.entries(config).map(([dz, c]) => ({
      apt:          dz,
      owner:        c.owner         || '',
      area:         c.area          || 0,
      heated_area:  c.heatedArea    || 0,
      residents:    c.residents     || 0,
      email:        c.email         || '',
      circ_group:   c.circGroup     || 0,
      pay_day:      c.payDay        || 20,
      pos_disabled:       c.posDisabled       || [],
      pos_extra:          c.posExtra          || [],
      footnotes_disabled: c.footnotesDisabled || [],
    }));
    if (rows.length)
      await supabase.from('apartment_config').upsert(rows, { onConflict: 'apt' });
  } catch(e) { console.error('saveCfgDb:', e); }
}

async function savePozDb(poz) {
  try {
    const rows = poz.map((p, i) => ({ id: p.id, label: p.label, mv: p.mv || '', is_on: p.on, sort_order: i + 1 }));
    await supabase.from('invoice_positions').upsert(rows, { onConflict: 'id' });
  } catch(e) { console.error('savePozDb:', e); }
}

async function saveCompanyDb(company) {
  try {
    await supabase.from('settings').upsert({ key: 'company', value: company });
  } catch(e) { console.error('saveCompanyDb:', e); }
}

async function resolveLogo(company) {
  if (company.logoData) return company.logoData;
  if (!company.logoPath) return null;
  try {
    const resp = await fetch('/' + company.logoPath);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blob); });
  } catch { return null; }
}

async function saveFnDb(footnotes) {
  try {
    const rows = footnotes.map((fn, i) => ({
      id: fn.id, text: fn.text, marker: fn.marker,
      is_on: fn.is_on ?? true, sort_order: i + 1,
      provider_id: fn.provider_id || null,
    }));
    await supabase.from('footnotes').upsert(rows, { onConflict: 'id' });
  } catch(e) { console.error('saveFnDb:', e); }
}

async function saveMenDb(men) {
  try {
    await supabase.from('settings')
      .upsert({ key: 'monthly_settings', value: men });
  } catch(e) { console.error('saveMenDb:', e); }
}

function mergePoz(saved) {
  const valid = saved.filter(p => DEFAULT_POZICIJAS.some(d => d.id === p.id)).map(p => {
    const def = DEFAULT_POZICIJAS.find(d => d.id === p.id);
    return { ...p, mv: p.mv !== undefined ? p.mv : (def?.mv || '') };
  });
  const ids = new Set(valid.map(p => p.id));
  for (const d of DEFAULT_POZICIJAS) if (!ids.has(d.id)) valid.push({...d, on: true});
  return valid;
}

const DEFAULT_POZICIJAS = [
  { id: "audensU", label: "Aukstais ūdens",              mv: "m³" },
  { id: "kudensU", label: "Karstais ūdens",              mv: "m³" },
  { id: "cirk",    label: "Cirkulācija",              mv: "m³" },
  { id: "lietus",  label: "Lietus notekūdeņi",        mv: "m²" },
  { id: "atk",     label: "Atkritumu izvešana",       mv: "iedz." },
  { id: "koplEl",  label: "Koplietošanas elektrība",  mv: "vienība" },
  { id: "apsam",   label: "Apsaimniekošana",          mv: "m²" },
  { id: "rem",     label: "Remontdarbu fonds",        mv: "m²" },
  { id: "siltmez", label: "Siltummezgla apkalpošana", mv: "m²" },
  { id: "apkM2",   label: "Apkure (kopējā)",          mv: "m²" },
  { id: "apkAlok", label: "Apkure (patēriņš)",        mv: "vienība" },
];

const defaultFullAptCfg = {
  enabled: false,
  recipientName: '', email: '',
  includePositions: [],
  elec: false, elecPrev: '', elecCur: '', elecAmount: '',
  nin: false, ninLabel: 'NĪN nodoklis', ninAmount: '',
  freeLines: [],
};

function _buildFullBlock(apt, regularBlock, aptCfg, pozicijas, company) {
  const cfg = { ...defaultFullAptCfg, ...aptCfg };
  const now = new Date();
  const DAYS_LV   = ["svētdiena","pirmdiena","otrdiena","trešdiena","ceturtdiena","piektdiena","sestdiena"];
  const MONTHS_LV = ["janvārī","februārī","martā","aprīlī","maijā","jūnijā","jūlijā","augustā","septembrī","oktobrī","novembrī","decembrī"];
  const dateTxt = `${DAYS_LV[now.getDay()]}, ${now.getFullYear()}. gada ${now.getDate()}. ${MONTHS_LV[now.getMonth()]}`;

  const lines = [];
  const inclSet = new Set(cfg.includePositions || []);
  for (const poz of pozicijas) {
    if (!inclSet.has(poz.id)) continue;
    if (poz.id === "audensU") {
      lines.push(...(regularBlock?.lines || []).filter(l => l.nos.startsWith('Aukstā ūdens')));
    } else if (poz.id === "kudensU") {
      lines.push(...(regularBlock?.lines || []).filter(l => l.nos.startsWith('Karstā ūdens')));
    } else {
      const rl = (regularBlock?.lines || []).find(l => l.nos.startsWith(poz.label));
      if (rl) lines.push({ ...rl });
    }
  }
  if (cfg.elec) {
    const prev = parseFloat(cfg.elecPrev) || 0;
    const cur  = parseFloat(cfg.elecCur)  || 0;
    const kwh  = Math.max(0, Math.round((cur - prev) * 1000) / 1000);
    const amt  = parseFloat(cfg.elecAmount) || 0;
    lines.push({ nos: `Elektrības skaitītājs (${prev.toFixed(3)}–${cur.toFixed(3)})`, mv: 'kWh', daudz: kwh, cena: amt, summa: amt });
  }
  if (cfg.nin && cfg.ninAmount) {
    const amt = Math.round((parseFloat(cfg.ninAmount) || 0) * 100) / 100;
    lines.push({ nos: cfg.ninLabel || 'NĪN nodoklis', mv: '', daudz: 1, cena: amt, summa: amt });
  }
  for (const l of (cfg.freeLines || [])) {
    if (!l.nos?.trim()) continue;
    const d = parseFloat(l.daudz)||0, c = Math.round((parseFloat(l.cena)||0) * 100) / 100;
    lines.push({ nos: l.nos.trim(), mv: l.mv||'', daudz: d, cena: c, summa: c });
  }
  const totalEur = Math.round(lines.reduce((s,l) => s + l.summa, 0) * 100) / 100;
  return {
    dateTxt,
    invoiceNr: '',
    supplier: { nos: company.name||'', addr: company.address||'', reg: company.regNr||'', bank: company.bank||'', swift: company.swift||'', konts: company.account||'' },
    owner: cfg.recipientName || '',
    recipientAddress: `${company.address || ''}, dz. ${apt}`,
    period1Txt: regularBlock?.period1Txt || '',
    periodTxt: regularBlock?.periodTxt || '',
    paymentDue: regularBlock?.paymentDue || '',
    lines,
    totalEur,
    wordsText: numVardiem(totalEur),
    renderedFootnotes: [],
  };
}

// ─── Parse Fails 1: skaitītāju atskaite ───────────────────────────────────
function parseAtskaite(wb, buildingId = "") {
  for (const name of ["Cold water","Hot water","Allocator"])
    if (!wb.SheetNames.includes(name)) throw new Error(`Nav lapas "${name}"`);

  // Lasīt datus pēc kolonnu INDEKSIEM — izvairās no Unicode normalizācijas neatbilstības
  // Struktūra: col0=Customer number, col1=Dzīvoklis, col2=Nosaukums, col3=Moduļa numurs,
  //            col4=Skaitītāja numurs, col5=Patēriņš, col6=Rādījums cur, col7=Rādījums prev
  const sheetToArr = (wsName) => {
    const ws = wb.Sheets[wsName];
    const rng = XLSX.utils.decode_range(ws["!ref"]);
    const rows = [];
    for (let r = rng.s.r; r <= rng.e.r; r++) {
      const row = [];
      for (let c = rng.s.c; c <= rng.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        row.push(cell ? cell.v : null);
      }
      rows.push(row);
    }
    return rows;
  };

  const coldArr  = sheetToArr("Cold water");
  const hotArr   = sheetToArr("Hot water");
  const allocArr = sheetToArr("Allocator");

  // Rinda 0 = galvenes, rindas 1+ = dati
  // Perioda noteikšana no galvenes col6 (Rādījums cur)
  const hdr = coldArr[0] || [];
  const period = String(hdr[6] || "").replace(/^[^\d]*/, "").trim();

  // Kolonnu indeksi datu rindās
  const I_CUST = 0, I_DZ = 1, I_NOS = 2, I_MOD = 3, I_SK = 4;
  const I_PAT = 5, I_CUR = 6, I_PREV = 7;

  const dataRows = arr => arr.slice(1).filter(r => r[I_DZ] != null);
  const isBldg = r => {
    const cust = r[I_CUST];
    const dz   = String(r[I_DZ] ?? "");
    // Mājas rinda: Customer number ir null/tukšs, vai Dzīvoklis satur buildingId
    if (buildingId && dz.includes(buildingId)) return true;
    return cust == null || cust === "";
  };

  const coldData  = dataRows(coldArr);
  const hotData   = dataRows(hotArr);
  const allocData = dataRows(allocArr);

  // Mājas kopējais skaitītājs = rinda kur Customer number ir tukšs/null
  // Dzīvokļu rindas = visas pārējās ar aizpildītu Customer number
  const isApt  = r => r[I_DZ] != null && r[I_CUST] != null && String(r[I_CUST]).trim() !== "";
  const isBldgRow = r => r[I_DZ] != null && (r[I_CUST] == null || String(r[I_CUST]).trim() === "");

  const coldAll  = coldArr.slice(1).filter(r => r[I_DZ] != null);
  const hotAll   = hotArr.slice(1).filter(r  => r[I_DZ] != null);

  const coldBldgRow = coldAll.find(isBldgRow);
  const hotBldgRow  = hotAll.find(isBldgRow);
  const kuKopaTotal = hotBldgRow  ? (parseFloat(hotBldgRow[I_PAT])  || 0) : null;
  const auKopaTotal = coldBldgRow ? (parseFloat(coldBldgRow[I_PAT]) || 0) : null;

  const cold  = coldAll.filter(isApt);
  const hot   = hotAll.filter(isApt);
  const alloc = allocData.filter(r => r[I_DZ] != null && r[I_CUST] != null && String(r[I_CUST]).trim() !== "");

  const allDz = new Set([...cold,...hot,...alloc].map(r => r[I_DZ]).filter(v => v != null));
  const sorted = sortApts([...allDz]);

  return { period, kuKopaTotal, auKopaTotal, apartments: sorted.map(dz => {
    const own   = rs => rs.find(r => r[I_DZ] === dz);
    const owner = String(own(alloc)?.[I_CUST] ?? own(cold)?.[I_CUST] ?? "");
    const cwR   = cold.filter(r  => r[I_DZ] === dz);
    const hwR   = hot.filter(r   => r[I_DZ] === dz);
    const meters = (rows, type) => rows.map(r => ({
      type,
      modulisNr:  String(r[I_MOD]  || ""),
      skaitNr:    String(r[I_SK]   || ""),
      nosaukums:  String(r[I_NOS]  || ""),
      prev: parseFloat(r[I_PREV])  || 0,
      cur:  parseFloat(r[I_CUR])   || 0,
      pat:  parseFloat(r[I_PAT])   || 0,
    }));
    return {
      dz: String(dz), owner,
      coldMeters: meters(cwR, "AŪ"),
      hotMeters:  meters(hwR, "KŪ"),
      auKopa: cwR.reduce((s,r) => s + (parseFloat(r[I_PAT]) || 0), 0),
      kuKopa: hwR.reduce((s,r) => s + (parseFloat(r[I_PAT]) || 0), 0),
    };
  })};
}

// ─── Parse Fails 2: alokatoru aprēķins ────────────────────────────────────
function parseAlokatori(wb) {
  const sn = wb.SheetNames.find(n=>n.toLowerCase()==="atskaite");
  if (!sn) throw new Error(`Nav lapas "Atskaite"`);
  return XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval:null })
    .map(r=>({
      dz: String(r["Dzīvoklis"]||""), irnieks:String(r["Īrnieks"]||""),
      ligums:String(r["Līguma numurs"]||""),
      cenaM2:parseFloat(r["Cena par m2"])||0, platiba:parseFloat(r["Platība (m2)"])||0,
      cenaVieniba:parseFloat(r["Cena par alokatora vienību"])||0,
      alokVienibas:parseFloat(r["Alokatora vienības"])||0,
      pvnLikme:parseFloat(r["PVN likme, %"])||0,
      periodNo:String(r["Periods no"]||""), periodLidz:String(r["Periods līdz"]||""),
    })).filter(r=>r.dz);
}

// ─── Excel builder ─────────────────────────────────────────────────────────
function fmt(ws,f,r1,c1,r2,c2){ for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++){const a=XLSX.utils.encode_cell({r,c});if(ws[a]&&ws[a].t==="n")ws[a].z=f;}}

function buildIrnieku(fullInvs, company) {
  const wb = XLSX.utils.book_new();
  const now = new Date();
  const DAYS   = ["svētdiena","pirmdiena","otrdiena","trešdiena","ceturtdiena","piektdiena","sestdiena"];
  const MONTHS = ["janvārī","februārī","martā","aprīlī","maijā","jūnijā","jūlijā","augustā","septembrī","oktobrī","novembrī","decembrī"];
  const dTxt = `${DAYS[now.getDay()]}, ${now.getFullYear()}. gada ${now.getDate()}. ${MONTHS[now.getMonth()]}`;
  for (const inv of fullInvs) {
    const ML = (r1,c1,r2,c2) => ({s:{r:r1,c:c1},e:{r:r2,c:c2}});
    const rows = []; const merges = []; let ri = 0;
    const push = (row) => { rows.push(row); return ri++; };
    const merge = (r1,c1,r2,c2) => merges.push(ML(r1,c1,r2,c2));
    const E = ["","","","",""];
    const rD = push([dTxt,"","",`Rēķins Nr. ${inv.invoice_nr}`,""]);
    merge(rD,0,rD,2); merge(rD,3,rD,4);
    push([...E]);
    const rP = push([`Piegādātājs: ${company?.name||""}`, "","", `Saņēmējs: ${inv.owner}`, ""]);
    merge(rP,0,rP,2); merge(rP,3,rP,4);
    const addrLines = (inv.recipient_address||"").split("\n");
    const piegLines = [company?.address||"", company?.regNr||"", company?.bank||"", company?.swift||"", company?.account||""].filter(Boolean);
    const maxL = Math.max(piegLines.length, addrLines.length);
    for (let i = 0; i < maxL; i++) {
      const row = [piegLines[i]||"","","",addrLines[i]||"",""];
      const rr = push(row); merge(rr,0,rr,2); merge(rr,3,rr,4);
    }
    push([...E]);
    const rTerm = push([`Rēķina apmaksas termiņš: ${inv.payment_due}`, "","","",""]);
    merge(rTerm,0,rTerm,4);
    push([...E]);
    push(["Nosaukums","Mērvien.","Daudz.","Cena (EUR)","Summa (EUR)"]);
    const rDataStart = ri;
    for (const l of (inv.lines||[])) push([l.nos, l.mv, l.daudz, l.cena, l.summa]);
    const rDataEnd = ri - 1;
    push([...E]);
    const rKopa = push(["Summa samaksai, EUR","","","",parseFloat(inv.total_eur)||0]);
    merge(rKopa,0,rKopa,3);
    push([...E]);
    const rVardi = push([`Summa vārdiem: ${numVardiem(parseFloat(inv.total_eur)||0)}`, "","","",""]);
    merge(rVardi,0,rVardi,4);
    push([...E]);
    const rFtr = push(["Rēķins sagatavots elektroniski un derīgs bez paraksta.","","","",""]);
    merge(rFtr,0,rFtr,4);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [42,10,10,16,14].map(w=>({wch:w}));
    ws["!merges"] = merges;
    for (let i = rDataStart; i <= rDataEnd; i++) {
      const l = (inv.lines||[])[i-rDataStart];
      if (!l) continue;
      if (typeof l.daudz==="number") { const a=XLSX.utils.encode_cell({r:i,c:2}); if(ws[a]) ws[a].z="0.###"; }
      if (typeof l.cena==="number")  { const a=XLSX.utils.encode_cell({r:i,c:3}); if(ws[a]) ws[a].z="0.00##"; }
      if (typeof l.summa==="number") { const a=XLSX.utils.encode_cell({r:i,c:4}); if(ws[a]) ws[a].z="0.00"; }
    }
    { const a=XLSX.utils.encode_cell({r:rKopa,c:4}); if(ws[a]) ws[a].z="0.00"; }
    ws["!pageSetup"]={paperSize:9,orientation:"portrait",fitToPage:true,fitToWidth:1,fitToHeight:1};
    ws["!margins"]={left:0.4,right:0.4,top:0.5,bottom:0.5,header:0.2,footer:0.2};
    XLSX.utils.book_append_sheet(wb, ws, String(inv.apt||"").replace(/[:\\\/\?\*\[\]]/g,"").substring(0,31));
  }

  // ── Kopsavilkums sheet ───────────────────────────────────────────────────
  {
    // Normalize meter-reading parentheticals: "Skaitītājs (1.234–5.678)" → "Skaitītājs"
    const normNos = nos => String(nos).replace(/\s*\(\d[^)]*\)/g, '').trim();
    const posSet = new Map();
    for (const inv of fullInvs) {
      for (const l of (inv.lines || [])) {
        const n = normNos(l.nos);
        if (!posSet.has(n)) posSet.set(n, posSet.size);
      }
    }
    const posNames = [...posSet.keys()];
    const hdrS = ["Dz.Nr.", "Īpašnieks", "Rēķins Nr.", ...posNames, "KOPĀ"];
    const aptRows = fullInvs.map(inv => {
      const amtMap = {};
      for (const l of (inv.lines || [])) {
        const n = normNos(l.nos);
        const v = typeof l.summa === 'number' ? l.summa : parseFloat(l.summa) || 0;
        amtMap[n] = Math.round(((amtMap[n] || 0) + v) * 100) / 100;
      }
      return [inv.apt || '', inv.owner || '', inv.invoice_nr || '',
        ...posNames.map(n => amtMap[n] || 0),
        Math.round((parseFloat(inv.total_eur) || 0) * 100) / 100,
      ];
    });
    const totRow = ["KOPĀ", "", "",
      ...posNames.map((_, i) => Math.round(aptRows.reduce((s, r) => s + (r[3 + i] || 0), 0) * 100) / 100),
      Math.round(aptRows.reduce((s, r) => s + (r[r.length - 1] || 0), 0) * 100) / 100,
    ];
    const rSs = [
      [`ĪRNIEKU RĒĶINU KOPSAVILKUMS`, ...Array(hdrS.length - 1).fill("")],
      hdrS, ...aptRows, totRow,
    ];
    const wsS = XLSX.utils.aoa_to_sheet(rSs);
    const ncS = hdrS.length;
    wsS["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: ncS - 1 } }];
    wsS["!cols"] = [{ wch: 10 }, { wch: 20 }, { wch: 18 }, ...Array(ncS - 3).fill({ wch: 16 })];
    for (let ri = 2; ri <= aptRows.length + 2; ri++) {
      for (let ci = 3; ci < ncS; ci++) {
        const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
        if (wsS[addr]) wsS[addr].z = "0.00";
      }
    }
    XLSX.utils.book_append_sheet(wb, wsS, "Kopsavilkums");
  }

  return wb;
}

function buildXlsx(atskaite, alokData, config, men, cirkulTarif, pozicijas, company, footnotes, extraInvs = []) {
  const {period}=atskaite, merged=mergeData(atskaite,alokData,config), wb=XLSX.utils.book_new();
  const MAU=Math.max(...merged.map(a=>a.coldMeters.length),1), MKU=Math.max(...merged.map(a=>a.hotMeters.length),1);

  // Sheet 1
  const h1=["Dz.Nr.","Īpašnieks","Alok. vienības","AŪ m³","KŪ m³"];
  for(let i=1;i<=MAU;i++) h1.push(`AŪ${i} Iepr.`,`AŪ${i} Pašr.`,`AŪ${i} Pat.`);
  for(let i=1;i<=MKU;i++) h1.push(`KŪ${i} Iepr.`,`KŪ${i} Pašr.`,`KŪ${i} Pat.`);
  const r1s=[[`SKAITĪTĀJU RĀDĪJUMI | Periods: ${period}`],h1];
  for(const a of merged){ const r=[a.dz,a.owner,a.alokVienibas,a.auKopa,a.kuKopa];
    for(let i=0;i<MAU;i++){const m=a.coldMeters[i];r.push(m?.prev??"",m?.cur??"",m?.pat??"")}
    for(let i=0;i<MKU;i++){const m=a.hotMeters[i];r.push(m?.prev??"",m?.cur??"",m?.pat??"")}
    r1s.push(r); }
  const ws1=XLSX.utils.aoa_to_sheet(r1s);
  ws1["!merges"]=[{s:{r:0,c:0},e:{r:0,c:h1.length-1}}];
  ws1["!cols"]=[{wch:12},{wch:16},...Array(h1.length-2).fill({wch:11})];
  const dr=merged.length,ds=2;
  fmt(ws1,"0.0000",ds,2,ds+dr-1,2); fmt(ws1,"0.00",ds,3,ds+dr-1,4);
  for(let i=0;i<MAU;i++){const b=5+i*3;fmt(ws1,"0.00",ds,b,ds+dr-1,b+2);}
  const kuS=5+MAU*3; for(let i=0;i<MKU;i++){const b=kuS+i*3;fmt(ws1,"0.00",ds,b,ds+dr-1,b+2);}
  XLSX.utils.book_append_sheet(wb,ws1,"Skaitītāju rādījumi");

  // Sheet 2
  const pvnP=merged[0]?.pvnLikme??0;
  const h2=["Dz.Nr.","Īpašnieks","PVN %","Cena/m²",`Cena/m² ar PVN`,"m²",`Maksa platībai ar PVN`,
    "Cena/vienību",`Cena/vien. ar PVN`,"Alok. vien.",`Maksa vienībām ar PVN`,"Kopsumma ar PVN"];
  const r2s=[[`ALOKATORU APRĒĶINS | ${alokData[0]?.periodNo||""}–${alokData[0]?.periodLidz||""}`],h2];
  for(const a of merged) r2s.push([a.dz,a.owner,a.pvnLikme,a.cenaM2,a.cenaM2ArPVN,a.area,
    a.maksPlatibaiArPVN,a.cenaVieniba,a.cenaVienArPVN,a.alokVienibas,a.maksVienibamArPVN,a.kopsumma]);
  const d2e=2+merged.length;
  r2s.push([],["KOPĀ","","","","",`=SUM(F3:F${d2e})`,`=SUM(G3:G${d2e})`,"","",
    `=SUM(J3:J${d2e})`,`=SUM(K3:K${d2e})`,`=SUM(L3:L${d2e})`]);
  const ws2=XLSX.utils.aoa_to_sheet(r2s);
  ws2["!cols"]=[10,16,8,12,14,10,18,14,16,12,20,16].map(w=>({wch:w}));
  const d2s=2,d2r=merged.length;
  fmt(ws2,"0",d2s,2,d2s+d2r-1,2); fmt(ws2,"0.0000",d2s,3,d2s+d2r-1,4);
  fmt(ws2,"0.00",d2s,5,d2s+d2r-1,5); fmt(ws2,"0.00",d2s,6,d2s+d2r-1,6);
  fmt(ws2,"0.0000",d2s,7,d2s+d2r-1,8); fmt(ws2,"0.0000",d2s,9,d2s+d2r-1,9);
  fmt(ws2,"0.00",d2s,10,d2s+d2r-1,11);
  XLSX.utils.book_append_sheet(wb,ws2,"Alokatoru aprēķins");

  // Sheet 3
  const r3s=[["SKAITĪTĀJU REĢISTRS"],["Dzīvoklis","Īpašnieks","Tips","Skait.Nr.","Moduļa nr.","Nosaukums","Iepr.","Pašr.","Patēriņš"]];
  for(const a of merged){
    for(const m of a.coldMeters) r3s.push([a.dz,a.owner,"Aukstais ūdens",m.skaitNr,m.modulisNr,m.nosaukums,m.prev,m.cur,m.pat]);
    for(const m of a.hotMeters)  r3s.push([a.dz,a.owner,"Karstais ūdens",m.skaitNr,m.modulisNr,m.nosaukums,m.prev,m.cur,m.pat]);
  }
  const ws3=XLSX.utils.aoa_to_sheet(r3s);
  ws3["!cols"]=[12,16,14,12,12,24,12,12,12].map(w=>({wch:w}));
  fmt(ws3,"0.00",2,6,r3s.length-1,8);
  XLSX.utils.book_append_sheet(wb,ws3,"Skaitītāju reģistrs");

  // Sheet 4
  const r4s=[["DZĪVOKĻU KONFIGURĀCIJA"],["Dz.Nr.","Īpašnieks","Platība m²","Personas","AŪ skait.","KŪ skait."]];
  for(const a of merged) r4s.push([a.dz,a.owner,a.area,a.residents,a.coldMeters.length,a.hotMeters.length]);
  const de=2+merged.length; r4s.push([],["KOPĀ","",`=SUM(C3:C${de})`,`=SUM(D3:D${de})`,"","",""]);
  const ws4=XLSX.utils.aoa_to_sheet(r4s);
  ws4["!cols"]=[10,18,12,10,12,12,28].map(w=>({wch:w}));
  fmt(ws4,"0.0",2,2,1+merged.length,2);
  XLSX.utils.book_append_sheet(wb,ws4,"Dzīvokļu konfigurācija");

  // ── Rēķini — katrs dzīvoklis savā lapā ────────────────────────────────────
  if (men) {
    const tAU      = parseFloat(men.tarifCold)         || 0;
    const tKU      = parseFloat(men.tarifHot)         || 0;
    const tApsam   = parseFloat(men.tarifMgmt)      || 0;
    const tRem     = parseFloat(men.tarifRepair)        || 0;
    const tSiltmez = parseFloat(men.tarifHeatNode) || 0;
    const tLietus  = parseFloat(men.tarifRain)     || 0;
    const koplElKopa = parseFloat(men.commonElec) || 0;
    const tKoplEl = Math.round(koplElKopa / 12 * 100) / 100;
    const lietusMen = Math.round(tLietus / 12 * 100) / 100;

    const _now = new Date();
    const _MNES = MNES;
    const gadam     = String(men.year     || _now.getFullYear());
    const mesCipars = String(men.monthNum || (_now.getMonth() + 1)).padStart(2, "0");
    const mesVards  = men.monthName       || _MNES[_now.getMonth()];
    const _curMes   = parseInt(mesCipars) || 1;
    const _curYear  = parseInt(gadam);
    const _nextMes  = _curMes === 12 ? 1 : _curMes + 1;
    const _nextYear = _curMes === 12 ? _curYear + 1 : _curYear;
    const nextMesCipars = String(_nextMes).padStart(2, "0");
    const nextGadam     = String(_nextYear);
    const _prevMes   = _curMes === 1 ? 12 : _curMes - 1;
    const _prevYear  = _curMes === 1 ? _curYear - 1 : _curYear;
    const periodTxt  = `${gadam}. gada ${mesVards}`;
    const period1Txt = `${String(_prevYear)}. gada ${_MNES[_prevMes - 1]}`;

    const atkritumiKopa = parseFloat(men.waste) || 0;
    const totalPersonas = merged.reduce((s, a) => s + (a.residents || 0), 0);

    const now = new Date();
    const DAYS_LV   = ["svētdiena","pirmdiena","otrdiena","trešdiena","ceturtdiena","piektdiena","sestdiena"];
    const MONTHS_LV = ["janvārī","februārī","martā","aprīlī","maijā","jūnijā",
                       "jūlijā","augustā","septembrī","oktobrī","novembrī","decembrī"];
    const dateTxt   = `${DAYS_LV[now.getDay()]}, ${now.getFullYear()}. gada ${now.getDate()}. ${MONTHS_LV[now.getMonth()]}`;

    const PIEG_NOS   = company?.name    || '';
    const PIEG_ADDR  = company?.address || '';
    const PIEG_REG   = company?.regNr   || '';
    const PIEG_BANK  = company?.bank    || '';
    const PIEG_SWIFT = company?.swift   || '';
    const PIEG_KONTS = company?.account || '';

    const ML = (r1, c1, r2, c2) => ({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });

    const rekNrSakums = Math.max(1, parseInt(men.invoiceNrStart) || 1);
    let rekIdx = 0;

    // ── Sheet 5: Kopsavilkums ─────────────────────────────────────────────────
    {
      const nApts = merged.length;
      const kAtriPerPers = totalPersonas > 0
        ? Math.round(atkritumiKopa / totalPersonas * 10000) / 10000
        : 0;
      let kSumAU = 0, kSumKU = 0, kSumKUauDala = 0, kSumCirk = 0, kSumLietus = 0;
      let kSumAtk = 0, kSumKoplEl = 0, kSumApsam = 0, kSumRem = 0, kSumSiltmez = 0;
      let kSumApkM2 = 0, kSumApkAlok = 0;

      for (const apt of merged) {
        const cfg = config[apt.dz] || {};
        const cirkulGrupas = parseFloat(cfg.circGroup) || 0;
        kSumAU      += Math.round(apt.auKopa * tAU * 100) / 100;
        kSumKU      += Math.round(apt.kuKopa * tKU * 100) / 100;
        kSumKUauDala+= Math.round(apt.kuKopa * tAU * 100) / 100; // ūdens daļa (→ Rīgas Ūdens)
        kSumCirk    += Math.round(cirkulGrupas * (cirkulTarif || 0) * 100) / 100;
        kSumLietus  += lietusMen;
        kSumAtk     += Math.round(kAtriPerPers * (apt.residents || 0) * 100) / 100;
        kSumKoplEl  += tKoplEl;
        kSumApsam   += Math.round(apt.area * tApsam * 100) / 100;
        kSumRem     += Math.round(apt.area * tRem * 100) / 100;
        kSumSiltmez += Math.round(apt.area * tSiltmez * 100) / 100;
        if (men.heatingIncluded) {
          kSumApkM2  += Math.round(apt.maksPlatibaiArPVN * 100) / 100;
          kSumApkAlok+= Math.round(apt.maksVienibamArPVN * 100) / 100;
        }
      }

      const r = (v) => Math.round(v * 100) / 100;
      // KŪ uzsildīšanas daļa = starpība starp KŪ un AŪ tarifu (→ Rīgas Siltums)
      const kSumKUheat = r(kSumKU - kSumKUauDala);
      const kSumTotal = r(kSumAU + kSumKU + kSumCirk + kSumLietus + kSumAtk + kSumKoplEl + kSumApsam + kSumRem + kSumSiltmez + kSumApkM2 + kSumApkAlok);
      // Rīgas Ūdens: AŪ + KŪ ūdens daļa (×tAU) + Lietus
      const kSumWater = r(kSumAU + kSumKUauDala + kSumLietus);
      // Rīgas Siltums: Cirkulācija + Apkure + KŪ uzsildīšana (×(tKU−tAU)); siltmezgls nav iekļauts
      const kSumHeat  = r(kSumCirk + kSumApkM2 + kSumApkAlok + kSumKUheat);
      const billWater = parseFloat(men.water) || 0;
      const billHeat  = parseFloat(men.heat)  || 0;
      const billWaste = atkritumiKopa;
      const billElec  = parseFloat(men.commonElec) || 0;

      // Formula descriptions for each position
      const fAU     = `Σ (patēriņš m³ × ${tAU.toFixed(4)} €/m³)`;
      const fKU     = `Σ (patēriņš m³ × ${tKU.toFixed(4)} €/m³)`;
      const fCirk   = `Σ (grupu sk. × ${(cirkulTarif||0).toFixed(4)} €/gr.)`;
      const fLietus = `${parseFloat(men.tarifRain||0).toFixed(4)}/12 = ${lietusMen.toFixed(4)} €/dz. × ${nApts} dz.`;
      const fAtk    = `${atkritumiKopa.toFixed(2)} ÷ ${totalPersonas} pers.`;
      const fKoplEl = `${billElec.toFixed(2)}/12 = ${tKoplEl.toFixed(4)} €/dz. × ${nApts} dz.`;
      const fApsam  = `Σ (platība m² × ${tApsam.toFixed(4)} €/m²)`;
      const fRem    = `Σ (platība m² × ${tRem.toFixed(4)} €/m²)`;
      const fSiltmez= `Σ (platība m² × ${tSiltmez.toFixed(4)} €/m²)`;
      const fApkM2  = men.heatingIncluded ? `Σ (aps. pl. m² × tarifs ar PVN, ${men.heatingM2Pct||40}%)` : "—";
      const fApkAlok= men.heatingIncluded ? `Σ (alok. vien. × tarifs ar PVN, ${men.heatingAllocPct||60}%)` : "—";

      // Section 2 formula descriptions (what is included in Aprēķinātais)
      const f2Water = "Aukstais ūdens + Karstais ūdens + Lietus notekūdeņi";
      const f2Heat  = "Cirkulācija + Apkure (kopējā + patēriņš) + Siltmezgls";
      const f2Waste = `Rēķins ÷ ${totalPersonas} personas`;
      const f2Elec  = `Rēķins ÷ 12 × ${nApts} dzīvokļi`;

      // 5 columns: A=Pozīcija/Pakalpojums, B=Formula/Ietver, C=Summa/Rēķins, D=Aprēķinātais, E=Starpība
      const r5s = [
        [`KOPSAVILKUMS | ${period || `${gadam}. gada ${mesVards}`}`, "", "", "", ""],
        ["", "", "", "", ""],
        ["Pozīciju kopsavilkums pa dzīvokļiem", "", "", "", ""],
        ["Pozīcija", "Aprēķins", "Summa (EUR)", "", ""],
        ["Aukstais ūdens",             fAU,     kSumAU,         "", ""],
        ["Karstais ūdens",             fKU,     kSumKU,         "", ""],
        ["Cirkulācija",                fCirk,   r(kSumCirk),    "", ""],
        ["Lietus notekūdeņi",          fLietus, r(kSumLietus),  "", ""],
        ["Atkritumu izvešana",         fAtk,    r(kSumAtk),     "", ""],
        ["Koplietošanas elektrība",    fKoplEl, r(kSumKoplEl),  "", ""],
        ["Apsaimniekošana",            fApsam,  r(kSumApsam),   "", ""],
        ["Remontdarbu fonds",          fRem,    r(kSumRem),     "", ""],
        ["Siltummezgla apkalpošana",   fSiltmez,r(kSumSiltmez), "", ""],
        ["Apkure (kopējā)",            fApkM2,  r(kSumApkM2),   "", ""],
        ["Apkure (patēriņš)",          fApkAlok,r(kSumApkAlok), "", ""],
        ["KOPĀ",                       "",      kSumTotal,       "", ""],
        ["", "", "", "", ""],
        ["Rēķinu salīdzinājums", "", "", "", ""],
        ["Pakalpojums", "Ietver", "Rēķins (EUR)", "Aprēķinātais (EUR)", "Starpība (EUR)"],
        ["Rīgas Ūdens",            f2Water, billWater, kSumWater,  r(billWater - kSumWater)],
        ["Rīgas Siltums",          f2Heat,  billHeat,  kSumHeat,   r(billHeat  - kSumHeat)],
        ["Atkritumi",              f2Waste, billWaste, r(kSumAtk), r(billWaste - kSumAtk)],
        ["Koplietošanas elektrība",f2Elec,  billElec,  r(kSumKoplEl), r(billElec - kSumKoplEl)],
      ];

      const ws5 = XLSX.utils.aoa_to_sheet(r5s);
      ws5["!cols"] = [26, 38, 14, 18, 14].map(w => ({ wch: w }));
      ws5["!merges"] = [
        { s: { r: 0,  c: 0 }, e: { r: 0,  c: 4 } },
        { s: { r: 2,  c: 0 }, e: { r: 2,  c: 4 } },
        { s: { r: 17, c: 0 }, e: { r: 17, c: 4 } },
      ];
      fmt(ws5, "0.00", 4,  2, 15, 2);   // Pozīcijas summa col
      fmt(ws5, "0.00", 19, 2, 22, 4);   // Reconciliation: Rēķins, Aprēķinātais, Starpība
      XLSX.utils.book_append_sheet(wb, ws5, "Kopsavilkums");
    }

    // ── Sheet 6: Rēķinu kopsavilkums (dzīvoklis × pozīcija) ──────────────────
    {
      const effPoz6 = (pozicijas && pozicijas.length) ? pozicijas : DEFAULT_POZICIJAS.map(p=>({...p,on:true}));
      const activePoz6 = effPoz6.filter(p => p.on);
      const kAtriPerPers6 = totalPersonas > 0 ? Math.round(atkritumiKopa / totalPersonas * 10000) / 10000 : 0;

      const aptAmts = merged.map(apt => {
        const cfg = config[apt.dz] || {};
        const dzOff = new Set(cfg.posDisabled || []);
        const cirkulGrupas = parseFloat(cfg.circGroup) || 0;
        const amtMap = {};
        for (const poz of activePoz6) {
          if (dzOff.has(poz.id)) { amtMap[poz.id] = 0; continue; }
          switch (poz.id) {
            case 'audensU':  amtMap[poz.id] = Math.round(apt.auKopa * tAU * 100) / 100; break;
            case 'kudensU':  amtMap[poz.id] = Math.round(apt.kuKopa * tKU * 100) / 100; break;
            case 'cirk':     amtMap[poz.id] = cirkulGrupas > 0 ? Math.round(cirkulGrupas * (cirkulTarif||0) * 100) / 100 : 0; break;
            case 'lietus':   amtMap[poz.id] = lietusMen; break;
            case 'atk':      amtMap[poz.id] = Math.round(kAtriPerPers6 * (apt.residents||0) * 100) / 100; break;
            case 'koplEl':   amtMap[poz.id] = Math.round(tKoplEl * 100) / 100; break;
            case 'apsam':    amtMap[poz.id] = Math.round(apt.area * tApsam * 100) / 100; break;
            case 'rem':      amtMap[poz.id] = Math.round(apt.area * tRem * 100) / 100; break;
            case 'siltmez':  amtMap[poz.id] = Math.round(apt.area * tSiltmez * 100) / 100; break;
            case 'apkM2':    amtMap[poz.id] = men.heatingIncluded ? Math.round(apt.maksPlatibaiArPVN * 100) / 100 : 0; break;
            case 'apkAlok':  amtMap[poz.id] = men.heatingIncluded ? Math.round(apt.maksVienibamArPVN * 100) / 100 : 0; break;
            default:         amtMap[poz.id] = 0;
          }
        }
        const extras = Math.round((cfg.posExtra || []).reduce((s, ex) => s + (parseFloat(ex.summa) || 0), 0) * 100) / 100;
        const total  = Math.round((Object.values(amtMap).reduce((s, v) => s + v, 0) + extras) * 100) / 100;
        return { apt, amtMap, extras, total };
      });

      const hdr6 = ["Dz.Nr.", "Īpašnieks", ...activePoz6.map(p => p.label), "Papildus", "KOPĀ"];
      const nc6  = hdr6.length;
      const totRow6 = ["KOPĀ", "",
        ...activePoz6.map(poz => Math.round(aptAmts.reduce((s, { amtMap }) => s + (amtMap[poz.id] || 0), 0) * 100) / 100),
        Math.round(aptAmts.reduce((s, { extras }) => s + extras, 0) * 100) / 100,
        Math.round(aptAmts.reduce((s, { total  }) => s + total,  0) * 100) / 100,
      ];

      // Extra invoices section
      const extraSection = [];
      const mergesExtra = [];
      if (extraInvs && extraInvs.length > 0) {
        extraSection.push(Array(nc6).fill(""));
        const hdgRow = Array(nc6).fill(""); hdgRow[0] = "PAPILDU RĒĶINI";
        extraSection.push(hdgRow);
        const subHdr = Array(nc6).fill(""); subHdr[0] = "Rēķins Nr."; subHdr[1] = "Saņēmējs"; subHdr[nc6 - 1] = "KOPĀ (EUR)";
        extraSection.push(subHdr);
        for (const inv of extraInvs) {
          const row = Array(nc6).fill("");
          row[0] = inv.invoice_nr || '';
          row[1] = inv.owner || '';
          row[nc6 - 1] = Math.round((parseFloat(inv.total_eur) || 0) * 100) / 100;
          extraSection.push(row);
        }
        const eTot = Array(nc6).fill(""); eTot[0] = "KOPĀ";
        eTot[nc6 - 1] = Math.round(extraInvs.reduce((s, inv) => s + (parseFloat(inv.total_eur) || 0), 0) * 100) / 100;
        extraSection.push(eTot);
      }

      const r6s = [
        [`RĒĶINU KOPSAVILKUMS | ${period || `${gadam}. gada ${mesVards}`}`, ...Array(nc6 - 1).fill("")],
        hdr6,
        ...aptAmts.map(({ apt, amtMap, extras, total }) => [
          apt.dz, apt.owner || '', ...activePoz6.map(p => amtMap[p.id] ?? 0), extras, total,
        ]),
        totRow6,
        ...extraSection,
      ];

      // Merge row indices
      const aptDataRows = aptAmts.length;
      const hdgIdx = 2 + aptDataRows + 1 + 1 + 1; // after title, hdr, apt rows, totRow, blank
      const merges6 = [{ s: { r: 0, c: 0 }, e: { r: 0, c: nc6 - 1 } }];
      if (extraInvs && extraInvs.length > 0) {
        merges6.push({ s: { r: hdgIdx, c: 0 }, e: { r: hdgIdx, c: nc6 - 1 } });
      }

      const ws6 = XLSX.utils.aoa_to_sheet(r6s);
      ws6["!merges"] = merges6;
      ws6["!cols"] = [{ wch: 10 }, { wch: 18 }, ...Array(nc6 - 2).fill({ wch: 14 })];
      fmt(ws6, "0.00", 2, 2, r6s.length - 1, nc6 - 1);
      XLSX.utils.book_append_sheet(wb, ws6, "Rēķinu kopsavilkums");
    }

    // ── Papildu rēķinu sheets (pirms dzīvokļu lapām) ─────────────────────────
    for (const inv of extraInvs) {
      const ML3 = (r1,c1,r2,c2) => ({s:{r:r1,c:c1},e:{r:r2,c:c2}});
      const rows3 = []; const merges3 = []; let ri3 = 0;
      const push3 = (row) => { rows3.push(row); return ri3++; };
      const merge3 = (r1,c1,r2,c2) => merges3.push(ML3(r1,c1,r2,c2));
      const E3 = ["","","","",""];
      const rD3 = push3([dateTxt,"","",`Rēķins Nr. ${inv.invoice_nr}`,""]);
      merge3(rD3,0,rD3,2); merge3(rD3,3,rD3,4);
      push3([...E3]);
      const rP3 = push3([`Piegādātājs: ${PIEG_NOS}`,"","",`Saņēmējs: ${inv.owner||""}`,""]);
      merge3(rP3,0,rP3,2); merge3(rP3,3,rP3,4);
      const addrL3 = (inv.recipient_address||"").split("\n");
      const piegL3 = [PIEG_ADDR,PIEG_REG,PIEG_BANK,PIEG_SWIFT,PIEG_KONTS].filter(Boolean);
      for (let i = 0; i < Math.max(piegL3.length,addrL3.length); i++) {
        const rr = push3([piegL3[i]||"","","",addrL3[i]||"",""]); merge3(rr,0,rr,2); merge3(rr,3,rr,4);
      }
      push3([...E3]);
      const rTerm3 = push3([`Rēķina apmaksas termiņš: ${inv.payment_due}`,"","","",""]); merge3(rTerm3,0,rTerm3,4);
      push3([...E3]);
      push3(["Nosaukums","Mērvien.","Daudz.","Cena (EUR)","Summa (EUR)"]);
      const rDS3 = ri3;
      for (const l of (inv.lines||[])) push3([l.nos,l.mv,l.daudz,l.cena,l.summa]);
      const rDE3 = ri3 - 1;
      push3([...E3]);
      const rKopa3 = push3(["Summa samaksai, EUR","","","",parseFloat(inv.total_eur)||0]); merge3(rKopa3,0,rKopa3,3);
      push3([...E3]);
      const rVardi3 = push3([`Summa vārdiem: ${numVardiem(parseFloat(inv.total_eur)||0)}`,"","","",""]); merge3(rVardi3,0,rVardi3,4);
      push3([...E3]);
      const rFtr3 = push3(["Rēķins sagatavots elektroniski un derīgs bez paraksta.","","","",""]); merge3(rFtr3,0,rFtr3,4);
      const ws3p = XLSX.utils.aoa_to_sheet(rows3);
      ws3p["!cols"] = [42,10,10,16,14].map(w=>({wch:w}));
      ws3p["!merges"] = merges3;
      for (let i = rDS3; i <= rDE3; i++) {
        const l = (inv.lines||[])[i-rDS3]; if (!l) continue;
        if (typeof l.daudz==="number") { const a=XLSX.utils.encode_cell({r:i,c:2}); if(ws3p[a]) ws3p[a].z="0.###"; }
        if (typeof l.cena==="number")  { const a=XLSX.utils.encode_cell({r:i,c:3}); if(ws3p[a]) ws3p[a].z="0.00##"; }
        if (typeof l.summa==="number") { const a=XLSX.utils.encode_cell({r:i,c:4}); if(ws3p[a]) ws3p[a].z="0.00"; }
      }
      { const a=XLSX.utils.encode_cell({r:rKopa3,c:4}); if(ws3p[a]) ws3p[a].z="0.00"; }
      ws3p["!pageSetup"]={paperSize:9,orientation:"portrait",fitToPage:true,fitToWidth:1,fitToHeight:1};
      ws3p["!margins"]={left:0.4,right:0.4,top:0.5,bottom:0.5,header:0.2,footer:0.2};
      const sNameP = `Papildu-${(inv.apts||[]).join("-")||inv.invoice_nr||""}`.replace(/[:\\\/\?\*\[\]]/g,"").substring(0,31);
      XLSX.utils.book_append_sheet(wb, ws3p, sNameP);
    }

    for (const apt of merged) {
      const cfg = config[apt.dz] || {};
      const cirkulGrupas = parseFloat(cfg.circGroup) || 0;
      const name = apt.owner || "";
      const payDay = String(cfg.payDay || 20).padStart(2, "0");
      const termiņš = `${payDay}.${mesCipars}.${gadam}`;

      const rApsam   = Math.round(apt.area  * tApsam   * 100) / 100;
      const rRem     = Math.round(apt.area  * tRem     * 100) / 100;
      const rSiltmez = Math.round(apt.area  * tSiltmez * 100) / 100;
      const rAU      = Math.round(apt.auKopa   * tAU      * 100) / 100;
      const rKU      = Math.round(apt.kuKopa   * tKU      * 100) / 100;
      const rCirk    = Math.round(cirkulGrupas * (cirkulTarif || 0) * 100) / 100;
      const rApkM2   = Math.round(apt.maksPlatibaiArPVN  * 100) / 100;
      const rApkAlok = Math.round(apt.maksVienibamArPVN  * 100) / 100;
      const rKoplEl  = Math.round(tKoplEl * 100) / 100;
      const atkritumiPerPers = totalPersonas > 0
        ? Math.round(atkritumiKopa / totalPersonas * 10000) / 10000
        : 0;
      const rAtk = Math.round(atkritumiPerPers * (apt.residents || 0) * 100) / 100;

      const auLines = apt.coldMeters.map(m => [
        `Aukstā ūdens skaitītājs (${m.prev.toFixed(3)}–${m.cur.toFixed(3)})`,
        "m³", m.pat, tAU, Math.round(m.pat * tAU * 100) / 100,
      ]);
      const kuLines = apt.hotMeters.map(m => [
        `Karstā ūdens skaitītājs (${m.prev.toFixed(3)}–${m.cur.toFixed(3)})`,
        "m³", m.pat, tKU, Math.round(m.pat * tKU * 100) / 100,
      ]);

      const effPoz = (pozicijas && pozicijas.length) ? pozicijas : DEFAULT_POZICIJAS.map(p=>({...p,on:true}));
      const dzOff  = new Set(cfg.posDisabled || []);
      const dzExtra = cfg.posExtra || [];
      const posLines = [];
      for (const poz of effPoz) {
        if (!poz.on || dzOff.has(poz.id)) continue;
        switch (poz.id) {
          case "cirk":    if (cirkulGrupas>0) posLines.push(["Cirkulācija*","gr.",cirkulGrupas,cirkulTarif||0,rCirk]); break;
          case "lietus":  posLines.push(["Lietus notekūdeņi","€/dz.",1,lietusMen,lietusMen]); break;
          case "atk":     if (rAtk>0) posLines.push(["Atkritumu izvešana**","pers.",apt.residents||0,atkritumiPerPers,rAtk]); break;
          case "koplEl":  posLines.push(["Koplietošanas elektrība***","€/dz.",1,tKoplEl,rKoplEl]); break;
          case "apsam":   posLines.push(["Apsaimniekošana","€/m²",apt.area,tApsam,rApsam]); break;
          case "rem":     posLines.push(["Remontdarbu fonds","€/m²",apt.area,tRem,rRem]); break;
          case "siltmez": if (rSiltmez>0) posLines.push(["Siltummezgla apkalpošana","€/m²",apt.area,tSiltmez,rSiltmez]); break;
          case "apkM2":   if (men.heatingIncluded&&rApkM2>0) posLines.push([`Apkure (kopējā) ${men.heatingM2Pct||"40"}%`,"m²",apt.heatedArea,apt.cenaM2ArPVN,rApkM2]); break;
          case "apkAlok": if (men.heatingIncluded&&rApkAlok>0) posLines.push([`Apkure (patēriņš) ${men.heatingAllocPct||"60"}%`,"vien.",apt.alokVienibas,apt.cenaVienArPVN,rApkAlok]); break;
        }
      }
      for (const ex of dzExtra) {
        const s = parseFloat(ex.summa) || 0;
        if (ex.label && s !== 0) posLines.push([ex.label,"€/dz.",1,s,s]);
      }
      const lines = [...auLines, ...kuLines, ...posLines];

      const kopsumma = lines.reduce((s, l) => s + (typeof l[4] === "number" ? l[4] : 0), 0);
      const nowMM = String(now.getMonth() + 1).padStart(2, "0");
      const invoiceNr = `B${gadam}${nowMM}${String(rekNrSakums + rekIdx).padStart(4, "0")}`;
      rekIdx++;

      // Rindu veidošana
      const rows = [];
      const merges = [];
      let ri = 0;
      const push = (row) => { rows.push(row); return ri++; };
      const merge = (r1, c1, r2, c2) => merges.push(ML(r1, c1, r2, c2));

      const E = ["", "", "", "", ""];

      const rDate = push([dateTxt, "", "", `Rēķins Nr. ${invoiceNr}`, ""]);
      merge(rDate, 0, rDate, 2); merge(rDate, 3, rDate, 4);

      const rPH = push(["Piegādātājs:", "", "", "Saņēmējs:", ""]);
      merge(rPH, 0, rPH, 2); merge(rPH, 3, rPH, 4);

      const rP1 = push([PIEG_NOS, "", "", name, ""]);
      merge(rP1, 0, rP1, 2); merge(rP1, 3, rP1, 4);

      const rP2 = push([PIEG_ADDR, "", "", `${PIEG_ADDR}, dz. ${apt.dz}`, ""]);
      merge(rP2, 0, rP2, 2); merge(rP2, 3, rP2, 4);

      const rP3 = push([PIEG_REG, "", "", "", ""]);
      merge(rP3, 0, rP3, 2); merge(rP3, 3, rP3, 4);

      const rP4 = push([PIEG_BANK, "", "", "", ""]);
      merge(rP4, 0, rP4, 2); merge(rP4, 3, rP4, 4);

      const rP5 = push([PIEG_SWIFT, "", "", "", ""]);
      merge(rP5, 0, rP5, 2); merge(rP5, 3, rP5, 4);

      const rP6 = push([PIEG_KONTS, "", "", "", ""]);
      merge(rP6, 0, rP6, 2); merge(rP6, 3, rP6, 4);

      push([...E]);

      const rPer1 = push([`Komunālo pakalpojumu sniegšanas periods: ${period1Txt}`, "", "", "", ""]);
      merge(rPer1, 0, rPer1, 4);

      const rPer2 = push([`Apsaimniekošana, remontdarbu fonds: ${periodTxt}`, "", "", "", ""]);
      merge(rPer2, 0, rPer2, 4);

      const rTerm = push([`Rēķina apmaksas termiņš: ${termiņš}`, "", "", "", ""]);
      merge(rTerm, 0, rTerm, 4);

      push([...E]);

      push(["Nosaukums", "Mērvien.", "Daudz.", "Cena (EUR)", "Summa (EUR)"]);

      const rSub = push(["Komunālie pakalpojumi un apsaimniekošana", "", "", "", ""]);
      merge(rSub, 0, rSub, 4);

      const rDataStart = ri;
      for (const l of lines) push([...l]);
      const rDataEnd = ri - 1;

      const rBl3 = push([...E]); merge(rBl3, 0, rBl3, 4);
      const rKopa = push(["Summa samaksai, EUR", "", "", "", kopsumma]);
      merge(rKopa, 0, rKopa, 3);
      const rBl4 = push([...E]); merge(rBl4, 0, rBl4, 4);
      const rVardi = push([`Summa vārdiem: ${numVardiem(kopsumma)}`, "", "", "", ""]);
      merge(rVardi, 0, rVardi, 4);
      const rBl5 = push([...E]); merge(rBl5, 0, rBl5, 4);
      const dzFnOff = new Set(cfg.footnotesDisabled || []);
      const aptFn = (footnotes || []).filter(fn => fn.is_on && !dzFnOff.has(fn.id));
      const nDz = merged.length || 1;
      const fnCtx = {
        waste: (parseFloat(men.waste)||0).toFixed(2),
        commonElec: (parseFloat(men.commonElec)||0).toFixed(2),
        commonElecKwh: men.commonElecKwh || '',
        heat: (parseFloat(men.heat)||0).toFixed(2),
        water: (parseFloat(men.water)||0).toFixed(2),
        monthName: men.monthName || '', year: men.year || '',
        residents: String(apt.residents || 0),
        rAtk: rAtk.toFixed(2), kopsumma: kopsumma.toFixed(2),
        waterM3: (apt.auKopa + apt.kuKopa).toFixed(3),
        waterEur: (rAU + rKU).toFixed(2),
        heatMwh: men.heatMwh || '',
        heatEur: (rApkM2 + rApkAlok).toFixed(2),
        elecKwh: ((parseFloat(men.commonElecKwh)||0) / nDz).toFixed(1),
        elecEur: rKoplEl.toFixed(2),
        wasteEur: rAtk.toFixed(2),
      };
      for (const fn of aptFn) {
        const rFn = push([`${fn.marker} ${renderFnText(fn.text, fnCtx)}`, "", "", "", ""]);
        merge(rFn, 0, rFn, 4);
      }
      const rBl6 = push([...E]); merge(rBl6, 0, rBl6, 4);
      const rFooter = push(["Rēķins sagatavots elektroniski un derīgs bez paraksta.", "", "", "", ""]);
      merge(rFooter, 0, rFooter, 4);

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [42, 10, 10, 16, 14].map(w => ({ wch: w }));
      ws["!merges"] = merges;

      for (let i = rDataStart; i <= rDataEnd; i++) {
        const l = lines[i - rDataStart];
        if (typeof l[2] === "number") { const a = XLSX.utils.encode_cell({r:i, c:2}); if (ws[a]) ws[a].z = "0.###"; }
        if (typeof l[3] === "number") { const a = XLSX.utils.encode_cell({r:i, c:3}); if (ws[a]) ws[a].z = "0.00##"; }
        if (typeof l[4] === "number") { const a = XLSX.utils.encode_cell({r:i, c:4}); if (ws[a]) ws[a].z = "0.00"; }
      }
      { const a = XLSX.utils.encode_cell({r: rKopa, c: 4}); if (ws[a]) ws[a].z = "0.00"; }

      // Times New Roman 10pt visām rēķina lapas šūnām
      const rng = XLSX.utils.decode_range(ws["!ref"] || "A1");
      for (let r = rng.s.r; r <= rng.e.r; r++) {
        for (let c = rng.s.c; c <= rng.e.c; c++) {
          const a = XLSX.utils.encode_cell({r, c});
          if (ws[a]) ws[a].s = {...(ws[a].s||{}), font: {name:"Times New Roman", sz:10}};
        }
      }

      ws["!pageSetup"] = {
        paperSize: 9,          // A4
        orientation: "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
      };
      ws["!margins"] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };

      const sheetName = String(apt.dz).replace(/[:\\\/\?\*\[\]]/g, "").substring(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
  }

  return wb;
}

// ─── HTML invoice builder (for PDF / print) ────────────────────────────────

// Shared calculation + per-apt HTML body generation.
// Returns { gadam, mesCipars, blocks } where blocks = [{invoiceNr, html}]
// and html is the <div class="inv">...</div> fragment for one apartment.
function _buildInvoiceBlocks(atskaite, alokData, config, men, cirkulTarif, pozicijas, logo, company, footnotes) {
  const { period } = atskaite;
  const merged = mergeData(atskaite, alokData, config);

  const tApsam   = parseFloat(men.tarifMgmt)      || 0;
  const tRem     = parseFloat(men.tarifRepair)        || 0;
  const tSiltmez = parseFloat(men.tarifHeatNode) || 0;
  const tAU      = parseFloat(men.tarifCold)         || 0;
  const tKU      = parseFloat(men.tarifHot)         || 0;
  const tLietus  = parseFloat(men.tarifRain)     || 0;
  const koplElKopa = parseFloat(men.commonElec) || 0;
  const tKoplEl    = Math.round(koplElKopa / 12 * 100) / 100;
  const lietusMen  = Math.round(tLietus / 12 * 100) / 100;

  const _now = new Date();
  const _MNES = ["Janvāris","Februāris","Marts","Aprīlis","Maijs","Jūnijs",
                 "Jūlijs","Augusts","Septembris","Oktobris","Novembris","Decembris"];
  const gadam     = String(men.year     || _now.getFullYear());
  const mesCipars = String(men.monthNum || (_now.getMonth() + 1)).padStart(2, "0");
  const mesVards  = men.monthName       || _MNES[_now.getMonth()];
  const _curMes   = parseInt(mesCipars) || 1;
  const _curYear  = parseInt(gadam);
  const _nextMes  = _curMes === 12 ? 1 : _curMes + 1;
  const _nextYear = _curMes === 12 ? _curYear + 1 : _curYear;
  const nextMesCipars = String(_nextMes).padStart(2, "0");
  const nextGadam     = String(_nextYear);
  const _prevMes   = _curMes === 1 ? 12 : _curMes - 1;
  const _prevYear  = _curMes === 1 ? _curYear - 1 : _curYear;
  const periodTxt  = `${gadam}. gada ${mesVards}`;
  const period1Txt = `${String(_prevYear)}. gada ${_MNES[_prevMes - 1]}`;

  const atkritumiKopa  = parseFloat(men.waste) || 0;
  const totalPersonas  = merged.reduce((s, a) => s + (a.residents || 0), 0);

  const now = new Date();
  const DAYS_LV   = ["svētdiena","pirmdiena","otrdiena","trešdiena","ceturtdiena","piektdiena","sestdiena"];
  const MONTHS_LV = ["janvārī","februārī","martā","aprīlī","maijā","jūnijā",
                     "jūlijā","augustā","septembrī","oktobrī","novembrī","decembrī"];
  const dateTxt = `${DAYS_LV[now.getDay()]}, ${now.getFullYear()}. gada ${now.getDate()}. ${MONTHS_LV[now.getMonth()]}`;

  const PIEG_NOS   = company?.name    || '';
  const PIEG_ADDR  = company?.address || '';
  const PIEG_REG   = company?.regNr   || '';
  const PIEG_BANK  = company?.bank    || '';
  const PIEG_SWIFT = company?.swift   || '';
  const PIEG_KONTS = company?.account || '';

  const esc = s => String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const blocks = [];
  const rekNrSakumsHtml = Math.max(1, parseInt(men.invoiceNrStart) || 1);
  let htmlRekIdx = 0;

  for (const apt of merged) {
    const cfg          = config[apt.dz] || {};
    const cirkulGrupas = parseFloat(cfg.circGroup) || 0;
    const name         = apt.owner || "";
    const payDay = String(cfg.payDay || 20).padStart(2, "0");
    const termiņš = `${payDay}.${mesCipars}.${gadam}`;

    const rApsam   = Math.round(apt.area  * tApsam   * 100) / 100;
    const rRem     = Math.round(apt.area  * tRem     * 100) / 100;
    const rSiltmez = Math.round(apt.area  * tSiltmez * 100) / 100;
    const rCirk    = Math.round(cirkulGrupas * (cirkulTarif || 0) * 100) / 100;
    const rApkM2   = Math.round(apt.maksPlatibaiArPVN * 100) / 100;
    const rApkAlok = Math.round(apt.maksVienibamArPVN * 100) / 100;
    const rKoplEl  = Math.round(tKoplEl * 100) / 100;
    const atkritumiPerPers = totalPersonas > 0
      ? Math.round(atkritumiKopa / totalPersonas * 10000) / 10000 : 0;
    const rAtk = Math.round(atkritumiPerPers * (apt.residents || 0) * 100) / 100;

    const auLines = apt.coldMeters.map(m => ({
      nos: `Aukstā ūdens skaitītājs (${m.prev.toFixed(3)}–${m.cur.toFixed(3)})`,
      mv: "m³", daudz: m.pat, cena: tAU, summa: Math.round(m.pat * tAU * 100) / 100,
    }));
    const kuLines = apt.hotMeters.map(m => ({
      nos: `Karstā ūdens skaitītājs (${m.prev.toFixed(3)}–${m.cur.toFixed(3)})`,
      mv: "m³", daudz: m.pat, cena: tKU, summa: Math.round(m.pat * tKU * 100) / 100,
    }));
    const rAU = auLines.reduce((s, l) => s + l.summa, 0);
    const rKU = kuLines.reduce((s, l) => s + l.summa, 0);

    const effPoz = (pozicijas && pozicijas.length) ? pozicijas : DEFAULT_POZICIJAS.map(p=>({...p,on:true}));
    const dzOff   = new Set(cfg.posDisabled || []);
    const dzExtra = cfg.posExtra || [];
    const posLines = [];
    for (const poz of effPoz) {
      if (!poz.on || dzOff.has(poz.id)) continue;
      switch (poz.id) {
        case "audensU": posLines.push(...auLines); break;
        case "kudensU": posLines.push(...kuLines); break;
        case "cirk":    if (cirkulGrupas>0) posLines.push({nos:"Cirkulācija*",mv:"gr.",daudz:cirkulGrupas,cena:cirkulTarif||0,summa:rCirk}); break;
        case "lietus":  posLines.push({nos:"Lietus notekūdeņi",mv:"€/dz.",daudz:1,cena:lietusMen,summa:lietusMen}); break;
        case "atk":     if (rAtk>0) posLines.push({nos:"Atkritumu izvešana**",mv:"pers.",daudz:apt.residents||0,cena:atkritumiPerPers,summa:rAtk}); break;
        case "koplEl":  posLines.push({nos:"Koplietošanas elektrība***",mv:"€/dz.",daudz:1,cena:tKoplEl,summa:rKoplEl}); break;
        case "apsam":   posLines.push({nos:"Apsaimniekošana",mv:"€/m²",daudz:apt.area,cena:tApsam,summa:rApsam}); break;
        case "rem":     posLines.push({nos:"Remontdarbu fonds",mv:"€/m²",daudz:apt.area,cena:tRem,summa:rRem}); break;
        case "siltmez": if (rSiltmez>0) posLines.push({nos:"Siltummezgla apkalpošana",mv:"€/m²",daudz:apt.area,cena:tSiltmez,summa:rSiltmez}); break;
        case "apkM2":   if (men.heatingIncluded&&rApkM2>0) posLines.push({nos:`Apkure (kopējā) ${men.heatingM2Pct||"40"}%`,mv:"m²",daudz:apt.heatedArea,cena:apt.cenaM2ArPVN,summa:rApkM2}); break;
        case "apkAlok": if (men.heatingIncluded&&rApkAlok>0) posLines.push({nos:`Apkure (patēriņš) ${men.heatingAllocPct||"60"}%`,mv:"vien.",daudz:apt.alokVienibas,cena:apt.cenaVienArPVN,summa:rApkAlok}); break;
      }
    }
    for (const ex of dzExtra) {
      const s = parseFloat(ex.summa) || 0;
      if (ex.label && s !== 0) posLines.push({nos:ex.label,mv:"€/dz.",daudz:1,cena:s,summa:s});
    }

    const lines    = [...posLines];
    const kopsumma = lines.reduce((s, l) => s + l.summa, 0);
    const nowMM = String(now.getMonth() + 1).padStart(2, "0");
    const invoiceNr = `B${gadam}${nowMM}${String(rekNrSakumsHtml + htmlRekIdx).padStart(4, "0")}`;
    htmlRekIdx++;

    const lineRows = lines.map(l => `
        <tr>
          <td>${esc(l.nos)}</td>
          <td class="c">${esc(l.mv)}</td>
          <td class="r">${typeof l.daudz==="number"?l.daudz.toFixed(3):esc(String(l.daudz))}</td>
          <td class="r">${typeof l.cena==="number"?l.cena.toFixed(4):esc(String(l.cena))}</td>
          <td class="r">${typeof l.summa==="number"?l.summa.toFixed(2):esc(String(l.summa))}</td>
        </tr>`).join("");

    const dzFnOff = new Set(cfg.footnotesDisabled || []);
    const nDz = merged.length || 1;
    const fnCtx = {
      waste: (parseFloat(men.waste)||0).toFixed(2), commonElec: (parseFloat(men.commonElec)||0).toFixed(2),
      commonElecKwh: men.commonElecKwh || '', heat: (parseFloat(men.heat)||0).toFixed(2),
      water: (parseFloat(men.water)||0).toFixed(2), monthName: men.monthName || '', year: men.year || '',
      residents: String(apt.residents || 0), rAtk: rAtk.toFixed(2), kopsumma: kopsumma.toFixed(2),
      waterM3: (apt.auKopa + apt.kuKopa).toFixed(3), waterEur: (rAU + rKU).toFixed(2),
      heatMwh: men.heatMwh || '',
      heatAlok: (apt.alokVienibas || 0).toFixed(4), heatEur: (rApkM2 + rApkAlok).toFixed(2),
      elecKwh: ((parseFloat(men.commonElecKwh)||0) / nDz).toFixed(1),
      elecEur: rKoplEl.toFixed(2), wasteEur: rAtk.toFixed(2),
    };
    const renderedFootnotes = (footnotes||[])
      .filter(fn => fn.is_on && !dzFnOff.has(fn.id))
      .map(fn => ({ marker: fn.marker, text: renderFnText(fn.text, fnCtx) }));
    const fnHtml = renderedFootnotes
      .map(fn => `<p class="fn">${esc(fn.marker)} ${esc(fn.text)}</p>`).join('\n');

    blocks.push({
      invoiceNr, aptDz: apt.dz, owner: name,
      periodYear: parseInt(gadam), periodMonth: parseInt(mesCipars),
      paymentDue: termiņš,
      totalEur: Math.round(kopsumma * 100) / 100,
      lines: lines.map(l => ({ nos: l.nos, mv: l.mv, daudz: l.daudz, cena: l.cena, summa: l.summa })),
      dateTxt, period1Txt, periodTxt, wordsText: numVardiem(kopsumma),
      supplier: { nos: PIEG_NOS, addr: PIEG_ADDR, reg: PIEG_REG, bank: PIEG_BANK, swift: PIEG_SWIFT, konts: PIEG_KONTS },
      recipientAddress: `${PIEG_ADDR}, dz. ${apt.dz}`,
      renderedFootnotes,
      html: `
<div class="inv">
  <div class="hdr-row">
    <span>${esc(dateTxt)}</span>
    <strong class="inv-nr">Rēķins Nr. ${esc(invoiceNr)}</strong>
  </div>
  <table class="parties">
    <tr><td class="ph">Piegādātājs:</td><td class="ph">Saņēmējs:</td></tr>
    <tr><td>${esc(PIEG_NOS)}</td><td>${esc(name)}</td></tr>
    <tr><td>${esc(PIEG_ADDR)}</td><td>${esc(PIEG_ADDR)}, dz. ${esc(apt.dz)}</td></tr>
    <tr><td>${esc(PIEG_REG)}</td><td></td></tr>
    <tr><td>${esc(PIEG_BANK)}</td><td></td></tr>
    <tr><td>${esc(PIEG_SWIFT)}</td><td></td></tr>
    <tr><td>${esc(PIEG_KONTS)}</td><td></td></tr>
  </table>
  <p class="pl">Komunālo pakalpojumu sniegšanas periods: ${esc(period1Txt)}</p>
  <p class="pl">Apsaimniekošana, remontdarbu fonds: ${esc(periodTxt)}</p>
  <p class="pl">Rēķina apmaksas termiņš: ${esc(termiņš)}</p>
  <table class="lines">
    <thead>
      <tr>
        <th>Nosaukums</th><th class="c">Mērvien.</th>
        <th class="r">Daudz.</th><th class="r">Cena (EUR)</th><th class="r">Summa (EUR)</th>
      </tr>
    </thead>
    <tbody>
      <tr class="grp"><td colspan="5">Komunālie pakalpojumi un apsaimniekošana</td></tr>
      ${lineRows}
    </tbody>
  </table>
  <div class="total-row">
    <span>Summa samaksai, EUR</span>
    <strong>${kopsumma.toFixed(2)}</strong>
  </div>
  <p class="words">Summa vārdiem: ${esc(numVardiem(kopsumma))}</p>
  ${fnHtml}
  <div class="inv-footer">
    <p class="sig">Rēķins sagatavots elektroniski un derīgs bez paraksta.</p>
    ${logo ? `<img class="inv-logo" src="${logo}" alt="Brīvības 166"/>` : ''}
  </div>
</div>` });
  }

  return { gadam, mesCipars, blocks };
}

// All invoices in one document — for batch preview / print
function buildInvoiceHtml(atskaite, alokData, config, men, cirkulTarif, pozicijas, logo, company, footnotes) {
  const { gadam, mesCipars, blocks } = _buildInvoiceBlocks(atskaite, alokData, config, men, cirkulTarif, pozicijas, logo, company, footnotes);
  return `<!DOCTYPE html>
<html lang="lv">
<head><meta charset="utf-8"><title>DZIB Rēķini ${gadam}-${mesCipars}</title>
<style>${INVOICE_CSS}</style></head>
<body>${blocks.map(b => b.html).join("\n")}</body>
</html>`;
}

// One complete HTML document per apartment — for individual file download
function buildInvoiceHtmls(atskaite, alokData, config, men, cirkulTarif, pozicijas, logo, company, footnotes) {
  const { gadam, mesCipars, blocks } = _buildInvoiceBlocks(atskaite, alokData, config, men, cirkulTarif, pozicijas, logo, company, footnotes);
  const singleCss = INVOICE_CSS
    .replace(".inv { page-break-after: always; }", "")
    .replace(".inv:last-child { page-break-after: avoid; }", "");
  return blocks.map(({ invoiceNr, aptDz, html }) => ({
    filename: `Rekins_${invoiceNr}-${aptDz}.html`,
    html: `<!DOCTYPE html>
<html lang="lv">
<head><meta charset="utf-8"><title>Rēķins Nr. ${invoiceNr}</title>
<style>${singleCss}</style></head>
<body>${html}</body>
</html>`,
  }));
}

// ─── Module-level helpers (must NOT be defined inside App) ────────────────────
const f3 = v => isNaN(v) ? "—" : v.toFixed(3);
const f4 = v => isNaN(v) ? "—" : v.toFixed(4);

function MenSec({ children }) {
  return (
    <div style={{padding:"6px 20px",background:"var(--surface)",borderBottom:"1px solid var(--border)",
      fontSize:10,fontWeight:700,color:"var(--text-2)",textTransform:"uppercase",letterSpacing:".7px",fontFamily:"DM Mono,monospace"}}>
      {children}
    </div>
  );
}

function MenCheck({ label, checked, onChange, note }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 20px",borderBottom:"1px solid var(--surface)"}}>
      <div style={{flex:"0 0 240px"}}>
        <div style={{fontSize:12,color:"var(--text-1)",fontWeight:500}}>{label}</div>
        {note && <div style={{fontSize:10,color:"var(--text-3)",marginTop:1}}>{note}</div>}
      </div>
      <input type="checkbox" checked={!!checked} onChange={onChange}
        style={{width:17,height:17,cursor:"pointer",accentColor:"var(--blue-500)"}} />
    </div>
  );
}

function MenInp({ label, type="number", unit, note, wide, value, onChange, onBlur }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 20px",borderBottom:"1px solid var(--surface)"}}>
      <div style={{flex:"0 0 240px"}}>
        <div style={{fontSize:12,color:"var(--text-1)",fontWeight:500}}>{label}</div>
        {note && <div style={{fontSize:10,color:"var(--text-3)",marginTop:1}}>{note}</div>}
      </div>
      <input
        type={type} step="0.0001" value={value||""}
        onChange={onChange} onBlur={onBlur}
        style={{flex:wide?"2":"1",padding:"5px 9px",fontFamily:"DM Mono,monospace",fontSize:13,
          fontWeight:600,border:"1.5px solid var(--border-2)",borderRadius:"var(--r-sm)",outline:"none",
          background:value?"#fff":"var(--surface)",color:"var(--blue-900)",transition:"border-color .15s"}}
      />
      {unit && <span style={{fontSize:11,color:"var(--text-3)",minWidth:36}}>{unit}</span>}
    </div>
  );
}

function SiltInp({label, val, set, unit, note, readOnly, readVal, color="#1F4E79", step:st="0.001"}) {
  return (
    <div className="silt-inp-row">
      <div className="silt-lbl-wrap">
        <div className="silt-lbl">{label}</div>
        {note && <div className="silt-note">{note}</div>}
      </div>
      {readOnly
        ? <div className="silt-readonly">{readVal!==null?f3(readVal):<span style={{color:"#aaa",fontWeight:400,fontSize:11}}>ielādēt F1</span>}</div>
        : <input className="silt-input" style={{color}} type="number" step={st} value={val} onChange={e=>set(e.target.value)} />
      }
      <span className="silt-unit">{unit}</span>
    </div>
  );
}

function SiltRes({label, formula, value, unit="MWh", big, warn}) {
  return (
    <div className={`silt-res-row${big?" silt-big":""}${warn?" silt-big-warn":""}`}>
      <div>
        <div className="silt-res-lbl">{label}</div>
        {formula && <div className="silt-res-f">{formula}</div>}
      </div>
      <div>
        <span className="silt-res-val">{value}</span>
        <span className="silt-res-unit">{unit}</span>
      </div>
    </div>
  );
}

function SiltSec({children}) {
  return <div className="silt-sec">{children}</div>;
}

function StepFooter({ step, onBack, onNext, canNext, noNext }) {
  const LABELS = ['Ūdens skaitītāji','Siltuma kalkulators','Alokatoru dati','Ģenerēt',''];
  return (
    <div className="step-bar">
      <button className="step-bar-back" disabled={step===0} onClick={onBack}>← Atpakaļ</button>
      <span className="step-bar-mid">Solis {step+1} no 5</span>
      {!noNext && (
        <button className="step-bar-next" disabled={!canNext} onClick={onNext}>
          {LABELS[step]} →
        </button>
      )}
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────
export default function App({ onBack }) {
  const [step, setStep] = useState(0);   // 0=konfigurācija, 1=iestatījumi, 2=ūdens, 3=siltums, 4=alokatori, 5=ģenerēt

  // Fails 1
  const [file1,    setFile1]    = useState(null);
  const [atskaite, setAtskaite] = useState(null);
  const [drag1,    setDrag1]    = useState(false);
  const [err1,     setErr1]     = useState("");

  // Siltuma kalkulators
  const [sKopa,   setSKopa]   = useState("");
  const [sTkud,   setSTkud]   = useState("55");
  const [sTaud,   setSTaud]   = useState("15");
  const [sC,      setSC]      = useState("1");
  const [sK1,     setSK1]     = useState("1");
  const [sK2,     setSK2]     = useState("0.8598");
  const [sDzSk,   setSDzSk]   = useState("19.5");
  const [sKoefC,  setSKoefC]  = useState("0.0728");

  // Fails 2
  const [file2,    setFile2]    = useState(null);
  const [alokData, setAlokData] = useState(null);
  const [drag2,    setDrag2]    = useState(false);
  const [err2,     setErr2]     = useState("");

  // Mēneša iestatījumi
  const [men, setMen] = useState({
    // Invoice totals
    heat:             "",
    water:            "",
    waste:            "",
    commonElec:       "",
    // Consumption
    coldWaterM3:      "",
    heatMwh:          "",
    commonElecKwh:    "",
    // Tariffs
    tarifCold:        "3.2307",
    tarifHot:         "7.26",
    tarifCirc:        "",
    tarifMgmt:        "0.6044",
    tarifRepair:      "0.3156",
    tarifHeatNode:    "0.037",
    tarifRain:        "9.6074",
    tarifCommonElec:  "6.80",
    // Period
    period:           "",
    monthNum:         "",
    monthName:        "",
    year:             "",
    invoiceNrStart:   "1",
    // Heating
    heatingIncluded:  true,
    heatingM2Pct:     "40",
    heatingAllocPct:  "60",
  });

  const [company,     setCompany]     = useState({name:'',address:'',regNr:'',bank:'',swift:'',account:'',buildingId:'',logoPath:'',logoData:'',title:''});
  const [footnotes,   setFootnotes]   = useState([]);
  const [config,      setConfig]      = useState({});
  const [done,        setDone]        = useState(false);
  const [errPdf,      setErrPdf]      = useState("");
  const [emailSettings, setEmailSettings] = useState({
    subject: 'Rēķins Nr. {{invoiceNr}} par {{period}}, {{dz}}',
    body: '<p>Labdien, <strong>{{owner}}</strong>!</p>\n<p>Pievienots rēķins <strong>Nr. {{invoiceNr}}</strong> par <strong>{{period}}</strong>.</p>\n<p>Kopējā summa: <strong>{{kopsumma}} EUR</strong>.<br>Apmaksas termiņš: <strong>{{paymentDue}}</strong>.</p>\n<p>Ar cieņu <br>DZĪB Brīvības 166 Pārvaldnieks</p>',
  });
  const [ownerEmails,   setOwnerEmails]   = useState({});
  const [emailSending,  setEmailSending]  = useState(false);
  const [emailProgress, setEmailProgress] = useState({ sent: 0, total: 0, errors: [], noEmail: [] });
  const [extraInvoices, setExtraInvoices] = useState([]);
  const [extraForm,     setExtraForm]     = useState(null);
  const [fullInvConfig, setFullInvConfig] = useState({});
  const [fullInvEditApt,setFullInvEditApt]= useState(null);
  // extraForm = null → list view; object → new/edit form
  // { periodMode:'settings'|'custom', customPeriod:'', owner:'', apts:[], lines:[{nos,mv,daudz,cena}] }
  const [pozicijas,   setPozicijas]   = useState(() => DEFAULT_POZICIJAS.map(p => ({...p, on: true})));
  const [activePanel,    setActivePanel]    = useState(null); // 'cfg'|'poz'|'fn'|'comp'|null
  const [expandedDz,     setExpandedDz]     = useState(null);
  const [pendingAtskaite,setPendingAtskaite]= useState(null);
  const [pendingFile1,   setPendingFile1]   = useState(null);
  const [dzMapping,      setDzMapping]      = useState({});
  const [showMappingDlg, setShowMappingDlg] = useState(false);
  const [pendingAlok,    setPendingAlok]    = useState(null);
  const [pendingFile2,   setPendingFile2]   = useState(null);
  const [dzMapping2,     setDzMapping2]     = useState({});
  const [showMappingDlg2,setShowMappingDlg2]= useState(false);

  const ref1 = useRef(), ref2 = useRef();

  // ── Ielādēt visus datus no DB vienā reizē ──
  useEffect(() => {
    // Dzīvokļu konfigurācija
    supabase.from('apartment_config').select('*').then(({ data }) => {
      if (data && data.length) {
        const cfg = {};
        for (const r of data) cfg[r.apt] = {
          owner: r.owner || '', area: r.area || 0, heatedArea: r.heated_area || 0, residents: r.residents || 0,
          email: r.email || '', circGroup: r.circ_group || 0, payDay: r.pay_day || 20,
          posDisabled: r.pos_disabled || [], posExtra: r.pos_extra || [],
          footnotesDisabled: r.footnotes_disabled || [],
        };
        setConfig(cfg);
      }
    });
    // Mēneša iestatījumi
    supabase.from('settings').select('value').eq('key', 'monthly_settings').maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          const v = data.value;
          const period = v.period || (v.year && v.monthNum
            ? `${v.year}-${String(v.monthNum).padStart(2,'0')}` : '');
          setMen(prev => ({ ...prev, ...v, period }));
        }
      });
    // Rēķinu pozīcijas
    supabase.from('invoice_positions').select('*').order('sort_order').then(({ data }) => {
      if (data && data.length)
        setPozicijas(mergePoz(data.map(r => ({ id: r.id, label: r.label, mv: r.mv || '', on: r.is_on }))));
    });
    // Uzņēmuma rekvizīti
    supabase.from('settings').select('value').eq('key', 'company').maybeSingle()
      .then(({ data }) => { if (data?.value) setCompany(prev => ({ ...prev, ...data.value })); });
    // Zemsvītras piezīmes
    supabase.from('footnotes').select('*').order('sort_order')
      .then(({ data }) => { if (data) setFootnotes(data); });
    // Epasta iestatījumi
    supabase.from('settings').select('value').eq('key', 'email_settings').maybeSingle()
      .then(({ data }) => { if (data?.value) setEmailSettings(prev => ({ ...prev, ...data.value })); });
    // Iedzīvotāju e-pasta adreses
    supabase.from('settings').select('value').eq('key', 'owner_emails').maybeSingle()
      .then(({ data }) => { if (data?.value) setOwnerEmails(data.value); });
    // Pilno rēķinu konfigurācija
    supabase.from('settings').select('value').eq('key', 'full_invoice_config').maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          const safe = {};
          for (const [k, v] of Object.entries(data.value)) {
            safe[k] = {
              ...defaultFullAptCfg, ...v,
              freeLines: Array.isArray(v?.freeLines) ? v.freeLines : [],
              includePositions: Array.isArray(v?.includePositions) ? v.includePositions : [],
            };
          }
          setFullInvConfig(safe);
        }
      });
    // Papildu rēķini
    supabase.from('extra_invoices').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setExtraInvoices(data); });
  }, []);

  const saveMen = (newMen) => { saveMenDb(newMen); };
  const updateMen = (field, val) => {
    setMen(prev => ({ ...prev, [field]: val }));
  };
  const saveMenField = () => {
    setMen(prev => { saveMenDb(prev); return prev; });
  };

  const updateCompany = (field, val) => setCompany(prev => ({ ...prev, [field]: val }));
  const saveCompanyNow = () => setCompany(prev => { saveCompanyDb(prev); return prev; });

  const readWb = async f => { const b=await f.arrayBuffer(); return XLSX.read(new Uint8Array(b),{type:"array"}); };

  const processF1 = useCallback(async f => {
    setErr1(""); setDone(false);
    try {
      await ensureXLSX();
      const r = parseAtskaite(await readWb(f), company.buildingId || "");
      const cfgIds = Object.keys(config);
      const cfgSet = new Set(cfgIds);
      const fileIds = r.apartments.map(a => a.dz);
      const allMatch = fileIds.every(id => cfgSet.has(id));
      if (allMatch) {
        setAtskaite(r); setFile1(f);
      } else {
        const initMap = {};
        for (const fid of fileIds) {
          if (cfgSet.has(fid)) {
            initMap[fid] = fid;
          } else {
            const auto = cfgIds.find(cid =>
              fid.startsWith(cid + ' ') || fid.startsWith(cid + '-') || fid === cid
            );
            initMap[fid] = auto || '';
          }
        }
        setPendingAtskaite(r);
        setPendingFile1(f);
        setDzMapping(initMap);
        setShowMappingDlg(true);
      }
    } catch(e) { setErr1(e.message); }
  }, [config, company]);

  const processF2 = useCallback(async f => {
    setErr2(""); setDone(false);
    try {
      await ensureXLSX();
      const r = parseAlokatori(await readWb(f));
      const cfgIds = Object.keys(config);
      const cfgSet = new Set(cfgIds);
      const fileIds = r.map(a => a.dz);
      const allMatch = fileIds.every(id => cfgSet.has(id));
      if (allMatch) {
        setAlokData(r); setFile2(f);
      } else {
        const initMap = {};
        for (const fid of fileIds) {
          if (cfgSet.has(fid)) {
            initMap[fid] = fid;
          } else {
            const auto = cfgIds.find(cid =>
              fid.startsWith(cid + ' ') || fid.startsWith(cid + '-') || fid === cid
            );
            initMap[fid] = auto || '';
          }
        }
        setPendingAlok(r);
        setPendingFile2(f);
        setDzMapping2(initMap);
        setShowMappingDlg2(true);
      }
    } catch(e) { setErr2(e.message); }
  }, [config]);

  const confirmMapping = () => {
    if (!pendingAtskaite) return;
    const mapped = {
      ...pendingAtskaite,
      apartments: pendingAtskaite.apartments.map(a => ({
        ...a, dz: dzMapping[a.dz] || a.dz,
      })),
    };
    setAtskaite(mapped);
    setFile1(pendingFile1);
    setShowMappingDlg(false);
    setPendingAtskaite(null);
    setPendingFile1(null);
  };

  const confirmMapping2 = () => {
    if (!pendingAlok) return;
    const cfgSet = new Set(Object.keys(config));
    const mapped = pendingAlok
      .map(a => ({ ...a, dz: dzMapping2[a.dz] || a.dz }))
      .filter(a => cfgSet.has(a.dz));
    setAlokData(mapped);
    setFile2(pendingFile2);
    setShowMappingDlg2(false);
    setPendingAlok(null);
    setPendingFile2(null);
  };

  const onDrop1 = useCallback(e=>{ e.preventDefault(); setDrag1(false); const f=e.dataTransfer.files[0]; if(f) processF1(f); },[processF1]);
  const onDrop2 = useCallback(e=>{ e.preventDefault(); setDrag2(false); const f=e.dataTransfer.files[0]; if(f) processF2(f); },[processF2]);

  const updateCfg = (dz, field, val) => {
    const v = (field==="email" || field==="owner" || Array.isArray(val)) ? val : (parseFloat(val)||0);
    setConfig(p => ({...p, [dz]: {...p[dz], [field]: v}}));
  };
  const saveCfgNow = () => { setConfig(prev => { saveCfgDb(prev); return prev; }); };
  const deleteCfg = async (dz) => {
    setConfig(prev => { const n={...prev}; delete n[dz]; return n; });
    if (expandedDz === dz) setExpandedDz(null);
    try { await supabase.from('apartment_config').delete().eq('apt', dz); }
    catch(e) { console.error('deleteCfg:', e); }
  };

  const toggleDzPoz = (dz, posId) => {
    setConfig(prev => {
      const off = prev[dz]?.posDisabled || [];
      const newOff = off.includes(posId) ? off.filter(x=>x!==posId) : [...off, posId];
      const updated = {...prev, [dz]: {...prev[dz], posDisabled: newOff}};
      saveCfgDb(updated); return updated;
    });
  };
  const toggleDzFn = (dz, fnId) => {
    setConfig(prev => {
      const off = prev[dz]?.footnotesDisabled || [];
      const newOff = off.includes(fnId) ? off.filter(x=>x!==fnId) : [...off, fnId];
      const updated = {...prev, [dz]: {...prev[dz], footnotesDisabled: newOff}};
      saveCfgDb(updated); return updated;
    });
  };
  const addDzExtra = (dz) => {
    setConfig(prev => {
      const extra = [...(prev[dz]?.posExtra||[]), {label:"",summa:""}];
      const updated = {...prev, [dz]: {...prev[dz], posExtra: extra}};
      saveCfgDb(updated); return updated;
    });
  };
  const removeDzExtra = (dz, i) => {
    setConfig(prev => {
      const extra = (prev[dz]?.posExtra||[]).filter((_,idx)=>idx!==i);
      const updated = {...prev, [dz]: {...prev[dz], posExtra: extra}};
      saveCfgDb(updated); return updated;
    });
  };
  const updateDzExtra = (dz, i, field, val) => {
    setConfig(prev => {
      const extra = [...(prev[dz]?.posExtra||[])];
      extra[i] = {...extra[i], [field]: val};
      const updated = {...prev, [dz]: {...prev[dz], posExtra: extra}};
      saveCfgDb(updated); return updated;
    });
  };

  const updateFn = (id, field, val) => {
    setFootnotes(prev => prev.map(fn => fn.id === id ? {...fn, [field]: val} : fn));
  };
  const saveFnNow = () => {
    setFootnotes(prev => { saveFnDb(prev); return prev; });
  };
  const toggleFnOn = (id) => {
    setFootnotes(prev => {
      const next = prev.map(fn => fn.id === id ? {...fn, is_on: !fn.is_on} : fn);
      saveFnDb(next); return next;
    });
  };

  const updatePoz = (newPoz) => { setPozicijas(newPoz); savePozDb(newPoz); };
  const movePoz = (i, dir) => {
    const p = [...pozicijas]; const j = i + dir;
    if (j < 0 || j >= p.length) return;
    [p[i], p[j]] = [p[j], p[i]]; updatePoz(p);
  };
  const togglePozId = (id) => updatePoz(pozicijas.map(p => p.id===id ? {...p,on:!p.on} : p));

  const saveEmailSettings = (upd) => {
    const next = upd ? { ...emailSettings, ...upd } : emailSettings;
    if (upd) setEmailSettings(next);
    supabase.from('settings').upsert({ key: 'email_settings', value: next }).catch(e => console.error('saveEmailSettings:', e));
  };
  const saveOwnerEmails = (emails) => {
    supabase.from('settings').upsert({ key: 'owner_emails', value: emails })
      .then(({ error }) => { if (error) console.error('saveOwnerEmails:', error); })
      .catch(e => console.error('saveOwnerEmails:', e));
  };
  const saveFullInvConfig = (cfg) => {
    supabase.from('settings').upsert({ key: 'full_invoice_config', value: cfg })
      .then(({ error }) => { if (error) console.error('saveFullInvConfig:', error); })
      .catch(e => console.error('saveFullInvConfig:', e));
  };
  const updateFullApt = (apt, patch) => {
    setFullInvConfig(prev => {
      const merged = { ...defaultFullAptCfg, ...prev[apt], ...patch };
      if (!Array.isArray(merged.freeLines)) merged.freeLines = [];
      if (!Array.isArray(merged.includePositions)) merged.includePositions = [];
      const next = { ...prev, [apt]: merged };
      saveFullInvConfig(next);
      return next;
    });
  };

  // ─── Papildu rēķini ────────────────────────────────────────────────────────
  const loadExtraInvoices = async () => {
    const { data } = await supabase.from('extra_invoices').select('*').order('created_at', { ascending: false });
    if (data) setExtraInvoices(data);
  };

  const _extraPeriodInfo = (form) => {
    const _now = new Date();
    let gadam, mesCipars, mesVards;
    if (form.periodMode === 'custom' && form.customPeriod) {
      const [y, m] = form.customPeriod.split('-');
      gadam = y; mesCipars = m.padStart(2,'0'); mesVards = MNES[parseInt(m,10)-1] || '';
    } else {
      gadam     = String(men.year     || _now.getFullYear());
      mesCipars = String(men.monthNum || (_now.getMonth()+1)).padStart(2,'0');
      mesVards  = men.monthName || MNES[_now.getMonth()];
    }
    const curMes  = parseInt(mesCipars) || 1;
    const curYear = parseInt(gadam);
    const nextMes = curMes === 12 ? 1 : curMes + 1;
    const nextYear = curMes === 12 ? curYear + 1 : curYear;
    return {
      gadam, mesCipars, mesVards,
      periodYear:  curYear,
      periodMonth: curMes,
      period1Txt:  `${gadam}. gada ${mesVards}`,
      periodTxt:   `${gadam}. gada ${mesVards}`,
      nextMesCipars: String(nextMes).padStart(2,'0'),
      nextGadam:     String(nextYear),
    };
  };

  const handleSaveExtra = async () => {
    if (!extraForm?.owner || !extraForm.apts?.length || !extraForm.lines?.some(l => l.nos?.trim())) return;
    const pi = _extraPeriodInfo(extraForm);

    const lines = extraForm.lines.filter(l => l.nos?.trim()).map(l => {
      const daudz = parseFloat(l.daudz) || 0;
      const cena  = parseFloat(l.cena)  || 0;
      return { nos: l.nos.trim(), mv: l.mv||'', daudz, cena, summa: Math.round(daudz*cena*100)/100 };
    });
    const totalEur = Math.round(lines.reduce((s,l) => s+l.summa, 0) * 100) / 100;
    const payDay = String(config[extraForm.apts[0]]?.payDay || 20).padStart(2,'0');
    const paymentDue = `${payDay}.${pi.mesCipars}.${pi.gadam}`;
    const recipientAddress = extraForm.apts.map(apt => `${company.address||''}, dz. ${apt}`).join('\n');
    const sharedFields = {
      period_year: pi.periodYear, period_month: pi.periodMonth,
      period1_txt: pi.period1Txt, period_txt: pi.periodTxt,
      apts: extraForm.apts, owner: extraForm.owner,
      recipient_address: recipientAddress, lines, total_eur: totalEur, payment_due: paymentDue,
    };

    if (extraForm.id) {
      const { error: updErr } = await supabase.from('extra_invoices').update(sharedFields).eq('id', extraForm.id);
      if (updErr) { alert('Kļūda saglabājot:\n' + updErr.message); return; }
    } else {
      const { error: insErr } = await supabase.from('extra_invoices').insert(sharedFields);
      if (insErr) { alert('Kļūda saglabājot papildu rēķinu:\n' + insErr.message); return; }
    }
    await loadExtraInvoices();
    setExtraForm(null);
  };

  const _buildExtraBlock = async (inv) => {
    const now = new Date();
    const DAYS_LV   = ["svētdiena","pirmdiena","otrdiena","trešdiena","ceturtdiena","piektdiena","sestdiena"];
    const MONTHS_LV = ["janvārī","februārī","martā","aprīlī","maijā","jūnijā","jūlijā","augustā","septembrī","oktobrī","novembrī","decembrī"];
    const dateTxt = `${DAYS_LV[now.getDay()]}, ${now.getFullYear()}. gada ${now.getDate()}. ${MONTHS_LV[now.getMonth()]}`;
    const logo = await resolveLogo(company);
    return {
      logo,
      block: {
        dateTxt, invoiceNr: inv.invoice_nr,
        supplier: { nos: company.name||'', addr: company.address||'', reg: company.regNr||'', bank: company.bank||'', swift: company.swift||'', konts: company.account||'' },
        owner: inv.owner, recipientAddress: inv.recipient_address,
        period1Txt: '', periodTxt: '',
        paymentDue: inv.payment_due, lines: inv.lines,
        totalEur: parseFloat(inv.total_eur)||0,
        wordsText: numVardiem(parseFloat(inv.total_eur)||0),
        renderedFootnotes: [],
      },
    };
  };

  const handleExtraPdf = async (inv) => {
    const [pdfLib, { InvoiceDocument: InvoiceDoc }] = await Promise.all([
      import('@react-pdf/renderer'), import('./src/InvoicePdf.jsx'),
    ]);
    try { await ensureFonts(pdfLib); } catch(e) { alert("Fontu kļūda: " + e.message); return; }
    const { logo, block } = await _buildExtraBlock(inv);
    const el = React.createElement(InvoiceDoc, { blocks: [block], logo });
    const pdfBlob = await pdfLib.pdf(el).toBlob();
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a'); a.href = url;
    a.download = `Rekins_${inv.invoice_nr}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExtraEmail = async (inv) => {
    const toEmail = (ownerEmails[inv.owner] || '').trim();
    if (!toEmail) { alert(`Īpašniekam "${inv.owner}" nav norādīta e-pasta adrese.`); return; }
    const emails = [toEmail];
    const [pdfLib, { InvoiceDocument: InvoiceDoc }] = await Promise.all([
      import('@react-pdf/renderer'), import('./src/InvoicePdf.jsx'),
    ]);
    try { await ensureFonts(pdfLib); } catch(e) { alert("Fontu kļūda: " + e.message); return; }
    const { logo, block } = await _buildExtraBlock(inv);
    const el = React.createElement(InvoiceDoc, { blocks: [block], logo });
    const pdfBlob = await pdfLib.pdf(el).toBlob();
    const pdfBase64 = await new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result.split(',')[1]); r.readAsDataURL(pdfBlob); });
    const emailCtx = { owner: inv.owner, invoiceNr: inv.invoice_nr, period: inv.period1_txt, dz: inv.apts.join(', '), kopsumma: parseFloat(inv.total_eur).toFixed(2), paymentDue: inv.payment_due };
    const errs = [];
    for (const toEmail of emails) {
      const { error } = await supabase.functions.invoke('send-invoice', {
        body: { to: toEmail, subject: renderFnText(emailSettings.subject, emailCtx), html: renderFnText(emailSettings.body, emailCtx), pdfBase64, filename: `Rekins_${inv.invoice_nr}.pdf` },
      });
      if (error) {
        let msg = error.message;
        try { const txt = await error.context?.text?.(); if (txt) { const j = JSON.parse(txt); if (j?.error) msg = j.error; } } catch {}
        errs.push(`${toEmail}: ${msg}`);
      }
    }
    alert(errs.length ? `Kļūdas:\n${errs.join('\n')}` : `✅ Nosūtīts uz: ${emails.join(', ')}`);
  };

  const handleDeleteExtra = async (id) => {
    if (!window.confirm('Dzēst šo papildu rēķinu?')) return;
    await supabase.from('extra_invoices').delete().eq('id', id);
    await loadExtraInvoices();
  };

  const handleSendEmails = async () => {
    if (!atskaite || !alokData) return;

    // ── 1. Pārbaudīt vai rēķini jau uzģenerēti ──
    const periodYear  = parseInt(men.year  || new Date().getFullYear());
    const periodMonth = parseInt(men.monthNum || (new Date().getMonth() + 1));
    const periodLabel = `${periodYear}-${String(periodMonth).padStart(2, '0')}`;

    const { data: existing } = await supabase
      .from('issued_invoices').select('id')
      .eq('period_year', periodYear).eq('period_month', periodMonth).limit(1);

    const alreadyGenerated = Array.isArray(existing) && existing.length > 0;

    if (!alreadyGenerated) {
      if (!window.confirm(`Rēķini par ${periodLabel} vēl nav uzģenerēti.\nVai uzģenerēt un lejupielādēt PDF rēķinus tagad?`))
        return;
      const ok = await handleGeneratePdf();
      if (!ok) return;
    }

    if (!window.confirm(`Izsūtīt rēķinus par ${periodLabel} uz norādītajām epasta adresēm?`))
      return;

    // ── 2. Sagatavot ──
    setEmailSending(true);
    setEmailProgress({ sent: 0, total: 0, errors: [], noEmail: [] });
    setErrPdf("");

    const logo = await resolveLogo(company);

    let blocks;
    try {
      ({ blocks } = _buildInvoiceBlocks(atskaite, alokData, config, men, effCirkulTarif, pozicijas, logo, company, footnotes));
    } catch(e) { setErrPdf(e.message); setEmailSending(false); return; }

    let pdfLib, InvoiceDoc;
    try {
      [pdfLib, { InvoiceDocument: InvoiceDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./src/InvoicePdf.jsx'),
      ]);
    } catch(e) { setErrPdf("PDF bibliotēka nav pieejama: " + e.message); setEmailSending(false); return; }
    try { await ensureFonts(pdfLib); } catch(e) { setErrPdf("Fontu ielādes kļūda: " + e.message); setEmailSending(false); return; }

    const blocksWithEmail = blocks.filter(b => (ownerEmails[b.owner] || '').trim());
    const noEmail = blocks.filter(b => !(ownerEmails[b.owner] || '').trim()).map(b => `${b.aptDz} (${b.owner})`);

    setEmailProgress({ sent: 0, total: blocksWithEmail.length, errors: [], noEmail });

    // ── 3. Sūtīt ──
    let sent = 0;
    for (const block of blocksWithEmail) {
      const toEmail = (ownerEmails[block.owner] || '').trim();
      const emailCtx = {
        owner: block.owner, invoiceNr: block.invoiceNr,
        period: block.period1Txt, dz: block.aptDz,
        kopsumma: block.totalEur.toFixed(2), paymentDue: block.paymentDue,
      };
      try {
        const el = React.createElement(InvoiceDoc, { blocks: [block], logo });
        const pdfBlob = await pdfLib.pdf(el).toBlob();
        const pdfBase64 = await new Promise(res => {
          const r = new FileReader(); r.onloadend = () => res(r.result.split(',')[1]); r.readAsDataURL(pdfBlob);
        });
        const { error } = await supabase.functions.invoke('send-invoice', {
          body: {
            to: toEmail,
            subject: renderFnText(emailSettings.subject, emailCtx),
            html:    renderFnText(emailSettings.body,    emailCtx),
            pdfBase64,
            filename: `Rekins_${block.invoiceNr}-${block.aptDz}.pdf`,
          },
        });
        if (error) {
          let msg = error.message;
          try {
            const txt = await error.context?.text?.();
            if (txt) { const j = JSON.parse(txt); if (j?.error) msg = j.error; }
          } catch {}
          throw new Error(msg);
        }
        sent++;
        setEmailProgress(prev => ({ ...prev, sent }));
      } catch(e) {
        const msg = e.message?.includes('Failed to send a request')
          ? `Dz. ${block.aptDz}: Edge Function nav pieejama — vai funkcija ir deploy-ota? (supabase functions deploy send-invoice)`
          : `Dz. ${block.aptDz} (${toEmail}): ${e.message}`;
        setEmailProgress(prev => ({ ...prev, errors: [...prev.errors, msg] }));
      }
      await new Promise(r => setTimeout(r, 300));
    }

    setEmailSending(false);
  };

  const handleGenerate = async () => {
    if(!atskaite||!alokData) return;
    await ensureXLSX();
    const periodClean = atskaite.period.trim().replace(/\s*-\s*/g,"-");
    const parts = periodClean.split("-");
    const yyyy = parts[0]?.padStart(4,"0") || "0000";
    const mm   = parts[1]?.padStart(2,"0") || "00";
    const _now = new Date();
    const menY = String(men.year || _now.getFullYear());
    const menM = String(men.monthNum || (_now.getMonth()+1)).padStart(2,'0');
    const periodYear  = parseInt(menY);
    const periodMonth = parseInt(menM);
    const { data: _extraData2 } = await supabase.from('extra_invoices').select('*')
      .eq('period_year', periodYear).eq('period_month', periodMonth);
    const extraForPeriod = _extraData2 || [];
    const rekStart = Math.max(1, parseInt(men.invoiceNrStart)||1);
    const mergedCount = mergeData(atskaite, alokData, config).length;
    const numberedExtras = extraForPeriod.map((inv, ei) => ({
      ...inv,
      invoice_nr: `B${menY}${menM}${String(rekStart + mergedCount + ei).padStart(4,'0')}`,
    }));
    for (const inv of numberedExtras) {
      await supabase.from('extra_invoices').update({ invoice_nr: inv.invoice_nr }).eq('id', inv.id);
    }
    if (numberedExtras.length) await loadExtraInvoices();

    // ── Tenant invoices (pilnie rēķini) ───────────────────────────────────
    let regBlocks = [];
    try { ({ blocks: regBlocks } = _buildInvoiceBlocks(atskaite, alokData, config, men, effCirkulTarif, pozicijas, null, company, footnotes)); } catch {}

    const alokIrnieksMapX = {};
    for (const al of (alokData || [])) { if (al.irnieks) alokIrnieksMapX[String(al.dz)] = al.irnieks; }
    const tenantAptsXlsx = sortApts(Object.keys(alokIrnieksMapX)).filter(apt =>
      fullInvConfig[apt]?.enabled !== false
    );
    const fullInvsForXlsx = tenantAptsXlsx.flatMap((apt, fi) => {
      const regBlock = regBlocks.find(b => b.aptDz === apt);
      if (!regBlock) return [];
      const cfg = fullInvConfig[apt];
      if (cfg?.recipientName) {
        try {
          const fullBlock = _buildFullBlock(apt, regBlock, cfg, pozicijas, company);
          const nr = regBlock.invoiceNr.replace(/^B/, 'S');
          fullBlock.invoiceNr = nr;
          return [{ invoice_nr: nr, apt, owner: fullBlock.owner, recipient_address: fullBlock.recipientAddress, payment_due: fullBlock.paymentDue || '', lines: fullBlock.lines, total_eur: fullBlock.totalEur }];
        } catch { return []; }
      }
      const irnieks = alokIrnieksMapX[apt];
      const nr = regBlock.invoiceNr.replace(/^B/, 'S');
      return [{ invoice_nr: nr, apt, owner: irnieks, recipient_address: regBlock.recipientAddress, payment_due: regBlock.paymentDue || '', lines: regBlock.lines, total_eur: regBlock.totalEur }];
    });

    XLSX.writeFile(buildXlsx(atskaite,alokData,config,men,effCirkulTarif,pozicijas,company,footnotes,numberedExtras),`DZIB_Kopsavilkums_${yyyy}_${mm}.xlsx`,{cellStyles:true});
    if (fullInvsForXlsx.length) {
      XLSX.writeFile(buildIrnieku(fullInvsForXlsx, company), `DZIB_Irnieki_${yyyy}_${mm}.xlsx`, {cellStyles:true});
    }
    setDone(true);
  };

  const handleGeneratePdf = async () => {
    if (!atskaite || !alokData) return;
    setErrPdf("");

    const logo = await resolveLogo(company);

    let blocks;
    try {
      ({ blocks } = _buildInvoiceBlocks(atskaite, alokData, config, men, effCirkulTarif, pozicijas, logo, company, footnotes));
    } catch(e) {
      setErrPdf(e.message);
      return false;
    }

    let pdfLib, InvoiceDoc;
    try {
      [pdfLib, { InvoiceDocument: InvoiceDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./src/InvoicePdf.jsx'),
      ]);
    } catch(e) {
      setErrPdf("PDF bibliotēka nav pieejama: " + e.message);
      return false;
    }
    try {
      await ensureFonts(pdfLib);
    } catch(e) {
      setErrPdf("Fontu ielādes kļūda: " + e.message);
      return false;
    }

    for (const block of blocks) {
      try {
        const el = React.createElement(InvoiceDoc, { blocks: [block], logo });
        const blob = await pdfLib.pdf(el).toBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Rekins_${block.invoiceNr}-${block.aptDz}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch(e) {
        setErrPdf(`${block.aptDz}: ${e.message}`);
        return false;
      }
      await new Promise(r => setTimeout(r, 300));
    }

    // Save all invoices to DB after successful PDF generation
    try {
      const rows = blocks.map(b => ({
        invoice_nr:   b.invoiceNr,
        apt:          b.aptDz,
        owner:        b.owner,
        period_year:  b.periodYear,
        period_month: b.periodMonth,
        payment_due:  b.paymentDue,
        total_eur:    b.totalEur,
        lines:        b.lines,
      }));
      await supabase.from('issued_invoices').upsert(rows, { onConflict: 'invoice_nr' });
    } catch(e) { console.error('saveInvoicesDb:', e); }

    // ── Extra invoices for this period ───────────────────────────────────────
    const _now2 = new Date();
    const gadam2     = String(men.year     || _now2.getFullYear());
    const mesCipars2 = String(men.monthNum || (_now2.getMonth()+1)).padStart(2,'0');
    const periodYear2  = parseInt(gadam2);
    const periodMonth2 = parseInt(mesCipars2);
    const rekNrSakums2 = Math.max(1, parseInt(men.invoiceNrStart)||1);
    const { data: _extraData, error: _extraErr } = await supabase.from('extra_invoices').select('*')
      .eq('period_year', periodYear2).eq('period_month', periodMonth2);
    if (_extraErr) { setErrPdf(`Papildu rēķinu DB kļūda: ${_extraErr.message}`); return false; }
    const extraForPdf = _extraData || [];

    for (let ei = 0; ei < extraForPdf.length; ei++) {
      const inv = extraForPdf[ei];
      const newNr = `B${gadam2}${mesCipars2}${String(rekNrSakums2 + blocks.length + ei).padStart(4,'0')}`;
      const invWithNr = { ...inv, invoice_nr: newNr };
      try {
        const { logo: eLogo, block: eBlock } = await _buildExtraBlock(invWithNr);
        const el = React.createElement(InvoiceDoc, { blocks: [eBlock], logo: eLogo });
        const blob = await pdfLib.pdf(el).toBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Rekins_${newNr}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        await supabase.from('extra_invoices').update({ invoice_nr: newNr }).eq('id', inv.id);
        await supabase.from('issued_invoices').upsert({
          invoice_nr:   newNr,
          apt:          (inv.apts||[]).join(', '),
          owner:        inv.owner,
          period_year:  periodYear2,
          period_month: periodMonth2,
          payment_due:  inv.payment_due,
          total_eur:    parseFloat(inv.total_eur) || 0,
          lines:        inv.lines,
        }, { onConflict: 'invoice_nr' });
      } catch(e) {
        setErrPdf(`Papildu rēķins ${inv.owner}: ${e.message}`);
        return false;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    if (extraForPdf.length) await loadExtraInvoices();

    // ── Tenant invoices — source: alokatoru Excel irnieks column ─────────────
    // All apartments with irnieks set are included unless explicitly disabled (enabled===false)
    const alokIrnieksMap = {};
    for (const al of (alokData || [])) {
      if (al.irnieks) alokIrnieksMap[String(al.dz)] = al.irnieks;
    }
    const tenantApts = sortApts(Object.keys(alokIrnieksMap)).filter(apt =>
      fullInvConfig[apt]?.enabled !== false
    );

    const downloadPdf = async (block, filename) => {
      const el = React.createElement(InvoiceDoc, { blocks: [block], logo });
      const blob = await pdfLib.pdf(el).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    for (let fi = 0; fi < tenantApts.length; fi++) {
      const apt = tenantApts[fi];
      const regBlock = blocks.find(b => b.aptDz === apt);
      if (!regBlock) continue;
      const cfg = fullInvConfig[apt];
      let tenantBlock;
      if (cfg?.recipientName) {
        try {
          tenantBlock = _buildFullBlock(apt, regBlock, cfg, pozicijas, company);
        } catch(e) {
          setErrPdf(`Īrnieka rēķins ${apt}: ${e.message}`);
          return false;
        }
      } else {
        tenantBlock = { ...regBlock, owner: alokIrnieksMap[apt], renderedFootnotes: [] };
      }
      const nr = regBlock.invoiceNr.replace(/^B/, 'S');
      tenantBlock.invoiceNr = nr;
      try {
        await downloadPdf(tenantBlock, `Rekins_${nr}-${apt}.pdf`);
        await supabase.from('issued_invoices').upsert({
          invoice_nr: nr, apt, owner: tenantBlock.owner,
          period_year: periodYear2, period_month: periodMonth2,
          payment_due: tenantBlock.paymentDue, total_eur: tenantBlock.totalEur, lines: tenantBlock.lines,
        }, { onConflict: 'invoice_nr' });
      } catch(e) {
        setErrPdf(`Īrnieka rēķins ${apt}: ${e.message}`);
        return false;
      }
      await new Promise(r => setTimeout(r, 300));
    }

    return true;
  };

  // Siltums calc — KŪ no mājas kopējā skaitītāja "Brīvības iela 166"
  const kuM3 = atskaite?.kuKopaTotal ?? null;
  const sk = { kopa:parseFloat(sKopa||men.heatMwh)||0, tkud:parseFloat(sTkud)||0, taud:parseFloat(sTaud)||0,
    c:parseFloat(sC)||1, k1:parseFloat(sK1)||1, k2:parseFloat(sK2)||0.8598,
    dzSk:parseFloat(sDzSk)||0, koefC:parseFloat(sKoefC)||0 };
  const q      = sk.k2>0 ? ((sk.tkud-sk.taud)/(1000*sk.k2))*sk.c*sk.k1 : 0;
  const qKud   = q*(kuM3??0);
  const qCirk  = sk.dzSk*sk.koefC;
  const qApk   = sk.kopa-qKud-qCirk;
  const siltOk = sk.kopa>0 && (kuM3??0)>0 && sk.dzSk>0;
  const siltWarn = siltOk && qApk<=0;
  // Cirkulācija € = Qcirk × (Rīgas Siltums / Qpieg), tarifs uz grupu
  const rijasUdensVal  = parseFloat(men.water) || 0;
  const riasSiltumsMen = parseFloat(men.heat)    || 0;
  const T_siltums      = sk.kopa > 0 ? riasSiltumsMen / sk.kopa : 0;
  const cirkulEur      = qCirk * T_siltums;
  const cirkulUzGrupu  = sk.dzSk > 0 ? Math.round(cirkulEur / sk.dzSk * 10000) / 10000 : 0;
  const effCirkulTarif = parseFloat(men.tarifCirc) || cirkulUzGrupu;

  const merged = atskaite&&alokData ? mergeData(atskaite,alokData,config) : [];
  const tAU = atskaite ? atskaite.apartments.reduce((s,a)=>s+a.auKopa,0) : 0;
  const tKU = atskaite ? atskaite.apartments.reduce((s,a)=>s+a.kuKopa,0) : 0;
  const tAlok=merged.reduce((s,a)=>s+a.alokVienibas,0), tSum=merged.reduce((s,a)=>s+a.kopsumma,0);

  // ── Step components ────────────────────────────────────────────────────
  const StepNav = () => {
    const steps = [
      {n:0, label:"Mēneša iestatījumi",  done: !!(men.heat && men.water)},
      {n:1, label:"Ūdens skaitītāji",    done: !!atskaite},
      {n:2, label:"Siltuma kalkulators", done: siltOk&&!siltWarn},
      {n:3, label:"Alokatoru dati",      done: !!alokData},
      {n:4, label:"Ģenerēt Excel",       done: done},
    ];
    return (
      <div className="steps">
        {steps.map((s,i) => (
          <div key={s.n} style={{display:"flex",alignItems:"center"}}>
            <div className={`step${step===s.n?" active":""}${s.done?" done":""}`} onClick={()=>setStep(s.n)}>
              <div className="step-num">{s.done?"✓":s.n===0?"⚙":s.n}</div>
              <span className="step-label">{s.label}</span>
            </div>
            {i<steps.length-1 && <span className="step-sep">›</span>}
          </div>
        ))}
      </div>
    );
  };


  return (
    <>
      <div className="app">
        <div className="topbar">
          <div className="topbar-icon">🏢</div>
          <div>
            <div className="topbar-title">{company.title || company.name || 'DZĪB Rēķinu sagatavotājs'}</div>
            <div className="topbar-sub">Skaitītāji → Siltuma kalkulators → Alokatori → Excel</div>
          </div>
          <div className="topbar-badge">v2.0</div>
          {onBack && (
            <button onClick={onBack} style={{marginLeft:12,padding:"5px 14px",background:"transparent",border:"1px solid #ffffff55",borderRadius:6,color:"#d0eaff",fontSize:12,cursor:"pointer"}}>← Atpakaļ</button>
          )}
        </div>

        <StepNav />

        <div className="main">

          {/* ══════ SOLIS 0: Mēneša iestatījumi ══════ */}
          {step===0 && (
            <>
            <div className="card">
              <div className="card-hdr">
                <div>
                  <div className="card-title">Mēneša iestatījumi</div>
                  <div className="card-meta">Rēķinu kopsummas, patēriņi un tarifi — saglabājas automātiski</div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}>
                {/* Kreisā kolonna */}
                <div style={{borderRight:"1px solid #e0eaf2"}}>
                  <MenSec>Periods</MenSec>
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 20px",borderBottom:"1px solid var(--surface)"}}>
                    <div style={{flex:"0 0 240px"}}>
                      <div style={{fontSize:12,color:"var(--text-1)",fontWeight:500}}>Periods (gads un mēnesis)</div>
                      {men.period && (() => {
                        const _m = parseInt(men.monthNum||0,10);
                        const _y = parseInt(men.year||0);
                        const prevM = _m === 1 ? 12 : _m - 1;
                        const prevY = _m === 1 ? _y - 1 : _y;
                        return <div style={{fontSize:10,color:"var(--text-3)",marginTop:1}}>
                          {"Komunālie: "}{MNES[prevM-1] || ""} {prevY}
                          {" · Apsaimniekošana: "}{MNES[_m-1] || ""} {_y}
                        </div>;
                      })()}
                    </div>
                    <input
                      type="month"
                      value={men.period || ""}
                      onChange={e => {
                        const val = e.target.value;
                        if (!val) return;
                        const [y, m] = val.split("-");
                        const monthName = MNES[parseInt(m, 10) - 1] || "";
                        const next = { ...men, period: val, year: y, monthNum: m, monthName };
                        setMen(next);
                        saveMenDb(next);
                      }}
                      style={{flex:1,padding:"5px 9px",fontFamily:"DM Mono,monospace",fontSize:13,
                        fontWeight:600,border:"1.5px solid var(--border-2)",borderRadius:"var(--r-sm)",
                        outline:"none",background:men.period?"#fff":"var(--surface)",color:"var(--blue-900)"}}
                    />
                  </div>
                  <MenInp label="Rēķinu sākuma nr." type="number" unit="" note="piem. 1 → B20260300001" value={men.invoiceNrStart} onChange={e=>updateMen("invoiceNrStart",e.target.value)} onBlur={saveMenField}/>

                  <MenSec>Rēķinu kopsummas (€)</MenSec>
                  <MenInp label="Rīgas Siltums" unit="€" note="Kopējais siltuma rēķins" value={men.heat} onChange={e=>updateMen("heat",e.target.value)} onBlur={saveMenField}/>
                  <MenInp label="Rīgas Ūdens" unit="€" value={men.water} onChange={e=>updateMen("water",e.target.value)} onBlur={saveMenField}/>
                  <MenInp label="Atkritumi (Clean)" unit="€" value={men.waste} onChange={e=>updateMen("waste",e.target.value)} onBlur={saveMenField}/>
                  <MenInp label="Koplietošanas elektrība" unit="€" value={men.commonElec} onChange={e=>updateMen("commonElec",e.target.value)} onBlur={saveMenField}/>

                  <MenSec>Patēriņi</MenSec>
                  <MenInp label="Kopējais siltums" unit="MWh" note="No siltumapgādes rēķina" value={men.heatMwh} onChange={e=>updateMen("heatMwh",e.target.value)} onBlur={saveMenField}/>
                  <MenInp label="Aukstais ūdens" unit="m³" note="Kopējais patēriņš" value={men.coldWaterM3} onChange={e=>updateMen("coldWaterM3",e.target.value)} onBlur={saveMenField}/>
                  <MenInp label="Koplietošanas elektrība" unit="kWh" value={men.commonElecKwh} onChange={e=>updateMen("commonElecKwh",e.target.value)} onBlur={saveMenField}/>

                  <MenSec>Apkure</MenSec>
                  <MenCheck
                    label="Apkure šajā mēnesī"
                    checked={men.heatingIncluded}
                    note="Noņemt — apkures rindas netiks iekļautas rēķinos"
                    onChange={e => { const c = e.target.checked; setMen(prev => { const n={...prev,heatingIncluded:c}; saveMen(n); return n; }); }}
                  />
                  {men.heatingIncluded && <>
                    <MenInp label="Kopējā apkure (m²)" unit="%" note={`Apkure (kopējā) ${men.heatingM2Pct||"40"}%`}
                      value={men.heatingM2Pct} onChange={e=>updateMen("heatingM2Pct",e.target.value)} onBlur={saveMenField}/>
                    <MenInp label="Patēriņa apkure (alok.)" unit="%" note={`Apkure (patēriņš) ${men.heatingAllocPct||"60"}%`}
                      value={men.heatingAllocPct} onChange={e=>updateMen("heatingAllocPct",e.target.value)} onBlur={saveMenField}/>
                  </>}
                </div>

                {/* Labā kolonna */}
                <div>
                  <MenSec>Tarifi</MenSec>
                  <MenInp label="Aukstais ūdens" unit="€/m³" value={men.tarifCold} onChange={e=>updateMen("tarifCold",e.target.value)} onBlur={saveMenField}/>
                  <MenInp label="Karstais ūdens" unit="€/m³" note="* koriģējas bilancē (4. solī)" value={men.tarifHot} onChange={e=>updateMen("tarifHot",e.target.value)} onBlur={saveMenField}/>
                  <MenInp label="Cirkulācija uz grupu" unit="€/gr." note="Mk.ūd.cirk. / kopējais skaits" value={men.tarifCirc} onChange={e=>updateMen("tarifCirc",e.target.value)} onBlur={saveMenField}/>
                  <MenInp label="Lietus notekūdeņi" unit="€/m²" value={men.tarifRain} onChange={e=>updateMen("tarifRain",e.target.value)} onBlur={saveMenField}/>
                  <MenInp label="Apsaimniekošana" unit="€/m²" value={men.tarifMgmt} onChange={e=>updateMen("tarifMgmt",e.target.value)} onBlur={saveMenField}/>
                  <MenInp label="Remontdarbu fonds" unit="€/m²" value={men.tarifRepair} onChange={e=>updateMen("tarifRepair",e.target.value)} onBlur={saveMenField}/>
                  <MenInp label="Siltummezgls" unit="€/m²" value={men.tarifHeatNode} onChange={e=>updateMen("tarifHeatNode",e.target.value)} onBlur={saveMenField}/>
                </div>
              </div>

              {/* ── Panel tabs ── */}
              <div className="panel-tabs">
                {[
                  {id:'cfg',   icon:'🏠', label:'Dzīvokļu konfigurācija'},
                  {id:'poz',   icon:'📋', label:'Rēķinu pozīcijas'},
                  {id:'fn',    icon:'📝', label:'Zemsvītras piezīmes'},
                  {id:'comp',  icon:'🏢', label:'Uzņēmuma rekvizīti'},
                  {id:'email', icon:'✉', label:'Epasta iestatījumi'},
                  {id:'extra', icon:'+', label:'Papildu rēķini'},
                  {id:'full',  icon:'⊞', label:'Īrnieku rēķini'},
                ].map(t => (
                  <button key={t.id}
                    className={`panel-tab${activePanel===t.id?' active':''}`}
                    onClick={()=>setActivePanel(p=>p===t.id?null:t.id)}>
                    <span className="tab-icon">{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>

              {/* ── Dzīvokļu konfigurācija panel ── */}
              {activePanel==='cfg' && (
                <div className="panel-body">
                  {Object.keys(config).length===0
                    ? <div className="empty-st">Nav saglabātu dzīvokļu. Ielādējiet F1 (1. solī) — dati saglabāsies automātiski.</div>
                    : <>
                        <div style={{overflowX:"auto"}}>
                          <table className="cfg-tbl" style={{minWidth:700}}>
                            <thead><tr>
                              <th style={{width:28}}/>
                              <th>Dz.Nr.</th><th>Īpašnieks</th>
                              <th style={{color:"#375623"}}>Platība m²</th>
                              <th style={{color:"#1a6b3a"}}>Apk. platība m²</th>
                              <th style={{color:"#7F6000"}}>Personas</th>
                              <th style={{color:"#1F4E79"}}>Cirk. grupas</th>
                              <th style={{color:"#1F4E79"}}>Apm. diena</th>
                              <th style={{width:28}}/>
                            </tr></thead>
                            <tbody>
                              {sortApts(Object.keys(config)).map(dz => { const c = config[dz]; return (
                                <React.Fragment key={dz}>
                                  <tr>
                                    <td style={{textAlign:"center"}}>
                                      <button onClick={()=>setExpandedDz(expandedDz===dz?null:dz)}
                                        style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"#2E75B6",padding:"2px 4px"}}>
                                        {expandedDz===dz?"▼":"▶"}
                                      </button>
                                    </td>
                                    <td style={{fontFamily:"DM Mono,monospace",fontWeight:700,color:"#1F4E79"}}>{dz}</td>
                                    <td><input className="ci em" type="text" value={c.owner||""} placeholder="Īpašnieks" onChange={e=>updateCfg(dz,"owner",e.target.value)} onBlur={saveCfgNow} style={{width:160}}/></td>
                                    <td><input className="ci" type="number" min="0" step="0.01" value={c.area??""} placeholder="0.00" onChange={e=>updateCfg(dz,"area",e.target.value)} onBlur={saveCfgNow}/></td>
                                    <td><input className="ci" type="number" min="0" step="0.01" value={c.heatedArea??""} placeholder="0.00" onChange={e=>updateCfg(dz,"heatedArea",e.target.value)} onBlur={saveCfgNow}/></td>
                                    <td><input className="ci" type="number" min="0" value={c.residents??""} placeholder="0" onChange={e=>updateCfg(dz,"residents",e.target.value)} onBlur={saveCfgNow}/></td>
                                    <td><input className="ci" type="number" min="0" step="0.5" value={c.circGroup??""} placeholder="0" onChange={e=>updateCfg(dz,"circGroup",e.target.value)} onBlur={saveCfgNow}/></td>
                                    <td><input className="ci" type="number" min="1" max="31" value={c.payDay??20} placeholder="20" onChange={e=>updateCfg(dz,"payDay",e.target.value)} onBlur={saveCfgNow}/></td>
                                    <td style={{textAlign:"center"}}>
                                      <button onClick={()=>{ if(window.confirm(`Dzēst dz. ${dz}?`)) deleteCfg(dz); }}
                                        title="Dzēst dzīvokli"
                                        style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#c62828",padding:"2px 4px",lineHeight:1}}>✕</button>
                                    </td>
                                  </tr>
                                  {expandedDz===dz && (
                                    <tr>
                                      <td colSpan={10} style={{background:"#f7fafd",padding:"10px 16px",borderBottom:"2px solid #e0eaf2"}}>
                                        <div style={{fontWeight:700,fontSize:11,color:"#1F4E79",marginBottom:6,textTransform:"uppercase",letterSpacing:".5px"}}>
                                          Pozīciju iestatījumi — dz. {dz}
                                        </div>
                                        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10}}>
                                          {pozicijas.filter(p=>p.on).map(p=>{
                                            const isOff=(c.posDisabled||[]).includes(p.id);
                                            return (
                                              <label key={p.id} style={{display:"flex",alignItems:"center",gap:4,fontSize:11,padding:"3px 9px",
                                                borderRadius:5,cursor:"pointer",userSelect:"none",
                                                background:isOff?"#FCE4EC":"#E2EFDA",
                                                border:`1px solid ${isOff?"#E5737355":"#70AD4766"}`}}>
                                                <input type="checkbox" checked={!isOff} onChange={()=>toggleDzPoz(dz,p.id)} style={{cursor:"pointer"}}/>
                                                {p.label}
                                              </label>
                                            );
                                          })}
                                        </div>
                                        <div style={{fontWeight:700,fontSize:11,color:"#1F4E79",marginBottom:5,textTransform:"uppercase",letterSpacing:".5px"}}>
                                          Papildu pozīcijas
                                        </div>
                                        {(c.posExtra||[]).map((ex,i)=>(
                                          <div key={i} style={{display:"flex",gap:6,alignItems:"center",marginBottom:5}}>
                                            <input type="text" value={ex.label||""} placeholder="Pozīcijas nosaukums"
                                              onChange={e=>updateDzExtra(dz,i,"label",e.target.value)}
                                              style={{flex:2,padding:"5px 8px",border:"1px solid #c8dce8",borderRadius:5,fontSize:12}}/>
                                            <input type="number" value={ex.summa||""} placeholder="0.00"
                                              onChange={e=>updateDzExtra(dz,i,"summa",e.target.value)}
                                              style={{width:90,padding:"5px 8px",border:"1px solid #c8dce8",borderRadius:5,fontSize:12,fontFamily:"DM Mono,monospace"}}/>
                                            <span style={{fontSize:11,color:"#7a9ab5",minWidth:14}}>€</span>
                                            <button onClick={()=>removeDzExtra(dz,i)}
                                              style={{background:"#FCE4EC",border:"none",borderRadius:5,padding:"4px 8px",cursor:"pointer",color:"#B71C1C",fontSize:12,fontWeight:700}}>✕</button>
                                          </div>
                                        ))}
                                        <button onClick={()=>addDzExtra(dz)}
                                          style={{fontSize:11,padding:"5px 12px",background:"#D6E4F0",border:"none",borderRadius:5,cursor:"pointer",color:"#1F4E79",fontWeight:600}}>
                                          + Pievienot pozīciju
                                        </button>
                                        <div style={{fontWeight:700,fontSize:11,color:"#1F4E79",marginTop:12,marginBottom:5,textTransform:"uppercase",letterSpacing:".5px"}}>
                                          Zemsvītras piezīmes
                                        </div>
                                        {footnotes.length>0
                                          ? <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                                              {footnotes.map(fn=>{
                                                const isOff=(c.footnotesDisabled||[]).includes(fn.id);
                                                return (
                                                  <label key={fn.id} style={{display:"flex",alignItems:"center",gap:4,fontSize:11,padding:"3px 9px",borderRadius:5,cursor:"pointer",userSelect:"none",background:isOff?"#FCE4EC":"#E2EFDA",border:`1px solid ${isOff?"#E5737355":"#70AD4766"}`}}>
                                                    <input type="checkbox" checked={!isOff} onChange={()=>toggleDzFn(dz,fn.id)} style={{cursor:"pointer"}}/>
                                                    {fn.marker} {fn.text.length>40?fn.text.slice(0,40)+"…":fn.text}
                                                  </label>
                                                );
                                              })}
                                            </div>
                                          : <div style={{fontSize:11,color:"#7a9ab5"}}>Nav pieejamo zemsvītras piezīmju</div>
                                        }
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              ); })}

                            </tbody>
                          </table>
                        </div>
                        <div style={{padding:"6px 12px",fontSize:11,color:"#7a9ab5",borderTop:"1px solid #f0f4f8"}}>
                          💾 Dati saglabājas automātiski · ▶ — paplašināt dzīvokļa iestatījumus
                        </div>
                      </>
                  }
                </div>
              )}

              {/* ── Rēķinu pozīcijas panel ── */}
              {activePanel==='poz' && (
                <div className="panel-body" style={{padding:"14px 16px"}}>
                  <div style={{fontWeight:700,fontSize:11,color:"#1F4E79",marginBottom:4,textTransform:"uppercase",letterSpacing:".5px"}}>Rēķinu pozīcijas un to kārtošana</div>
                  <div style={{fontSize:11,color:"#7a9ab5",marginBottom:10}}>Mainiet secību ar ▲▼. Noņemiet atzīmi — pozīcija netiks iekļauta nevienā rēķinā.</div>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{background:"#1F4E79",color:"#fff"}}>
                        <th style={{width:36,padding:"7px 10px",textAlign:"center",fontWeight:600,fontSize:11,letterSpacing:".3px"}}>#</th>
                        <th style={{width:48,padding:"7px 8px",textAlign:"center",fontWeight:600,fontSize:11}}>Aktīva</th>
                        <th style={{padding:"7px 12px",textAlign:"left",fontWeight:600,fontSize:11}}>Pozīcija</th>
                        <th style={{width:110,padding:"7px 8px",textAlign:"left",fontWeight:600,fontSize:11}}>Mērvienība</th>
                        <th style={{width:60,padding:"7px 8px",textAlign:"center",fontWeight:600,fontSize:11}}>Kārtot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pozicijas.map((p,i)=>(
                        <tr key={p.id} style={{background:i%2===0?(p.on?"#f7fafd":"#f5f5f5"):(p.on?"#eef4fb":"#efefef"),borderBottom:"1px solid #dde8f2",transition:"background .15s"}}>
                          <td style={{textAlign:"center",padding:"6px 10px",color:"#7a9ab5",fontSize:11,fontWeight:600}}>{i+1}</td>
                          <td style={{textAlign:"center",padding:"6px 8px"}}>
                            <input type="checkbox" checked={p.on} onChange={()=>togglePozId(p.id)}
                              style={{width:15,height:15,cursor:"pointer",accentColor:"#2E75B6"}}/>
                          </td>
                          <td style={{padding:"6px 12px",color:p.on?"#1a2733":"#aab8c5",fontWeight:p.on?500:400}}>{p.label}</td>
                          <td style={{padding:"4px 8px"}}>
                            <select value={p.mv||''} onChange={e=>updatePoz(pozicijas.map((q,j)=>j===i?{...q,mv:e.target.value}:q))}
                              style={{fontSize:11,padding:"2px 4px",border:"1px solid #ccd8e8",borderRadius:4,width:"100%",background:"#fff",color:"#1a2733"}}>
                              <option value="">—</option>
                              {['m²','m³','dz.','iedz.','mēnesis','telpa','vienība'].map(u=><option key={u} value={u}>{u}</option>)}
                            </select>
                          </td>
                          <td style={{textAlign:"center",padding:"4px 6px"}}>
                            <div style={{display:"flex",gap:3,justifyContent:"center"}}>
                              <button onClick={()=>movePoz(i,-1)} disabled={i===0} title="Pārvietot augstāk"
                                style={{background:i===0?"#f0f4f8":"#2E75B6",border:"none",borderRadius:4,width:24,height:24,
                                  cursor:i===0?"not-allowed":"pointer",color:i===0?"#c0cdd8":"#fff",fontSize:12,
                                  display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>▲</button>
                              <button onClick={()=>movePoz(i,1)} disabled={i===pozicijas.length-1} title="Pārvietot zemāk"
                                style={{background:i===pozicijas.length-1?"#f0f4f8":"#2E75B6",border:"none",borderRadius:4,width:24,height:24,
                                  cursor:i===pozicijas.length-1?"not-allowed":"pointer",color:i===pozicijas.length-1?"#c0cdd8":"#fff",fontSize:12,
                                  display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>▼</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Zemsvītras piezīmes panel ── */}
              {activePanel==='fn' && (
                <div className="panel-body" style={{padding:"14px 16px"}}>
                  <div style={{fontWeight:700,fontSize:11,color:"#1F4E79",marginBottom:4,textTransform:"uppercase",letterSpacing:".5px"}}>Zemsvītras piezīmes</div>
                  <div style={{fontSize:11,color:"#7a9ab5",marginBottom:10}}>
                    Teksts tiek drukāts zem rēķina. Pieejamie mainīgie:
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:"3px 16px",marginBottom:12}}>
                    {[
                      ["{{waterM3}}",       "Rīgas Ūdens — dzīvokļa patēriņš, m³ ✦"],
                      ["{{waterEur}}",      "Rīgas Ūdens — dzīvokļa summa, € ✦"],
                      ["{{heatMwh}}",       "Rīgas Siltums — mēneša kopējais patēriņš, MWh"],
                      ["{{heatEur}}",       "Rīgas Siltums — dzīvokļa summa, € ✦"],
                      ["{{elecKwh}}",       "TET — dzīvokļa elektrības daļa, kWh ✦"],
                      ["{{elecEur}}",       "TET — dzīvokļa elektrības summa, € ✦"],
                      ["{{wasteEur}}",      "Atkritumu dzīvokļa summa, € ✦"],
                      ["{{kopsumma}}",      "Dzīvokļa rēķina kopsumma, € ✦"],
                      ["{{residents}}",     "Personu skaits dzīvoklī ✦"],
                      ["{{waste}}",         "Atkritumu kopējais mājas rēķins, €"],
                      ["{{commonElec}}",    "TET kopējais mājas rēķins, €"],
                      ["{{commonElecKwh}}", "TET kopējais mājas patēriņš, kWh"],
                      ["{{heat}}",          "Rīgas Siltums kopējais mājas rēķins, €"],
                      ["{{water}}",         "Rīgas Ūdens kopējais mājas rēķins, €"],
                      ["{{monthName}}",     "Mēneša nosaukums"],
                      ["{{year}}",          "Gads"],
                    ].map(([v, desc]) => (
                      <div key={v} style={{display:"flex",alignItems:"baseline",gap:6}}>
                        <span style={{fontFamily:"DM Mono,monospace",fontSize:10,background:"#f0f4f8",
                          padding:"1px 5px",borderRadius:3,color:"#1F4E79",flexShrink:0,whiteSpace:"nowrap"}}>{v}</span>
                        <span style={{fontSize:10,color:"#7a9ab5"}}>{desc}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:10,color:"#b0c4d4",marginBottom:10}}>✦ — individuāla vērtība katram dzīvoklim</div>
                  {footnotes.length === 0
                    ? <div style={{fontSize:11,color:"#7a9ab5"}}>Nav piezīmju — pievienojiet datus DB tabulā <code>footnotes</code>.</div>
                    : footnotes.map(fn => (
                      <div key={fn.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",
                        borderRadius:6,border:"1px solid #e0eaf2",marginBottom:5,
                        background:fn.is_on?"#f7fafd":"#fafafa"}}>
                        <input type="checkbox" checked={fn.is_on??true} onChange={()=>toggleFnOn(fn.id)}
                          title="Globāli ieslēgt/izslēgt"
                          style={{width:15,height:15,cursor:"pointer",accentColor:"#2E75B6",flexShrink:0}}/>
                        <input type="text" value={fn.marker||""} onChange={e=>updateFn(fn.id,"marker",e.target.value)} onBlur={saveFnNow}
                          title="Marķieris (*, **, ...)"
                          style={{width:36,padding:"4px 6px",border:"1px solid #c8dce8",borderRadius:5,fontSize:12,
                            fontFamily:"DM Mono,monospace",textAlign:"center",flexShrink:0}}/>
                        <input type="text" value={fn.text||""} onChange={e=>updateFn(fn.id,"text",e.target.value)} onBlur={saveFnNow}
                          placeholder="Piezīmes teksts — var lietot {{mainīgos}}"
                          style={{flex:1,padding:"4px 8px",border:"1px solid #c8dce8",borderRadius:5,fontSize:12,
                            color:fn.is_on?"#1a2733":"#aab8c5"}}/>
                      </div>
                    ))
                  }
                </div>
              )}

              {/* ── Epasta iestatījumi panel ── */}
              {activePanel==='email' && (
                <div className="panel-body" style={{padding:"14px 16px"}}>
                  <div style={{fontWeight:700,fontSize:11,color:"#1F4E79",marginBottom:4,textTransform:"uppercase",letterSpacing:".5px"}}>Epasta iestatījumi</div>
                  <div style={{fontSize:11,color:"#7a9ab5",marginBottom:12}}>
                    Rēķins tiek pievienots kā PDF pielikums. E-pasta adreses norādītas zemāk pēc iedzīvotāja.
                  </div>

                  <div style={{marginBottom:10}}>
                    <div style={{fontWeight:600,fontSize:11,color:"#1F4E79",marginBottom:4}}>Temats (Subject)</div>
                    <input type="text" value={emailSettings.subject}
                      onChange={e => setEmailSettings(prev => ({...prev, subject: e.target.value}))}
                      onBlur={() => saveEmailSettings()}
                      style={{width:"100%",padding:"6px 8px",border:"1px solid #c8dce8",borderRadius:5,fontSize:12,boxSizing:"border-box"}}
                      placeholder="Rēķins Nr. {{invoiceNr}} par {{period}}" />
                  </div>

                  <div style={{marginBottom:10}}>
                    <div style={{fontWeight:600,fontSize:11,color:"#1F4E79",marginBottom:4}}>Epasta teksts (HTML)</div>
                    <textarea value={emailSettings.body}
                      onChange={e => setEmailSettings(prev => ({...prev, body: e.target.value}))}
                      onBlur={() => saveEmailSettings()}
                      rows={8}
                      style={{width:"100%",padding:"6px 8px",border:"1px solid #c8dce8",borderRadius:5,fontSize:11,fontFamily:"monospace",resize:"vertical",boxSizing:"border-box"}} />
                  </div>

                  <div style={{background:"#f0f5fa",borderRadius:6,padding:"8px 12px",fontSize:10.5,color:"#445"}}>
                    <div style={{fontWeight:700,marginBottom:5,color:"#1F4E79"}}>Pieejamie mainīgie:</div>
                    <table style={{borderCollapse:"collapse",width:"100%"}}>
                      <tbody>
                        {[
                          ["{{owner}}",      "Dzīvokļa īpašnieka vārds"],
                          ["{{invoiceNr}}", "Rēķina numurs"],
                          ["{{period}}",     "Pakalpojumu periods"],
                          ["{{dz}}",         "Dzīvokļa numurs"],
                          ["{{kopsumma}}",   "Kopējā summa (EUR)"],
                          ["{{paymentDue}}", "Apmaksas termiņš"],
                        ].map(([ph, desc]) => (
                          <tr key={ph}>
                            <td style={{padding:"2px 8px 2px 0",whiteSpace:"nowrap"}}>
                              <code style={{background:"#ddeaf8",padding:"1px 5px",borderRadius:3,fontSize:10,color:"#1F4E79"}}>{ph}</code>
                            </td>
                            <td style={{padding:"2px 0",color:"#556"}}>{desc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* ── Iedzīvotāju e-pasta adreses ── */}
                  <div style={{marginTop:16,marginBottom:10}}>
                    <div style={{fontWeight:700,fontSize:11,color:"#1F4E79",marginBottom:8,textTransform:"uppercase",letterSpacing:".5px"}}>Iedzīvotāju e-pasta adreses</div>
                    {(() => {
                      const uniqueOwners = [...new Set(Object.values(config).map(c=>c.owner||'').filter(Boolean))].sort();
                      if (!uniqueOwners.length) return <div style={{fontSize:12,color:"#aaa"}}>Nav dzīvokļu konfigurācijas datu</div>;
                      return (
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead>
                            <tr style={{background:"#f0f5fa"}}>
                              <th style={{padding:"5px 8px",textAlign:"left",fontWeight:600,fontSize:11,color:"#1F4E79"}}>Iedzīvotājs</th>
                              <th style={{padding:"5px 8px",textAlign:"left",fontWeight:600,fontSize:11,color:"#888"}}>Dzīvokļi</th>
                              <th style={{padding:"5px 8px",textAlign:"left",fontWeight:600,fontSize:11,color:"#1F4E79"}}>E-pasta adrese</th>
                            </tr>
                          </thead>
                          <tbody>
                            {uniqueOwners.map((owner,i) => {
                              const apts = Object.entries(config).filter(([,c])=>c.owner===owner).map(([dz])=>dz).join(', ');
                              return (
                                <tr key={owner} style={{background:i%2===0?"#fff":"#f7fafd",borderBottom:"1px solid #e0eaf2"}}>
                                  <td style={{padding:"5px 8px",fontWeight:500}}>{owner}</td>
                                  <td style={{padding:"5px 8px",color:"#888",fontFamily:"monospace",fontSize:11}}>dz. {apts}</td>
                                  <td style={{padding:"4px 8px"}}>
                                    <input type="email" value={ownerEmails[owner]||""}
                                      placeholder="epasts@piemers.lv"
                                      onChange={e=>{const v=e.target.value;setOwnerEmails(prev=>({...prev,[owner]:v}));}}
                                      onBlur={()=>saveOwnerEmails(ownerEmails)}
                                      style={{width:"100%",padding:"4px 7px",border:"1px solid #c8dce8",borderRadius:4,fontSize:12,boxSizing:"border-box"}}/>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>

                </div>
              )}

              {activePanel==='comp' && (
                <div className="panel-body" style={{padding:"14px 16px"}}>
                  <div style={{fontWeight:700,fontSize:11,color:"#1F4E79",marginBottom:12,textTransform:"uppercase",letterSpacing:".5px"}}>Uzņēmuma rekvizīti un sistēmas iestatījumi</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 24px"}}>
                    <div>
                      {[
                        ["name",       "Nosaukums",             "piem. Dzīvokļu īpašnieku biedrība"],
                        ["address",    "Adrese",                "piem. Brīvības iela 166, Rīga"],
                        ["regNr",      "Reģistrācijas nr.",     "piem. 40008012345"],
                        ["bank",       "Banka",                 "piem. Swedbank AS"],
                        ["swift",      "SWIFT",                 "piem. HABALV22"],
                        ["account",    "Konta nr.",             "piem. LV12HABA0012345678901"],
                      ].map(([f, lbl, note]) => (
                        <div key={f} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #f0f4f8"}}>
                          <div style={{flex:"0 0 160px",fontSize:12,color:"#1a2733",fontWeight:500}}>{lbl}</div>
                          <input className="ci em" type="text"
                            value={company[f]||""} placeholder={note}
                            onChange={e=>updateCompany(f,e.target.value)} onBlur={saveCompanyNow}
                            style={{flex:1,width:"auto"}}/>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{marginBottom:6,fontWeight:600,fontSize:11,color:"#7a9ab5",textTransform:"uppercase",letterSpacing:".4px"}}>Sistēmas</div>
                      {[
                        ["title",      "Lietotnes virsraksts",  "piem. DZĪB Brīvības 166 Rēķinu sagatavotājs"],
                        ["buildingId", "Mājas identifikators",  "piem. 166 (filtrē mājas skaitītāju F1 failā)"],
                      ].map(([f, lbl, note]) => (
                        <div key={f} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #f0f4f8"}}>
                          <div style={{flex:"0 0 160px",fontSize:12,color:"#1a2733",fontWeight:500}}>{lbl}</div>
                          <input className="ci em" type="text"
                            value={company[f]||""} placeholder={note}
                            onChange={e=>updateCompany(f,e.target.value)} onBlur={saveCompanyNow}
                            style={{flex:1,width:"auto"}}/>
                        </div>
                      ))}
                      <div style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #f0f4f8"}}>
                        <div style={{flex:"0 0 160px",fontSize:12,color:"#1a2733",fontWeight:500}}>Logo</div>
                        <div style={{display:"flex",alignItems:"center",gap:8,flex:1}}>
                          {company.logoData
                            ? <img src={company.logoData} alt="logo" style={{height:36,maxWidth:120,objectFit:"contain",border:"1px solid #e0e0e0",borderRadius:3,background:"#fafafa",padding:2}}/>
                            : <span style={{fontSize:11,color:"#aaa"}}>Nav logo</span>
                          }
                          <label style={{cursor:"pointer",background:"#e8f0fe",color:"#1a73e8",border:"1px solid #c5d8f7",borderRadius:4,padding:"3px 10px",fontSize:11,fontWeight:500}}>
                            Augšupielādēt
                            <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                              const file = e.target.files[0]; if (!file) return;
                              const r = new FileReader();
                              r.onloadend = () => setCompany(prev => { const next={...prev,logoData:r.result}; saveCompanyDb(next); return next; });
                              r.readAsDataURL(file);
                              e.target.value='';
                            }}/>
                          </label>
                          {company.logoData && <button style={{cursor:"pointer",background:"none",border:"none",color:"#c00",fontSize:11,padding:"2px 6px"}} onClick={()=>setCompany(prev=>{const next={...prev,logoData:''}; saveCompanyDb(next); return next;})}>Noņemt</button>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activePanel==='extra' && (() => {
                const ownerGroups = Object.entries(config).reduce((acc, [dz, cfg]) => {
                  const o = (cfg.owner||'').trim(); if (!o) return acc;
                  if (!acc[o]) acc[o] = []; acc[o].push(dz); return acc;
                }, {});
                const owners = Object.keys(ownerGroups).sort();
                const emptyLine = { nos:'', mv:'', daudz:'', cena:'' };
                const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('lv-LV') : '';

                if (!extraForm) return (
                  <div className="panel-body" style={{padding:"14px 16px"}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                      <div style={{fontWeight:700,fontSize:11,color:"#1F4E79",textTransform:"uppercase",letterSpacing:".5px"}}>Papildu rēķini</div>
                      <button className="btn-primary" style={{padding:"5px 14px",fontSize:12}} onClick={()=>setExtraForm({periodMode:'settings',customPeriod:'',owner:'',apts:[],lines:[{...emptyLine}]})}>+ Jauns rēķins</button>
                    </div>
                    {extraInvoices.length===0
                      ? <div style={{fontSize:12,color:"#888",padding:"20px 0",textAlign:'center'}}>Nav papildu rēķinu</div>
                      : <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                          <thead>
                            <tr style={{background:'#1F4E79',color:'#fff'}}>
                              {['Īpašnieks','Dz.','Periods','Summa','Rēķina datums',''].map(h=>(
                                <th key={h} style={{padding:'5px 8px',textAlign:'left',fontWeight:600,fontSize:11}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {extraInvoices.map((inv,i)=>(
                              <tr key={inv.id} style={{background:i%2===0?'#fff':'#f5f8fc',borderBottom:'1px solid #e0eaf2'}}>
                                <td style={{padding:'5px 8px'}}>{inv.owner}</td>
                                <td style={{padding:'5px 8px'}}>{(inv.apts||[]).join(', ')}</td>
                                <td style={{padding:'5px 8px'}}>{inv.period1_txt}</td>
                                <td style={{padding:'5px 8px',textAlign:'right',fontWeight:600}}>{parseFloat(inv.total_eur).toFixed(2)} €</td>
                                <td style={{padding:'5px 8px',color:'#888'}}>{new Date().toLocaleDateString('lv-LV')}</td>
                                <td style={{padding:'5px 4px',whiteSpace:'nowrap'}}>
                                  <button className="btn-secondary" style={{padding:'3px 8px',fontSize:11,marginRight:3}} onClick={()=>{
                                    const periodYear=parseInt(men.year||0), periodMonth=parseInt(men.monthNum||0);
                                    const samePeriod = inv.period_year===periodYear && inv.period_month===periodMonth;
                                    const cp = `${String(inv.period_year).padStart(4,'0')}-${String(inv.period_month).padStart(2,'0')}`;
                                    setExtraForm({ id:inv.id, invoice_nr:inv.invoice_nr, periodMode:samePeriod?'settings':'custom', customPeriod:samePeriod?'':cp, owner:inv.owner, apts:inv.apts||[], lines:(inv.lines||[]).map(l=>({nos:l.nos,mv:l.mv||'',daudz:String(l.daudz),cena:String(l.cena)})) });
                                  }}>Labot</button>
                                  <button style={{padding:'3px 7px',fontSize:11,background:'none',border:'1px solid #e0a0a0',color:'#c0392b',borderRadius:4,cursor:'pointer'}} onClick={()=>handleDeleteExtra(inv.id)}>×</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                    }
                  </div>
                );

                const totalExtra = extraForm.lines.reduce((s,l) => s + (parseFloat(l.daudz)||0)*(parseFloat(l.cena)||0), 0);
                const settingsPeriodLabel = men.period ? `${MNES[parseInt(men.monthNum||0,10)-1]||''} ${men.year}` : 'nav iestatīts';
                return (
                  <div className="panel-body" style={{padding:"14px 16px"}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
                      <button className="btn-secondary" style={{padding:'4px 10px',fontSize:12}} onClick={()=>setExtraForm(null)}>← Atpakaļ</button>
                      <div style={{fontWeight:700,fontSize:11,color:"#1F4E79",textTransform:"uppercase",letterSpacing:".5px"}}>{extraForm.id ? 'Labot papildu rēķinu' : 'Jauns papildu rēķins'}</div>
                    </div>

                    {/* Owner + period */}
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                      <div>
                        <div style={{fontSize:11,fontWeight:600,color:'#555',marginBottom:4}}>Īpašnieks</div>
                        <select value={extraForm.owner}
                          onChange={e => { const o=e.target.value; setExtraForm(f=>({...f,owner:o,apts:ownerGroups[o]||[]})); }}
                          style={{width:'100%',padding:'5px 8px',border:'1.5px solid var(--border-2)',borderRadius:'var(--r-sm)',fontSize:13,color:'var(--blue-900)'}}>
                          <option value="">— izvēlieties —</option>
                          {owners.map(o=>(
                            <option key={o} value={o}>{o} (dz. {(ownerGroups[o]||[]).join(', ')})</option>
                          ))}
                        </select>
                        {extraForm.apts.length>0 && <div style={{fontSize:10,color:'#888',marginTop:3}}>Dzīvokļi: {extraForm.apts.join(', ')}</div>}
                      </div>
                      <div>
                        <div style={{fontSize:11,fontWeight:600,color:'#555',marginBottom:4}}>Periods</div>
                        <div style={{display:'flex',flexDirection:'column',gap:4}}>
                          <label style={{fontSize:12,display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
                            <input type="radio" name="periodMode" value="settings" checked={extraForm.periodMode==='settings'} onChange={()=>setExtraForm(f=>({...f,periodMode:'settings'}))}/>
                            No iestatījumiem: <strong>{settingsPeriodLabel}</strong>
                          </label>
                          <label style={{fontSize:12,display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
                            <input type="radio" name="periodMode" value="custom" checked={extraForm.periodMode==='custom'} onChange={()=>setExtraForm(f=>({...f,periodMode:'custom'}))}/>
                            Cits periods:
                            <input type="month" value={extraForm.customPeriod}
                              onChange={e=>setExtraForm(f=>({...f,customPeriod:e.target.value,periodMode:'custom'}))}
                              style={{marginLeft:4,padding:'2px 6px',border:'1.5px solid var(--border-2)',borderRadius:'var(--r-sm)',fontSize:12}}/>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Line items */}
                    <datalist id="extra-poz-list">
                      {pozicijas.map(p => <option key={p.id} value={p.label}/>)}
                    </datalist>
                    <div style={{fontSize:11,fontWeight:600,color:'#555',marginBottom:6}}>Pozīcijas</div>
                    {extraForm.lines.map((l,i)=>{
                      const summa = Math.round((parseFloat(l.daudz)||0)*(parseFloat(l.cena)||0)*100)/100;
                      const inpSt = {padding:'4px 7px',border:'1.5px solid var(--border-2)',borderRadius:'var(--r-sm)',fontSize:12,color:'var(--blue-900)',background:'#fff',width:'100%'};
                      const lbl = (t) => <div style={{fontSize:10,color:'#888',fontWeight:600,marginBottom:2,textTransform:'uppercase',letterSpacing:'.3px'}}>{t}</div>;
                      return (
                        <div key={i} style={{display:'flex',gap:8,alignItems:'flex-end',padding:'7px 8px',marginBottom:4,background:i%2===0?'#f5f8fc':'#fff',borderRadius:6,border:'1px solid #e0eaf2'}}>
                          <div style={{flex:1}}>
                            {lbl('Nosaukums')}
                            <input value={l.nos} list="extra-poz-list" placeholder="Izvēlēties vai ievadīt..."
                              onChange={e=>{const val=e.target.value;const match=pozicijas.find(p=>p.label===val);setExtraForm(f=>({...f,lines:f.lines.map((r,j)=>j===i?{...r,nos:val,mv:match?.mv??r.mv}:r)}));}}
                              style={inpSt}/>
                          </div>
                          <div style={{width:110}}>
                            {lbl('Mērvienība')}
                            <select value={l.mv} onChange={e=>setExtraForm(f=>({...f,lines:f.lines.map((r,j)=>j===i?{...r,mv:e.target.value}:r)}))} style={{...inpSt,width:'100%'}}>
                              <option value="">—</option>
                              {['m²','m³','dz.','iedz.','mēnesis','telpa','vienība'].map(u=><option key={u} value={u}>{u}</option>)}
                            </select>
                          </div>
                          <div style={{width:90}}>
                            {lbl('Daudzums')}
                            <input type="number" step="0.001" value={l.daudz} onChange={e=>setExtraForm(f=>({...f,lines:f.lines.map((r,j)=>j===i?{...r,daudz:e.target.value}:r)}))} style={{...inpSt,textAlign:'right'}}/>
                          </div>
                          <div style={{width:90}}>
                            {lbl('Cena (€)')}
                            <input type="number" step="0.01" value={l.cena} onChange={e=>setExtraForm(f=>({...f,lines:f.lines.map((r,j)=>j===i?{...r,cena:e.target.value}:r)}))} style={{...inpSt,textAlign:'right'}}/>
                          </div>
                          <div style={{width:80,textAlign:'right'}}>
                            {lbl('Summa (€)')}
                            <div style={{padding:'4px 7px',fontWeight:700,fontSize:13,color:'#1F4E79'}}>{summa.toFixed(2)}</div>
                          </div>
                          <div style={{width:24,paddingBottom:2}}>
                            {extraForm.lines.length>1 && <button onClick={()=>setExtraForm(f=>({...f,lines:f.lines.filter((_,j)=>j!==i)}))} style={{background:'none',border:'none',color:'#c0392b',fontSize:16,cursor:'pointer',lineHeight:1,padding:0}}>×</button>}
                          </div>
                        </div>
                      );
                    })}
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                      <button className="btn-secondary" style={{padding:'4px 10px',fontSize:12}} onClick={()=>setExtraForm(f=>({...f,lines:[...f.lines,{...emptyLine}]}))}>+ Pievienot rindu</button>
                      <div style={{fontSize:13,fontWeight:700,color:'#1F4E79'}}>Kopā: {Math.round(totalExtra*100)/100} EUR</div>
                    </div>
                    <button className="btn-primary" style={{padding:'7px 20px',fontSize:13}}
                      disabled={!extraForm.owner || !extraForm.apts.length || !extraForm.lines.some(l=>l.nos?.trim())}
                      onClick={handleSaveExtra}>
                      {extraForm.id ? 'Saglabāt izmaiņas' : 'Saglabāt rēķinu'}
                    </button>
                  </div>
                );
              })()}

              {activePanel==='full' && (() => {
                const apts = sortApts(Object.keys(config));
                const emptyFree = {nos:'',mv:'',daudz:'',cena:''};
                const MV_OPTS = ['m²','m³','dz.','iedz.','mēnesis','telpa','vienība','kWh'];
                const inpSt = {padding:'4px 7px',border:'1.5px solid var(--border-2)',borderRadius:'var(--r-sm)',fontSize:12,color:'var(--blue-900)',background:'#fff',width:'100%'};
                const lbl = (t) => <div style={{fontSize:10,color:'#888',fontWeight:600,marginBottom:2,textTransform:'uppercase',letterSpacing:'.3px'}}>{t}</div>;

                if (fullInvEditApt === null) return (
                  <div className="panel-body" style={{padding:'14px 16px'}}>
                    <div style={{fontWeight:700,fontSize:11,color:'#1F4E79',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:10}}>Īrnieku rēķini</div>
                    {apts.length === 0
                      ? <div style={{fontSize:12,color:'#888',textAlign:'center',padding:'20px 0'}}>Nav dzīvokļu konfigurācijas</div>
                      : <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                          <thead>
                            <tr style={{background:'#1F4E79',color:'#fff'}}>
                              {['Dz.','Īpašnieks','Saņēmējs','E-pasts',''].map(h=>(
                                <th key={h} style={{padding:'5px 8px',textAlign:'left',fontWeight:600,fontSize:11}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {apts.map((apt,i)=>{
                              const ac = fullInvConfig[apt] || {};
                              const alIrnieks = (alokData||[]).find(a=>String(a.dz)===String(apt))?.irnieks || '';
                              const willGenerate = !!alIrnieks && ac.enabled !== false;
                              return (
                                <tr key={apt} style={{background:i%2===0?'#fff':'#f5f8fc',borderBottom:'1px solid #e0eaf2',opacity:alIrnieks?(ac.enabled===false?0.45:1):0.35}}>
                                  <td style={{padding:'5px 8px',fontFamily:'monospace',fontWeight:700,color:'#1F4E79'}}>{apt}</td>
                                  <td style={{padding:'5px 8px',color:'#555'}}>{config[apt]?.owner||'—'}</td>
                                  <td style={{padding:'5px 8px'}}>{ac.recipientName || (alIrnieks ? <span style={{color:'#888'}}>{alIrnieks}</span> : <span style={{color:'#bbb'}}>—</span>)}</td>
                                  <td style={{padding:'5px 8px',color:'#888'}}>{ac.email||<span style={{color:'#bbb'}}>—</span>}</td>
                                  <td style={{padding:'5px 4px',whiteSpace:'nowrap',display:'flex',gap:4,alignItems:'center'}}>
                                    <input type="checkbox" checked={willGenerate} disabled={!alIrnieks}
                                      onChange={e=>updateFullApt(apt,{enabled:e.target.checked?undefined:false})}
                                      title={alIrnieks?'Ieslēgt/izslēgt īrnieka rēķinu':'Nav īrnieka datos'} style={{width:14,height:14,cursor:alIrnieks?'pointer':'default',accentColor:'#2E75B6'}}/>
                                    <button className="btn-secondary" style={{padding:'3px 8px',fontSize:11}} onClick={()=>setFullInvEditApt(apt)}>Konfigurēt</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                    }
                  </div>
                );

                const apt = fullInvEditApt;
                const _raw = fullInvConfig[apt];
                const ac = {
                  ...defaultFullAptCfg, ..._raw,
                  freeLines: Array.isArray(_raw?.freeLines) ? _raw.freeLines : [],
                  includePositions: Array.isArray(_raw?.includePositions) ? _raw.includePositions : [],
                };
                const upd = (patch) => updateFullApt(apt, patch);
                return (
                  <div className="panel-body" style={{padding:'14px 16px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
                      <button className="btn-secondary" style={{padding:'4px 10px',fontSize:12}} onClick={()=>setFullInvEditApt(null)}>← Atpakaļ</button>
                      <div style={{fontWeight:700,fontSize:11,color:'#1F4E79',textTransform:'uppercase',letterSpacing:'.5px'}}>Dz. {apt} — īrnieka rēķins</div>
                      <label style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,fontSize:12,cursor:'pointer'}}>
                        <input type="checkbox" checked={ac.enabled} onChange={e=>upd({enabled:e.target.checked})} style={{accentColor:'#2E75B6'}}/> Ieslēgts
                      </label>
                    </div>

                    {/* Saņēmējs */}
                    <div style={{background:'#f5f8fc',borderRadius:7,padding:'10px 12px',marginBottom:12,border:'1px solid #e0eaf2'}}>
                      <div style={{fontWeight:600,fontSize:11,color:'#1F4E79',marginBottom:8}}>Saņēmējs</div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                        <div>{lbl('Vārds')}<input value={ac.recipientName} onChange={e=>upd({recipientName:e.target.value})} style={inpSt} placeholder="Vārds Uzvārds"/></div>
                        <div>{lbl('E-pasts')}<input type="email" value={ac.email} onChange={e=>upd({email:e.target.value})} style={inpSt} placeholder="epasts@piemers.lv"/></div>
                      </div>
                    </div>

                    {/* Pozīcijas no komunālā rēķina */}
                    <div style={{background:'#f5f8fc',borderRadius:7,padding:'10px 12px',marginBottom:12,border:'1px solid #e0eaf2'}}>
                      <div style={{fontWeight:600,fontSize:11,color:'#1F4E79',marginBottom:8}}>Iekļaut no komunālā rēķina</div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:'4px 16px'}}>
                        {pozicijas.filter(p=>p.on).map(p=>(
                          <label key={p.id} style={{fontSize:12,display:'flex',alignItems:'center',gap:5,cursor:'pointer'}}>
                            <input type="checkbox" checked={ac.includePositions.includes(p.id)}
                              onChange={e=>upd({includePositions: e.target.checked ? [...ac.includePositions,p.id] : ac.includePositions.filter(x=>x!==p.id)})}
                              style={{accentColor:'#2E75B6'}}/>
                            {p.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Elektrība */}
                    <div style={{background:'#f5f8fc',borderRadius:7,padding:'10px 12px',marginBottom:12,border:'1px solid #e0eaf2'}}>
                      <label style={{display:'flex',alignItems:'center',gap:7,fontSize:12,fontWeight:600,color:'#1F4E79',cursor:'pointer',marginBottom:ac.elec?8:0}}>
                        <input type="checkbox" checked={ac.elec} onChange={e=>upd({elec:e.target.checked})} style={{accentColor:'#2E75B6'}}/> Elektrība dzīvoklī
                      </label>
                      {ac.elec && (
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                          <div style={{flex:1,minWidth:90}}>{lbl('Iepriekš. (kWh)')}<input type="number" step="0.001" value={ac.elecPrev} onChange={e=>upd({elecPrev:e.target.value})} style={{...inpSt,textAlign:'right'}} placeholder="0.000"/></div>
                          <div style={{flex:1,minWidth:90}}>{lbl('Pašreiz. (kWh)')}<input type="number" step="0.001" value={ac.elecCur} onChange={e=>upd({elecCur:e.target.value})} style={{...inpSt,textAlign:'right'}} placeholder="0.000"/></div>
                          <div style={{flex:1,minWidth:80}}>{lbl('Summa (EUR)')}<input type="number" step="0.01" value={ac.elecAmount} onChange={e=>upd({elecAmount:e.target.value})} style={{...inpSt,textAlign:'right'}} placeholder="0.00"/></div>
                          <div style={{width:72,flexShrink:0}}>{lbl('Patēriņš')}<div style={{padding:'4px 0',fontWeight:700,color:'#1F4E79',fontSize:12,textAlign:'right'}}>{Math.max(0,Math.round(((parseFloat(ac.elecCur)||0)-(parseFloat(ac.elecPrev)||0))*1000)/1000).toFixed(3)}</div></div>
                        </div>
                      )}
                    </div>

                    {/* NĪN nodoklis */}
                    <div style={{background:'#f5f8fc',borderRadius:7,padding:'10px 12px',marginBottom:12,border:'1px solid #e0eaf2'}}>
                      <label style={{display:'flex',alignItems:'center',gap:7,fontSize:12,fontWeight:600,color:'#1F4E79',cursor:'pointer',marginBottom:ac.nin?8:0}}>
                        <input type="checkbox" checked={ac.nin} onChange={e=>upd({nin:e.target.checked})} style={{accentColor:'#2E75B6'}}/> NĪN nodoklis
                      </label>
                      {ac.nin && (
                        <div style={{display:'flex',gap:8}}>
                          <div style={{flex:2}}>{lbl('Nosaukums')}<input value={ac.ninLabel} onChange={e=>upd({ninLabel:e.target.value})} style={inpSt} placeholder="NĪN nodoklis"/></div>
                          <div style={{flex:1}}>{lbl('Summa (EUR)')}<input type="number" step="0.01" value={ac.ninAmount} onChange={e=>upd({ninAmount:e.target.value})} style={{...inpSt,textAlign:'right'}} placeholder="0.00"/></div>
                        </div>
                      )}
                    </div>

                    {/* Brīvās pozīcijas */}
                    <div style={{background:'#f5f8fc',borderRadius:7,padding:'10px 12px',marginBottom:8,border:'1px solid #e0eaf2'}}>
                      <div style={{fontWeight:600,fontSize:11,color:'#1F4E79',marginBottom:8}}>Brīvās pozīcijas</div>
                      {ac.freeLines.map((l,i)=>{
                        const summa = Math.round((parseFloat(l.daudz)||0)*(parseFloat(l.cena)||0)*100)/100;
                        return (
                          <div key={i} style={{display:'flex',gap:6,alignItems:'flex-end',marginBottom:5}}>
                            <div style={{flex:2}}>{i===0&&lbl('Nosaukums')}<input value={l.nos} onChange={e=>upd({freeLines:ac.freeLines.map((r,j)=>j===i?{...r,nos:e.target.value}:r)})} style={inpSt} placeholder="Pozīcijas nosaukums"/></div>
                            <div style={{width:80}}>{i===0&&lbl('Mērvien.')}<select value={l.mv} onChange={e=>upd({freeLines:ac.freeLines.map((r,j)=>j===i?{...r,mv:e.target.value}:r)})} style={{...inpSt,padding:'4px 2px'}}><option value="">—</option>{MV_OPTS.map(u=><option key={u} value={u}>{u}</option>)}</select></div>
                            <div style={{width:80}}>{i===0&&lbl('Daudzums')}<input type="number" step="0.001" value={l.daudz} onChange={e=>upd({freeLines:ac.freeLines.map((r,j)=>j===i?{...r,daudz:e.target.value}:r)})} style={{...inpSt,textAlign:'right'}}/></div>
                            <div style={{width:80}}>{i===0&&lbl('Cena (€)')}<input type="number" step="0.01" value={l.cena} onChange={e=>upd({freeLines:ac.freeLines.map((r,j)=>j===i?{...r,cena:e.target.value}:r)})} style={{...inpSt,textAlign:'right'}}/></div>
                            <div style={{width:64,textAlign:'right'}}>{i===0&&lbl('Summa')}<div style={{padding:'4px 0',fontWeight:700,color:'#1F4E79',fontSize:12}}>{summa.toFixed(2)}</div></div>
                            <button onClick={()=>upd({freeLines:ac.freeLines.filter((_,j)=>j!==i)})} style={{background:'none',border:'none',color:'#c0392b',fontSize:16,cursor:'pointer',paddingBottom:2}}>×</button>
                          </div>
                        );
                      })}
                      <button className="btn-secondary" style={{padding:'4px 10px',fontSize:12,marginTop:4}} onClick={()=>upd({freeLines:[...ac.freeLines,{...emptyFree}]})}>+ Pievienot rindu</button>
                    </div>
                  </div>
                );
              })()}

              <div style={{padding:"9px 20px",background:"var(--yellow-100)",borderTop:"1px solid var(--border)",
                fontSize:11,color:"var(--yellow-600)",display:"flex",alignItems:"center",gap:7}}>
                <span>💾</span>
                <span>Visi iestatījumi saglabājas automātiski — dati paliek arī pēc lapas atsvaidzināšanas.</span>
              </div>
            </div>
            <StepFooter step={0} onBack={()=>setStep(-1)} onNext={()=>setStep(1)} canNext={true}/>
            </>
          )}

          {/* ══════ SOLIS 1: Ūdens skaitītāji ══════ */}
          {step===1 && (
            <>
              <div className="card">
                <div className="card-hdr">
                  <div>
                    <div className="card-title">1. solis — Ūdens skaitītāju atskaite</div>
                    <div className="card-meta">Lapas: Cold water · Hot water · Allocator</div>
                  </div>
                </div>
                <div className="card-body">
                  <div className={`drop-zone${drag1?" drag":""}${atskaite?" loaded":""}`}
                    onDrop={onDrop1} onDragOver={e=>{e.preventDefault();setDrag1(true)}} onDragLeave={()=>setDrag1(false)}
                    onClick={()=>ref1.current.click()}>
                    <div className="drop-icon">{atskaite?"✅":"📊"}</div>
                    <div className="drop-label">{atskaite?"Ielādēts — klikšķis nomaina":"Ievelciet xlsx vai noklikšķiniet"}</div>
                    <div className="drop-sub">Skaitītāju atskaite ar ūdens un alokatoru rādījumiem</div>
                    {file1 && <div className="drop-name">📄 {file1.name}</div>}
                    {atskaite && <div className="drop-info">Periods: {atskaite.period} · {atskaite.apartments.length} dzīvokļi</div>}
                  </div>
                  <input ref={ref1} type="file" accept=".xlsx" style={{display:"none"}} onChange={e=>e.target.files[0]&&processF1(e.target.files[0])}/>
                  {err1 && <div className="status st-err">⚠ {err1}</div>}
                  {showMappingDlg && pendingAtskaite && (
                    <div style={{marginTop:14,border:"2px solid #F9A825",borderRadius:8,overflow:"hidden"}}>
                      <div style={{background:"#FFF9C4",padding:"10px 14px",borderBottom:"1px solid #F9A825",display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:15}}>⚠</span>
                        <div>
                          <div style={{fontWeight:700,fontSize:12,color:"#7F6000"}}>Dzīvokļu ID nesakrīt ar konfigurāciju</div>
                          <div style={{fontSize:11,color:"#9E7B00"}}>Norādiet, kuram konfigurācijas dzīvoklim atbilst katrs faila ieraksts</div>
                        </div>
                      </div>
                      <div style={{padding:"10px 14px"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead><tr>
                            <th style={{textAlign:"left",padding:"4px 8px",color:"#7a9ab5",fontWeight:600,borderBottom:"1px solid #e0eaf2"}}>Failā</th>
                            <th style={{textAlign:"left",padding:"4px 8px",color:"#7a9ab5",fontWeight:600,borderBottom:"1px solid #e0eaf2"}}>→ Konfigurācijā</th>
                            <th style={{width:80,padding:"4px 8px",borderBottom:"1px solid #e0eaf2"}}/>
                          </tr></thead>
                          <tbody>
                            {pendingAtskaite.apartments.map(a => {
                              const fid = a.dz;
                              const sel = dzMapping[fid] || '';
                              const exact = sel === fid;
                              return (
                                <tr key={fid} style={{background: exact?"#f7fafd": sel?"#FFFDE7":"#FFF3E0"}}>
                                  <td style={{padding:"5px 8px",fontFamily:"DM Mono,monospace",fontWeight:700,color:"#1F4E79"}}>{fid}</td>
                                  <td style={{padding:"5px 8px"}}>
                                    <select value={sel} onChange={e=>setDzMapping(p=>({...p,[fid]:e.target.value}))}
                                      style={{padding:"4px 8px",border:`1px solid ${sel?"#c8dce8":"#E65100"}`,borderRadius:5,fontSize:12,
                                        background:sel?"#fff":"#FFF3E0",minWidth:120}}>
                                      <option value="">— izvēlieties —</option>
                                      {sortApts(Object.keys(config)).map(cid=>(
                                        <option key={cid} value={cid}>{cid}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td style={{padding:"5px 8px",fontSize:10}}>
                                    {exact && <span style={{color:"#70AD47"}}>✓ sakrīt</span>}
                                    {sel && !exact && <span style={{color:"#F57F17"}}>auto</span>}
                                    {!sel && <span style={{color:"#E65100"}}>!norādīt</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <div style={{marginTop:10,display:"flex",gap:8,alignItems:"center"}}>
                          <button onClick={confirmMapping}
                            disabled={Object.values(dzMapping).some(v=>!v)}
                            style={{padding:"7px 18px",background:"#2E75B6",border:"none",borderRadius:6,color:"#fff",
                              fontSize:12,fontWeight:700,cursor:"pointer",opacity:Object.values(dzMapping).some(v=>!v)?0.4:1}}>
                            Apstiprināt sasaisti
                          </button>
                          <button onClick={()=>setShowMappingDlg(false)}
                            style={{padding:"7px 14px",background:"#f7fafd",border:"1px solid #c8dce8",borderRadius:6,
                              color:"#1F4E79",fontSize:12,cursor:"pointer"}}>
                            Atcelt
                          </button>
                          {Object.values(dzMapping).some(v=>!v) &&
                            <span style={{fontSize:11,color:"#E65100"}}>Visiem jānorāda atbilstība</span>}
                        </div>
                      </div>
                    </div>
                  )}
                  {atskaite && (
                    <div className="status st-ok" style={{marginTop:16}}>
                      ✓ {atskaite.apartments.length} dzīvokļi · KŪ kopā: {tKU.toFixed(2)} m³ · AŪ kopā: {tAU.toFixed(2)} m³
                    </div>
                  )}
                </div>
              </div>

              {atskaite && (
                <div className="card">
                  <div className="card-hdr">
                    <div className="card-title">Priekšskatījums — {atskaite.period}</div>
                  </div>
                  <div className="chips">
                    <span className="chip cb">🏠 {atskaite.apartments.length} dz.</span>
                    <span className="chip cb">🔵 AŪ: {tAU.toFixed(2)} m³</span>
                    <span className="chip ca">🔴 KŪ: {tKU.toFixed(2)} m³</span>
                    <span className="chip cg">Max AŪ skait.: {Math.max(...atskaite.apartments.map(a=>a.coldMeters.length))}×</span>
                    <span className="chip cg">Max KŪ skait.: {Math.max(...atskaite.apartments.map(a=>a.hotMeters.length))}×</span>
                  </div>
                  <div className="tbl-wrap">
                    <table className="ptbl">
                      <thead><tr>
                        <th>Dz.</th><th>Īpašnieks</th>
                        <th>AŪ skaitītāji → patēriņš</th><th>AŪ m³</th>
                        <th>KŪ skaitītāji → patēriņš</th><th>KŪ m³</th>
                      </tr></thead>
                      <tbody>
                        {atskaite.apartments.map(a=>(
                          <tr key={a.dz}>
                            <td className="cdz">{a.dz}</td>
                            <td>{a.owner}</td>
                            <td>{a.coldMeters.map((m,i)=>(
                              <div key={i} style={{fontSize:10,color:"#166d8e"}}>[{m.modulisNr}] {m.nosaukums} → <b>{m.pat.toFixed(2)}</b></div>
                            ))}</td>
                            <td className="cau">{a.auKopa.toFixed(2)}</td>
                            <td>{a.hotMeters.map((m,i)=>(
                              <div key={i} style={{fontSize:10,color:"#8B3A00"}}>[{m.modulisNr}] {m.nosaukums} → <b>{m.pat.toFixed(2)}</b></div>
                            ))}</td>
                            <td className="cku">{a.kuKopa.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr>
                        <td colSpan={3}>KOPĀ</td>
                        <td className="cau">{tAU.toFixed(2)}</td>
                        <td/>
                        <td className="cku">{tKU.toFixed(2)}</td>
                      </tr></tfoot>
                    </table>
                  </div>
                </div>
              )}
              <StepFooter step={1} onBack={()=>setStep(0)} onNext={()=>setStep(2)} canNext={!!atskaite}/>
            </>
          )}

          {/* ══════ SOLIS 2: Siltuma kalkulators ══════ */}
          {step===2 && (
            <>
              <div className="card">
                <div className="card-hdr">
                  <div>
                    <div className="card-title">2. solis — Siltuma kalkulators</div>
                    <div className="card-meta">
                      {atskaite
                        ? `KŪ no mājas skaitītāja "Brīvības iela 166" (${atskaite.period}): ${f3(kuM3)} m³`
                        : "⚠ Ielādējiet F1 1. solī"}
                    </div>
                  </div>
                </div>
                <div className="silt-grid">
                  {/* Kreisā — ievade */}
                  <div className="silt-panel">
                    <SiltSec>Ievadlauки</SiltSec>
                    <SiltSec>No siltumapgādes rēķina</SiltSec>
                    <SiltInp label="Kopējais siltums (Qpieg.)"
                      val={sKopa || men.heatMwh} set={setSKopa}
                      unit="MWh" note={sKopa ? "Ievadīts manuāli" : men.heatMwh ? "No mēneša iestatījumiem" : "Ievadiet mēneša iestatījumos"} color="#1F4E79"/>
                    <SiltSec>Ūdens temperatūras</SiltSec>
                    <SiltInp label="Karstā ūdens t° (t°KŪ)" val={sTkud} set={setSTkud} unit="°C" note="Parasti 55°C" color="#8B3A00" st="1"/>
                    <SiltInp label="Aukstā ūdens t° (t°AŪ)" val={sTaud} set={setSTaud} unit="°C" note="Parasti 15°C" color="#166d8e" st="1"/>
                    <SiltSec>Cirkulācija</SiltSec>
                    <SiltInp label="Dzīvokļu / telpgrupu skaits" val={sDzSk} set={setSDzSk} unit="" note="Iekļaujot koplietošanas" color="#1F4E79" st="0.5"/>
                    <SiltInp label="Koeficients C" val={sKoefC} set={setSKoefC} unit="" note="No normatīviem" color="#1F4E79" st="0.0001"/>
                    <SiltSec>Konstantes (mainīt reti)</SiltSec>
                    <SiltInp label="c — ūdens siltumietilpība" val={sC} set={setSC} unit="" note="= 1" color="#595959" st="0.001"/>
                    <SiltInp label="k1 — siltuma zudumi" val={sK1} set={setSK1} unit="" note="Plākšņu = 1.0" color="#595959" st="0.001"/>
                    <SiltInp label="k2 — Gcal→MWh" val={sK2} set={setSK2} unit="" note="= 0.8598" color="#595959" st="0.0001"/>
                    <SiltSec>No Faila 1 (automātiski)</SiltSec>
                    <SiltInp label="KŪ patēriņš (mājas skaitītājs)" unit="m³" note='"Brīvības iela 166" kopējais skaitītājs' readOnly readVal={kuM3}/>
                  </div>

                  {/* Labā — rezultāti */}
                  <div className="silt-panel silt-panel-r">
                    <SiltSec>Aprēķins</SiltSec>
                    <SiltSec>1. Viena m³ uzsildīšana</SiltSec>
                    <SiltRes label="q — siltums vienam m³"
                      formula={`((${sk.tkud}−${sk.taud}) / (1000×${sk.k2})) × ${sk.c} × ${sk.k1}`}
                      value={f4(q)} unit="MWh/m³"/>
                    <SiltSec>2. Siltums karstajam ūdenim</SiltSec>
                    <SiltRes label="Qkūd = q × KŪ patēriņš"
                      formula={kuM3!==null?`${f4(q)} × ${f3(kuM3)} m³`:"ielādēt F1"}
                      value={kuM3!==null?f4(qKud):"—"}/>
                    <SiltSec>3. Cirkulācija</SiltSec>
                    <SiltRes label="Qcirk = dzīvokļu skaits × C"
                      formula={sk.dzSk?`${sk.dzSk} × ${sk.koefC}`:"—"}
                      value={sk.dzSk?f4(qCirk):"—"}/>
                    <SiltSec>4. Gala rezultāts</SiltSec>
                    <SiltRes label="Kopējais siltums" value={sk.kopa>0?f3(sk.kopa):"—"} unit="MWh"/>
                    <SiltRes label="− Siltums KŪ"
                      formula={kuM3!==null?`${f4(q)} × ${f3(kuM3??0)} m³`:"—"}
                      value={kuM3!==null?f4(qKud):"—"} unit="MWh"/>
                    <SiltRes label="− Cirkulācija"
                      formula={sk.dzSk?`${sk.dzSk} × ${sk.koefC}`:"—"}
                      value={sk.dzSk?f4(qCirk):"—"} unit="MWh"/>
                    <SiltRes label="= APKURES SILTUMS (ievadīt sistēmā)"
                      formula="Qpieg. − Qkūd − Qcirk"
                      value={sk.kopa>0?f3(qApk):"—"}
                      big warn={siltWarn}/>
                  </div>
                </div>

                {!atskaite && <div className="status st-warn" style={{margin:"12px 16px 0"}}>⚠ Ielādējiet F1 1. solī — KŪ m³ aizpildīsies automātiski</div>}
                {siltWarn && <div className="status st-err" style={{margin:"12px 16px 0"}}>⚠ Apkures siltums ir negatīvs — pārbaudiet ievadītos datus!</div>}
                {siltOk && !siltWarn && (
                  <div className="status st-ok" style={{margin:"12px 16px 0"}}>
                    ✓ Ievadiet <b>{f3(qApk)} MWh</b> alokatoru sistēmā · Cirkulācija: <b>{cirkulEur.toFixed(2)} €</b> · Tarifs uz grupu: <b>{cirkulUzGrupu.toFixed(4)} €/gr.</b>
                  </div>
                )}
                <div style={{height:12}}/>
              </div>
              <StepFooter step={2} onBack={()=>setStep(1)} onNext={()=>setStep(3)} canNext={true}/>
            </>
          )}

          {/* ══════ SOLIS 3: Alokatoru dati ══════ */}
          {step===3 && (
            <>
              <div className="card">
                <div className="card-hdr">
                  <div>
                    <div className="card-title">3. solis — Alokatoru aprēķina fails</div>
                    <div className="card-meta">Lapa: Atskaite · Alokatoru vienības ar decimāldaļām + cenas + PVN</div>
                  </div>
                </div>
                <div className="card-body">
                  <div className={`drop-zone${drag2?" drag":""}${alokData?" loaded":""}`}
                    onDrop={onDrop2} onDragOver={e=>{e.preventDefault();setDrag2(true)}} onDragLeave={()=>setDrag2(false)}
                    onClick={()=>ref2.current.click()}>
                    <div className="drop-icon">{alokData?"✅":"📋"}</div>
                    <div className="drop-label">{alokData?"Ielādēts — klikšķis nomaina":"Ievelciet xlsx vai noklikšķiniet"}</div>
                    <div className="drop-sub">Cenas, alokatoru vienības, PVN likmes</div>
                    {file2 && <div className="drop-name">📄 {file2.name}</div>}
                    {alokData && <div className="drop-info">✓ {alokData.length} dzīvokļi · {alokData[0]?.periodNo}–{alokData[0]?.periodLidz}</div>}
                  </div>
                  <input ref={ref2} type="file" accept=".xlsx" style={{display:"none"}} onChange={e=>e.target.files[0]&&processF2(e.target.files[0])}/>
                  {err2 && <div className="status st-err">⚠ {err2}</div>}
                  {showMappingDlg2 && pendingAlok && (
                    <div style={{marginTop:14,border:"2px solid #F9A825",borderRadius:8,overflow:"hidden"}}>
                      <div style={{background:"#FFF9C4",padding:"10px 14px",borderBottom:"1px solid #F9A825",display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:15}}>⚠</span>
                        <div>
                          <div style={{fontWeight:700,fontSize:12,color:"#7F6000"}}>Dzīvokļu ID nesakrīt ar konfigurāciju</div>
                          <div style={{fontSize:11,color:"#9E7B00"}}>Norādiet atbilstību — nesakritušie ieraksti netiks iekļauti</div>
                        </div>
                      </div>
                      <div style={{padding:"10px 14px"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead><tr>
                            <th style={{textAlign:"left",padding:"4px 8px",color:"#7a9ab5",fontWeight:600,borderBottom:"1px solid #e0eaf2"}}>Failā</th>
                            <th style={{textAlign:"left",padding:"4px 8px",color:"#7a9ab5",fontWeight:600,borderBottom:"1px solid #e0eaf2"}}>→ Konfigurācijā</th>
                            <th style={{width:80,padding:"4px 8px",borderBottom:"1px solid #e0eaf2"}}/>
                          </tr></thead>
                          <tbody>
                            {pendingAlok.map(a => {
                              const fid = a.dz;
                              const sel = dzMapping2[fid] || '';
                              const exact = sel === fid;
                              return (
                                <tr key={fid} style={{background: exact?"#f7fafd": sel?"#FFFDE7":"#FFF3E0"}}>
                                  <td style={{padding:"5px 8px",fontFamily:"DM Mono,monospace",fontWeight:700,color:"#1F4E79"}}>{fid}</td>
                                  <td style={{padding:"5px 8px"}}>
                                    <select value={sel} onChange={e=>setDzMapping2(p=>({...p,[fid]:e.target.value}))}
                                      style={{padding:"4px 8px",border:`1px solid ${sel?"#c8dce8":"#E65100"}`,borderRadius:5,fontSize:12,
                                        background:sel?"#fff":"#FFF3E0",minWidth:120}}>
                                      <option value="">— izlaist —</option>
                                      {sortApts(Object.keys(config)).map(cid=>(
                                        <option key={cid} value={cid}>{cid}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td style={{padding:"5px 8px",fontSize:10}}>
                                    {exact && <span style={{color:"#70AD47"}}>✓ sakrīt</span>}
                                    {sel && !exact && <span style={{color:"#F57F17"}}>auto</span>}
                                    {!sel && <span style={{color:"#aab8c5"}}>izlaidīs</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <div style={{marginTop:10,display:"flex",gap:8,alignItems:"center"}}>
                          <button onClick={confirmMapping2}
                            style={{padding:"7px 18px",background:"#2E75B6",border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                            Apstiprināt sasaisti
                          </button>
                          <button onClick={()=>setShowMappingDlg2(false)}
                            style={{padding:"7px 14px",background:"#f7fafd",border:"1px solid #c8dce8",borderRadius:6,color:"#1F4E79",fontSize:12,cursor:"pointer"}}>
                            Atcelt
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {alokData && (
                    <div className="status st-ok" style={{marginTop:16}}>
                      ✓ {alokData.length} dzīvokļi · PVN dati ielādēti
                    </div>
                  )}
                </div>
              </div>
              {alokData && atskaite && (
                <div className="card">
                  <div className="card-hdr">
                    <div className="card-title">Alokatoru priekšskatījums</div>
                    <div className="card-meta">{merged.length} dzīvokļi</div>
                  </div>
                  <div className="chips">
                    <span className="chip cg">⬛ Alok.: {tAlok.toFixed(4)} vien.</span>
                    <span className="chip cy">💶 Kopsumma: {tSum.toFixed(2)} €</span>
                  </div>
                  <div className="tbl-wrap">
                    <table className="ptbl">
                      <thead><tr>
                        <th>Dz.</th><th>Īpašnieks</th><th>Alok. vien.</th>
                        <th>Cena/m² ar PVN</th><th>Maksa platībai</th>
                        <th>Cena/vien. ar PVN</th><th>Maksa vienībām</th>
                        <th>Kopsumma €</th>
                      </tr></thead>
                      <tbody>
                        {merged.map(a=>(
                          <tr key={a.dz}>
                            <td className="cdz">{a.dz}</td>
                            <td>{config[a.dz]?.owner || a.irnieks}</td>
                            <td className="calok">{a.alokVienibas>0?a.alokVienibas.toFixed(4):<span className="czero">—</span>}</td>
                            <td className="ceur">{a.cenaM2ArPVN.toFixed(4)}</td>
                            <td className="ceur">{a.maksPlatibaiArPVN.toFixed(2)}</td>
                            <td className="ceur">{a.cenaVienArPVN.toFixed(4)}</td>
                            <td className="ceur">{a.maksVienibamArPVN.toFixed(2)}</td>
                            <td style={{fontWeight:700,color:"#1F4E79"}}>{a.kopsumma.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr>
                        <td colSpan={4}>KOPĀ</td>
                        <td className="ceur">{merged.reduce((s,a)=>s+a.maksPlatibaiArPVN,0).toFixed(2)}</td>
                        <td/>
                        <td className="ceur">{merged.reduce((s,a)=>s+a.maksVienibamArPVN,0).toFixed(2)}</td>
                        <td style={{fontWeight:700,color:"#1F4E79"}}>{tSum.toFixed(2)}</td>
                      </tr></tfoot>
                    </table>
                  </div>
                </div>
              )}
              <StepFooter step={3} onBack={()=>setStep(2)} onNext={()=>setStep(4)} canNext={!!alokData}/>
            </>
          )}

          {/* ══════ SOLIS 4: Ģenerēt ══════ */}
          {step===4 && (
            <>
              {/* ── Bilances pārbaude ── */}
              {atskaite && alokData && (() => {
                const rijasUdens  = parseFloat(men.water) || 0;
                const riasSiltums = parseFloat(men.heat)    || 0;
                const tarifKU     = parseFloat(men.tarifHot)    || 0;
                const tarifAU     = parseFloat(men.tarifCold)    || 0;
                const tarifLietus = parseFloat(men.tarifRain)|| 0;
                const kuM3b = tKU;

                // G26 = Σ ROUND(auKopa × tarifAU, 2)
                const auKopaSumma  = merged.reduce((s,a) => s + Math.round(a.auKopa * tarifAU * 100)/100, 0);
                // H26 = Σ ROUND(kuKopa × tarifKU, 2)
                const kuKopaSumma  = merged.reduce((s,a) => s + Math.round(a.kuKopa * tarifKU * 100)/100, 0);
                // KŪ × AŪ tarifs = aukstā ūdens daļa no KŪ
                const kuAuDala     = merged.reduce((s,a) => s + Math.round(a.kuKopa * tarifAU * 100)/100, 0);
                // J26 = ROUND(tarifLietus/12, 2) × dzīvokļu skaits
                const lietusSumma  = Math.round(tarifLietus / 12 * 100) / 100 * merged.length;
                // Cirkulācija = Σ ROUND(cirkulGrupas × effCirkulTarif, 2)
                const cirkulSumma  = merged.reduce((s,a) => {
                  const grupas = parseFloat(config[a.dz]?.circGroup) || 0;
                  return s + Math.round(grupas * effCirkulTarif * 100) / 100;
                }, 0);
                const apkM2Summa   = merged.reduce((s,a) => s + a.maksPlatibaiArPVN, 0);
                const apkAlokSumma = merged.reduce((s,a) => s + a.maksVienibamArPVN, 0);

                // Rīgas Ūdens = (AŪ + KŪ) × AŪ_tarifs + Lietus
                const udensPaterinsh = tAU + tKU;  // kopējais ūdens patēriņš m³
                const aprUdens = Math.round(udensPaterinsh * tarifAU * 100) / 100 + lietusSumma;
                // Rīgas Siltums = Cirkulācija + (KŪ_kopsumma − KŪ_m³×AŪ_tarifs) + ApkM2 + ApkAlok
                const aprSiltums = cirkulSumma + (kuKopaSumma - kuAuDala) + apkM2Summa + apkAlokSumma;

                const udensNesakrit  = rijasUdens  - aprUdens;
                const siltumNesakrit = riasSiltums - aprSiltums;
                // Koriģētais KŪ tarifs — kompensē ABU rēķinu kopējo nesakritību:
                // (rijasUdens + riasSiltums) = aprUdens + [cirkulSumma + (kuM3b×t − kuAuDala) + apkM2 + apkAlok]
                // t = (rijasUdens + riasSiltums − aprUdens − cirkulSumma + kuAuDala − apkM2 − apkAlok) / kuM3b
                const tarifKUkor = kuM3b > 0
                  ? (rijasUdens + riasSiltums - aprUdens - cirkulSumma + kuAuDala - apkM2Summa - apkAlokSumma) / kuM3b
                  : tarifKU;
                const kuKopaSummaKor = Math.round(kuM3b * tarifKUkor * 100) / 100;
                const aprSiltumsKor = cirkulSumma + (kuKopaSummaKor - kuAuDala) + apkM2Summa + apkAlokSumma;
                const hasData  = rijasUdens > 0 && riasSiltums > 0;
                const totalNesakrit = udensNesakrit + siltumNesakrit;
                const balansOk = hasData && Math.abs(totalNesakrit) < 0.02;
                const mesVards = men.monthName || men.monthNum || "—";
                const fmt = v => (v > 0 ? "+" : "") + v.toFixed(2);
                const tdStyle = (color, bold) => ({
                  padding:"10px 16px", fontFamily:"DM Mono,monospace", fontSize:13,
                  textAlign:"right", color: color||"#1a2733",
                  fontWeight: bold ? "600" : "400",
                  borderBottom:"0.5px solid #f0f4f8",
                });
                return (
                  <div className="card" style={{marginBottom:16}}>
                    <div className="card-hdr">
                      <div>
                        <div className="card-title">Bilances pārbaude</div>
                        <div className="card-meta">Izdevumi (rēķins) vs. Aprēķins</div>
                      </div>
                      {hasData && !balansOk && (
                        <button onClick={() => updateMen("tarifHot", tarifKUkor.toFixed(4))}
                          style={{padding:"7px 16px",background:"#1F4E79",border:"none",
                            borderRadius:7,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                          Koriģēt KŪ tarifu → {tarifKUkor.toFixed(4)} €/m³
                        </button>
                      )}
                    </div>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead>
                        <tr style={{background:"#D6E4F0"}}>
                          <th style={{padding:"8px 16px",textAlign:"left",fontSize:11,fontWeight:700,
                            color:"#1F4E79",fontFamily:"DM Mono,monospace",textTransform:"uppercase",
                            letterSpacing:".5px",borderBottom:"1px solid #c8dce8"}}>{mesVards}</th>
                          <th style={{padding:"8px 16px",textAlign:"right",fontSize:11,fontWeight:700,
                            color:"#1F4E79",fontFamily:"DM Mono,monospace",textTransform:"uppercase",
                            letterSpacing:".5px",borderBottom:"1px solid #c8dce8"}}>Izdevumi</th>
                          <th style={{padding:"8px 16px",textAlign:"right",fontSize:11,fontWeight:700,
                            color:"#1F4E79",fontFamily:"DM Mono,monospace",textTransform:"uppercase",
                            letterSpacing:".5px",borderBottom:"1px solid #c8dce8"}}>Aprēķins</th>
                          <th style={{padding:"8px 16px",textAlign:"right",fontSize:11,fontWeight:700,
                            color:"#1F4E79",fontFamily:"DM Mono,monospace",textTransform:"uppercase",
                            letterSpacing:".5px",borderBottom:"1px solid #c8dce8"}}>Nesakrīt</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style={{padding:"10px 16px",fontSize:13,fontWeight:500,
                            borderBottom:"0.5px solid #f0f4f8"}}>Rīgas Ūdens</td>
                          <td style={tdStyle("#1F4E79")}>{rijasUdens>0?rijasUdens.toFixed(2)+" €":"—"}</td>
                          <td style={tdStyle("#1F4E79")}>{hasData?aprUdens.toFixed(2)+" €":"—"}</td>
                          <td style={tdStyle(hasData?(Math.abs(udensNesakrit)<0.02?"#375623":"#E67700"):"#aab8c5", true)}>
                            {hasData?fmt(udensNesakrit)+" €":"—"}
                          </td>
                        </tr>
                        <tr>
                          <td style={{padding:"10px 16px",fontSize:13,fontWeight:500,
                            borderBottom:"0.5px solid #f0f4f8"}}>Rīgas Siltums</td>
                          <td style={tdStyle("#1F4E79")}>{riasSiltums>0?riasSiltums.toFixed(2)+" €":"—"}</td>
                          <td style={tdStyle("#1F4E79")}>{hasData?aprSiltums.toFixed(2)+" €":"—"}</td>
                          <td style={tdStyle(hasData?(Math.abs(siltumNesakrit)<0.02?"#375623":"#E67700"):"#aab8c5", true)}>
                            {hasData?fmt(siltumNesakrit)+" €":"—"}
                          </td>
                        </tr>
                        {hasData && (
                          <tr style={{background:"#f7fafd"}}>
                            <td style={{padding:"8px 16px",fontSize:12,fontWeight:700,color:"#1F4E79",borderTop:"2px solid #c8dce8"}}>Kopā (Ūdens + Siltums)</td>
                            <td style={{...tdStyle("#1F4E79",true),borderTop:"2px solid #c8dce8"}}>{(rijasUdens+riasSiltums).toFixed(2)} €</td>
                            <td style={{...tdStyle("#1F4E79",true),borderTop:"2px solid #c8dce8"}}>{(aprUdens+aprSiltums).toFixed(2)} €</td>
                            <td style={{...tdStyle(Math.abs(totalNesakrit)<0.02?"#375623":"#B71C1C",true),borderTop:"2px solid #c8dce8"}}>{fmt(totalNesakrit)} €</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {hasData && (() => {
                      const auSumma    = Math.round(tAU * tarifAU * 100) / 100;
                      const kuUdensDala = Math.round(tKU * tarifAU * 100) / 100;
                      const kuSiltDala  = kuKopaSumma - kuAuDala;
                      const row = (label, formula, value, indent, bold) => (
                        <tr key={label}>
                          <td style={{padding:"3px 8px 3px"+(indent?"24px":"8px"),color:bold?"#1F4E79":"#5a7a90",fontWeight:bold?700:400}}>{label}</td>
                          <td style={{padding:"3px 8px",color:"#7a9ab5",fontStyle:"italic"}}>{formula}</td>
                          <td style={{padding:"3px 8px",textAlign:"right",fontWeight:bold?700:400,color:bold?"#1F4E79":"#374151"}}>{value}</td>
                        </tr>
                      );
                      const sep = (label) => (
                        <tr key={"sep-"+label}><td colSpan={3} style={{padding:"6px 8px 2px",fontWeight:700,color:"#1F4E79",borderTop:"1px solid #e0eaf2",fontSize:10,textTransform:"uppercase",letterSpacing:".5px"}}>{label}</td></tr>
                      );
                      return (
                        <div style={{padding:"12px 16px",background:"#f7fafd",borderTop:"1px solid #e0eaf2",fontSize:11,fontFamily:"DM Mono,monospace"}}>
                          <div style={{fontWeight:700,marginBottom:8,color:"#1F4E79",fontSize:12}}>Aprēķina sadalījums</div>
                          <table style={{width:"100%",borderCollapse:"collapse"}}>
                            <tbody>
                              {sep("Rīgas Ūdens")}
                              {row("  Aukstais ūdens",`${tAU.toFixed(3)} m³ × ${tarifAU} €/m³`,`${auSumma.toFixed(2)} €`,true)}
                              {row("  Karstais ūdens (ūdens daļa)",`${tKU.toFixed(3)} m³ × ${tarifAU} €/m³`,`${kuUdensDala.toFixed(2)} €`,true)}
                              {row("  Lietus notekūdeņi",`${merged.length} dz. × ${(tarifLietus/12).toFixed(4)} €/dz.`,`${lietusSumma.toFixed(2)} €`,true)}
                              {row("Rīgas Ūdens kopā","",`${aprUdens.toFixed(2)} €`,false,true)}

                              {sep("Rīgas Siltums")}
                              {row("  Cirkulācija",`${merged.reduce((s,a)=>s+(parseFloat(config[a.dz]?.circGroup)||0),0).toFixed(1)} gr. × ${effCirkulTarif.toFixed(4)} €/gr.`,`${cirkulSumma.toFixed(2)} €`,true)}
                              {row("  Karstais ūdens (siltuma daļa)",`${tKU.toFixed(3)} m³ × (${tarifKU} − ${tarifAU}) €/m³`,`${kuSiltDala.toFixed(2)} €`,true)}
                              {row("  Apkure m² (alokatoru maksa platībai)","Σ ROUND(m² × cena/m² ar PVN, 2)",`${apkM2Summa.toFixed(2)} €`,true)}
                              {row("  Apkure alok. (alokatoru vienību maksa)","Σ ROUND(vien. × cena/vien. ar PVN, 2)",`${apkAlokSumma.toFixed(2)} €`,true)}
                              {row("Rīgas Siltums kopā","",`${aprSiltums.toFixed(2)} €`,false,true)}

                              {!balansOk && riasSiltums > 0 && sep(`Koriģētais aprēķins — KŪ tarifs ${tarifKUkor.toFixed(4)} €/m³ absorbē Ūdens iztrūkumu (${fmt(udensNesakrit)} €)`)}
                              {!balansOk && riasSiltums > 0 && row("  Karstais ūdens (siltuma daļa, kor.)",`${tKU.toFixed(3)} m³ × (${tarifKUkor.toFixed(4)} − ${tarifAU}) €/m³`,`${(kuKopaSummaKor - kuAuDala).toFixed(2)} €`,true)}
                              {!balansOk && riasSiltums > 0 && row("Rīgas Siltums (koriģēts)",`= ${riasSiltums.toFixed(2)} + (${fmt(udensNesakrit)}) €`,`${aprSiltumsKor.toFixed(2)} €`,false,true)}
                              {!balansOk && riasSiltums > 0 && row("Kopā pēc korekcijas","Ūdens + Siltums kor.",`${(aprUdens + aprSiltumsKor).toFixed(2)} €`,false,true)}
                            </tbody>
                          </table>
                          <div style={{marginTop:8,color:"#aab8c5",lineHeight:1.7}}>
                            KŪ pa dzīvokļiem: {merged.map(a=>`${a.dz}: ${a.kuKopa.toFixed(3)}`).join(" · ")}
                          </div>
                        </div>
                      );
                    })()}
                    {balansOk && (
                      <div style={{padding:"10px 16px",background:"#E2EFDA",fontSize:12,
                        color:"#375623",fontWeight:500,borderTop:"0.5px solid #e0eaf2"}}>
                        ✓ Kopējā bilance sakrīt. KŪ tarifs: {tarifKU} €/m³
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Ģenerēšana */}
              <div className="card">
                <div className="card-hdr">
                  <div>
                    <div className="card-title">4. solis — Ģenerēt DZIB_Kopsavilkums.xlsx</div>
                    <div className="card-meta">
                      {atskaite&&alokData?"Abi faili gatavi — var ģenerēt":"Nepieciešami abi faili (1. un 3. solis)"}
                    </div>
                  </div>
                </div>
                <div className="card-body">
                  <div style={{background:"#f7fafd",borderRadius:8,border:"1px solid #e0eaf2",padding:"14px 18px",marginBottom:16}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
                      {[
                        {label:"Fails 1", val:file1?.name||"—", ok:!!atskaite, sub:atskaite?`${atskaite.period}`:"nav"},
                        {label:"Siltums", val:siltOk?`${f3(qApk)} MWh`:"—", ok:siltOk&&!siltWarn, sub:siltOk?"aprēķināts":"nepilnīgs"},
                        {label:"Fails 2", val:file2?.name||"—", ok:!!alokData, sub:alokData?`${alokData.length} dz.`:"nav"},
                        {label:"Kopsumma", val:alokData?`${tSum.toFixed(2)} €`:"—", ok:!!alokData, sub:"ar PVN"},
                      ].map(({label,val,ok,sub})=>(
                        <div key={label} style={{background:ok?"#E2EFDA":"#f0f4f8",borderRadius:8,padding:"10px 12px",border:`1px solid ${ok?"#70AD4766":"#e0eaf2"}`}}>
                          <div style={{fontSize:10,color:ok?"#375623":"#7a9ab5",textTransform:"uppercase",letterSpacing:".5px",fontWeight:700}}>{label}</div>
                          <div style={{fontSize:12,fontFamily:"DM Mono,monospace",fontWeight:600,color:ok?"#1F4E79":"#aaa",marginTop:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{val}</div>
                          <div style={{fontSize:10,color:ok?"#375623":"#7a9ab5",marginTop:2}}>{sub}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {(() => {
                    const py = parseInt(men.year||0), pm = parseInt(men.monthNum||0);
                    const ef = py && pm ? extraInvoices.filter(i=>i.period_year===py&&i.period_month===pm) : [];
                    if (!ef.length) return null;
                    return (
                      <div style={{background:"#f0f6ff",border:"1px solid #c0d8f0",borderRadius:7,padding:"10px 14px",marginBottom:12}}>
                        <div style={{fontSize:11,fontWeight:700,color:"#1F4E79",marginBottom:6}}>Papildu rēķini ({ef.length}) — tiks iekļauti ģenerēšanā</div>
                        {ef.map(i=>(
                          <div key={i.id} style={{fontSize:11,color:"#2c5f8a",display:'flex',gap:12,borderTop:"1px solid #d0e8f8",paddingTop:4,marginTop:4}}>
                            <span style={{fontFamily:'monospace'}}>{i.invoice_nr||'(nr. tiks piešķirts)'}</span>
                            <span>{i.owner}</span>
                            <span style={{color:"#888"}}>dz. {(i.apts||[]).join(', ')}</span>
                            <span style={{marginLeft:'auto',fontWeight:600}}>{parseFloat(i.total_eur).toFixed(2)} €</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <div style={{fontSize:12,color:"#5a7a90",marginBottom:8}}>
                    Ģenerētais fails saturēs 4 lapas: <b>Skaitītāju rādījumi · Alokatoru aprēķins · Skaitītāju reģistrs · Dzīvokļu konfigurācija</b>
                  </div>

                  <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                    <button className="btn-primary" style={{flex:"2 1 240px"}} disabled={!atskaite||!alokData} onClick={handleGenerate}>
                      <span style={{fontSize:18}}>⚡</span>
                      {atskaite ? `Ģenerēt DZIB_Kopsavilkums_${(atskaite.period.trim().split("-")[0]||"YYYY")}_${(atskaite.period.trim().split("-")[1]||"MM").padStart(2,"0")}.xlsx` : "Ģenerēt DZIB_Kopsavilkums_YYYY_MM.xlsx"}
                    </button>
                    <button className="btn-secondary" disabled={!atskaite||!alokData} onClick={handleGeneratePdf}>
                      <span style={{fontSize:18}}>🖨</span>
                      Ģenerēt PDF rēķinus
                    </button>
                    <button className="btn-secondary" disabled={!atskaite||!alokData||emailSending} onClick={handleSendEmails}
                      style={{background: emailSending ? "#c8dce8" : undefined}}>
                      <span style={{fontSize:18}}>✉</span>
                      {emailSending ? `Sūta ${emailProgress.sent}/${emailProgress.total}...` : "Izsūtīt rēķinus"}
                    </button>
                  </div>
                  {done && <div className="status st-ok">✅ Fails lejupielādēts! · {merged.length} dzīvokļi · {atskaite?.period}</div>}
                  {!emailSending && emailProgress.total > 0 && (
                    <div className={emailProgress.errors.length > 0 ? "status st-err" : "status st-ok"}>
                      {emailProgress.errors.length === 0
                        ? `✅ Nosūtīts ${emailProgress.sent}/${emailProgress.total} rēķini`
                        : `⚠ Nosūtīts ${emailProgress.sent}/${emailProgress.total}`}
                      {emailProgress.errors.map((e,i) => <div key={i} style={{fontSize:10.5,marginTop:2}}>{e}</div>)}
                      {emailProgress.noEmail.length > 0 && (
                        <div style={{fontSize:10.5,marginTop:3,color:"#888",borderTop:"1px solid #ddd",paddingTop:3}}>
                          Nav e-pasta adreses: {emailProgress.noEmail.join(', ')} — pievienot E-pasta iestatījumos
                        </div>
                      )}
                    </div>
                  )}
                  {errPdf && <div className="status st-err">⚠ PDF kļūda: {errPdf}</div>}
                  {(!atskaite||!alokData) && (
                    <div className="status st-warn">
                      ⚠ {!atskaite?"Nepieciešams Fails 1 (1. solis)":""}{!atskaite&&!alokData?" un ":""}{!alokData?"Nepieciešams Fails 2 (3. solis)":""}
                    </div>
                  )}
                </div>
              </div>
              <StepFooter step={4} onBack={()=>setStep(3)} onNext={null} noNext/>
            </>
          )}

        </div>
      </div>
    </>
  );
}
