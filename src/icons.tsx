const paths = {
  bookmark: <path d="M8 3.5h8a2 2 0 0 1 2 2v14.2a.8.8 0 0 1-1.25.66L12 17l-4.75 3.36A.8.8 0 0 1 6 19.7V5.5a2 2 0 0 1 2-2Z" />,
  history: <><path d="M3 5v5h5M3.5 10A8.5 8.5 0 1 1 4 16" /><path d="M12 7v5l3 2" /></>,
  edit: <><path d="m14 5 5 5M5 15l10.8-10.8a2.8 2.8 0 0 1 4 4L9 19l-4.7 1a.6.6 0 0 1-.7-.7Z" /><path d="M13 20h7" /></>,
  moon: <path d="M20.5 14.1A8.8 8.8 0 0 1 9.9 3.5a8.8 8.8 0 1 0 10.6 10.6Z" />,
  camera: <><path d="M8 6.5 9.5 4h5L16 6.5h3A2 2 0 0 1 21 8.5v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="4" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  rotate: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  download: <><path d="M12 3.5v11M8 11l4 4 4-4M4.5 16v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V16" /></>,
  print: <><path d="M7 8V3h10v5M7 17H4a1 1 0 0 1-1-1v-5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5a1 1 0 0 1-1 1h-3" /><path d="M7 14h10v7H7ZM17 11h1" /></>,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  file: <><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-.6-1.4l-3.5-3.5a2 2 0 0 0-1.4-.6Z" /><path d="M13 3.5V8a1.5 1.5 0 0 0 1.5 1.5H19M8.5 13h7M8.5 16.5h4" /></>,
  upload: <><path d="M12 15V4M8 8l4-4 4 4M4.5 16v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V16" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  cursor: <path d="M5.1 4.4a.7.7 0 0 1 1-.7l13 7a.7.7 0 0 1-.2 1.3l-6 1a1.3 1.3 0 0 0-1 .8l-2.3 5.6a.7.7 0 0 1-1.3-.1Z" />,
  hand: <path d="M8 12V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-2a6 6 0 0 1-4.8-2.4L3 13.5a1.5 1.5 0 0 1 2.4-1.8L8 15" />,
  highlight: <><path d="m10 7 3-3a1.5 1.5 0 0 1 2.1 0l5 5a1.5 1.5 0 0 1 0 2.1l-7.5 7.5a1.5 1.5 0 0 1-1.1.4H7.5a1 1 0 0 1-1-1v-4a1.5 1.5 0 0 1 .4-1.1L10 10M10 7l7 7M6.5 18.5 4 21h7" /></>,
  signature: <><path d="M3 16.5c2-.2 3.4-8.5 5.6-8.5 1.8 0 .6 7.5 3 7.5 1.6 0 2-3.6 3.6-3.6 1.3 0 1.2 2.4 2.8 2.4 1 0 1.8-.8 3-1.8" /><path d="M3 20.5h18" /></>,
  pen: <><path d="m14 5 5 5M5.2 15.8 16.5 4.5a2.1 2.1 0 0 1 3 3L8.2 18.8a1.5 1.5 0 0 1-.7.4l-3 .7a.7.7 0 0 1-.9-.9l.7-3a1.5 1.5 0 0 1 .4-.7Z" /><path d="m5.5 15.5 3 3" /></>,
  text: <><path d="M5 7V5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5V7M12 4v16M9 20h6" /></>,
  book: <><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z" /><path d="M12 5v15" /></>,
  fitWidth: <><path d="M3 12h18" /><path d="m7 8-4 4 4 4M17 8l4 4-4 4" /></>,
  fitPage: <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 12h6" /></>,
  trash: <><path d="M4.5 7h15M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M6.5 7l.8 11.6a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7M10 11v5.5M14 11v5.5" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></>,
  note: <><path d="M6 4h12a2 2 0 0 1 2 2v9.2a2 2 0 0 1-.6 1.4l-2.8 2.8a2 2 0 0 1-1.4.6H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M20 15h-3.5a1.5 1.5 0 0 0-1.5 1.5V20M8 8.5h8M8 12h5" /></>,
  sparkle: <><path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9Z" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  screenshot: <><path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5" /><path d="M12 9v6M9 12h6" /></>,
  install: <><circle cx="12" cy="12" r="8.5" /><path d="M12 16V8M8.5 11.5 12 8l3.5 3.5" /></>,
  send: <><path d="M12 19V5M6 11l6-6 6 6" /></>,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  settings: <><path d="M9.5 4.5a1.5 1.5 0 0 1 1.4-1h2.2a1.5 1.5 0 0 1 1.4 1l.5 1.4 1.5.9 1.5-.3a1.5 1.5 0 0 1 1.6.7l1.1 1.9a1.5 1.5 0 0 1-.2 1.7l-1 1.2v1.7l1 1.2a1.5 1.5 0 0 1 .2 1.7l-1.1 1.9a1.5 1.5 0 0 1-1.6.7l-1.5-.3-1.5.9-.5 1.4a1.5 1.5 0 0 1-1.4 1h-2.2a1.5 1.5 0 0 1-1.4-1L9 19.8l-1.5-.9-1.5.3a1.5 1.5 0 0 1-1.6-.7l-1.1-1.9a1.5 1.5 0 0 1 .2-1.7l1-1.2V12l-1-1.2a1.5 1.5 0 0 1-.2-1.7l1.1-1.9A1.5 1.5 0 0 1 6 6.5l1.5.3L9 5.9Z" /><circle cx="12" cy="12.8" r="3" /></>,
  more: <><circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none" /></>,
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14.5h8" /></>,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="app-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      // Keep compact glyphs at 1.5 CSS px instead of thinning the stroke with the viewBox.
      strokeWidth={Math.max(1.8, 36 / size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
