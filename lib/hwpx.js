// 학습지 문서(JSON) -> HWPX(한글 문서) 변환기.
//
// 구조와 요소 순서는 한컴오피스가 실제로 저장한 HWPX 파일(머리 정보, 표, 그림, 수식)을
// 그대로 따릅니다. 수식은 LaTeX를 한글 수식 스크립트로 바꾸고, 상자 크기를 계산해 넣습니다.

import { zipSync, strToU8 } from 'fflate';
import { eqSize, blankWidth, blankHeight, charEm, STUDENT_BLANK_SIZE } from './measure';
import { PAGE, TABLE_GAP } from './compose';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const NS =
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';

// ---------- 머리 정보(글꼴·테두리·글자 모양·문단 모양) ----------
const FONTS = ['함초롬돋움', '함초롬바탕'];
const FONT_ID = { dotum: 0, batang: 1 };

class Header {
  constructor() {
    this.borderFills = [];
    this.bfKeys = new Map();
    this.charPrs = [];
    this.cpKeys = new Map();
    this.paraPrs = [];
    this.ppKeys = new Map();
    // 1: 테두리 없음(쪽 테두리용), 2: 테두리 없음 + 채우기 없음(글자 기본)
    this.borderFill({});
    this.borderFill({ fillNone: true });
    this.charPr({}); // 0: 본문 기본
    this.paraPr({}); // 0: 본문 기본
  }
  borderFill(spec) {
    const key = JSON.stringify(spec);
    if (this.bfKeys.has(key)) return this.bfKeys.get(key);
    const id = this.borderFills.length + 1;
    this.borderFills.push({ id, spec });
    this.bfKeys.set(key, id);
    return id;
  }
  charPr(spec) {
    const s = { size: 1000, color: '#000000', font: 'batang', bold: false, ...spec };
    const key = JSON.stringify(s);
    if (this.cpKeys.has(key)) return this.cpKeys.get(key);
    const id = this.charPrs.length;
    this.charPrs.push({ id, s });
    this.cpKeys.set(key, id);
    return id;
  }
  paraPr(spec) {
    const s = { align: 'JUSTIFY', line: 160, left: 0, indent: 0, prev: 0, next: 0, keepNext: false, ...spec };
    const key = JSON.stringify(s);
    if (this.ppKeys.has(key)) return this.ppKeys.get(key);
    const id = this.paraPrs.length;
    this.paraPrs.push({ id, s });
    this.ppKeys.set(key, id);
    return id;
  }

