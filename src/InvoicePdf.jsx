import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer';

Font.register({ family: 'Roboto', fonts: [
  { src: '/Roboto-Regular.ttf', fontWeight: 'normal', fontStyle: 'normal' },
  { src: '/Roboto-Bold.ttf',    fontWeight: 'bold',   fontStyle: 'normal' },
  { src: '/Roboto-Italic.ttf',  fontWeight: 'normal', fontStyle: 'italic' },
]});

const C  = '#cccccc';
const CB = '#bbbbbb';

const s = StyleSheet.create({
  page: {
    paddingTop: 28, paddingBottom: 28, paddingLeft: 28, paddingRight: 28,
    fontFamily: 'Roboto', fontSize: 7.5, color: '#111111', lineHeight: 1.3,
  },
  // ── Header ──
  hdrRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    borderBottomWidth: 0.5, borderBottomColor: C, borderBottomStyle: 'solid',
    paddingBottom: 4, marginBottom: 5,
  },
  hdrDate: { fontSize: 7.5, color: '#555555' },
  invNr:   { fontSize: 11, fontWeight: 'bold', color: '#000000' },
  // ── Parties ──
  parties: { flexDirection: 'row', marginBottom: 4 },
  partyL:  { flex: 1, paddingRight: 8 },
  partyR:  { flex: 1, paddingLeft: 8, borderLeftWidth: 0.5, borderLeftColor: '#dddddd', borderLeftStyle: 'solid' },
  partyLabel: { fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.4, color: '#333333', marginBottom: 2 },
  partyLine:  { fontSize: 7.5, marginBottom: 1 },
  // ── Period ──
  periodLine: { fontSize: 7.5, marginBottom: 1.5 },
  // ── Table ──
  table: { marginTop: 4, marginBottom: 3 },
  row:   { flexDirection: 'row' },
  th: {
    padding: '2pt 3pt', fontSize: 7, fontWeight: 'bold', backgroundColor: '#efefef',
    borderWidth: 0.5, borderColor: CB, borderStyle: 'solid',
  },
  grpCell: {
    flex: 1, padding: '2pt 3pt', fontSize: 7, fontWeight: 'bold', backgroundColor: '#f8f8f8',
    borderWidth: 0.5, borderColor: C, borderStyle: 'solid',
  },
  td: { padding: '1.5pt 3pt', fontSize: 7.5, borderWidth: 0.5, borderColor: C, borderStyle: 'solid' },
  // Column widths
  colNos: { flex: 1 },
  colMv:  { width: '9%',  textAlign: 'center' },
  colD:   { width: '12%', textAlign: 'right' },
  colC:   { width: '18%', textAlign: 'right' },
  colS:   { width: '16%', textAlign: 'right' },
  // ── Total ──
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    borderTopWidth: 2, borderTopColor: '#000000', borderTopStyle: 'solid',
    borderBottomWidth: 0.5, borderBottomColor: '#000000', borderBottomStyle: 'solid',
    paddingTop: 3, paddingBottom: 3, paddingLeft: 4, paddingRight: 4, marginTop: 2,
  },
  totalLabel: { fontSize: 9, fontWeight: 'bold' },
  totalAmt:   { fontSize: 10, fontWeight: 'bold' },
  // ── Words ──
  words: { fontSize: 7, fontStyle: 'italic', color: '#333333', marginTop: 2, marginBottom: 1, marginLeft: 4 },
  // ── Footnotes ──
  fn: { fontSize: 6.5, color: '#555555', marginTop: 1, lineHeight: 1.3 },
  // ── Footer ──
  footer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 6, borderTopWidth: 0.5, borderTopColor: '#dddddd', borderTopStyle: 'solid', paddingTop: 4,
  },
  sig:  { fontSize: 6.5, color: '#888888', fontStyle: 'italic', flex: 1 },
  logo: { height: 108, width: 'auto' },
});

