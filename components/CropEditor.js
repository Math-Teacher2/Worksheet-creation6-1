'use client';

// 교과서 그림 영역을 직접 지정하는 편집기 (드래그로 사각형 그리기)
import { useEffect, useRef, useState } from 'react';
import { pagePreview } from '../lib/figures';
import { figureCandidates } from '../lib/pdfClient';

export default function CropEditor({ file, initial, title, onApply, onCancel }) {
  const [page, setPage] = useState(initial?.page || 1);
  const [img, setImg] = useState(null);
  const [box, setBox] = useState(initial?.box || null); // [ymin,xmin,ymax,xmax] 0~1000
  const [refine, setRefine] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cands, setCands] = useState([]);
  const wrapRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    let alive = true;
    setImg(null);
    setBox(initial && initial.page === page ? initial.box : null);
    setCands([]);
    pagePreview(file, page, 1000)
      .then((p) => alive && setImg(p))
      .catch(() => alive && setImg({ error: true }));
    figureCandidates(file, page)
      .then((c) => alive && setCands(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [file, page]);

  const toUnit = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 1000;
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * 1000;
    return { x, y };
  };
  const onDown = (e) => {
    if (!wrapRef.current) return;
    if (e.target?.dataset?.cand) return; // 후보 상자를 누른 경우는 그 후보를 고름
    e.preventDefault();
    wrapRef.current.setPointerCapture?.(e.pointerId);
    const p = toUnit(e);
    drag.current = p;
    setBox([p.y, p.x, p.y, p.x]);
  };
  const onMove = (e) => {
    if (!drag.current) return;
    const p = toUnit(e);
    const s = drag.current;
    setBox([Math.min(s.y, p.y), Math.min(s.x, p.x), Math.max(s.y, p.y), Math.max(s.x, p.x)]);
  };
  const onUp = () => {
    drag.current = null;
  };

  const valid = box && box[2] - box[0] > 8 && box[3] - box[1] > 8;
  const pageCount = img?.pageCount || 0;

  return (
    <div className="modal no-print" role="dialog" aria-modal="true">
      <div className="modal-card crop">
        <div className="modal-head">
          <b>{title || '그림 위치 조정'}</b>
          <span className="hint">파란 점선 상자(앱이 찾은 그림)를 누르면 바로 그 그림이 선택됩니다. 맞는 상자가 없으면 마우스(또는 손가락)로 드래그해 사각형을 그리세요.</span>
        </div>
        <div className="crop-tools">
          <button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ◀ 이전 쪽
          </button>
          <span>
            PDF {page}
            {pageCount ? ` / ${pageCount}` : ''}쪽
          </span>
          <button type="button" className="secondary" disabled={pageCount && page >= pageCount} onClick={() => setPage((p) => p + 1)}>
            다음 쪽 ▶
          </button>
          <label className="check">
            <input type="checkbox" checked={refine} onChange={(e) => setRefine(e.target.checked)} /> 여백 자동 보정
          </label>
        </div>
        <div className="crop-stage">
          {!img ? <p className="hint">페이지를 불러오는 중...</p> : null}
          {img?.error ? <p className="error">페이지를 불러오지 못했습니다.</p> : null}
          {img && !img.error ? (
            <div ref={wrapRef} className="crop-wrap" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              <img src={img.url} alt={`교과서 ${page}쪽`} draggable={false} />
              {cands.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  data-cand={c.id}
                  className="cand-rect"
                  title={`그림 후보 ${c.id}`}
                  onClick={() => setBox(c.box)}
                  style={{ top: `${c.box[0] / 10}%`, left: `${c.box[1] / 10}%`, height: `${(c.box[2] - c.box[0]) / 10}%`, width: `${(c.box[3] - c.box[1]) / 10}%` }}
                />
              ))}
              {box ? (
                <div
                  className="crop-rect"
                  style={{ top: `${box[0] / 10}%`, left: `${box[1] / 10}%`, height: `${(box[2] - box[0]) / 10}%`, width: `${(box[3] - box[1]) / 10}%` }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="modal-foot">
          <button type="button" className="secondary" onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onApply({ page, box, refine });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '적용 중...' : '이 영역으로 적용'}
          </button>
        </div>
      </div>
    </div>
  );
}