  xmlBorderFill({ id, spec }) {
    const side = (name, b) =>
      b
        ? `<hh:${name} type="${b.type || 'SOLID'}" width="${b.width || '0.12 mm'}" color="${b.color || '#000000'}"/>`
        : `<hh:${name} type="NONE" width="0.1 mm" color="#000000"/>`;
    let fill = '';
    if (spec.fill) fill = `<hc:fillBrush><hc:winBrush faceColor="${spec.fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>`;
    else if (spec.fillNone) fill = '<hc:fillBrush><hc:winBrush faceColor="none" hatchColor="#999999" alpha="0"/></hc:fillBrush>';
    return (
      `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
      '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' +
      side('leftBorder', spec.left) +
      side('rightBorder', spec.right) +
      side('topBorder', spec.top) +
      side('bottomBorder', spec.bottom) +
      '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>' +
      fill +
      '</hh:borderFill>'
    );
  }
  xmlCharPr({ id, s }) {
    const f = FONT_ID[s.font] ?? 1;
    const seven = (v) => `hangul="${v}" latin="${v}" hanja="${v}" japanese="${v}" other="${v}" symbol="${v}" user="${v}"`;
    return (
      `<hh:charPr id="${id}" height="${s.size}" textColor="${s.color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="${s.border || 2}">` +
      `<hh:fontRef ${seven(f)}/><hh:ratio ${seven(100)}/><hh:spacing ${seven(s.spacing ?? 0)}/><hh:relSz ${seven(100)}/><hh:offset ${seven(0)}/>` +
      (s.bold ? '<hh:bold/>' : '') +
      '<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/>' +
      '</hh:charPr>'
    );
  }
  xmlParaPr({ id, s }) {
    const margin = (k) =>
      `<hh:margin><hc:intent value="${s.indent * k}" unit="HWPUNIT"/><hc:left value="${s.left * k}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="${s.prev * k}" unit="HWPUNIT"/><hc:next value="${s.next * k}" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="${s.line}" unit="HWPUNIT"/>`;
    return (
      `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">` +
      `<hh:align horizontal="${s.align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>` +
      `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="${s.keepNext ? 1 : 0}" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
      '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>' +
      `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin(1)}</hp:case><hp:default>${margin(2)}</hp:default></hp:switch>` +
      '<hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>' +
      '</hh:paraPr>'
    );
  }
  xml() {
    const typeInfo = '<hh:typeInfo familyType="FCAT_GOTHIC" weight="8" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>';
    const langs = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'];
    const fontfaces = langs
      .map(
        (lang) =>
          `<hh:fontface lang="${lang}" fontCnt="${FONTS.length}">` +
          FONTS.map((f, i) => `<hh:font id="${i}" face="${f}" type="TTF" isEmbedded="0">${typeInfo}</hh:font>`).join('') +
          '</hh:fontface>'
      )
      .join('');
    const styleNames = [
      ['바탕글', 'Normal'], ['본문', 'Body'], ['개요 1', 'Outline 1'], ['개요 2', 'Outline 2'], ['개요 3', 'Outline 3'],
      ['개요 4', 'Outline 4'], ['개요 5', 'Outline 5'], ['개요 6', 'Outline 6'], ['개요 7', 'Outline 7'],
    ];
    const styles =
      styleNames
        .map(([n, e], i) => `<hh:style id="${i}" type="PARA" name="${n}" engName="${e}" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="${i}" langID="1042" lockForm="0"/>`)
        .join('') +
      `<hh:style id="9" type="CHAR" name="쪽 번호" engName="Page Number" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/>`;
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hh:head ${NS} version="1.4" secCnt="1">` +
      '<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>' +
      '<hh:refList>' +
      `<hh:fontfaces itemCnt="7">${fontfaces}</hh:fontfaces>` +
      `<hh:borderFills itemCnt="${this.borderFills.length}">${this.borderFills.map((b) => this.xmlBorderFill(b)).join('')}</hh:borderFills>` +
      `<hh:charProperties itemCnt="${this.charPrs.length}">${this.charPrs.map((c) => this.xmlCharPr(c)).join('')}</hh:charProperties>` +
      '<hh:tabProperties itemCnt="2"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/><hh:tabPr id="1" autoTabLeft="1" autoTabRight="0"/></hh:tabProperties>' +
      '<hh:numberings itemCnt="1"><hh:numbering id="1" start="0">' +
      [['1', 'DIGIT', '^1.'], ['2', 'HANGUL_SYLLABLE', '^2.'], ['3', 'DIGIT', '^3)'], ['4', 'HANGUL_SYLLABLE', '^4)'], ['5', 'DIGIT', '(^5)'], ['6', 'HANGUL_SYLLABLE', '(^6)'], ['7', 'CIRCLED_DIGIT', '^7']]
        .map(([lv, fmt, txt]) => `<hh:paraHead start="1" level="${lv}" align="LEFT" useInstWidth="1" autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="${fmt}" charPrIDRef="4294967295" checkable="${lv === '7' ? 1 : 0}">${txt}</hh:paraHead>`)
        .join('') +
      '</hh:numbering></hh:numberings>' +
      `<hh:paraProperties itemCnt="${this.paraPrs.length}">${this.paraPrs.map((p) => this.xmlParaPr(p)).join('')}</hh:paraProperties>` +
      `<hh:styles itemCnt="10">${styles}</hh:styles>` +
      '</hh:refList>' +
      '<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>' +
      '<hh:docOption><hh:linkinfo path="" pageInherit="1" footnoteInherit="0"/></hh:docOption>' +
      '<hh:trackchageConfig flags="56"/>' +
      '</hh:head>'
    );
  }
}

// ---------- 본문 조립 ----------
class Writer {
  constructor(mode, images, theme) {
    this.h = new Header();
    this.teacher = mode === 'teacher';
    this.images = images || {};
    this.th = theme;
    this.bin = [];
    this.binById = new Map();
    this.objId = 1900000000;
    this.z = 0;
  }
  nextId() {
    this.objId += 7;
    return this.objId;
  }
  cp(o) {
    return this.h.charPr(o);
  }
  bf(fill, b) {
    const side = (x) => (x ? { color: x.color, width: x.width, type: x.type } : null);
    return this.h.borderFill({ left: side(b?.l), right: side(b?.r), top: side(b?.t), bottom: side(b?.b), fill: fill || undefined, fillNone: fill ? undefined : true });
  }

