import { useRef } from 'react';

export function ResizeSeparator({ label, value, min, max, initial, horizontal = false, onChange }: { label: string; value: number; min: number; max: number; initial: number; horizontal?: boolean; onChange: (value: number) => void }) {
  const drag = useRef({ coordinate: 0, value: 0 });
  const change = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return <div className={`resize-separator${horizontal ? ' resize-horizontal' : ''}`} role="separator" tabIndex={0} aria-label={label} aria-orientation={horizontal ? 'horizontal' : 'vertical'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)}
    onDoubleClick={() => change(initial)} onKeyDown={(e) => { const back = horizontal ? 'ArrowUp' : 'ArrowLeft', forward = horizontal ? 'ArrowDown' : 'ArrowRight'; if (![back, forward, 'Home', 'End'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); change(e.key === 'Home' ? min : e.key === 'End' ? max : value + (e.key === back ? -1 : 1) * (horizontal ? -1 : 1) * (e.shiftKey ? 32 : 8)); }}
    onPointerDown={(e) => { if (e.button !== 0) return; drag.current = { coordinate: horizontal ? e.clientY : e.clientX, value }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) change(drag.current.value + ((horizontal ? e.clientY : e.clientX) - drag.current.coordinate) * (horizontal ? -1 : 1)); }}
    onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} />;
}
