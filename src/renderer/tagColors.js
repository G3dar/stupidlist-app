// Deterministic color palette for project hashtag badges

const TAG_COLORS = [
  { bg: '#e8f0fe', text: '#1a73e8' },  // blue
  { bg: '#fce4ec', text: '#c62828' },  // red
  { bg: '#e8f5e9', text: '#2e7d32' },  // green
  { bg: '#fff3e0', text: '#e65100' },  // orange
  { bg: '#f3e5f5', text: '#7b1fa2' },  // purple
  { bg: '#e0f7fa', text: '#00838f' },  // teal
  { bg: '#fff8e1', text: '#f57f17' },  // yellow
  { bg: '#fce4ec', text: '#ad1457' },  // pink
  { bg: '#e8eaf6', text: '#283593' },  // indigo
  { bg: '#efebe9', text: '#4e342e' },  // brown
];

export function getTagColor(name) {
  // Use the project name (before " / " if it's a list tag) for consistent color
  const key = name.includes(' / ') ? name.split(' / ')[0] : name;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}
