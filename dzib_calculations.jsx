import { useState, useCallback, useRef, useEffect } from "react";
import * as XLSX from "xlsx";

// ─── Persistent storage ────────────────────────────────────────────────────
const SK = "dzivoklu-config-v1";
async function loadCfg() {
  try { const r = await window.storage.get(SK); return r ? JSON.parse(r.value) : {}; } catch { return {}; }
}
async function saveCfg(c) {
  try { await window.storage.set(SK, JSON.stringify(c)); } catch {}
}

// ─── Parse Fails 1: skaitītāju atskaite ───────────────────────────────────
function parseAtskaite(wb) {
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
    // Mājas rinda: Customer number ir null, tukšs, vai Dzīvoklis satur "166"
    return cust == null || cust === "" || dz.includes("166") || dz.toLowerCase().includes("br");
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
  const aptKey = x => { const n = parseInt(String(x)); return isNaN(n)?[1,String(x)]:[0,n]; };
  const sorted = [...allDz].sort((a,b)=>{ const[ta,va]=aptKey(a),[tb,vb]=aptKey(b); return ta!==tb?ta-tb:String(va)<String(vb)?-1:1; });

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

// ─── Merge + PVN calc ──────────────────────────────────────────────────────
function mergeData(atskaite, alokData, config) {
  const am = {}; for (const a of alokData) am[a.dz]=a;
  return atskaite.apartments.map(apt => {
    const al=am[apt.dz]||{}, cfg=config[apt.dz]||{};
    const cenaM2=al.cenaM2??0, platiba=al.platiba??cfg.platiba??0;
    const cenaV=al.cenaVieniba??0, alokV=al.alokVienibas??0;
    const pvn=al.pvnLikme??0, pvnK=1+pvn/100;
    return { ...apt, platiba, personas:cfg.personas??0, epasts:cfg.epasts??"",
      irnieks:al.irnieks??apt.owner, ligums:al.ligums??"",
      cenaM2, cenaVieniba:cenaV, alokVienibas:alokV, pvnLikme:pvn,
      cenaM2ArPVN:cenaM2*pvnK, cenaVienArPVN:cenaV*pvnK,
      maksPlatibaiArPVN:cenaM2*platiba*pvnK,
      maksVienibamArPVN:cenaV*alokV*pvnK,
      kopsumma:cenaM2*platiba*pvnK+cenaV*alokV*pvnK };
  });
}

// ─── Excel builder ─────────────────────────────────────────────────────────
function fmt(ws,f,r1,c1,r2,c2){ for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++){const a=XLSX.utils.encode_cell({r,c});if(ws[a]&&ws[a].t==="n")ws[a].z=f;}}

function buildXlsx(atskaite, alokData, config) {
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
  const h2=["Dz.Nr.","Īrnieks","PVN %","Cena/m²",`Cena/m² ar PVN`,"m²",`Maksa platībai ar PVN`,
    "Cena/vienību",`Cena/vien. ar PVN`,"Alok. vien.",`Maksa vienībām ar PVN`,"Kopsumma ar PVN"];
  const r2s=[[`ALOKATORU APRĒĶINS | ${alokData[0]?.periodNo||""}–${alokData[0]?.periodLidz||""}`],h2];
  for(const a of merged) r2s.push([a.dz,a.irnieks,a.pvnLikme,a.cenaM2,a.cenaM2ArPVN,a.platiba,
    a.maksPlatibaiArPVN,a.cenaVieniba,a.cenaVienArPVN,a.alokVienibas,a.maksVienibamArPVN,a.kopsumma]);
  const d2e=1+merged.length;
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
  const r4s=[["DZĪVOKĻU KONFIGURĀCIJA"],["Dz.Nr.","Īpašnieks","Platība m²","Personas","AŪ skait.","KŪ skait.","E-pasts"]];
  for(const a of merged) r4s.push([a.dz,a.owner,a.platiba,a.personas,a.coldMeters.length,a.hotMeters.length,a.epasts]);
  const de=1+merged.length; r4s.push([],["KOPĀ","",`=SUM(C3:C${de})`,`=SUM(D3:D${de})`,"","",""]);
  const ws4=XLSX.utils.aoa_to_sheet(r4s);
  ws4["!cols"]=[10,18,12,10,12,12,28].map(w=>({wch:w}));
  fmt(ws4,"0.0",2,2,1+merged.length,2);
  XLSX.utils.book_append_sheet(wb,ws4,"Dzīvokļu konfigurācija");
  return wb;
}

// ─── Styles ────────────────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f0f4f8;color:#1a2733;font-family:'DM Sans',sans-serif;font-size:14px}
.app{min-height:100vh;display:flex;flex-direction:column}
.main{flex:1;padding:20px 24px;max-width:1140px;margin:0 auto;width:100%}

