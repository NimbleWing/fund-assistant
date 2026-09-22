// 指标公式提示：label 后跟 ⓘ 小图标，点击切换公式气泡（再点或点外部关闭）。
import { useEffect, useRef, useState } from 'react';

export function MetricTip({ label, tip }: { label: string; tip?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <span className="tip" ref={ref}>
      {label}
      {tip != null && (
        <button type="button" className="tip-btn" aria-label={`${label}计算公式`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          ⓘ
        </button>
      )}
      {open && tip != null && (
        <span className="tip-bubble" role="tooltip">
          {tip}
        </span>
      )}
    </span>
  );
}