function InvoicePage({ block, logo }) {
  const {
    dateTxt, invoiceNr, supplier, owner, recipientAddress,
    period1Txt, periodTxt, paymentDue, lines,
    totalEur, wordsText, renderedFootnotes,
  } = block;

  return (
    <Page size="A4" style={s.page}>
      {/* ── Header ── */}
      <View style={s.hdrRow}>
        <Text style={s.hdrDate}>{dateTxt}</Text>
        <Text style={s.invNr}>Rēķins Nr. {invoiceNr}</Text>
      </View>

      {/* ── Parties ── */}
      <View style={s.parties}>
        <View style={s.partyL}>
          <Text style={s.partyLabel}>Piegādātājs:</Text>
          {!!supplier.nos   && <Text style={s.partyLine}>{supplier.nos}</Text>}
          {!!supplier.addr  && <Text style={s.partyLine}>{supplier.addr}</Text>}
          {!!supplier.reg   && <Text style={s.partyLine}>{supplier.reg}</Text>}
          {!!supplier.bank  && <Text style={s.partyLine}>{supplier.bank}</Text>}
          {!!supplier.swift && <Text style={s.partyLine}>{supplier.swift}</Text>}
          {!!supplier.konts && <Text style={s.partyLine}>{supplier.konts}</Text>}
        </View>
        <View style={s.partyR}>
          <Text style={s.partyLabel}>Saņēmējs:</Text>
          <Text style={s.partyLine}>{owner}</Text>
          <Text style={s.partyLine}>{recipientAddress}</Text>
        </View>
      </View>

      {/* ── Period lines ── */}
      <Text style={s.periodLine}>Komunālo pakalpojumu sniegšanas periods: {period1Txt}</Text>
      <Text style={s.periodLine}>Apsaimniekošana, remontdarbu fonds: {periodTxt}</Text>
      <Text style={s.periodLine}>Rēķina apmaksas termiņš: {paymentDue}</Text>

      {/* ── Lines table ── */}
      <View style={s.table}>
        <View style={s.row}>
          <Text style={[s.th, s.colNos]}>Nosaukums</Text>
          <Text style={[s.th, s.colMv, { textAlign: 'center' }]}>Mērvien.</Text>
          <Text style={[s.th, s.colD,  { textAlign: 'right'  }]}>Daudz.</Text>
          <Text style={[s.th, s.colC,  { textAlign: 'right'  }]}>Cena (EUR)</Text>
          <Text style={[s.th, s.colS,  { textAlign: 'right'  }]}>Summa (EUR)</Text>
        </View>
        <View style={s.row}>
          <Text style={s.grpCell}>Komunālie pakalpojumi un apsaimniekošana</Text>
        </View>
        {lines.map((l, i) => (
          <View key={i} style={[s.row, i % 2 !== 0 && { backgroundColor: '#f9f9f9' }]}>
            <Text style={[s.td, s.colNos]}>{l.nos}</Text>
            <Text style={[s.td, s.colMv]}>{l.mv}</Text>
            <Text style={[s.td, s.colD]}>{typeof l.daudz === 'number' ? l.daudz.toFixed(3) : String(l.daudz)}</Text>
            <Text style={[s.td, s.colC]}>{typeof l.cena  === 'number' ? l.cena.toFixed(4)  : String(l.cena)}</Text>
            <Text style={[s.td, s.colS]}>{typeof l.summa === 'number' ? l.summa.toFixed(2) : String(l.summa)}</Text>
          </View>
        ))}
      </View>

      {/* ── Total ── */}
      <View style={s.totalRow}>
        <Text style={s.totalLabel}>Summa samaksai, EUR</Text>
        <Text style={s.totalAmt}>{totalEur.toFixed(2)}</Text>
      </View>

      {/* ── Amount in words ── */}
      <Text style={s.words}>Summa vārdiem: {wordsText}</Text>

      {/* ── Footnotes ── */}
      {renderedFootnotes.map((fn, i) => (
        <Text key={i} style={s.fn}>{fn.marker} {fn.text}</Text>
      ))}

      {/* ── Footer ── */}
      <View style={s.footer}>
        <Text style={s.sig}>Rēķins sagatavots elektroniski un derīgs bez paraksta.</Text>
        {logo && <Image style={s.logo} src={logo} />}
      </View>
    </Page>
  );
}

export function InvoiceDocument({ blocks, logo }) {
  return (
    <Document>
      {blocks.map(block => (
        <InvoicePage key={block.invoiceNr} block={block} logo={logo} />
      ))}
    </Document>
  );
}