  run(text, style) {
    if (!text) return '';
    return `<hp:run charPrIDRef="${this.cp(style)}"><hp:t>${esc(text)}</hp:t></hp:run>`;
  }
  objRun(xml, style) {
    return `<hp:run charPrIDRef="${this.cp(style)}">${xml}<hp:t/></hp:run>`;
  }

  equation(latex, size, color, tick) {
    const e = eqSize(latex, size);
    if (!e.script) return '';
    const script = tick ? `${e.script}\`` : e.script;
    const id = this.nextId();
    return (
      `<hp:equation id="${id}" zOrder="${this.z++}" numberingType="EQUATION" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" version="Equation Version 60" baseLine="${e.baseLine}" textColor="${color}" baseUnit="${size}" lineMode="CHAR" font="HYhwpEQ">` +
      `<hp:sz width="${e.width - 112}" widthRelTo="ABSOLUTE" height="${e.height}" heightRelTo="ABSOLUTE" protect="0"/>` +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="56" right="56" top="0" bottom="0"/>' +
      '<hp:shapeComment>수식입니다.</hp:shapeComment>' +
      `<hp:script>${esc(script)}</hp:script>` +
      '</hp:equation>'
    );
  }

  picture(id, w, h) {
    const img = this.images[id];
    if (!img || !img.bytes) return '';
    let binId = this.binById.get(id);
    if (!binId) {
      binId = `image${this.bin.length + 1}`;
      this.bin.push({ id: binId, name: `${binId}.${img.ext}`, bytes: img.bytes, ext: img.ext });
      this.binById.set(id, binId);
    }
    const oid = this.nextId();
    const dimW = img.w * 75;
    const dimH = img.h * 75;
    const ident = 'e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"';
    return (
      `<hp:pic id="${oid}" zOrder="${this.z++}" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${oid}" reverse="0">` +
      `<hp:offset x="0" y="0"/><hp:orgSz width="${w}" height="${h}"/><hp:curSz width="${w}" height="${h}"/><hp:flip horizontal="0" vertical="0"/>` +
      `<hp:rotationInfo angle="0" centerX="${Math.round(w / 2)}" centerY="${Math.round(h / 2)}" rotateimage="1"/>` +
      `<hp:renderingInfo><hc:transMatrix ${ident}/><hc:scaMatrix ${ident}/><hc:rotMatrix ${ident}/></hp:renderingInfo>` +
      `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect>` +
      `<hp:imgClip left="0" right="${dimW}" top="0" bottom="${dimH}"/>` +
      '<hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      `<hp:imgDim dimwidth="${dimW}" dimheight="${dimH}"/>` +
      `<hc:img binaryItemIDRef="${binId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
      '<hp:effects/>' +
      `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>` +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:shapeComment>교과서 그림</hp:shapeComment>' +
      '</hp:pic>'
    );
  }

  // 빈칸: 학생용은 테두리 친 공백, 교사용은 정답(수식이면 1칸 표)
  blank(n, size, p) {
    const bf = this.h.borderFill({ left: { color: '#4A4A4A', width: '0.12 mm' }, right: { color: '#4A4A4A', width: '0.12 mm' }, top: { color: '#4A4A4A', width: '0.12 mm' }, bottom: { color: '#4A4A4A', width: '0.12 mm' }, fill: '#FFFFFF' });
    const w = blankWidth(n, size, { teacher: this.teacher });
    const hasMath = (n.ans || []).some((a) => a.t === 'math');
    const red = this.th.answer;
    const sp = this.run(' ', { size, color: p.color, font: p.font });
    if (this.teacher && hasMath) {
      const h = blankHeight(n, size, { teacher: true });
      const inner = n.ans
        .map((a) => (a.t === 'math' ? this.objRun(this.equation(a.v, size, red), { size, color: red }) : this.run(a.v, { size, color: red, bold: true, font: p.font })))
        .join('');
      const cellXml =
        `<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${bf}">` +
        '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' +
        `<hp:p id="0" paraPrIDRef="${this.h.paraPr({ align: 'CENTER', line: 100 })}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${inner}</hp:p>` +
        '</hp:subList>' +
        `<hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${w}" height="${h}"/><hp:cellMargin left="56" right="56" top="28" bottom="28"/></hp:tc>`;
      const tid = this.nextId();
      const tbl =
        `<hp:tbl id="${tid}" zOrder="${this.z++}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="NONE" repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="${bf}" noAdjust="0">` +
        `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>` +
        '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="40" right="40" top="0" bottom="0"/>' +
        '<hp:inMargin left="56" right="56" top="28" bottom="28"/>' +
        `<hp:tr>${cellXml}</hp:tr></hp:tbl>`;
      return sp + this.objRun(tbl, { size }) + sp;
    }
    const em = (t) => [...t].reduce((a, ch) => a + charEm(ch), 0);
    if (this.teacher) {
      const t = (n.ans || []).map((a) => a.v).join('').trim();
      const padEm = Math.max(0.3, (w / size - em(t) * 1.04) / 2);
      const pad = ' '.repeat(Math.max(1, Math.round(padEm / 0.3)));
      return sp + this.run(`${pad}${t}${pad}`, { size, color: red, bold: true, font: p.font, border: bf }) + sp;
    }
    // 학생용: 글자 크기를 키운 전각 공백에 테두리 → 더 높고 넓은 빈칸
    const bs = Math.round(size * STUDENT_BLANK_SIZE);
    const k = Math.max(2, Math.round(w / bs));
    return sp + this.run('　'.repeat(k), { size: bs, color: p.color, font: p.font, border: bf }) + sp;
  }

