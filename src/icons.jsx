const I = ({ children, size = 20, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {children}
  </svg>
);

export const PlusIcon = (p) => (
  <I {...p}><path d="M10 2v16M2 10h16" /></I>
);

export const LockIcon = (p) => (
  <I {...p}><path d="M5 9H15a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM6 9V6a4 4 0 0 1 8 0v3" /></I>
);

export const XIcon = (p) => (
  <I {...p}><path d="M4 4l12 12M16 4L4 16" /></I>
);

export const ZoomInIcon = (p) => (
  <I {...p}><path d="M2 9a7 7 0 1 0 14 0A7 7 0 0 0 2 9M14 14l5 5M9 6v6M6 9h6" /></I>
);

export const ZoomOutIcon = (p) => (
  <I {...p}><path d="M2 9a7 7 0 1 0 14 0A7 7 0 0 0 2 9M14 14l5 5M6 9h6" /></I>
);

export const FitIcon = (p) => (
  <I {...p}><path d="M2 7V2h5M13 2h5v5M18 13v5h-5M7 18H2v-5" /></I>
);

export const TextIcon = (p) => (
  <I {...p}><path d="M3 3h14M10 3v14M6 17h8" /></I>
);

export const LinkIcon = (p) => (
  <I {...p}><path d="M12 6h2a4 4 0 0 1 0 8h-2M8 14H6a4 4 0 0 1 0-8h2M7 10h6" /></I>
);

export const ShapeIcon = (p) => (
  <I {...p}><path d="M5 2H15a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z" /></I>
);

export const SaveIcon = (p) => (
  <I {...p}><path d="M2 18h16M10 4v10M6 10l4 4 4-4" /></I>
);

export const FloppyIcon = (p) => (
  <I {...p}><path d="M4 2h10l4 4v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /><path d="M14 18v-5H6v5" /><path d="M6 2v4h7" /></I>
);

export const LoadIcon = (p) => (
  <I {...p}><path d="M2 18h16M10 14V4M6 8l4-4 4 4" /></I>
);

export const GridIcon = (p) => (
  <I {...p}><path d="M3 2H17a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM2 10h16M10 2v16" /></I>
);

export const SunIcon = (p) => (
  <I {...p}><path d="M6.5 10a3.5 3.5 0 1 0 7 0A3.5 3.5 0 0 0 6.5 10M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.22 4.22L5.99 6M14.01 14.01L15.78 15.78M15.78 4.22L14.01 6M5.99 14.01L4.22 15.78" /></I>
);

export const CleanupIcon = (p) => (
  <I {...p}>
    <rect x="2" y="3" width="16" height="6" rx="1" />
    <rect x="2" y="11" width="16" height="6" rx="1" />
    <circle cx="15" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="14" r="1" fill="currentColor" stroke="none" />
    <path d="M4 6h7M4 14h7" />
  </I>
);

export const TrashIcon = (p) => (
  <I {...p}><path d="M3.5 6h13M7.5 6V4.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5V6M5 6l.9 10.5a.5.5 0 0 0 .5.47h7.2a.5.5 0 0 0 .5-.47L15 6" /></I>
);

export const GlobeIcon = (p) => (
  <I {...p}><path d="M2 10a8 8 0 1 0 16 0A8 8 0 0 0 2 10M2 10h16M10 2c-2.5 2-4 4.8-4 8s1.5 6 4 8M10 2c2.5 2 4 4.8 4 8s-1.5 6-4 8" /></I>
);

export const GroupIcon = (p) => (
  <I {...p}>
    {/* Dashed rect must stay as its own element for strokeDasharray */}
    <rect x="1.5" y="1.5" width="17" height="17" rx="2" strokeDasharray="3 2" />
    <path d="M5 4H8a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM12 11H15a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H12a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z" />
  </I>
);

export const UngroupIcon = (p) => (
  <I {...p}>
    <path d="M2 2H7a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM13 12H18a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H13a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z" />
    <path d="M13 7l4-4" strokeDasharray="1.5 1.5" />
  </I>
);

export const ConnectorIcon = (p) => (
  <I {...p}><path d="M1.5 15.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M14.5 4.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M3.5 13.5V9h13V6.5" /></I>
);

export const BringFrontIcon = (p) => (
  <I {...p}>
    <rect x="1" y="1" width="7" height="7" rx="1" />
    <rect x="0" y="10" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />
    <path d="M16 17V3M19 6L16 3" />
  </I>
);

export const SendBackIcon = (p) => (
  <I {...p}>
    <rect x="0" y="0" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />
    <rect x="1" y="11" width="7" height="7" rx="1" />
    <path d="M16 3V17M19 14L16 17" />
  </I>
);

export const TileIcon = (p) => (
  <I {...p}>
    <rect x="2" y="2" width="16" height="16" rx="1.5" />
    <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="13" cy="7" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="7" cy="13" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="13" cy="13" r="1.5" fill="currentColor" stroke="none" />
  </I>
);

export const UndoIcon = (p) => (
  <I {...p}><path d="M4 8l4-4M4 8l4 4M4 8h9a5 5 0 0 1 0 10H12" /></I>
);

export const RedoIcon = (p) => (
  <I {...p}><path d="M16 8l-4-4M16 8l-4 4M16 8H7a5 5 0 0 0 0 10h1" /></I>
);

export const ChevronUpIcon = (p) => (
  <I {...p}><path d="M4 12l6-6 6 6" /></I>
);

export const ChevronDownIcon = (p) => (
  <I {...p}><path d="M4 8l6 6 6-6" /></I>
);

export const MenuBarsIcon = (p) => (
  <I {...p}><path d="M4 6h12M4 10h12M4 14h12" /></I>
);

export const HomeIcon = (p) => (
  <I {...p}><path d="M3 10l7-7 7 7M5 9v7a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V9" /></I>
);

export const SetHomeIcon = (p) => (
  <I {...p}><path d="M3 10l7-7 7 7M5 9v7a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V9" /><circle cx="15" cy="5" r="3" fill="currentColor" stroke="none" /></I>
);

export const CopyIcon = (p) => (
  <I {...p}><rect x="7" y="7" width="10" height="11" rx="1.5" /><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3H3.5A1.5 1.5 0 0 0 2 4.5v10A1.5 1.5 0 0 0 3.5 16H7" /></I>
);

export const PasteIcon = (p) => (
  <I {...p}><rect x="3" y="5" width="14" height="13" rx="1.5" /><path d="M7 5V3.5A1.5 1.5 0 0 1 8.5 2h3A1.5 1.5 0 0 1 13 3.5V5M7 10h6M7 13h4" /></I>
);

export const PaletteIcon = (p) => (
  <I {...p}>
    <path d="M2 10a8 8 0 1 0 16 0A8 8 0 0 0 2 10" />
    {/* Filled dots have stroke="none" so they can't compound */}
    <circle cx="7" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="13" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="10" cy="5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="5.5" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
  </I>
);
