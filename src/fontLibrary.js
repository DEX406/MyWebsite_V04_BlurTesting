// Central font library config.
// Update GOOGLE_FONT_STYLESHEETS to swap fonts without touching the rest of the app.

export const GOOGLE_FONT_STYLESHEETS = [
  'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,100..1000&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&display=swap',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&display=swap',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap',
];

export const CUSTOM_FONTS = [
  { label: 'DM Sans', value: "'DM Sans', sans-serif" },
  { label: 'Inter', value: "'Inter', sans-serif" },
  { label: 'IBM Plex Sans', value: "'IBM Plex Sans', sans-serif" },
  { label: 'Outfit', value: "'Outfit', sans-serif" },
  { label: 'Space Grotesk', value: "'Space Grotesk', sans-serif" },
];

function ensureStylesheet(url) {
  const key = encodeURIComponent(url);
  let link = document.head.querySelector(`link[data-app-font-key="${key}"]`);
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset.appFontKey = key;
    document.head.appendChild(link);
  }

  return new Promise((resolve) => {
    if (link.sheet) {
      resolve();
      return;
    }
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
  });
}

async function waitForConfiguredFaces() {
  // Load regular/bold/italic faces to avoid first-render fallback in canvas rasterization.
  const jobs = CUSTOM_FONTS.flatMap((font) => ([
    document.fonts.load(`normal 24px ${font.value}`),
    document.fonts.load(`italic 24px ${font.value}`),
    document.fonts.load(`700 24px ${font.value}`),
  ]));
  await Promise.all(jobs);
  await document.fonts.ready;
}

export async function loadConfiguredFonts() {
  await Promise.all(GOOGLE_FONT_STYLESHEETS.map(ensureStylesheet));
  await waitForConfiguredFaces();
}
