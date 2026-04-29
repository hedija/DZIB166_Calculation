import { describe, it, expect } from 'vitest';
import { numVardiem, renderFnText, mergeData, calcAptBill } from './calc.js';

// ─── numVardiem ───────────────────────────────────────────────────────────────

describe('numVardiem', () => {
  describe('veseli eiro, bez centiem', () => {
    it('nulle', () => expect(numVardiem(0)).toBe('Nulle eiro 00 centu'));
    it('1',     () => expect(numVardiem(1)).toBe('Viens eiro 00 centu'));
    it('2',     () => expect(numVardiem(2)).toBe('Divi eiro 00 centu'));
    it('3',     () => expect(numVardiem(3)).toBe('Trīs eiro 00 centu'));
    it('9',     () => expect(numVardiem(9)).toBe('Deviņi eiro 00 centu'));
    it('10',    () => expect(numVardiem(10)).toBe('Desmit eiro 00 centu'));
    it('11',    () => expect(numVardiem(11)).toBe('Vienpadsmit eiro 00 centu'));
    it('12',    () => expect(numVardiem(12)).toBe('Divpadsmit eiro 00 centu'));
    it('19',    () => expect(numVardiem(19)).toBe('Deviņpadsmit eiro 00 centu'));
    it('20',    () => expect(numVardiem(20)).toBe('Divdesmit eiro 00 centu'));
    it('21',    () => expect(numVardiem(21)).toBe('Divdesmit viens eiro 00 centu'));
    it('99',    () => expect(numVardiem(99)).toBe('Deviņdesmit deviņi eiro 00 centu'));
    it('100',   () => expect(numVardiem(100)).toBe('Simts eiro 00 centu'));
    it('200',   () => expect(numVardiem(200)).toBe('Divi simti eiro 00 centu'));
    it('101',   () => expect(numVardiem(101)).toBe('Simts viens eiro 00 centu'));
    it('999',   () => expect(numVardiem(999)).toBe('Deviņi simti deviņdesmit deviņi eiro 00 centu'));
    it('1000',  () => expect(numVardiem(1000)).toBe('Tūkstotis eiro 00 centu'));
    it('2000',  () => expect(numVardiem(2000)).toBe('Divi tūkstoši eiro 00 centu'));
    it('1001',  () => expect(numVardiem(1001)).toBe('Tūkstotis viens eiro 00 centu'));
    it('1234',  () => expect(numVardiem(1234)).toBe('Tūkstotis divi simti trīsdesmit četri eiro 00 centu'));
  });

  describe('centi', () => {
    it('1.50',  () => expect(numVardiem(1.50)).toBe('Viens eiro 50 centi'));
    it('0.01',  () => expect(numVardiem(0.01)).toBe('Nulle eiro 01 centi'));
    it('0.99',  () => expect(numVardiem(0.99)).toBe('Nulle eiro 99 centi'));
    it('5.05',  () => expect(numVardiem(5.05)).toBe('Pieci eiro 05 centi'));
    it('12.34', () => expect(numVardiem(12.34)).toBe('Divpadsmit eiro 34 centi'));
  });

  describe('noapaļošana', () => {
    it('noapaļo 1.999 → 2.00', () => expect(numVardiem(1.999)).toBe('Divi eiro 00 centu'));
    it('noapaļo 0.004 → 0.00', () => expect(numVardiem(0.004)).toBe('Nulle eiro 00 centu'));
    it('noapaļo 0.005 → 0.01', () => expect(numVardiem(0.005)).toBe('Nulle eiro 01 centi'));
  });
});

// ─── renderFnText ─────────────────────────────────────────────────────────────

describe('renderFnText', () => {
  it('aizstāj zināmu placeholderi', () =>
    expect(renderFnText('Atkritumi {{rAtk}} EUR', { rAtk: '9.36' })).toBe('Atkritumi 9.36 EUR'));

  it('atstāj nezināmu placeholderi nemainītu', () =>
    expect(renderFnText('{{unknown}}', {})).toBe('{{unknown}}'));

  it('aizstāj vairākus placeholderus', () =>
    expect(renderFnText('{{a}} un {{b}}', { a: '1', b: '2' })).toBe('1 un 2'));

  it('teksts bez placeholderiem', () =>
    expect(renderFnText('vienkāršs teksts', {})).toBe('vienkāršs teksts'));

  it('aizstāj tukšu vērtību', () =>
    expect(renderFnText('{{val}}', { val: '' })).toBe(''));
});

