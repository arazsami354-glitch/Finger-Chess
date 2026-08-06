import { ReactNode } from 'react';

export function Panel({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`panel ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          {title && <h3 className="text-sm font-display font-semibold tracking-wide text-ink">{title}</h3>}
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function StatCard({ label, value, sublabel, tone = 'default' }: { label: string; value: string; sublabel?: string; tone?: 'default' | 'gain' | 'loss' | 'warn' }) {
  const toneClass = { default: 'text-ink', gain: 'text-gain', loss: 'text-loss', warn: 'text-warn' }[tone];
  return (
    <div className="panel p-5">
      <div className="text-xs uppercase tracking-wider text-ink-muted mb-2">{label}</div>
      <div className={`font-mono text-2xl font-semibold ${toneClass}`}>{value}</div>
      {sublabel && <div className="text-xs text-ink-faint mt-1">{sublabel}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'gain' | 'loss' | 'warn' | 'info' }) {
  const toneClasses = {
    default: 'bg-surface-raised text-ink-muted border-border',
    gain: 'bg-gain/10 text-gain border-gain/30',
    loss: 'bg-loss/10 text-loss border-loss/30',
    warn: 'bg-warn/10 text-warn border-warn/30',
    info: 'bg-info/10 text-info border-info/30',
  }[tone];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border transition-colors duration-200 ${toneClasses}`}>{children}</span>;
}

export function Button({ children, onClick, tone = 'default', disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; tone?: 'default' | 'brass' | 'danger'; disabled?: boolean; type?: 'button' | 'submit' }) {
  const toneClasses = {
    default: 'bg-surface-raised hover:bg-border text-ink border border-border',
    brass: 'bg-brass hover:bg-brass-bright text-canvas font-medium border border-brass shadow-soft',
    danger: 'bg-loss/10 hover:bg-loss/20 text-loss border border-loss/30',
  }[tone];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded text-sm transition-all duration-200 ease-premium active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${toneClasses}`}
    >
      {children}
    </button>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="text-center py-10 text-ink-faint text-sm">{message}</div>;
}

export function LoadingRow() {
  return <div className="text-center py-10 text-ink-faint text-sm font-mono">loading…</div>;
}
