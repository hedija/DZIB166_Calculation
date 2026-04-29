# Detailed Test Report

Generated from `test-report.json` produced by `npx vitest run --reporter=json --outputFile=test-report.json`.

## Summary

- Total test suites: 8
- Passed test suites: 8
- Failed test suites: 0
- Pending test suites: 0
- Total tests: 58
- Passed tests: 58
- Failed tests: 0
- Pending tests: 0
- Todo tests: 0

## Suites and Test Cases

### src/calc.test.js

#### numVardiem › veseli eiro, bez centiem

- ✅ nulle
- ✅ 1
- ✅ 2
- ✅ 3
- ✅ 9
- ✅ 10
- ✅ 11
- ✅ 12
- ✅ 19
- ✅ 20
- ✅ 21
- ✅ 99
- ✅ 100
- ✅ 200
- ✅ 101
- ✅ 999
- ✅ 1000
- ✅ 2000
- ✅ 1001
- ✅ 1234

#### numVardiem › centi

- ✅ 1.50
- ✅ 0.01
- ✅ 0.99
- ✅ 5.05
- ✅ 12.34

#### numVardiem › noapaļošana

- ✅ noapaļo 1.999 → 2.00
- ✅ noapaļo 0.004 → 0.00
- ✅ noapaļo 0.005 → 0.01

#### renderFnText

- ✅ aizstāj zināmu placeholderi
- ✅ atstāj nezināmu placeholderi nemainītu
- ✅ aizstāj vairākus placeholderus
- ✅ teksts bez placeholderiem
- ✅ aizstāj tukšu vērtību

#### mergeData

- ✅ pielieto PVN cenai par m²
- ✅ pielieto PVN vienības cenai
- ✅ aprēķina maksPlatibaiArPVN
- ✅ aprēķina maksVienibamArPVN
- ✅ aprēķina kopsummu kā maksPlatibai + maksVienibam
- ✅ izmanto alokatoru platību, ja nav cfg.heatedArea
- ✅ rezerves uz cfg.heatedArea, ja alokatoros nav platības
- ✅ rezerves uz cfg.area, ja nav ne platibas, ne heatedArea
- ✅ saglabā skaitītāju rādījumus
- ✅ dzīvoklis bez alokatoru datiem — nulles vērtības
- ✅ izmanto cfg.owner, ja tas aizstāj atskaites owner

#### calcAptBill

- ✅ rAU = round(auKopa × tAU, 2)
- ✅ rKU = round(kuKopa × tKU, 2)
- ✅ rCirk = round(circGroup × cirkulTarif, 2)
- ✅ rLietus = lietusMen (1 dz.)
- ✅ rAtk = round(atkritumiPerPers × residents, 2)
- ✅ rKoplEl = tKoplEl (nemainīgs uz dz.)
- ✅ rApsam = round(area × tApsam, 2)
- ✅ rRem = round(area × tRem, 2)
- ✅ rSiltmez = round(area × tSiltmez, 2)
- ✅ apkure nav iekļauta pēc noklusējuma (rApkM2=0, rApkAlok=0)
- ✅ apkure tiek iekļauta, ja heatingIncluded=true
- ✅ circGroup=0 → rCirk=0
- ✅ residents=0 → rAtk=0
- ✅ visi nulle tarifi + nulle alokatoru summas → visi nulle maksājumi

## Notes

- All test cases currently pass.
- The detailed report lists every suite and every test case by name.
- If you want the report in a different format (JSON, JUnit, TAP), I can generate that too.
