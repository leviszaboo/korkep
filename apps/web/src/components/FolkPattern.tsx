export function FolkPattern() {
  return (
    <svg
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <pattern id="folk" width="64" height="64" patternUnits="userSpaceOnUse">
          <g transform="translate(32,32)" fill="var(--ac)">
            {[0, 90, 180, 270].map((a) => (
              <path
                key={a}
                d="M0,-3 C2.5,-5.5 2.5,-9 0,-11 C-2.5,-9 -2.5,-5.5 0,-3Z"
                transform={`rotate(${a})`}
              />
            ))}
            <circle r="2" />
          </g>
          <circle cx="0" cy="0" r="1.5" fill="var(--ac)" />
          <circle cx="64" cy="0" r="1.5" fill="var(--ac)" />
          <circle cx="0" cy="64" r="1.5" fill="var(--ac)" />
          <circle cx="64" cy="64" r="1.5" fill="var(--ac)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#folk)" opacity="0.04" />
    </svg>
  );
}
