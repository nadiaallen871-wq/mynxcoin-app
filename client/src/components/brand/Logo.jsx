import { Link } from 'react-router';
import { cn } from '../../utils/format.js';

export function Logo({ to = '/', inverted = false, className }) {
  return (
    <Link
      to={to}
      className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', inverted ? 'text-white' : 'text-ink', className)}
      aria-label="Mynx home"
    >
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill={inverted ? '#ffffff' : '#0b1f33'} />
        <path
          d="M8 22V10l8 7 8-7v12"
          fill="none"
          stroke={inverted ? '#047857' : '#34d399'}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-lg">Mynx</span>
    </Link>
  );
}