// ─── mergeData ────────────────────────────────────────────────────────────────

describe('mergeData', () => {
  const atskaite = {
    period: '2025.03',
    apartments: [
      { dz: '1', owner: 'Jānis Bērziņš', coldMeters: [], hotMeters: [], auKopa: 2.5, kuKopa: 1.0 },
      { dz: '2', owner: '',               coldMeters: [], hotMeters: [], auKopa: 0,   kuKopa: 0   },
    ],
  };
  const alokData = [
    { dz: '1', cenaM2: 1.50, platiba: 45, cenaVieniba: 3.00, alokVienibas: 10, pvnLikme: 21, irnieks: 'Pēteris', ligums: 'L-001' },
  ];
  const config = {
    '1': { area: 50, heatedArea: 45, residents: 2, email: 'test@test.lv', circGroup: 2 },
    '2': { area: 30, heatedArea: 28, residents: 1, email: '' },
  };

  it('pielieto PVN cenai par m²', () => {
    const r = mergeData(atskaite, alokData, config);
    expect(r[0].cenaM2ArPVN).toBeCloseTo(1.50 * 1.21);
  });

  it('pielieto PVN vienības cenai', () => {
    const r = mergeData(atskaite, alokData, config);
    expect(r[0].cenaVienArPVN).toBeCloseTo(3.00 * 1.21);
  });

  it('aprēķina maksPlatibaiArPVN', () => {
    const r = mergeData(atskaite, alokData, config);
    expect(r[0].maksPlatibaiArPVN).toBeCloseTo(1.50 * 45 * 1.21);
  });

  it('aprēķina maksVienibamArPVN', () => {
    const r = mergeData(atskaite, alokData, config);
    expect(r[0].maksVienibamArPVN).toBeCloseTo(3.00 * 10 * 1.21);
  });

  it('aprēķina kopsummu kā maksPlatibai + maksVienibam', () => {
    const r = mergeData(atskaite, alokData, config);
    expect(r[0].kopsumma).toBeCloseTo(1.50 * 45 * 1.21 + 3.00 * 10 * 1.21);
  });

  it('izmanto alokatoru platību, ja nav cfg.heatedArea', () => {
    const r = mergeData(atskaite, alokData, config);
    expect(r[0].heatedArea).toBe(45);
  });

  it('rezerves uz cfg.heatedArea, ja alokatoros nav platības', () => {
    const alokBezPlatibas = [{ dz: '1', cenaM2: 1.5, cenaVieniba: 3, alokVienibas: 10, pvnLikme: 0 }];
    const r = mergeData(atskaite, alokBezPlatibas, config);
    expect(r[0].heatedArea).toBe(45); // config['1'].heatedArea
  });

  it('rezerves uz cfg.area, ja nav ne platibas, ne heatedArea', () => {
    const alokBezPlatibas = [{ dz: '1', cenaM2: 1.5, cenaVieniba: 3, alokVienibas: 10, pvnLikme: 0 }];
    const cfgBezHeatedArea = { ...config, '1': { area: 50, residents: 2, email: '' } };
    const r = mergeData(atskaite, alokBezPlatibas, cfgBezHeatedArea);
    expect(r[0].heatedArea).toBe(50); // cfg.area
  });

  it('saglabā skaitītāju rādījumus', () => {
    const r = mergeData(atskaite, alokData, config);
    expect(r[0].auKopa).toBe(2.5);
    expect(r[0].kuKopa).toBe(1.0);
  });

  it('dzīvoklis bez alokatoru datiem — nulles vērtības', () => {
    const r = mergeData(atskaite, alokData, config);
    expect(r[1].cenaM2ArPVN).toBe(0);
    expect(r[1].maksPlatibaiArPVN).toBe(0);
    expect(r[1].kopsumma).toBe(0);
  });

  it('izmanto cfg.owner, ja tas aizstāj atskaites owner', () => {
    const cfgWithOwner = { ...config, '2': { ...config['2'], owner: 'Ilze Kalniņa' } };
    const r = mergeData(atskaite, alokData, cfgWithOwner);
    expect(r[1].owner).toBe('Ilze Kalniņa');
  });
});

// ─── calcAptBill ─────────────────────────────────────────────────────────────

