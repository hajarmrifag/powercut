// PowerCut's design system: a single source of truth for color, type,
// spacing, and radius so every screen reads as one considered product
// rather than a set of ad hoc styles. Dark, cinematic "outage at night"
// background; a restrained amber accent for attention and warmth; green
// and coral reserved strictly for feasible/infeasible state, never used
// decoratively. Values are tuned for the Vega Virtual Device's effective
// ~2x dp scale (see docs/VEGA_SDK_FRICTION_LOG.md), not raw 1920x1080 px.
export const colors = {
  bg: '#07090F',
  bgHero: '#0E1324',
  bgPanel: '#131A2E',
  bgCard: '#161D34',
  bgCardFocused: '#283257',
  bgCardCritical: '#1A2440',
  border: '#232C4A',
  borderFocused: '#FFB347',
  divider: '#1E2640',
  accent: '#FFB347',
  accentMuted: '#B98A4E',
  accentSoft: '#3A311F',
  text: '#F5F7FC',
  textDim: '#A8B1CC',
  textFaint: '#626C8C',
  feasible: '#4ADE80',
  feasibleDim: '#17301F',
  infeasible: '#FB7185',
  infeasibleDim: '#331821',
  energyTrack: '#1C2440',
};

export const spacing = {xs: 6, sm: 12, md: 18, lg: 28, xl: 44, xxl: 64};

export const radius = {sm: 10, md: 16, lg: 22, pill: 999};

export const type = {
  display: 64,
  title: 42,
  h1: 28,
  h2: 22,
  body: 19,
  label: 14,
  small: 15,
  caption: 13,
};

export const motion = {
  focusScale: 1.035,
  duration: 120,
};

// Appliance ids double as icon names (Icon component in icons.tsx); kept
// as an explicit export so call sites don't have to assume the mapping.
export const applianceIconName: Record<string, string> = {
  fridge: 'fridge',
  router: 'router',
  lamp: 'lamp',
  phone: 'phone',
  laptop: 'laptop',
  fan: 'fan',
};

export const applianceLabel: Record<string, string> = {
  fridge: 'Fridge',
  router: 'Router',
  lamp: 'Lamp',
  phone: 'Phone',
  laptop: 'Laptop',
  fan: 'Fan',
};
