// Display name for a table: "5" → "Table 5"; labels that already name the
// table ("Table 5", "Patio — Table 5") are kept as they are — avoids
// "Table Table 5". Empty → "Table —".
export function tableName(t) {
  const s = String(t ?? '').trim();
  if (!s) return 'Table —';
  return /^\d+$/.test(s) ? `Table ${s}` : s;
}
