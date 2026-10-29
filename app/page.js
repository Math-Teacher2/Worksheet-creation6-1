'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ModelView from '../components/ModelView';
import CropEditor from '../components/CropEditor';
import CompositionEditor from '../components/CompositionEditor';
import LayoutPicker from '../components/LayoutPicker';
import JobPanel, { ErrorBox } from '../components/JobPanel';
import { PROVIDERS, generate } from '../lib/llm';
import { explainError } from '../lib/errors';
import { runUnit, newJob, fileKey, unitProgress, mergeChunk, estimateRequests, buildToc, globalOrder, nextUnit, unitName, customUnit } from '../lib/job';
import { DEFAULT_CONTENT, normalizeContent, THINK_LABEL } from '../lib/content';
import {
  buildSystemPrompt,
  buildReviseInstruction,
  COMPOSITION_SYSTEM,
  COMPOSITION_INSTRUCTION,
  LAYOUT_SYSTEM,
  LAYOUT_INSTRUCTION,
} from '../lib/prompt';
import { parseModelJson } from '../lib/jsonRepair';
import { normalizeDoc } from '../lib/doc';
import { parsePageRange } from '../lib/pdfClient';
import { THEMES, getTheme, paletteFrom } from '../lib/themes';
import { LAYOUTS, getLayout, normalizeLayout } from '../lib/layouts';
import { DEFAULT_COMPOSITION, normalizeComposition, ACTIVITY_TYPES } from '../lib/composition';
import { layoutDocument } from '../lib/paginate';
import { SAMPLE_DOC } from '../lib/sample';
import { SAMPLE_IMAGES } from '../lib/sampleImages';

const LS = 'worksheet-settings-v3';
const loadSettings = () => {
  try {
    return JSON.parse(localStorage.getItem(LS) || '{}');
  } catch {
    return {};
  }
};
const saveSettings = (s) => {
  try {
    localStorage.setItem(LS, JSON.stringify(s));
  } catch {}
};
// 만들던 작업(차시 계획·끝난 차시)을 저장해 두고, 새로고침해도 이어서 만들 수 있게 함
const LS_JOB = 'worksheet-job-v2';
const loadJob = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_JOB) || 'null');
  } catch {
    return null;
  }
};
const saveJob = (v) => {
  try {
    if (v) localStorage.setItem(LS_JOB, JSON.stringify(v));
    else localStorage.removeItem(LS_JOB);
    return true;
  } catch {
    return false;
  }
};
const nowTime = () => new Date().toTimeString().slice(0, 8);

function downloadBlob(bytes, name, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 60);

