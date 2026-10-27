// Minimal RFC-4180 CSV parser for menu imports: quoted fields (with commas,
// newlines and "" escapes), CRLF/LF, and the BOM Excel adds. Returns rows as
// objects keyed by normalised header names (see HEADER_ALIASES).

const HEADER_ALIASES = {
  item: 'name', item_name: 'name', dish: 'name', name: 'name',
  price: 'price', rate: 'price', mrp: 'price',
  category: 'category', section: 'category',
  description: 'description', desc: 'description',
  veg: 'is_veg', is_veg: 'is_veg', type: 'is_veg', veg_non_veg: 'is_veg',
  tags: 'tags',
  hindi_name: 'hi_name', hi_name: 'hi_name', hindi_description: 'hi_description', hi_description: 'hi_description',
  marathi_name: 'mr_name', mr_name: 'mr_name', marathi_description: 'mr_description', mr_description: 'mr_description',
};

const normHeader = (h) => {
  const key = String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return HEADER_ALIASES[key] || key;
};

export function parseCsvRows(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

// → { headers, records } — records are { name, price, … } objects
export function parseCsv(text) {
  const [header, ...body] = parseCsvRows(text);
  if (!header) return { headers: [], records: [] };
  const headers = header.map(normHeader);
  const records = body.map((cells) => Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()])));
  return { headers, records };
}

export const MENU_CSV_TEMPLATE =
  'name,price,category,description,veg,tags,hindi_name,marathi_name\n' +
  'Masala Dosa,140,South Indian,"Crisp crepe, potato filling",veg,spicy,मसाला डोसा,मसाला डोसा\n' +
  'Chicken 65,260,Starters,Spicy fried chicken,non-veg,spicy,चिकन 65,चिकन 65\n';