  runs(p) {
    const out = [];
    for (const n of p.nodes) {
      const size = n.size || p.size;
      const color = n.color || p.color;
      const font = n.font || p.font;
      if (n.t === 'text' || n.t === 'hint') out.push(this.run(n.v, { size, color, bold: !!(n.b || p.bold), font }));
      else if (n.t === 'math') out.push(this.objRun(this.equation(n.v, size, color, n.tick), { size, color, font }));
      else if (n.t === 'blank') out.push(this.blank(n, size, p));
      else if (n.t === 'img') out.push(this.objRun(this.picture(n.id, n.w, n.h), { size: 100, font }));
      else if (n.t === 'tbl') out.push(this.objRun(this.table(n.table, true), { size: 100, font }));
      else if (n.t === 'gap') out.push(this.run(' '.repeat(Math.max(1, Math.round((n.w || size) / (size * 0.3)))), { size, color, font }));
    }
    return out.join('');
  }

  para(p, { pageBreak = false, pre = '' } = {}) {
    const pp = this.h.paraPr({ align: p.align, line: p.line, left: p.left || 0, indent: p.indent || 0, prev: p.prev || 0, next: p.next || 0 });
    let body = this.runs(p);
    if (pre) body = pre + body;
    if (!body) body = `<hp:run charPrIDRef="${this.cp({ size: p.size, color: p.color, font: p.font })}"/>`;
    return `<hp:p id="0" paraPrIDRef="${pp}" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">${body}</hp:p>`;
  }

