export function EPCLogo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-label="Editorial Policy Checker"
    >
      {/* Page */}
      <rect x="5" y="2" width="18" height="24" rx="2" stroke="currentColor" strokeWidth="2" />
      {/* Lines */}
      <line x1="9" y1="9"  x2="19" y2="9"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="13" x2="19" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="17" x2="15" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Check badge */}
      <circle cx="23" cy="23" r="7" fill="hsl(182 98% 22%)" />
      <polyline points="19.5,23 22,25.5 26.5,20.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
