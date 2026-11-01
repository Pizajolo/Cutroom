import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

interface TabsProps<T extends string> {
  label: string;
  tabs: readonly T[];
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs<T extends string>({ label, tabs, value, onChange, children, className = '' }: TabsProps<T>) {
  const id = useId();
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const tab = tabs[next];
    if (tab) { onChange(tab); buttons.current.get(tab)?.focus(); }
  };
  return (
    <div className={`tab-layout ${className}`}>
      <div className="tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button key={tab} ref={(element) => { if (element) buttons.current.set(tab, element); else buttons.current.delete(tab); }}
            type="button" role="tab" id={`${id}-tab-${tab}`} aria-controls={`${id}-panel`}
            aria-selected={value === tab} tabIndex={value === tab ? 0 : -1}
            onClick={() => onChange(tab)} onKeyDown={(event) => navigate(event, index)}>{tab}</button>
        ))}
      </div>
      <div className="tab-panel" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${value}`}>{children}</div>
    </div>
  );
}
