// A small, consistent design system so PowerCut reads as one product rather
// than a developer dashboard: a dark "outage at night" background with a
// warm candlelight-amber accent, carried through every screen.
export const colors = {
  bg: '#0B0F1C',
  bgPanel: '#131A2E',
  bgCard: '#1C2541',
  bgCardFocused: '#2C3A63',
  border: '#28325420',
  borderFocused: '#FFB347',
  accent: '#FFB347',
  accentDim: '#C98A33',
  text: '#F3F5FA',
  textDim: '#A8B1CC',
  textFaint: '#6D7797',
  feasible: '#4ADE80',
  feasibleDim: '#1E3A2A',
  infeasible: '#FB7185',
  infeasibleDim: '#3A1E27',
  energyTrack: '#28325480',
};

export const spacing = {xs: 6, sm: 12, md: 16, lg: 26, xl: 40};

export const type = {
  title: 38,
  h1: 28,
  h2: 23,
  body: 20,
  small: 15,
};

export const applianceIcon: Record<string, string> = {
  fridge: '🧊',
  router: '📶',
  lamp: '💡',
  phone: '📱',
  laptop: '💻',
  fan: '🌀',
};

export const applianceLabel: Record<string, string> = {
  fridge: 'Fridge',
  router: 'Router',
  lamp: 'Lamp',
  phone: 'Phone',
  laptop: 'Laptop',
  fan: 'Fan',
};