.topbar{background:linear-gradient(135deg,#1F4E79,#2E75B6);padding:16px 24px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 10px #1F4E7933}
.topbar-icon{font-size:26px}
.topbar-title{font-size:17px;font-weight:700;color:#fff}
.topbar-sub{font-size:11px;color:#9cc8e8;margin-top:1px}
.topbar-badge{margin-left:auto;background:#ffffff22;border:1px solid #ffffff33;color:#d0eaff;font-size:10px;font-family:'DM Mono',monospace;padding:3px 10px;border-radius:20px}

/* steps nav */
.steps{display:flex;background:#fff;border-bottom:2px solid #e0eaf2;padding:0 24px;overflow-x:auto}
.step{display:flex;align-items:center;gap:8px;padding:12px 18px;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .15s;white-space:nowrap;user-select:none}
.step:hover .step-label{color:#1F4E79}
.step.active{border-bottom-color:#2E75B6}
.step.active .step-label{color:#1F4E79;font-weight:700}
.step.done .step-num{background:#70AD47;color:#fff;border-color:#70AD47}
.step-num{width:22px;height:22px;border-radius:50%;border:2px solid #c8dce8;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#7a9ab5;flex-shrink:0;transition:all .15s}
.step.active .step-num{border-color:#2E75B6;color:#2E75B6}
.step-label{font-size:13px;color:#7a9ab5;transition:color .15s}
.step-sep{color:#c8dce8;font-size:18px;padding:0 2px}

/* cards */
.card{background:#fff;border-radius:12px;box-shadow:0 2px 8px #1F4E7910;margin-bottom:16px;overflow:hidden}
.card-hdr{padding:13px 18px;background:#f7fafd;border-bottom:1px solid #e0eaf2;display:flex;align-items:center;justify-content:space-between}
.card-title{font-size:11px;font-weight:700;color:#1F4E79;text-transform:uppercase;letter-spacing:.8px;font-family:'DM Mono',monospace}
.card-meta{font-size:11px;color:#7a9ab5;margin-top:2px}
.card-body{padding:18px}

/* drop zone */
.drop-zone{border:2px dashed #c8dce8;border-radius:10px;padding:28px 16px;text-align:center;cursor:pointer;transition:all .2s;background:#f7fafd;display:flex;flex-direction:column;align-items:center;gap:8px}
.drop-zone:hover,.drop-zone.drag{border-color:#2E75B6;background:#EBF4FF}
.drop-zone.loaded{border-color:#70AD47;background:#f0faf0;border-style:solid}
.drop-icon{font-size:32px}
.drop-label{font-size:12px;color:#7a9ab5}
.drop-sub{font-size:10px;color:#b0c4d4;font-style:italic}
.drop-name{font-family:'DM Mono',monospace;font-size:11px;color:#375623;font-weight:600}
.drop-info{font-family:'DM Mono',monospace;font-size:11px;color:#2E75B6;font-weight:600}

/* buttons */
.btn-primary{width:100%;padding:13px;margin-top:16px;background:linear-gradient(135deg,#1F4E79,#2E75B6);border:none;border-radius:10px;color:#fff;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 3px 10px #2E75B633}
.btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 5px 16px #2E75B644}
.btn-primary:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none}
.btn-dl{padding:8px 16px;border-radius:7px;border:1px solid #70AD4766;background:#E2EFDA;color:#375623;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all .15s}
.btn-dl:hover{background:#d5e8cc}
.btn-save{padding:6px 14px;border-radius:7px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;border:1px solid #70AD4766;background:#E2EFDA;color:#375623}
.btn-save.dirty{background:#FFF2CC;color:#7F6000;border-color:#FFD96666}
.btn-next{display:inline-flex;align-items:center;gap:6px;padding:9px 20px;background:#2E75B6;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s}
.btn-next:hover{background:#1F4E79}

/* status */
.status{padding:10px 14px;border-radius:8px;font-size:12px;margin-top:12px;display:flex;align-items:center;gap:8px;font-weight:500}
.st-ok{background:#E2EFDA;color:#375623;border:1px solid #70AD4755}
.st-err{background:#FCE4EC;color:#B71C1C;border:1px solid #E5737355}
.st-warn{background:#FFF2CC;color:#7F6000;border:1px solid #FFD96666}
.st-info{background:#D6E4F0;color:#1F4E79;border:1px solid #2E75B655}

/* chips */
.chips{display:flex;gap:7px;flex-wrap:wrap;padding:10px 18px;border-bottom:1px solid #e0eaf2;background:#f7fafd}
.chip{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:500}
.cb{background:#D6E4F0;color:#1F4E79} .cg{background:#E2EFDA;color:#375623}
.ca{background:#FCE4D6;color:#8B3A00} .cy{background:#FFF2CC;color:#7F6000}

/* preview table */
.tbl-wrap{overflow-x:auto;max-height:380px;overflow-y:auto}
.ptbl{width:100%;border-collapse:collapse;font-size:11px}
.ptbl thead th{position:sticky;top:0;z-index:1;padding:8px 10px;background:#D6E4F0;border-bottom:2px solid #2E75B6;text-align:right;color:#1F4E79;font-weight:700;white-space:nowrap;font-size:10px}
.ptbl thead th:first-child,.ptbl thead th:nth-child(2){text-align:left}
.ptbl tbody td{padding:6px 10px;border-bottom:1px solid #e8f0f7;text-align:right;white-space:nowrap}
.ptbl tbody td:first-child{text-align:left}
.ptbl tbody td:nth-child(2){text-align:left;color:#5a7a90}
.ptbl tbody tr:nth-child(even) td{background:#f7fafd}
.ptbl tbody tr:hover td{background:#EBF4FF}
.ptbl tfoot td{background:#D6E4F0;font-weight:700;padding:7px 10px;text-align:right;border-top:2px solid #2E75B6}
.ptbl tfoot td:first-child{text-align:left}
.cdz{font-family:'DM Mono',monospace;font-weight:700;color:#1F4E79}
.cau{color:#166d8e;font-weight:600} .cku{color:#8B3A00;font-weight:600}
.ceur{color:#1F4E79;font-weight:600} .calok{color:#375623;font-weight:600;font-family:'DM Mono',monospace}
.czero{color:#bbb}

/* siltuma kalkulators */
.silt-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #e0eaf2;border-radius:10px;overflow:hidden}
.silt-panel{background:#fff}
.silt-panel-r{border-left:1px solid #e0eaf2}
.silt-sec{padding:6px 14px;background:#edf2f7;border-bottom:1px solid #e0eaf2;font-size:10px;font-weight:700;color:#4a6580;text-transform:uppercase;letter-spacing:.6px;font-family:'DM Mono',monospace}
.silt-inp-row{display:flex;align-items:center;gap:8px;padding:7px 14px;border-bottom:1px solid #f0f4f8}
.silt-lbl-wrap{flex:0 0 195px}
.silt-lbl{font-size:12px;color:#1a2733;font-weight:500}
.silt-note{font-size:10px;color:#aab8c5;margin-top:1px}
.silt-input{flex:1;padding:6px 10px;font-family:'DM Mono',monospace;font-size:13px;font-weight:600;border:1.5px solid #c8dce8;border-radius:6px;outline:none;background:#f7fafd;transition:border-color .15s;color:#1F4E79}
.silt-input:focus{border-color:#2E75B6;background:#fff}
.silt-readonly{flex:1;padding:6px 10px;font-family:'DM Mono',monospace;font-size:13px;font-weight:700;border:1.5px solid #70AD4788;border-radius:6px;background:#E2EFDA;color:#375623}
.silt-unit{font-size:11px;color:#7a9ab5;min-width:42px}
.silt-res-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 14px;border-bottom:1px solid #f0f4f8}
.silt-res-lbl{font-size:12px;color:#1a2733}
.silt-res-f{font-size:10px;color:#aab8c5;font-family:'DM Mono',monospace;margin-top:1px}
.silt-res-val{font-family:'DM Mono',monospace;font-size:13px;font-weight:600;color:#1a2733;white-space:nowrap}
.silt-res-unit{font-size:10px;color:#7a9ab5;margin-left:3px}
.silt-big{padding:13px 14px;background:#EBF4FF;border-top:2px solid #2E75B6}
.silt-big .silt-res-lbl{font-size:13px;font-weight:700;color:#1F4E79}
.silt-big .silt-res-val{font-size:20px;color:#1F4E79}
.silt-big-warn{background:#FCE4EC;border-top-color:#E57373}
.silt-big-warn .silt-res-lbl{color:#B71C1C}
.silt-big-warn .silt-res-val{color:#B71C1C}

/* config */
.cfg-tbl{width:100%;border-collapse:collapse;font-size:12px}
.cfg-tbl thead th{text-align:left;padding:8px 12px;background:#D6E4F0;border-bottom:2px solid #2E75B6;color:#1F4E79;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
.cfg-tbl tbody td{padding:5px 12px;border-bottom:1px solid #e8f0f7}
.cfg-tbl tbody tr:nth-child(even) td{background:#f7fafd}
.cfg-tbl tbody tr:hover td{background:#EBF4FF}
.ci{background:#FFF2CC;border:1px solid #FFD96699;color:#1a2733;padding:4px 8px;border-radius:5px;font-size:12px;width:80px;text-align:center;font-family:'DM Mono',monospace;outline:none}
.ci:focus{border-color:#2E75B6;background:#fff}
.ci.em{width:190px;text-align:left;background:#f7fafd;border-color:#c8dce8}
.ci.em:focus{border-color:#2E75B6;background:#fff}
.empty-st{color:#7a9ab5;font-size:13px;text-align:center;padding:40px 20px;line-height:1.8}
`;

// ─── App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState(0);   // 0=iestatījumi, 1=ūdens, 2=siltums, 3=alokatori, 4=ģenerēt

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

  // Mēneša iestatījumi (no Rekvizīti taba)
  const SK_MEN = "dzib-menesa-iestatijumi-v1";
  const [men, setMen] = useState({
    // Rēķinu kopsummas
    siltums:        "",   // Siltums EUR (kopā)
    rijasUdens:     "",   // Rīgas Ūdens EUR
    atkritumi:      "",   // Atkritumi EUR
    koplEl:         "",   // Koplietošanas elektrība EUR
    // Patēriņi
    aukstaisUdens:  "",   // Aukstais ūdens m³ (kopā)
    kopejaisSiltums: "",  // Kopējais siltums MWh (no rēķina)
    koplElKwh:      "",   // Koplietošanas elektrība kWh
    // Tarifi
    tarifAU:        "3.2307",
    tarifKU:        "7.26",
    tarifCirk:      "",
    tarifApsam:     "0.6044",
    tarifRem:       "0.3156",
    tarifSiltmezgls:"0.037",
    tarifLietus:    "9.6074",
    koplElTarifs:   "6.80",
    // Periods
    menesisCipars:  "",   // 03
    menesisVards:   "",   // MARTS
    gadam:          "",   // 2026
  });

  useEffect(() => {
    const load = async () => {
      try {
        const r = await window.storage.get(SK_MEN);
        if (r) setMen(prev => ({ ...prev, ...JSON.parse(r.value) }));
      } catch {}
    };
    load();
  }, []);

  const saveMen = async (newMen) => {
    try { await window.storage.set(SK_MEN, JSON.stringify(newMen)); } catch {}
  };
  const updateMen = (field, val) => {
    setMen(prev => ({ ...prev, [field]: val }));
  };
  const saveMenField = () => {
    setMen(prev => { saveMen(prev); return prev; });
  };
  const [config, setConfig] = useState({});
  const [dirty,  setDirty]  = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [done,   setDone]   = useState(false);

  const ref1 = useRef(), ref2 = useRef();

  useEffect(() => { loadCfg().then(c=>{ if(Object.keys(c).length) setConfig(c); }); }, []);

  const readWb = async f => { const b=await f.arrayBuffer(); return XLSX.read(new Uint8Array(b),{type:"array"}); };

  const processF1 = useCallback(async f => {
    setErr1(""); setDone(false);
    // Zināmie cirkulācijas grupas skaiti katram dzīvoklim
    const CIRK_GRUPAS = {
      "1A Pagrabs": 1, "1 Kafejnīca": 1, "2 Salons": 1,
      "3": 2.5, "4": 2.5, "6": 1, "7": 2, "8": 1,
      "9": 2, "10": 1, "11": 2, "12": 2.5,
    };
    try {
      const r = parseAtskaite(await readWb(f));
      setAtskaite(r); setFile1(f);
      setConfig(prev => {
        const n={...prev};
        for(const a of r.apartments) {
          if(!n[a.dz]) n[a.dz]={platiba:0,personas:0,epasts:"",cirkulGrupas: CIRK_GRUPAS[a.dz] ?? 0};
          else if(!n[a.dz].cirkulGrupas) n[a.dz].cirkulGrupas = CIRK_GRUPAS[a.dz] ?? 0;
        }
        return n;
      });
    } catch(e) { setErr1(e.message); }
  }, []);

  const processF2 = useCallback(async f => {
    setErr2(""); setDone(false);
    try {
      const r = parseAlokatori(await readWb(f));
      setAlokData(r); setFile2(f);
    } catch(e) { setErr2(e.message); }
  }, []);

  const onDrop1 = useCallback(e=>{ e.preventDefault(); setDrag1(false); const f=e.dataTransfer.files[0]; if(f) processF1(f); },[processF1]);
  const onDrop2 = useCallback(e=>{ e.preventDefault(); setDrag2(false); const f=e.dataTransfer.files[0]; if(f) processF2(f); },[processF2]);

  const updateCfg = (dz,field,val) => {
    setConfig(p=>({...p,[dz]:{...p[dz],[field]:field==="epasts"?val:(parseFloat(val)||0)}}));
    setDirty(true); setSaved(false);
  };
  const handleSave = async () => { await saveCfg(config); setDirty(false); setSaved(true); setTimeout(()=>setSaved(false),2500); };

  const handleGenerate = () => {
    if(!atskaite||!alokData) return;
    const periodClean = atskaite.period.trim().replace(/\s*-\s*/g,"-");
    const parts = periodClean.split("-");
    const yyyy = parts[0]?.padStart(4,"0") || "0000";
    const mm   = parts[1]?.padStart(2,"0") || "00";
    XLSX.writeFile(buildXlsx(atskaite,alokData,config),`DZIB_Kopsavilkums_${yyyy}_${mm}.xlsx`);
    setDone(true);
  };

  // Siltums calc — KŪ no mājas kopējā skaitītāja "Brīvības iela 166"
  const kuM3 = atskaite?.kuKopaTotal ?? null;
  const sk = { kopa:parseFloat(sKopa||men.kopejaisSiltums)||0, tkud:parseFloat(sTkud)||0, taud:parseFloat(sTaud)||0,
    c:parseFloat(sC)||1, k1:parseFloat(sK1)||1, k2:parseFloat(sK2)||0.8598,
    dzSk:parseFloat(sDzSk)||0, koefC:parseFloat(sKoefC)||0 };
  const q      = sk.k2>0 ? ((sk.tkud-sk.taud)/(1000*sk.k2))*sk.c*sk.k1 : 0;
  const qKud   = q*(kuM3??0);
  const qCirk  = sk.dzSk*sk.koefC;
  const qApk   = sk.kopa-qKud-qCirk;
  const siltOk = sk.kopa>0 && (kuM3??0)>0 && sk.dzSk>0;
  const siltWarn = siltOk && qApk<=0;
  // Cirkulācija € = Qcirk × (Rīgas Siltums / Qpieg), tarifs uz grupu
  const rijasUdensVal  = parseFloat(men.rijasUdens) || 0;
  const riasSiltumsMen = parseFloat(men.siltums)    || 0;
  const T_siltums      = sk.kopa > 0 ? riasSiltumsMen / sk.kopa : 0;
  const cirkulEur      = qCirk * T_siltums;
  const cirkulUzGrupu  = sk.dzSk > 0 ? Math.round(cirkulEur / sk.dzSk * 10000) / 10000 : 0;

  const f4=v=>isNaN(v)?"—":v.toFixed(4), f3=v=>isNaN(v)?"—":v.toFixed(3);

  const merged = atskaite&&alokData ? mergeData(atskaite,alokData,config) : [];
  const tAU = atskaite ? atskaite.apartments.reduce((s,a)=>s+a.auKopa,0) : 0;
  const tKU = atskaite ? atskaite.apartments.reduce((s,a)=>s+a.kuKopa,0) : 0;
  const tAlok=merged.reduce((s,a)=>s+a.alokVienibas,0), tSum=merged.reduce((s,a)=>s+a.kopsumma,0);

  // ── Step components ────────────────────────────────────────────────────
  const StepNav = () => {
    const steps = [
      {n:0, label:"Mēneša iestatījumi", done: !!(men.siltums && men.rijasUdens)},
      {n:1, label:"Ūdens skaitītāji",   done: !!atskaite},
      {n:2, label:"Siltuma kalkulators",done: siltOk&&!siltWarn},
      {n:3, label:"Alokatoru dati",     done: !!alokData},
      {n:4, label:"Ģenerēt Excel",      done: done},
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

  // ── Siltuma ievades rinda ──
  const SiltInp = ({label, val, set, unit, note, readOnly, readVal, color="#1F4E79", step:st="0.001"}) => (
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

  const SiltRes = ({label, formula, value, unit="MWh", big, warn}) => (
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

  const SiltSec = ({children}) => <div className="silt-sec">{children}</div>;

  return (
    <>
      <style>{css}</style>
      <div className="app">
        <div className="topbar">
          <div className="topbar-icon">🏢</div>
          <div>
            <div className="topbar-title">DZĪB Brīvības 166 Rēķinu sagatavotājs</div>
            <div className="topbar-sub">Skaitītāji → Siltuma kalkulators → Alokatori → Excel</div>
          </div>
          <div className="topbar-badge">v2.0</div>
        </div>

        <StepNav />

        <div className="main">

          {/* ══════ SOLIS 0: Mēneša iestatījumi ══════ */}
          {step===0 && (() => {
            const Inp = ({label, field, unit, note, wide}) => (
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 16px",borderBottom:"1px solid #f0f4f8"}}>
                <div style={{flex:"0 0 240px"}}>
                  <div style={{fontSize:12,color:"#1a2733",fontWeight:500}}>{label}</div>
                  {note && <div style={{fontSize:10,color:"#aab8c5",marginTop:1}}>{note}</div>}
                </div>
                <input
                  type={field==="menesisVards"||field==="gadam"||field==="menesisCipars"?"text":"number"}
                  step="0.0001" value={men[field]||""}
                  onChange={e => updateMen(field, e.target.value)}
                  onBlur={() => saveMenField()}
                  style={{flex:wide?"2":"1",padding:"6px 10px",fontFamily:"DM Mono,monospace",fontSize:13,
                    fontWeight:600,border:"1.5px solid #c8dce8",borderRadius:6,outline:"none",
                    background:men[field]?"#FAFCFF":"#f7fafd",color:"#1F4E79",transition:"border-color .15s"}}
                />
                {unit && <span style={{fontSize:11,color:"#7a9ab5",minWidth:36}}>{unit}</span>}
              </div>
            );
            const Sec = ({children}) => (
              <div style={{padding:"6px 16px",background:"#edf2f7",borderBottom:"1px solid #e0eaf2",
                fontSize:10,fontWeight:700,color:"#4a6580",textTransform:"uppercase",letterSpacing:".6px",fontFamily:"DM Mono,monospace"}}>
                {children}
              </div>
            );
            return (
              <div className="card">
                <div className="card-hdr">
                  <div>
                    <div className="card-title">Mēneša iestatījumi</div>
                    <div className="card-meta">Rēķinu kopsummas, patēriņi un tarifi — saglabājas automātiski</div>
                  </div>
                  <button className="btn-next" onClick={()=>setStep(1)}>Tālāk: Ūdens skaitītāji →</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}>
                  {/* Kreisā kolonna */}
                  <div style={{borderRight:"1px solid #e0eaf2"}}>
                    <Sec>Periods</Sec>
                    <Inp label="Gads" field="gadam" unit="" note="piem. 2026"/>
                    <Inp label="Mēnesis (cipars)" field="menesisCipars" unit="" note="piem. 03"/>
                    <Inp label="Mēnesis (vārds)" field="menesisVards" unit="" note="piem. MARTS"/>

                    <Sec>Rēķinu kopsummas (€)</Sec>
                    <Inp label="Rīgas Siltums" field="siltums" unit="€" note="Kopējais siltuma rēķins"/>
                    <Inp label="Rīgas Ūdens" field="rijasUdens" unit="€"/>
                    <Inp label="Atkritumi (Clean)" field="atkritumi" unit="€"/>
                    <Inp label="Koplietošanas elektrība" field="koplEl" unit="€"/>

                    <Sec>Patēriņi</Sec>
                    <Inp label="Kopējais siltums" field="kopejaisSiltums" unit="MWh" note="No siltumapgādes rēķina"/>
                    <Inp label="Aukstais ūdens" field="aukstaisUdens" unit="m³" note="Kopējais patēriņš"/>
                    <Inp label="Koplietošanas elektrība" field="koplElKwh" unit="kWh"/>
                  </div>

                  {/* Labā kolonna */}
                  <div>
                    <Sec>Tarifi</Sec>
                    <Inp label="Aukstais ūdens" field="tarifAU" unit="€/m³"/>
                    <Inp label="Karstais ūdens" field="tarifKU" unit="€/m³" note="* koriģējas bilancē (4. solis)"/>
                    <Inp label="Cirkulācija uz grupu" field="tarifCirk" unit="€/gr." note="Mk.ūd.cirk. / kopējais skaits"/>
                    <Inp label="Lietus notekūdeņi" field="tarifLietus" unit="€/m²"/>
                    <Inp label="Apsaimniekošana" field="tarifApsam" unit="€/m²"/>
                    <Inp label="Remontdarbu fonds" field="tarifRem" unit="€/m²"/>
                    <Inp label="Siltummezgls" field="tarifSiltmezgls" unit="€/m²"/>
                    <Inp label="Koplietošanas el." field="koplElTarifs" unit="€/dz." note="Tarifs uz dzīvokli"/>
                  </div>
                </div>

                <div style={{padding:"10px 16px",background:"#FFF9C4",borderTop:"1px solid #e0eaf2",
                  fontSize:11,color:"#7F6000",lineHeight:1.7}}>
                  💡 Dati saglabājas automātiski pārlūkprogrammā. Šos datus izmantos rēķinu aprēķinos.
                </div>
              </div>
            );
          })()}

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
                  {atskaite && (
                    <div style={{marginTop:16,display:"flex",gap:10,alignItems:"center",justifyContent:"space-between"}}>
                      <div className="status st-ok" style={{margin:0,flex:1}}>
                        ✓ {atskaite.apartments.length} dzīvokļi · KŪ kopā: {tKU.toFixed(2)} m³ · AŪ kopā: {tAU.toFixed(2)} m³
                      </div>
                      <button className="btn-next" onClick={()=>setStep(2)}>Tālāk: Siltuma kalkulators →</button>
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
                      val={sKopa || men.kopejaisSiltums} set={setSKopa}
                      unit="MWh" note={sKopa ? "Ievadīts manuāli" : men.kopejaisSiltums ? "No mēneša iestatījumiem" : "Ievadiet mēneša iestatījumos"} color="#1F4E79"/>
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
                  <div style={{margin:"12px 16px",display:"flex",gap:10,alignItems:"center",justifyContent:"space-between"}}>
                    <div className="status st-ok" style={{margin:0,flex:1}}>
                      ✓ Ievadiet <b>{f3(qApk)} MWh</b> alokatoru sistēmā · Cirkulācija: <b>{cirkulEur.toFixed(2)} €</b> · Tarifs uz grupu: <b>{cirkulUzGrupu.toFixed(4)} €/gr.</b>
                    </div>
                    <button className="btn-next" onClick={()=>setStep(3)}>Tālāk: Alokatoru dati →</button>
                  </div>
                )}
                {!siltOk && sk.kopa>0 && (
                  <div style={{margin:"12px 16px"}}>
                    <button className="btn-next" onClick={()=>setStep(3)}>Izlaist → Alokatoru dati</button>
                  </div>
                )}
                <div style={{height:12}}/>
              </div>
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
                  {alokData && (
                    <div style={{marginTop:16,display:"flex",gap:10,alignItems:"center",justifyContent:"space-between"}}>
                      <div className="status st-ok" style={{margin:0,flex:1}}>
                        ✓ {alokData.length} dzīvokļi · PVN dati ielādēti
                      </div>
                      <button className="btn-next" onClick={()=>setStep(4)}>Tālāk: Ģenerēt →</button>
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
                        <th>Dz.</th><th>Īrnieks</th><th>Alok. vien.</th>
                        <th>Cena/m² ar PVN</th><th>Maksa platībai</th>
                        <th>Cena/vien. ar PVN</th><th>Maksa vienībām</th>
                        <th>Kopsumma €</th>
                      </tr></thead>
                      <tbody>
                        {merged.map(a=>(
                          <tr key={a.dz}>
                            <td className="cdz">{a.dz}</td>
                            <td>{a.irnieks}</td>
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
            </>
          )}

          {/* ══════ SOLIS 4: Ģenerēt ══════ */}
          {step===4 && (
            <>
              {/* ── Bilances pārbaude ── */}
              {atskaite && alokData && (() => {
                const rijasUdens  = parseFloat(men.rijasUdens) || 0;
                const riasSiltums = parseFloat(men.siltums)    || 0;
                const tarifKU     = parseFloat(men.tarifKU)    || 0;
                const tarifAU     = parseFloat(men.tarifAU)    || 0;
                const tarifLietus = parseFloat(men.tarifLietus)|| 0;
                const kuM3b = tKU;

                // G26 = Σ ROUND(auKopa × tarifAU, 2)
                const auKopaSumma  = merged.reduce((s,a) => s + Math.round(a.auKopa * tarifAU * 100)/100, 0);
                // H26 = Σ ROUND(kuKopa × tarifKU, 2)
                const kuKopaSumma  = merged.reduce((s,a) => s + Math.round(a.kuKopa * tarifKU * 100)/100, 0);
                // KŪ × AŪ tarifs = aukstā ūdens daļa no KŪ
                const kuAuDala     = merged.reduce((s,a) => s + Math.round(a.kuKopa * tarifAU * 100)/100, 0);
                // J26 = ROUND(tarifLietus/12, 2) × dzīvokļu skaits
                const lietusSumma  = Math.round(tarifLietus / 12 * 100) / 100 * merged.length;
                // Cirkulācija = Σ ROUND(cirkulGrupas × cirkulUzGrupu, 2)
                // cirkulUzGrupu aprēķināts no siltuma kalkulatora: Qcirk × T / dzSk
                const effCirkulTarif = parseFloat(men.tarifCirk) || cirkulUzGrupu;
                const cirkulSumma  = merged.reduce((s,a) => {
                  const grupas = parseFloat(config[a.dz]?.cirkulGrupas) || 0;
                  return s + Math.round(grupas * effCirkulTarif * 100) / 100;
                }, 0);
                const apkM2Summa   = merged.reduce((s,a) => s + a.maksPlatibaiArPVN, 0);
                const apkAlokSumma = merged.reduce((s,a) => s + a.maksVienibamArPVN, 0);

                // Rīgas Ūdens = (AŪ + KŪ) × AŪ_tarifs + Lietus
                const udensPaterinsh = tAU + tKU;  // kopējais ūdens patēriņš m³
                const aprUdens = Math.round(udensPaterinsh * tarifAU * 100) / 100 + lietusSumma;
                // Rīgas Siltums = Cirkulācija + (KŪ_kopsumma − KŪ_m³×AŪ_tarifs) + ApkM2 + ApkAlok
                const aprSiltums = cirkulSumma + (kuKopaSumma - kuAuDala) + apkM2Summa + apkAlokSumma;

                // Koriģētais KŪ tarifs no Rīgas Siltums:
                // riasSiltums = cirkulSumma + (kuM3b×t − kuAuDala) + apkM2 + apkAlok
                // t = (riasSiltums − cirkulSumma + kuAuDala − apkM2 − apkAlok) / kuM3b
                const tarifKUkor = kuM3b > 0
                  ? (riasSiltums - cirkulSumma + kuAuDala - apkM2Summa - apkAlokSumma) / kuM3b
                  : tarifKU;
                const aprUdensKor   = aprUdens; // nemainās — nav atkarīgs no KŪ tarifa
                const kuKopaSummaKor = Math.round(kuM3b * tarifKUkor * 100) / 100;
                const aprSiltumsKor = cirkulSumma + (kuKopaSummaKor - kuAuDala) + apkM2Summa + apkAlokSumma;
                const udensNesakrit  = rijasUdens  - aprUdens;
                const siltumNesakrit = riasSiltums - aprSiltums;
                const hasData  = rijasUdens > 0 && riasSiltums > 0;
                const balansOk = hasData && Math.abs(udensNesakrit) < 0.02 && Math.abs(siltumNesakrit) < 0.02;
                const mesVards = men.menesisVards || men.menesisCipars || "—";
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
                        <button onClick={() => updateMen("tarifKU", tarifKUkor.toFixed(4))}
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
                          <td style={tdStyle(hasData?(Math.abs(udensNesakrit)<0.02?"#375623":"#B71C1C"):"#aab8c5", true)}>
                            {hasData?fmt(udensNesakrit)+" €":"—"}
                          </td>
                        </tr>
                        <tr>
                          <td style={{padding:"10px 16px",fontSize:13,fontWeight:500,
                            borderBottom:"0.5px solid #f0f4f8"}}>Rīgas Siltums</td>
                          <td style={tdStyle("#1F4E79")}>{riasSiltums>0?riasSiltums.toFixed(2)+" €":"—"}</td>
                          <td style={tdStyle("#1F4E79")}>{hasData?aprSiltums.toFixed(2)+" €":"—"}</td>
                          <td style={tdStyle(hasData?(Math.abs(siltumNesakrit)<0.02?"#375623":"#B71C1C"):"#aab8c5", true)}>
                            {hasData?fmt(siltumNesakrit)+" €":"—"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    {hasData && (
                      <div style={{padding:"10px 16px",background:"#f7fafd",borderTop:"1px solid #e0eaf2",
                        fontSize:11,color:"#5a7a90",fontFamily:"DM Mono,monospace",lineHeight:1.9}}>
                        <div style={{fontWeight:700,marginBottom:4,color:"#1F4E79"}}>Aprēķina sadalījums:</div>
                        <div>Rīgas Ūdens = (AŪ + KŪ) × AŪ tarifs + Lietus</div>
                        <div style={{paddingLeft:16}}>
                          = ({tAU.toFixed(3)} + {tKU.toFixed(3)}) × {tarifAU} + {lietusSumma.toFixed(2)} = <b style={{color:"#1F4E79"}}>{aprUdens.toFixed(2)} €</b>
                        </div>
                        <div style={{marginTop:4}}>Rīgas Siltums = Cirkulācija + (KŪ kopsumma − KŪ×AŪ tarifs) + Apkure m² + Apkure alok.</div>
                        <div style={{paddingLeft:16}}>
                          = {cirkulSumma.toFixed(2)} + ({kuKopaSumma.toFixed(2)} − {kuAuDala.toFixed(2)}) + {apkM2Summa.toFixed(2)} + {apkAlokSumma.toFixed(2)} = <b style={{color:"#1F4E79"}}>{aprSiltums.toFixed(2)} €</b>
                        </div>
                        {!balansOk && riasSiltums > 0 && (
                          <div style={{marginTop:4,color:"#7F6000"}}>
                            Koriģēts KŪ tarifs: {tarifKUkor.toFixed(4)} €/m³ → Rīgas Siltums = <b>{aprSiltumsKor.toFixed(2)} €</b>
                          </div>
                        )}
                        <div style={{marginTop:4,color:"#aab8c5"}}>
                          AŪ tarifs: {tarifAU} €/m³ · KŪ tarifs: {tarifKU} €/m³ · KŪ m³: {tKU.toFixed(3)} · AŪ m³: {tAU.toFixed(3)} · Cirk: {cirkulSumma.toFixed(2)} €
                        </div>
                        <div style={{marginTop:4,color:"#aab8c5"}}>
                          KŪ pa dzīvokļiem: {merged.map(a=>`${a.dz}:${a.kuKopa.toFixed(3)}`).join(" · ")}
                        </div>
                      </div>
                    )}
                    {balansOk && (
                      <div style={{padding:"10px 16px",background:"#E2EFDA",fontSize:12,
                        color:"#375623",fontWeight:500,borderTop:"0.5px solid #e0eaf2"}}>
                        ✓ Bilances sakrīt. KŪ tarifs: {tarifKU} €/m³
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Konfigurācija */}
              <div className="card">
                <div className="card-hdr">
                  <div>
                    <div className="card-title">Dzīvokļu konfigurācija</div>
                    <div className="card-meta">Personas un e-pasts — nemainās katru mēnesi</div>
                  </div>
                  <button className={`btn-save${dirty?" dirty":""}`} onClick={handleSave}>
                    {saved?"✅ Saglabāts!":dirty?"💾 Saglabāt":"✓ Aktuāls"}
                  </button>
                </div>
                {Object.keys(config).length===0
                  ? <div className="empty-st">Vispirms ielādējiet F1 1. solī</div>
                  : <div className="card-body" style={{paddingTop:0}}>
                      <table className="cfg-tbl">
                        <thead><tr>
                          <th>Dz.Nr.</th><th>Īpašnieks</th>
                          <th style={{color:"#7F6000"}}>Personas</th>
                          <th style={{color:"#1F4E79"}}>Cirk. grupas</th>
                          <th>E-pasts</th>
                        </tr></thead>
                        <tbody>
                          {Object.entries(config).map(([dz,c])=>{
                            const apt=atskaite?.apartments.find(a=>a.dz===dz);
                            return (<tr key={dz}>
                              <td style={{fontFamily:"DM Mono,monospace",fontWeight:700,color:"#1F4E79"}}>{dz}</td>
                              <td style={{color:"#5a7a90",fontSize:11}}>{apt?.owner||"—"}</td>
                              <td><input className="ci" type="number" min="0" value={c.personas??""} placeholder="0" onChange={e=>updateCfg(dz,"personas",e.target.value)}/></td>
                              <td><input className="ci" type="number" min="0" step="0.5" value={c.cirkulGrupas??""} placeholder="0" onChange={e=>updateCfg(dz,"cirkulGrupas",e.target.value)}/></td>
                              <td><input className="ci em" type="email" value={c.epasts||""} placeholder="epasts@piemers.lv" onChange={e=>updateCfg(dz,"epasts",e.target.value)}/></td>
                            </tr>);
                          })}
                        </tbody>
                      </table>
                    </div>
                }
              </div>

              {/* Ģenerēšana */}
              <div className="card">
                <div className="card-hdr">
                  <div>
                    <div className="card-title">4. solis — Ģenerēt iedzivotaji.xlsx</div>
                    <div className="card-meta">
                      {atskaite&&alokData?"Abi faili gatavi — var ģenerēt":"Nepieciešami abi faili (1. un 3. solis)"}
                    </div>
                  </div>
                  {atskaite&&alokData && <button className="btn-dl" onClick={handleGenerate}>↓ Lejupielādēt</button>}
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

                  <div style={{fontSize:12,color:"#5a7a90",marginBottom:8}}>
                    Ģenerētais fails saturēs 4 lapas: <b>Skaitītāju rādījumi · Alokatoru aprēķins · Skaitītāju reģistrs · Dzīvokļu konfigurācija</b>
                  </div>

                  <button className="btn-primary" disabled={!atskaite||!alokData} onClick={handleGenerate}>
                    <span style={{fontSize:18}}>⚡</span>
                    {atskaite ? `Ģenerēt DZIB_Kopsavilkums_${(atskaite.period.trim().split("-")[0]||"YYYY")}_${(atskaite.period.trim().split("-")[1]||"MM").padStart(2,"0")}.xlsx` : "Ģenerēt DZIB_Kopsavilkums_YYYY_MM.xlsx"}
                  </button>
                  {done && <div className="status st-ok">✅ Fails lejupielādēts! · {merged.length} dzīvokļi · {atskaite?.period}</div>}
                  {(!atskaite||!alokData) && (
                    <div className="status st-warn">
                      ⚠ {!atskaite?"Nepieciešams Fails 1 (1. solis)":""}{!atskaite&&!alokData?" un ":""}{!alokData?"Nepieciešams Fails 2 (3. solis)":""}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  );
}