export default function Home() {
  // ----- AI 설정 -----
  const [provider, setProvider] = useState('gemini');
  const [conf, setConf] = useState({}); // {gemini:{key,model}, anthropic:{...}, compat:{key,model,baseUrl}}
  const [remember, setRemember] = useState(true);
  const [useProxy, setUseProxy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // ----- 입력 -----
  const [sourceFile, setSourceFile] = useState(null);
  const [sourcePages, setSourcePages] = useState('');
  const [sourceCount, setSourceCount] = useState(0);
  const [sourceKind, setSourceKind] = useState('textbook'); // textbook | guide
  const [compMode, setCompMode] = useState('upload'); // upload(내 학습지 분석) | manual(직접 구성)
  const [compConfirmed, setCompConfirmed] = useState(null); // 확인을 마친 구성 참고 파일
  const [compFile, setCompFile] = useState(null);
  const [compPages, setCompPages] = useState('');
  const [compAnalyzed, setCompAnalyzed] = useState(null); // 분석한 파일
  const [composition, setComposition] = useState(() => normalizeComposition(DEFAULT_COMPOSITION));
  const [layoutFile, setLayoutFile] = useState(null);
  const [layoutPages, setLayoutPages] = useState('');
  const [layoutId, setLayoutId] = useState('block');
  const [customLayout, setCustomLayout] = useState(null);
  const [customPalette, setCustomPalette] = useState(null);
  const [content, setContent] = useState(() => normalizeContent(DEFAULT_CONTENT));
  const [subject, setSubject] = useState('');
  const [scope, setScope] = useState('');
  const [extra, setExtra] = useState('');
  const [verify, setVerify] = useState(true);
  const [themeId, setThemeId] = useState('auto');

  // ----- 결과 -----
  const [doc, setDoc] = useState(null);
  const [figs, setFigs] = useState({});
  const [teacherView, setTeacherView] = useState(false);
  const [isSample, setIsSample] = useState(false);

  // ----- 진행 상태 -----
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState(null); // {title, why, fix, raw}
  const [elapsed, setElapsed] = useState(0);
  const [job, setJob] = useState(null);
  const [log, setLog] = useState([]);
  const [askNext, setAskNext] = useState(null); // 소단원 하나가 끝난 뒤 "다음 소단원을 만들까요?" {done, next}
  const abortRef = useRef(null);
  const sourceImagesRef = useRef(null);
  const docRef = useRef(null);
  const figsRef = useRef({});
  const jobLoaded = useRef(false);
  const restoreCropRef = useRef('');

  // ----- 편집 -----
  const [cropTarget, setCropTarget] = useState(null); // {mode:'edit', id} | {mode:'add', path}
  const [reviseText, setReviseText] = useState('');
  const [jsonEdit, setJsonEdit] = useState(null);
  const [jsonErr, setJsonErr] = useState('');

  const pinfo = PROVIDERS[provider];
  const cur = conf[provider] || {};
  // 목록에 없는 예전 모델 이름이 저장돼 있으면 기본 모델로
  const model = pinfo.models.length ? (pinfo.models.some((m) => m.id === cur.model) ? cur.model : pinfo.defaultModel) : cur.model || '';
  const apiKey = (cur.key || '').trim();

  useEffect(() => {
    const s = loadSettings();
    if (s.provider && PROVIDERS[s.provider]) setProvider(s.provider);
    if (s.conf) setConf(s.conf);
    if (typeof s.remember === 'boolean') setRemember(s.remember);
    if (typeof s.useProxy === 'boolean') setUseProxy(s.useProxy);
    if (s.themeId) setThemeId(s.themeId);
    if (s.layoutId) setLayoutId(s.layoutId);
    if (s.customLayout) setCustomLayout(normalizeLayout(s.customLayout));
    if (s.customPalette) setCustomPalette(s.customPalette);
    if (s.composition) setComposition(normalizeComposition(s.composition));
    if (typeof s.verify === 'boolean') setVerify(s.verify);
    if (s.content) setContent(normalizeContent(s.content));
    if (s.compMode === 'manual' || s.compMode === 'upload') setCompMode(s.compMode);
    const saved = loadJob();
    if (saved && saved.job && saved.job.v === 2) {
      setJob(saved.job);
      if (saved.job.kind) setSourceKind(saved.job.kind);
      if (saved.doc) {
        const d = normalizeDoc(saved.doc);
        docRef.current = d;
        setDoc(d);
      }
      const units = saved.job.toc?.units || [];
      const done = units.filter((u) => unitProgress(saved.job, u.id).complete).length;
      setNotes([
        `지난번에 만들던 학습지(${saved.job.fileName}, 소단원 ${done}/${units.length}개 완료)를 불러왔습니다. 그림을 보거나 이어서 만들려면 같은 PDF를 다시 올려 주세요.`,
      ]);
    }
    jobLoaded.current = true;
    setLoaded(true);
  }, []);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => {
    figsRef.current = figs;
  }, [figs]);

  // 작업 저장 (샘플은 저장하지 않음)
  useEffect(() => {
    if (!jobLoaded.current || isSample) return;
    if (!job && !doc) return;
    const ok = saveJob({ job, doc, savedAt: Date.now() });
    if (!ok && doc) saveJob({ job, doc: null, savedAt: Date.now() });
  }, [job, doc, isSample]);

  useEffect(() => {
    if (!loaded) return;
    const keep = remember ? conf : Object.fromEntries(Object.entries(conf).map(([k, v]) => [k, { ...v, key: '' }]));
    saveSettings({ provider, conf: keep, remember, useProxy, themeId, layoutId, customLayout, customPalette, composition, verify, content, compMode });
  }, [loaded, provider, conf, remember, useProxy, themeId, layoutId, customLayout, customPalette, composition, verify, content, compMode]);

  // 레이아웃·색
  const layout = useMemo(() => getLayout(layoutId, customLayout), [layoutId, customLayout]);
  const theme = useMemo(() => {
    if (themeId === 'auto') return layoutId === 'custom' && customPalette ? customPalette : getTheme(layout.palette);
    return getTheme(themeId, customPalette);
  }, [themeId, layoutId, layout, customPalette]);

  // 쪽 배치 (HWPX와 미리보기가 같이 씀)
  const laid = useMemo(() => {
    if (!doc) return null;
    try {
      return layoutDocument(doc, { layout, theme, composition, figs });
    } catch (e) {
      console.error(e);
      return { error: e.message, lessons: [] };
    }
  }, [doc, layout, theme, composition, figs]);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    if (!doc || isSample) return;
    const h = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [doc, isSample]);

  const setCur = (patch) => setConf((c) => ({ ...c, [provider]: { ...(c[provider] || {}), ...patch } }));

  const onSourceFile = async (f) => {
    setSourceFile(f);
    setSourceCount(0);
    setAskNext(null);
    sourceImagesRef.current = null;
    if (!f) return;
    try {
      const { getPageCount } = await import('../lib/pdfClient');
      setSourceCount(await getPageCount(f));
    } catch (e) {
      setError(explainError(e));
      return;
    }
    // 같은 파일로 만들던 작업이 있으면 이어서, 아니면 새 작업 (목차는 키가 있으면 바로 만듦)
    if (job && job.key === fileKey(f)) {
      setNotes([`이전에 만들던 작업(${job.fileName})에 이어서 만들 수 있습니다.`]);
      return;
    }
    const j = newJob({ file: f, kind: sourceKind });
    setJob(j);
    setLog([]);
    if (apiKey) makeToc(f, j);
  };

  // 단원 목차(소단원별 쪽 범위) 만들기
  const makeToc = (f = sourceFile, j0 = job) => {
    if (needKey() || !f) return;
    run(async (signal) => {
      const j = j0 && j0.key === fileKey(f) ? j0 : newJob({ file: f, kind: sourceKind });
      const r = await buildToc({ llm: llmArgs(), file: f, kind: sourceKind, subject, content, signal, cb: { status: setStatus, log: addLog } });
      const nj = { ...j, kind: sourceKind, toc: r.toc, units: {}, usage: { input: j.usage.input + (r.usage?.input || 0), output: j.usage.output + (r.usage?.output || 0) }, requests: j.requests + 1 };
      setJob(nj);
      if (!subject.trim() && r.toc.subject) setSubject(r.toc.subject);
      addLog({ level: 'info', text: `단원 목차: 소단원 ${r.toc.units.length}개를 찾았습니다.` });
      setNotes([`PDF를 소단원 ${r.toc.units.length}개로 나눴습니다. ② 아래 목록에서 만들 소단원을 고르세요. 쪽 범위가 틀리면 직접 고칠 수 있습니다.`]);
    });
  };

  const setUnits = (fn) => setJob((j) => (j && j.toc ? { ...j, toc: { ...j.toc, units: fn(j.toc.units) } } : j));

  const llmArgs = () => ({
    provider,
    model,
    apiKey,
    baseUrl: provider === 'compat' ? cur.baseUrl || PROVIDERS.compat.defaultBaseUrl : undefined,
    useProxy,
  });

  const run = async (job) => {
    setError(null);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await job(ctrl.signal);
    } catch (e) {
      console.error(e);
      const ex = explainError(e);
      if (e.stage) ex.stage = e.stage;
      setError(ex);
    } finally {
      setStatus('');
      setBusy(false);
      abortRef.current = null;
    }
  };

  const addNote = (n) => setNotes((x) => [...x, n]);
  const addLog = (x) => setLog((l) => [...l.slice(-199), { time: nowTime(), ...x }]);

  const cropFigures = async (d, file, existing = {}) => {
    const { cropAll } = await import('../lib/figures');
    const need = d.figures.filter((f) => !existing[f.id]);
    if (!need.length) return existing;
    setStatus(`교과서 그림을 잘라오는 중... (0/${need.length})`);
    const got = await cropAll(file, need, (i, n) => setStatus(`교과서 그림을 잘라오는 중... (${i}/${n})`));
    return { ...existing, ...got };
  };

  // 저장된 작업을 불러온 뒤 같은 교과서를 올리면 그림을 다시 잘라 옴
  useEffect(() => {
    if (!sourceFile || !doc || isSample || busy) return;
    if (job && job.key !== fileKey(sourceFile)) return;
    const missing = doc.figures.filter((f) => !figs[f.id]);
    const sig = `${sourceFile.name}|${missing.map((f) => f.id).join(',')}`;
    if (!missing.length || restoreCropRef.current === sig) return;
    restoreCropRef.current = sig;
    (async () => {
      try {
        const f = await cropFigures(doc, sourceFile, figs);
        setFigs(f);
      } catch (e) {
        console.error(e);
      } finally {
        setStatus('');
      }
    })();
  }, [sourceFile, doc, isSample, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const needKey = () => {
    if (!apiKey) {
      setError({ title: `${pinfo.label} API 키를 입력해 주세요.`, why: '구성·레이아웃 분석과 학습지 만들기에 AI를 씁니다.', fix: '① AI 선택에서 키를 입력해 주세요.' });
      return true;
    }
    return false;
  };

  // 구성 참고 학습지 분석 → "내 학습지 구성"
  const analyzeComposition = async (signal, f = compFile) => {
    const { prepareTemplate } = await import('../lib/pdfClient');
    setStatus('내 학습지의 구성을 분석하는 중...');
    const tpl = await prepareTemplate(f, compPages || '1-6');
    const parts = [];
    tpl.images.forEach((im, i) => {
      parts.push({ type: 'text', text: `[학습지 ${i + 1}쪽]` });
      parts.push({ type: 'image', ...im, res: 'medium' });
    });
    parts.push({ type: 'text', text: COMPOSITION_INSTRUCTION });
    const r = await generate({
      ...llmArgs(),
      system: COMPOSITION_SYSTEM,
      parts,
      json: true,
      maxTokens: 6000,
      thinking: 'low',
      fallback: content.fallback,
      signal,
      onStatus: (m, info) => {
        setStatus(`구성 분석: ${m}`);
        addLog({ level: 'wait', text: `[구성 분석] ${m}`, error: info?.error ? explainError(info.error) : null });
      },
      onText: (t) => setStatus(`구성 참고 학습지를 분석하는 중... (${t.length}자)`),
    });
    const c = normalizeComposition(parseModelJson(r.text, { allowTruncated: true }));
    setComposition(c);
    setCompAnalyzed(f);
    const offNames = c.activities.filter((a) => !a.use).map((a) => ACTIVITY_TYPES[a.type].split(' (')[0]);
    setCompConfirmed(null);
    addNote(`내 학습지를 분석했습니다. ④ 아래 구성에서 각 활동의 역할이 맞는지 확인하고 [이 구성으로 확정]을 눌러 주세요.${offNames.length ? ` 학습지에 없던 역할(${offNames.join(', ')})은 꺼 두었습니다. 넣고 싶으면 체크하세요.` : ''}`);
    return c;
  };

  // 레이아웃 참고 파일 분석 → 맞춤 레이아웃
  const analyzeLayout = () => {
    if (needKey() || !layoutFile) return;
    run(async (signal) => {
      const { prepareTemplate } = await import('../lib/pdfClient');
      setStatus('레이아웃 참고 파일을 분석하는 중...');
      const tpl = await prepareTemplate(layoutFile, layoutPages || '1-2');
      const parts = [];
      tpl.images.forEach((im) => parts.push({ type: 'image', ...im, res: 'medium' }));
      parts.push({ type: 'text', text: LAYOUT_INSTRUCTION });
      const r = await generate({ ...llmArgs(), system: LAYOUT_SYSTEM, parts, json: true, maxTokens: 3000, thinking: 'low', fallback: content.fallback, signal, onStatus: (m) => setStatus(`레이아웃 분석: ${m}`) });
      const raw = parseModelJson(r.text, { allowTruncated: true });
      const L = normalizeLayout(raw, raw.base);
      const pal = paletteFrom(raw.primary, raw.accent, `${L.name} 색`);
      setCustomLayout({ ...L, palette: 'custom' });
      setCustomPalette(pal);
      setLayoutId('custom');
      setThemeId('auto');
      addNote(`레이아웃 참고 파일을 분석해 "${L.name}" 레이아웃을 만들었습니다. 레이아웃 목록 맨 끝에서 고를 수 있습니다.`);
    });
  };

  const analyzeCompositionClick = () => {
    if (needKey() || !compFile) return;
    run((signal) => analyzeComposition(signal));
  };
  const onCompFile = (f) => {
    setCompFile(f);
    setCompAnalyzed(null);
    setCompConfirmed(null);
    // 올리자마자 분석 (분석 없이 만들기를 누르는 일을 막음)
    if (f && apiKey) run((signal) => analyzeComposition(signal, f));
  };

  // 만들기 전에 갖춰야 할 것
  const compReady = compMode === 'manual' || (compFile && compAnalyzed === compFile && compConfirmed === compFile);
  const compBlock =
    compMode === 'upload' && !compFile
      ? '④ 내 학습지를 올리거나 "기본 구성을 직접 정하기"를 고르세요.'
      : compMode === 'upload' && compAnalyzed !== compFile
        ? '④ 내 학습지의 구성을 먼저 분석해 주세요.'
        : compMode === 'upload' && compConfirmed !== compFile
          ? '④ 분석된 구성을 확인하고 [이 구성으로 확정]을 눌러 주세요.'
          : '';
  const sameFile = !!(job && sourceFile && job.key === fileKey(sourceFile));
  const units = sameFile ? job.toc?.units || [] : [];
  const upcoming = sameFile ? nextUnit(job) : null;

  // 소단원 만들기: unitId(없으면 다음 소단원), only=차시 묶음 하나만 다시, all=묻지 않고 끝까지
  const startUnits = ({ unitId, only, all = false } = {}) => {
    if (!apiKey) return needKey();
    if (!sourceFile) return setError({ title: '교과서 또는 지도서 PDF를 올려 주세요.', why: '', fix: '② 에서 PDF 파일을 고르세요.' });
    if (!sameFile || !job.toc) return setError({ title: '먼저 소단원 목차를 만들어 주세요.', why: 'PDF를 소단원별로 나눠야 필요한 쪽만 AI에 보내 토큰을 아낄 수 있습니다.', fix: '② 에서 [소단원 목차 만들기]를 누르세요.' });
    if (!compReady) return setError({ title: '학습지 구성을 먼저 정해 주세요.', why: compBlock, fix: '' });
    setAskNext(null);
    run(async (signal) => {
      let j = job;
      let target = unitId ? j.toc.units.find((u) => u.id === unitId) : nextUnit(j);
      if (!target) {
        addLog({ level: 'info', text: '선택한 소단원을 모두 만들었습니다.' });
        return;
      }
      for (;;) {
        addLog({ level: 'info', text: `소단원 "${unitName(target)}" (${target.pages[0]}~${target.pages[1]}쪽) 만들기 시작 · ${model}` });
        j = await runUnit({
          llm: llmArgs(),
          file: sourceFile,
          job: j,
          unitId: target.id,
          composition,
          content,
          subject,
          scope,
          extra,
          verify,
          rulerMode: !pinfo.nativeBoxes,
          imageWidth: pinfo.imageWidth,
          only,
          signal,
          cb: {
            status: setStatus,
            log: addLog,
            update: (nj) => {
              j = nj;
              setJob(nj);
            },
            chunkDone: async (chunkId, chunkDoc) => {
              const merged = mergeChunk(docRef.current, chunkId, chunkDoc, globalOrder(j), subject.trim());
              docRef.current = merged;
              setIsSample(false);
              setDoc(merged);
              const f = await cropFigures(merged, sourceFile, figsRef.current);
              figsRef.current = f;
              setFigs(f);
            },
          },
        });
        const pr = unitProgress(j, target.id);
        if (pr.failed) {
          setError({
            title: `"${unitName(target)}"에서 ${pr.failed}개 차시를 만들지 못했습니다`,
            why: `진행 상황에서 실패한 차시마다 이유를 확인할 수 있습니다.${pr.done ? ` 나머지 ${pr.done}개는 정상적으로 만들어졌습니다.` : ''}`,
            fix: '[이어서 만들기]를 누르면 실패한 차시만 다시 만듭니다.',
          });
          return;
        }
        if (only) return;
        const nx = nextUnit(j, target.id);
        if (!nx) {
          addLog({ level: 'info', text: '선택한 소단원을 모두 만들었습니다.' });
          setNotes(['선택한 소단원을 모두 만들었습니다. 그림이 어긋났으면 그림 아래 [✂ 위치 조정]으로 고칠 수 있습니다.']);
          return;
        }
        if (!all) {
          setAskNext({ done: unitName(target), next: nx });
          return;
        }
        target = nx;
      }
    });
  };

  const handleRevise = () => {
    if (!doc || !reviseText.trim()) return;
    if (!apiKey) return needKey();
    run(async (signal) => {
      setStatus('수정 요청을 반영하는 중...');
      const r = await generate({
        ...llmArgs(),
        system: buildSystemPrompt({ rulerMode: !pinfo.nativeBoxes, composition, hasGuide: job?.kind === 'guide' }),
        parts: [{ type: 'text', text: buildReviseInstruction(JSON.stringify(doc), reviseText.trim()) }],
        json: true,
        maxTokens: 48000,
        thinking: content.thinking,
        fallback: content.fallback,
        signal,
        onStatus: (m) => setStatus(`수정 반영: ${m}`),
        onText: (t) => setStatus(`수정 요청을 반영하는 중... (${t.length.toLocaleString()}자)`),
      });
      if (r.finish === 'MAX_TOKENS') throw Object.assign(new Error('수정 결과가 너무 길어 잘렸습니다. 요청을 나눠서 해 주세요(예: 차시 하나씩).'), { kind: 'max-tokens' });
      const d = normalizeDoc(parseModelJson(r.text));
      if (!d.lessons.length) throw Object.assign(new Error('수정 결과가 비어 있습니다.'), { kind: 'parse' });
      // 차시 묶음 표시를 이어 붙임(나중에 그 차시만 다시 만들 때 필요)
      if (d.lessons.length === doc.lessons.length) d.lessons.forEach((l, i) => doc.lessons[i].chunk !== undefined && (l.chunk = doc.lessons[i].chunk));
      setDoc(d);
      if (sourceFile && !isSample) setFigs(await cropFigures(d, sourceFile, figs));
      setReviseText('');
    });
  };

  // ----- 그림 편집 -----
  const onEditFigure = useCallback((id) => setCropTarget({ mode: 'edit', id }), []);
  const onAddFigure = useCallback((path) => setCropTarget({ mode: 'add', path }), []);
  const onRemoveFigure = useCallback((id) => {
    setDoc((d) => {
      const n = structuredClone(d);
      n.lessons.forEach((l) =>
        l.sections.forEach((s) =>
          s.blocks.forEach((b) => {
            b.figures = (b.figures || []).filter((x) => x !== id);
            if (b.items && b.type === 'problems') b.items.forEach((it) => (it.figures = (it.figures || []).filter((x) => x !== id)));
          })
        )
      );
      return n;
    });
  }, []);

  const applyCrop = async ({ page, box, refine }) => {
    const { cropFigure } = await import('../lib/figures');
    if (cropTarget.mode === 'edit') {
      const id = cropTarget.id;
      const fig = await cropFigure(sourceFile, { id, page, box }, { refine, grow: false });
      setFigs((f) => ({ ...f, [id]: fig }));
      setDoc((d) => ({ ...d, figures: d.figures.map((x) => (x.id === id ? { ...x, page: fig.page, box: fig.box } : x)) }));
    } else {
      const id = `u${Date.now().toString(36)}`;
      const fig = await cropFigure(sourceFile, { id, page, box }, { refine, grow: false });
      const [li, si, bi] = cropTarget.path;
      setFigs((f) => ({ ...f, [id]: fig }));
      setDoc((d) => {
        const n = structuredClone(d);
        n.figures.push({ id, page: fig.page, box: fig.box, desc: '' });
        const b = n.lessons[li].sections[si].blocks[bi];
        b.figures = [...(b.figures || []), id];
        return n;
      });
    }
    setCropTarget(null);
  };

  const cropInitial = useMemo(() => {
    if (!cropTarget || !doc) return null;
    if (cropTarget.mode === 'edit') return doc.figures.find((f) => f.id === cropTarget.id) || null;
    const lesson = doc.lessons[cropTarget.path?.[0]];
    const allChunks = Object.values(job?.units || {}).flatMap((u) => u.chunks || []);
    const ch = allChunks.find((c) => c.id === lesson?.chunk);
    const sec = lesson?.sections?.[cropTarget.path?.[1]];
    const near = doc.figures.find((f) => (sec?.blocks || []).some((b) => (b.figures || []).includes(f.id)));
    return { page: near?.page || ch?.pages?.[0] || 1, box: null };
  }, [cropTarget, doc, job]);

  // ----- 내려받기 -----
  const downloadHwpx = async (mode) => {
    try {
      const { buildHwpx } = await import('../lib/hwpx');
      const { dataUrlToBytes } = await import('../lib/figures');
      const images = {};
      Object.entries(figs).forEach(([id, f]) => {
        if (f && f.dataUrl) images[id] = { bytes: dataUrlToBytes(f.dataUrl), ext: 'png', w: f.w, h: f.h, frac: f.frac };
      });
      if (!laid || laid.error) throw new Error(laid?.error || '쪽 배치를 만들지 못했습니다.');
      const l0 = doc.lessons[0];
      const preview = doc.lessons.map((l) => `${doc.subject} ${l.chapterNo} ${l.chapterTitle} ${l.topic} (${l.no}차시)`).join('\r\n');
      const bytes = buildHwpx(laid, { mode, images, theme, title: `${doc.subject || '학습지'} ${l0?.chapterTitle || ''}`.trim(), previewText: preview });
      const name = `${safeName(doc.subject || '학습지')}_${safeName(l0?.chapterTitle || l0?.topic || '')}_${mode === 'teacher' ? '교사용' : '학생용'}.hwpx`;
      downloadBlob(bytes, name, 'application/hwp+zip');
    } catch (e) {
      setError({ title: `HWPX 만들기 실패: ${e.message}`, why: '', fix: '', raw: e.stack || '' });
    }
  };

  const showSample = () => {
    setDoc(normalizeDoc(SAMPLE_DOC));
    setFigs(Object.fromEntries(Object.entries(SAMPLE_IMAGES).map(([k, v]) => [k, { ...v, id: k }])));
    setIsSample(true);
    setError(null);
    setNotes(['샘플 학습지입니다. API 키 없이 화면과 HWPX 모양을 확인할 수 있습니다.']);
  };

  const canEditFigs = !!sourceFile && !isSample && !busy;

  return (
    <main>
      <aside className="panel no-print">
        <h1>📝 맞춤형 학습지 생성기</h1>
        <p className="hint">교과서 PDF를 올리면 교과서 문제·그림을 그대로 담은 컬러 학습지를 학생용·교사용 HWPX로 만들어 줍니다.</p>

        <div className="card">
          <div className="card-title">① AI 선택</div>
          <label>
            AI 회사
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {Object.entries(PROVIDERS).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{pinfo.note}</p>
          <label>
            모델
            {pinfo.models.length ? (
              <select value={model} onChange={(e) => setCur({ model: e.target.value })}>
                {[...new Set(pinfo.models.map((m) => m.group || ''))].map((g) => (
                  <optgroup key={g} label={g}>
                    {pinfo.models
                      .filter((m) => (m.group || '') === g)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            ) : (
              <input value={cur.model || ''} onChange={(e) => setCur({ model: e.target.value })} placeholder="예: anthropic/claude-sonnet-5.5" />
            )}
          </label>
          {provider === 'compat' ? (
            <label>
              API 주소 (Base URL)
              <input value={cur.baseUrl ?? PROVIDERS.compat.defaultBaseUrl} onChange={(e) => setCur({ baseUrl: e.target.value })} />
            </label>
          ) : null}
          <label>
            {pinfo.label} API 키
            <input type="password" value={cur.key || ''} onChange={(e) => setCur({ key: e.target.value })} placeholder={pinfo.keyHint} autoComplete="off" />
          </label>
          <p className="hint">
            키 발급:{' '}
            <a href={pinfo.keyUrl} target="_blank" rel="noreferrer">
              {pinfo.keyUrl.replace(/^https:\/\//, '')}
            </a>
            . 키는 내 브라우저에서 AI 회사로만 전송되고 이 사이트 서버에는 저장되지 않습니다.
          </p>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 이 브라우저에 키 기억하기
          </label>
          <details>
            <summary>고급 설정</summary>
            <label className="check">
              <input type="checkbox" checked={useProxy} onChange={(e) => setUseProxy(e.target.checked)} /> 서버 경유 연결 (직접 연결이 막힐 때만)
            </label>
            <p className="hint">켜면 요청이 이 사이트 서버(Vercel)를 거쳐 전달됩니다. 키는 저장하지 않지만 서버를 지나가며, 5분이 넘는 작업은 끊길 수 있습니다.</p>
          </details>
        </div>

        <div className="card">
          <div className="card-title">② 교과서 또는 지도서 (필수)</div>
          <div className="seg">
            {[
              ['textbook', '교과서'],
              ['guide', '지도서·교사용 교과서'],
            ].map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={sourceKind === k ? 'on' : ''}
                onClick={() => {
                  setSourceKind(k);
                  setJob((j) => (j ? { ...j, kind: k } : j));
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <input type="file" accept="application/pdf" onChange={(e) => onSourceFile(e.target.files?.[0] || null)} />
          {sourceCount ? <p className="hint">총 {sourceCount}쪽</p> : null}
          <p className="hint">
            {sourceKind === 'guide'
              ? '지도서를 넣으면 교사용 학습지에 정답 외에도 지도 팁, 교육과정 유의점, 학생들이 자주 틀리는 부분, 심화 참고 내용을 넣어 줍니다. 학생용에는 교과서 내용만 들어갑니다.'
              : '교과서 PDF를 그대로 올리세요. 지도서(교사용 교과서)를 올리면 정답 외에도 지도 팁·교육과정 유의점을 교사용 학습지에 넣어 줄 수 있습니다.'}
          </p>
          {sourceFile && !units.length ? (
            <>
              <button type="button" className="ghost" onClick={() => makeToc()} disabled={busy}>
                소단원 목차 만들기
              </button>
              <p className="hint">PDF 전체를 한 번에 보내지 않도록, 먼저 쪽마다 제목 글자만 읽어 소단원별로 나눕니다(가벼운 요청 1번). 그다음 소단원을 하나씩 만듭니다.</p>
            </>
          ) : null}
          {units.length ? (
            <div className="units">
              <div className="units-head">
                <b>소단원 목록</b> <span className="muted">만들 소단원을 고르세요</span>
                <button type="button" className="mini" onClick={() => makeToc()} disabled={busy} title="목차를 다시 만듭니다">
                  다시 나누기
                </button>
              </div>
              {units.map((u) => {
                const pr = unitProgress(job, u.id);
                return (
                  <div key={u.id} className={`unit-row ${u.kind === 'review' ? 'review' : ''}`}>
                    <input type="checkbox" checked={!!u.selected} onChange={(e) => setUnits((list) => list.map((x) => (x.id === u.id ? { ...x, selected: e.target.checked } : x)))} />
                    <span className="unit-name" title={`${u.chapterTitle || ''} ${u.title || ''}`}>
                      {unitName(u)}
                      {u.kind === 'review' ? <em> (문제 모음)</em> : null}
                    </span>
                    <input className="pg" type="number" min={1} max={sourceCount || 999} value={u.pages[0]} onChange={(e) => setUnits((list) => list.map((x) => (x.id === u.id ? { ...x, pages: [Math.max(1, parseInt(e.target.value, 10) || 1), x.pages[1]] } : x)))} disabled={pr.started} />
                    <span>~</span>
                    <input className="pg" type="number" min={1} max={sourceCount || 999} value={u.pages[1]} onChange={(e) => setUnits((list) => list.map((x) => (x.id === u.id ? { ...x, pages: [x.pages[0], Math.max(x.pages[0], parseInt(e.target.value, 10) || x.pages[0])] } : x)))} disabled={pr.started} />
                    <span className={`badge ${pr.complete ? 'done' : pr.failed ? 'fail' : pr.started ? 'run' : ''}`}>{pr.complete ? '완료' : pr.failed ? '일부 실패' : pr.started ? `${pr.done}/${pr.total}` : '대기'}</span>
                  </div>
                );
              })}
              <details>
                <summary>쪽 범위로 직접 추가</summary>
                <div className="opt-grid">
                  <input value={sourcePages} onChange={(e) => setSourcePages(e.target.value)} placeholder="예: 12-17" />
                  <button
                    type="button"
                    className="mini"
                    onClick={() => {
                      const m = sourcePages.match(/(\d+)\s*[-~]\s*(\d+)/);
                      if (!m) return;
                      const a = parseInt(m[1], 10);
                      const b = Math.max(a, parseInt(m[2], 10));
                      setUnits((list) => [...list, customUnit(job, a, b)].sort((x, y) => x.pages[0] - y.pages[0]));
                      setSourcePages('');
                    }}
                  >
                    + 소단원으로 추가
                  </button>
                </div>
              </details>
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-title">③ 내 학습지 구성</div>
          <div className="seg">
            <button type="button" className={compMode === 'upload' ? 'on' : ''} onClick={() => setCompMode('upload')}>
              내 학습지 올려서 분석
            </button>
            <button type="button" className={compMode === 'manual' ? 'on' : ''} onClick={() => setCompMode('manual')}>
              기본 구성을 직접 정하기
            </button>
          </div>
          {compMode === 'upload' ? (
            <>
              <label>
                평소 쓰는 학습지 (PDF/이미지)
                <input type="file" accept="application/pdf,image/*" onChange={(e) => onCompFile(e.target.files?.[0] || null)} />
              </label>
              {compFile ? (
                <>
                  <label>
                    분석할 쪽 (예: 1-6)
                    <input value={compPages} onChange={(e) => setCompPages(e.target.value)} placeholder="비우면 앞 6쪽" />
                  </label>
                  <button type="button" className="ghost" onClick={analyzeCompositionClick} disabled={busy}>
                    {compAnalyzed === compFile ? '구성 다시 분석' : '이 학습지의 구성 분석하기'}
                  </button>
                </>
              ) : null}
              <p className="hint">올린 학습지가 어떤 활동(개념 도입, 핵심 개념, 확인 문제, 예제, 유제, 생각해보기, 실전 문제 등)으로 짜여 있는지 분석합니다. 분석 결과를 꼭 확인하고, 다르면 고친 뒤 확정해 주세요.</p>
            </>
          ) : (
            <p className="hint">아래 기본 구성에서 넣을 활동을 체크하고, 역할과 학습지에 찍힐 이름을 정하세요. 이름 예: 개념 도입 · 핵심 개념 · 확인 문제 · 예제 · 유제(또는 문제) · 생각해보기, 탐구해보기 · 실전 문제.</p>
          )}
          {compMode === 'manual' || compAnalyzed === compFile ? (
            <div className={`comp-wrap ${compMode === 'upload' && compConfirmed !== compFile ? 'pending' : ''}`}>
              {compMode === 'upload' && compConfirmed !== compFile ? <p className="note-msg">분석 결과입니다. 역할·이름·순서가 내 학습지와 맞는지 확인하고, 다르면 고친 뒤 확정하세요.</p> : null}
              <CompositionEditor value={composition} onChange={setComposition} />
              <button type="button" className="mini" onClick={() => setComposition(normalizeComposition(DEFAULT_COMPOSITION))}>
                기본 구성으로 되돌리기
              </button>
              {compMode === 'upload' ? (
                compConfirmed === compFile ? (
                  <p className="hint ok">✓ 확정한 구성으로 만듭니다. (고쳐도 그대로 반영됩니다)</p>
                ) : (
                  <button type="button" onClick={() => setCompConfirmed(compFile)}>
                    ✓ 이 구성으로 확정
                  </button>
                )
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-title">④ 레이아웃</div>
          <LayoutPicker value={layoutId} onChange={setLayoutId} custom={customLayout} customTheme={customPalette} />
          <label>
            색
            <select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
              <option value="auto">레이아웃 기본색</option>
              {Object.entries(THEMES).map(([id, t]) => (
                <option key={id} value={id}>
                  {t.name}
                </option>
              ))}
              {customPalette ? <option value="custom">{customPalette.name}</option> : null}
            </select>
          </label>
          <label>
            레이아웃 참고 파일 (선택, 모양만 참고)
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setLayoutFile(e.target.files?.[0] || null)} />
          </label>
          {layoutFile ? (
            <>
              <label>
                참고할 쪽 (예: 1-2)
                <input value={layoutPages} onChange={(e) => setLayoutPages(e.target.value)} placeholder="비우면 앞 2쪽" />
              </label>
              <button type="button" className="ghost" onClick={analyzeLayout} disabled={busy}>
                이 파일의 레이아웃 분석해서 추가
              </button>
            </>
          ) : null}
          <p className="hint">레이아웃은 만든 뒤에도 바꿀 수 있고, 미리보기와 HWPX에 바로 반영됩니다.</p>
        </div>

        <div className="card">
          <div className="card-title">⑤ 내용 설정</div>
          <label>
            과목명
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="예: 미적분Ⅰ (비우면 교과서에서 읽음)" />
          </label>
          <p className="hint">무엇을 어떤 순서로 넣을지와 확인 문제·예제·유제의 양(전부/대표 문항만)은 ③ 내 학습지 구성에서 정합니다. 개념 빈칸과 풀이 공간은 문항마다 알맞게 정합니다.</p>
          <label>
            만들 범위·차시 (선택)
            <textarea rows={3} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="예: 1차시 함수의 수렴과 발산(10~13쪽), 2차시 우극한과 좌극한(15~17쪽)" />
          </label>
          <label>
            추가 요청 (선택)
            <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="예: 생각해보기는 차시마다 1개" />
          </label>
          <label className="check">
            <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} /> 교과서와 대조해 문제·정답 검산 (권장, 요청 수 2배)
          </label>
          <details>
            <summary>속도·안정성 설정</summary>
            <div className="opt-grid">
              <label>
                AI 생각 깊이
                <select value={content.thinking} onChange={(e) => setContent((c) => ({ ...c, thinking: e.target.value }))}>
                  {Object.entries(THINK_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                한 번에 만들 차시 수
                <select value={content.perChunk} onChange={(e) => setContent((c) => ({ ...c, perChunk: Number(e.target.value) }))}>
                  <option value={1}>1차시 (가장 안정적)</option>
                  <option value={2}>2차시 (요청 수 절약)</option>
                  <option value={3}>3차시</option>
                </select>
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={content.fallback} onChange={(e) => setContent((c) => ({ ...c, fallback: e.target.checked }))} /> 서버가 계속 바쁘면 같은 회사의 다른 모델로 자동 전환
            </label>
            <p className="hint">생각 깊이를 낮추면 빠르고 토큰을 덜 쓰지만 정답 정확도가 조금 떨어질 수 있습니다. "한 번에 만들 차시 수"를 늘리면 요청 수는 줄지만 한 번 실패할 때 다시 만들 양이 커집니다.</p>
          </details>
        </div>

        {askNext && !busy ? (
          <div className="ask-next">
            <p>
              ✓ <b>{askNext.done}</b> 소단원을 만들었습니다.
              <br />
              다음 소단원 <b>{unitName(askNext.next)}</b> ({askNext.next.pages[0]}~{askNext.next.pages[1]}쪽)을 만들까요?
            </p>
            <button type="button" onClick={() => startUnits({ unitId: askNext.next.id })}>
              ▶ 다음 소단원 만들기
            </button>
            <div className="opt-grid">
              <button type="button" className="secondary" onClick={() => setAskNext(null)}>
                여기서 멈추기
              </button>
              <button type="button" className="ghost" onClick={() => startUnits({ unitId: askNext.next.id, all: true })}>
                남은 것 모두 (묻지 않기)
              </button>
            </div>
          </div>
        ) : null}
        {!askNext && upcoming && !busy && compReady ? (
          <p className="hint est">
            {(() => {
              const est = estimateRequests(job, upcoming, { verify, perChunk: content.perChunk });
              return `다음: ${unitName(upcoming)} · 예상 AI 요청 ${est.approx ? '약 ' : ''}${est.total}회`;
            })()}
          </p>
        ) : null}
        {!askNext && !busy && compBlock && sourceFile ? <p className="note-msg">{compBlock}</p> : null}
        {!askNext ? (
          <button type="button" onClick={() => startUnits()} disabled={busy || !units.length || !compReady || !upcoming}>
            {busy ? '작업 중...' : upcoming && unitProgress(job, upcoming.id).started ? `▶ 이어서 만들기 (${unitName(upcoming)})` : upcoming ? `학습지 만들기 (${unitName(upcoming)})` : units.length ? '선택한 소단원을 모두 만들었습니다' : '학습지 만들기'}
          </button>
        ) : null}
        {busy ? (
          <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
            중단 (끝난 차시는 남음)
          </button>
        ) : null}
        {status ? (
          <p className="status">
            {status} <span className="muted">({elapsed}초)</span>
          </p>
        ) : null}
        <ErrorBox e={error} />
        {notes.map((n, i) => (
          <p key={i} className="note-msg">
            {n}
          </p>
        ))}
        <JobPanel job={job} log={log} busy={busy} onRetry={sameFile ? (unitId, chunkId) => startUnits({ unitId, only: chunkId }) : null} />
        {job && !busy ? (
          <button
            type="button"
            className="mini"
            onClick={() => {
              saveJob(null);
              setJob(null);
              setLog([]);
            }}
          >
            저장된 작업 기록 지우기
          </button>
        ) : null}

        {doc ? (
          <div className="card">
            <div className="card-title">⑥ 내려받기</div>
            {laid?.lessons?.map((L, i) => (L.warn ? <p key={i} className="note-msg">{L.warn}</p> : null))}
            <div className="seg">
              <button type="button" className={!teacherView ? 'on' : ''} onClick={() => setTeacherView(false)}>
                학생용 보기
              </button>
              <button type="button" className={teacherView ? 'on' : ''} onClick={() => setTeacherView(true)}>
                교사용 보기
              </button>
            </div>
            <button type="button" onClick={() => downloadHwpx('student')} disabled={busy}>
              ⬇ 학생용 HWPX
            </button>
            <button type="button" onClick={() => downloadHwpx('teacher')} disabled={busy}>
              ⬇ 교사용 HWPX (정답·풀이)
            </button>
            <button type="button" className="secondary" onClick={() => window.print()}>
              🖨 지금 보기를 PDF로 저장/인쇄
            </button>
            {!isSample ? (
              <>
                <label>
                  AI에게 수정 요청
                  <textarea rows={3} value={reviseText} onChange={(e) => setReviseText(e.target.value)} placeholder="예: 2차시 개념 확인 문항을 하나 더, 1차시 학습목표를 더 짧게" />
                </label>
                <button type="button" className="secondary" onClick={handleRevise} disabled={busy || !reviseText.trim()}>
                  수정 반영
                </button>
              </>
            ) : null}
            <button type="button" className="ghost" onClick={() => setJsonEdit(JSON.stringify(doc, null, 2))} disabled={busy}>
              내용 직접 고치기 (고급)
            </button>
          </div>
        ) : (
          <button type="button" className="ghost" onClick={showSample}>
            샘플 학습지 보기 (키 없이)
          </button>
        )}
      </aside>

      <section className="preview">
        {doc && laid && !laid.error ? (
          <ModelView
            laid={laid}
            figs={figs}
            teacher={teacherView}
            onEditFigure={canEditFigs ? onEditFigure : undefined}
            onRemoveFigure={canEditFigs ? onRemoveFigure : undefined}
            onAddFigure={canEditFigs ? onAddFigure : undefined}
          />        ) : (
          <div className="empty no-print">
            {laid?.error ? <p className="error">배치 오류: {laid.error}</p> : null}
            <p>
              왼쪽에서 AI와 키를 고르고 교과서(또는 지도서) PDF를 올리면 소단원별로 나눠 줍니다. 소단원을 골라 <b>학습지 만들기</b>를 누르세요.
            </p>
            <p className="hint">완성되면 여기에서 확인하고, 학생용·교사용 HWPX로 내려받을 수 있습니다.</p>
          </div>
        )}
      </section>

      {cropTarget && sourceFile ? (
        <CropEditor
          file={sourceFile}
          initial={cropInitial}
          title={cropTarget.mode === 'edit' ? '그림 위치 조정' : '이 칸에 넣을 교과서 그림 고르기'}
          onApply={applyCrop}
          onCancel={() => setCropTarget(null)}
        />
      ) : null}

      {jsonEdit !== null ? (
        <div className="modal no-print" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-head">
              <b>내용 직접 고치기</b>
              <span className="hint">문장·정답을 직접 고칠 수 있습니다. 수식은 $...$, 빈칸은 [[정답]] 표기를 지켜 주세요.</span>
            </div>
            <textarea className="json-edit" value={jsonEdit} onChange={(e) => setJsonEdit(e.target.value)} spellCheck={false} />
            {jsonErr ? <p className="error">{jsonErr}</p> : null}
            <div className="modal-foot">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setJsonEdit(null);
                  setJsonErr('');
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    const d = normalizeDoc(JSON.parse(jsonEdit));
                    setDoc(d);
                    setJsonEdit(null);
                    setJsonErr('');
                  } catch (e) {
                    setJsonErr(`형식 오류: ${e.message} (쉼표·따옴표를 확인해 주세요)`);
                  }
                }}
              >
                적용
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
