export function TulipLogo() {
  return (
    <svg width="26" height="26" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">
      <path d="M24 8C24 8 18 14 18 20C18 24 20.5 26 24 26C27.5 26 30 24 30 20C30 14 24 8 24 8Z" />
      <path d="M18 20C14 16 10 17 9 20C8 23 11 25 15 24C17 23.5 18 22 18 20Z" />
      <path d="M30 20C34 16 38 17 39 20C40 23 37 25 33 24C31 23.5 30 22 30 20Z" />
      <path d="M23 26L23 40C23 40 23 42 24 42C25 42 25 40 25 40L25 26Z" />
      <path d="M23 34C19 32 15 33 14 35C13 37 15 38 19 37C21 36.5 22.5 35.5 23 34Z" />
      <path d="M25 31C29 29 33 30 34 32C35 34 33 35 29 34C27 33.5 25.5 32.5 25 31Z" />
    </svg>
  );
}

export function TulipLogoSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true" opacity={0.25}>
      <path d="M24 8C24 8 18 14 18 20C18 24 20.5 26 24 26C27.5 26 30 24 30 20C30 14 24 8 24 8Z" />
      <path d="M18 20C14 16 10 17 9 20C8 23 11 25 15 24C17 23.5 18 22 18 20Z" />
      <path d="M30 20C34 16 38 17 39 20C40 23 37 25 33 24C31 23.5 30 22 30 20Z" />
      <path d="M23 26L23 40C23 40 23 42 24 42C25 42 25 40 25 40L25 26Z" />
      <path d="M23 34C19 32 15 33 14 35C13 37 15 38 19 37C21 36.5 22.5 35.5 23 34Z" />
      <path d="M25 31C29 29 33 30 34 32C35 34 33 35 29 34C27 33.5 25.5 32.5 25 31Z" />
    </svg>
  );
}

export function FolkDivider() {
  return (
    <div className="flex items-center justify-center py-2" aria-hidden="true">
      <svg width="400" height="32" viewBox="0 0 400 32" fill="currentColor" className="max-w-full">
        {/* Left branch */}
        <path d="M200 28Q180 26 160 20Q140 14 120 16Q100 18 80 14Q60 10 40 14" fill="none" stroke="currentColor" strokeWidth="1" />
        <circle cx="120" cy="14" r="3" />
        <circle cx="90" cy="14" r="2" />
        <circle cx="60" cy="12" r="1.8" />
        <path d="M150 18C146 15 143 15.5 142 17C141 18.5 143.5 19.5 147 18.5Z" />
        <circle cx="135" cy="16" r="1.2" />
        <circle cx="105" cy="15" r="1.2" />

        {/* Central tulip */}
        <path d="M200 6C200 6 196.5 10 196.5 13C196.5 15 198 16 200 16C202 16 203.5 15 203.5 13C203.5 10 200 6 200 6Z" />
        <path d="M196.5 13C194.5 11 192.5 11.5 192 13C191.5 14.5 193 15 195 14.5Z" />
        <path d="M203.5 13C205.5 11 207.5 11.5 208 13C208.5 14.5 207 15 205 14.5Z" />
        <path d="M199.2 16L199.2 28Q199.2 28.5 200 28.5Q200.8 28.5 200.8 28L200.8 16Z" />

        {/* Right branch (mirror) */}
        <path d="M200 28Q220 26 240 20Q260 14 280 16Q300 18 320 14Q340 10 360 14" fill="none" stroke="currentColor" strokeWidth="1" />
        <circle cx="280" cy="14" r="3" />
        <circle cx="310" cy="14" r="2" />
        <circle cx="340" cy="12" r="1.8" />
        <path d="M250 18C254 15 257 15.5 258 17C259 18.5 256.5 19.5 253 18.5Z" />
        <circle cx="265" cy="16" r="1.2" />
        <circle cx="295" cy="15" r="1.2" />
      </svg>
    </div>
  );
}

export function FooterEmbroidery() {
  return (
    <div className="flex flex-col items-center gap-3" aria-hidden="true">
      <svg width="500" height="52" viewBox="0 0 500 52" fill="currentColor" className="max-w-full">
        {/* Central tulip */}
        <path d="M250 4C250 4 243 12 243 18C243 22 246 24.5 250 24.5C254 24.5 257 22 257 18C257 12 250 4 250 4Z" />
        <path d="M243 18C239 14 235 14.5 234 17C233 19.5 236 20.5 239 19.5Z" />
        <path d="M257 18C261 14 265 14.5 266 17C267 19.5 264 20.5 261 19.5Z" />
        <path d="M248.5 24.5L248.5 46" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <path d="M251.5 24.5L251.5 46" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <path d="M248.5 32Q241 29 238 32Q241 35 248.5 32Z" />
        <path d="M251.5 38Q259 35 262 38Q259 41 251.5 38Z" />

        {/* Left flower */}
        <circle cx="150" cy="22" r="5" />
        <circle cx="150" cy="22" r="2.5" className="fill-base" />
        <path d="M150 27L150 46" stroke="currentColor" strokeWidth="1.1" fill="none" />
        <path d="M150 35Q143 33 140 35Q143 37 150 35Z" />

        {/* Right flower */}
        <circle cx="350" cy="22" r="5" />
        <circle cx="350" cy="22" r="2.5" className="fill-base" />
        <path d="M350 27L350 46" stroke="currentColor" strokeWidth="1.1" fill="none" />
        <path d="M350 35Q357 33 360 35Q357 37 350 35Z" />

        {/* Connecting vines */}
        <path d="M30 34Q70 24 110 28Q130 30 150 27" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <path d="M350 27Q370 30 390 28Q430 24 470 34" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <path d="M155 24Q180 16 210 20Q230 22 248 28" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <path d="M252 28Q270 22 290 20Q320 16 345 24" fill="none" stroke="currentColor" strokeWidth="1.1" />

        {/* Berries */}
        <circle cx="70" cy="28" r="2.5" />
        <circle cx="110" cy="26" r="2" />
        <circle cx="180" cy="18" r="2" />
        <circle cx="210" cy="19" r="2.5" />
        <circle cx="290" cy="19" r="2.5" />
        <circle cx="320" cy="18" r="2" />
        <circle cx="390" cy="26" r="2" />
        <circle cx="430" cy="28" r="2.5" />

        {/* Small leaves */}
        <path d="M90 30Q86 25 93 25Q89 28 90 30Z" />
        <path d="M410 30Q414 25 407 25Q411 28 410 30Z" />
      </svg>
      <span className="text-xs text-faint">Körkép — Hungarian News Panorama</span>
    </div>
  );
}