  table(t, inline = true) {
    const { widths, rows } = t;
    const occupied = [];
    const rowH = rows.map((r) => Math.round(r.h ?? r.h0 ?? r.minH ?? 600));
    const trs = rows.map((r, ri) => {
      occupied[ri] = occupied[ri] || [];
      let c = 0;
      const tcs = r.cells.map((cell) => {
        while (occupied[ri][c]) c++;
        const cs = cell.cs || 1;
        const rs = cell.rs || 1;
        for (let rr = ri; rr < ri + rs; rr++) {
          occupied[rr] = occupied[rr] || [];
          for (let cc = c; cc < c + cs; cc++) occupied[rr][cc] = true;
        }
        const w = widths.slice(c, c + cs).reduce((a, b) => a + b, 0);
        const h = rowH.slice(ri, ri + rs).reduce((a, b) => a + b, 0);
        const [ml, mr, mt, mb] = cell.m;
        const paras = cell.paras.length ? cell.paras.map((p) => this.para(p)).join('') : `<hp:p id="0" paraPrIDRef="${this.h.paraPr({ align: 'LEFT', line: 100 })}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${this.cp({ size: 100 })}"/></hp:p>`;
        const xml =
          `<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${this.bf(cell.fill, cell.b)}">` +
          `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${cell.v || 'TOP'}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
          paras +
          '</hp:subList>' +
          `<hp:cellAddr colAddr="${c}" rowAddr="${ri}"/><hp:cellSpan colSpan="${cs}" rowSpan="${rs}"/>` +
          `<hp:cellSz width="${w}" height="${h}"/><hp:cellMargin left="${ml}" right="${mr}" top="${mt}" bottom="${mb}"/>` +
          '</hp:tc>';
        c += cs;
        return xml;
      });
      return `<hp:tr>${tcs.join('')}</hp:tr>`;
    });
    const width = widths.reduce((a, b) => a + b, 0);
    const height = rowH.reduce((a, b) => a + b, 0);
    const id = this.nextId();
    return (
      `<hp:tbl id="${id}" zOrder="${this.z++}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="NONE" repeatHeader="0" rowCnt="${rows.length}" colCnt="${widths.length}" cellSpacing="0" borderFillIDRef="${this.bf(null, null)}" noAdjust="0">` +
      `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
      `<hp:pos treatAsChar="${inline ? 1 : 0}" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      trs.join('') +
      '</hp:tbl>'
    );
  }

  // 쪽 단위 표 하나를 담은 문단 (글자처럼 취급, 줄 간격 100%)
  tablePara(t, { pageBreak, last, pre }) {
    const pp = this.h.paraPr({ align: 'LEFT', line: 100, next: last ? 0 : TABLE_GAP });
    const run = `<hp:run charPrIDRef="${this.cp({ size: 100 })}">${pre || ''}${this.table(t, true)}<hp:t/></hp:run>`;
    return `<hp:p id="0" paraPrIDRef="${pp}" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">${run}</hp:p>`;
  }
}

function secPrXml() {
  return (
    '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">' +
    '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>' +
    '<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>' +
    '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>' +
    '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>' +
    `<hp:pagePr landscape="WIDELY" width="${PAGE.W}" height="${PAGE.H}" gutterType="LEFT_ONLY">` +
    `<hp:margin header="0" footer="${PAGE.FOOT}" gutter="0" left="${PAGE.ML}" right="${PAGE.MR}" top="${PAGE.MT}" bottom="${PAGE.MB}"/>` +
    '</hp:pagePr>' +
    '<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>' +
    '<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>' +
    ['BOTH', 'EVEN', 'ODD']
      .map((t) => `<hp:pageBorderFill type="${t}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>`)
      .join('') +
    '</hp:secPr>' +
    '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>' +
    '<hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl>'
  );
}

function contentHpf(W, title) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const items = W.bin.map((b) => `<opf:item id="${b.id}" href="BinData/${b.name}" media-type="image/${b.ext === 'jpg' ? 'jpg' : b.ext}" isEmbeded="1"/>`).join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><opf:package ${NS.replace(/xmlns:opf="[^"]+"/, '')} xmlns:opf="http://www.idpf.org/2007/opf/" version="" unique-identifier="" id="">` +
    `<opf:metadata><opf:title>${esc(title)}</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text">맞춤형 학습지 생성기</opf:meta><opf:meta name="subject" content="text"/><opf:meta name="description" content="text"/><opf:meta name="lastsaveby" content="text">맞춤형 학습지 생성기</opf:meta><opf:meta name="CreatedDate" content="text">${now}</opf:meta><opf:meta name="ModifiedDate" content="text">${now}</opf:meta><opf:meta name="date" content="text"/><opf:meta name="keyword" content="text"/></opf:metadata>` +
    `<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>${items}<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest>` +
    '<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>'
  );
}

// layout: layoutDocument() 결과, images: {figId: {bytes, ext, w, h}}
export function buildHwpx(laid, { mode = 'student', images = {}, theme, title = '학습지', previewText = '' } = {}) {
  const W = new Writer(mode, images, theme);
  const paras = [];
  let first = true;
  laid.lessons.forEach((L) => {
    const pages = mode === 'teacher' ? L.teacher : L.student;
    pages.forEach((tables) => {
      tables.forEach((t, ti) => {
        paras.push(W.tablePara(t, { pageBreak: !first && ti === 0, last: ti === tables.length - 1, pre: first ? secPrXml() : '' }));
        first = false;
      });
    });
  });
  if (first) paras.push(`<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${secPrXml()}<hp:t/></hp:run></hp:p>`);
  const section = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec ${NS}>${paras.join('')}</hs:sec>`;
  const header = W.h.xml();
  const files = {};
  files.mimetype = [strToU8('application/hwp+zip'), { level: 0 }];
  files['version.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.4" application="Hancom Office Hangul" appVersion="12, 0, 0, 0 WIN32LEWindows_10"/>'
  );
  files['Contents/header.xml'] = strToU8(header);
  files['Contents/section0.xml'] = strToU8(section);
  files['Preview/PrvText.txt'] = strToU8(previewText.slice(0, 1000));
  files['settings.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>'
  );
  W.bin.forEach((b) => (files[`BinData/${b.name}`] = [b.bytes, { level: 0 }]));
  files['META-INF/container.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/></ocf:rootfiles></ocf:container>'
  );
  files['Contents/content.hpf'] = strToU8(contentHpf(W, title));
  files['META-INF/manifest.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>');
  return zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00') });
}