describe('calcAptBill', () => {
  const apt = {
    auKopa: 2.5,
    kuKopa: 1.0,
    area: 50,
    residents: 2,
    maksPlatibaiArPVN: 81.675,  // 1.5 × 45 × 1.21
    maksVienibamArPVN: 36.30,   // 3.0 × 10 × 1.21
  };
  const tariffs = {
    tAU: 0.89,
    tKU: 2.15,
    tApsam: 0.30,
    tRem: 0.10,
    tSiltmez: 0.05,
    cirkulTarif: 3.21,
    lietusMen: 2.00,
    tKoplEl: 5.00,
  };
  const cfg = { circGroup: 2 };
  const atkritumiPerPers = 4.6844;

  it('rAU = round(auKopa × tAU, 2)', () => {
    const { rAU } = calcAptBill(apt, tariffs, atkritumiPerPers, cfg);
    expect(rAU).toBe(Math.round(2.5 * 0.89 * 100) / 100);
  });

  it('rKU = round(kuKopa × tKU, 2)', () => {
    const { rKU } = calcAptBill(apt, tariffs, atkritumiPerPers, cfg);
    expect(rKU).toBe(Math.round(1.0 * 2.15 * 100) / 100);
  });

  it('rCirk = round(circGroup × cirkulTarif, 2)', () => {
    const { rCirk } = calcAptBill(apt, tariffs, atkritumiPerPers, cfg);
    expect(rCirk).toBe(Math.round(2 * 3.21 * 100) / 100);
  });

  it('rLietus = lietusMen (1 dz.)', () => {
    const { rLietus } = calcAptBill(apt, tariffs, atkritumiPerPers, cfg);
    expect(rLietus).toBe(2.00);
  });

  it('rAtk = round(atkritumiPerPers × residents, 2)', () => {
    const { rAtk } = calcAptBill(apt, tariffs, atkritumiPerPers, cfg);
    expect(rAtk).toBe(Math.round(4.6844 * 2 * 100) / 100);
  });

  it('rKoplEl = tKoplEl (nemainīgs uz dz.)', () => {
    const { rKoplEl } = calcAptBill(apt, tariffs, atkritumiPerPers, cfg);
    expect(rKoplEl).toBe(5.00);
  });

  it('rApsam = round(area × tApsam, 2)', () => {
    const { rApsam } = calcAptBill(apt, tariffs, atkritumiPerPers, cfg);
    expect(rApsam).toBe(Math.round(50 * 0.30 * 100) / 100);
  });

  it('rRem = round(area × tRem, 2)', () => {
    const { rRem } = calcAptBill(apt, tariffs, atkritumiPerPers, cfg);
    expect(rRem).toBe(Math.round(50 * 0.10 * 100) / 100);
  });

  it('rSiltmez = round(area × tSiltmez, 2)', () => {
    const { rSiltmez } = calcAptBill(apt, tariffs, atkritumiPerPers, cfg);
    expect(rSiltmez).toBe(Math.round(50 * 0.05 * 100) / 100);
  });

  it('apkure nav iekļauta pēc noklusējuma (rApkM2=0, rApkAlok=0)', () => {
    const { rApkM2, rApkAlok } = calcAptBill(apt, tariffs, atkritumiPerPers, cfg);
    expect(rApkM2).toBe(0);
    expect(rApkAlok).toBe(0);
  });

  it('apkure tiek iekļauta, ja heatingIncluded=true', () => {
    const { rApkM2, rApkAlok } = calcAptBill(apt, tariffs, atkritumiPerPers, cfg, true);
    expect(rApkM2).toBe(Math.round(81.675 * 100) / 100);
    expect(rApkAlok).toBe(Math.round(36.30 * 100) / 100);
  });

  it('circGroup=0 → rCirk=0', () => {
    const { rCirk } = calcAptBill(apt, tariffs, atkritumiPerPers, { circGroup: 0 });
    expect(rCirk).toBe(0);
  });

  it('residents=0 → rAtk=0', () => {
    const { rAtk } = calcAptBill({ ...apt, residents: 0 }, tariffs, atkritumiPerPers, cfg);
    expect(rAtk).toBe(0);
  });

  it('visi nulle tarifi + nulle alokatoru summas → visi nulle maksājumi', () => {
    const zeroTariffs = { tAU:0, tKU:0, tApsam:0, tRem:0, tSiltmez:0, cirkulTarif:0, lietusMen:0, tKoplEl:0 };
    const aptZeroHeat = { ...apt, maksPlatibaiArPVN: 0, maksVienibamArPVN: 0 };
    const bill = calcAptBill(aptZeroHeat, zeroTariffs, 0, cfg, true);
    expect(Object.values(bill).every(v => v === 0)).toBe(true);
  });
});
