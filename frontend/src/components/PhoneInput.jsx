import { useState, useRef, useEffect } from 'react';

const COUNTRIES = [
  { code: '+91', flag: '🇮🇳', name: 'India', iso: 'IN' },
  { code: '+1',  flag: '🇺🇸', name: 'USA',   iso: 'US' },
  { code: '+44', flag: '🇬🇧', name: 'UK',    iso: 'GB' },
  { code: '+61', flag: '🇦🇺', name: 'Australia', iso: 'AU' },
  { code: '+971', flag: '🇦🇪', name: 'UAE',  iso: 'AE' },
  { code: '+65', flag: '🇸🇬', name: 'Singapore', iso: 'SG' },
  { code: '+60', flag: '🇲🇾', name: 'Malaysia', iso: 'MY' },
  { code: '+94', flag: '🇱🇰', name: 'Sri Lanka', iso: 'LK' },
  { code: '+977', flag: '🇳🇵', name: 'Nepal', iso: 'NP' },
  { code: '+880', flag: '🇧🇩', name: 'Bangladesh', iso: 'BD' },
];

/**
 * PhoneInput — country code dropdown + phone number field.
 *
 * Props:
 *   value        string  full phone e.g. "+91 9876543210"
 *   onChange     fn(full: string)  called with "+CC number" or ""
 *   placeholder  string
 *   required     bool
 *   error        string
 *   className    string  extra classes on wrapper
 */
export default function PhoneInput({ value = '', onChange, placeholder = 'xxxxxxxxxx', required, error, className = '' }) {
  // Parse existing value into countryCode + local
  const parseValue = (v) => {
    if (!v) return { countryCode: '+91', local: '' };
    for (const c of COUNTRIES) {
      if (v.startsWith(c.code + ' ')) {
        return { countryCode: c.code, local: v.slice(c.code.length + 1) };
      }
    }
    // fallback
    return { countryCode: '+91', local: v };
  };

  const parsed = parseValue(value);
  const [countryCode, setCountryCode] = useState(parsed.countryCode);
  const [local, setLocal] = useState(parsed.local);
  const [open, setOpen] = useState(false);
  const dropRef = useRef(null);

  // Sync internal state when the parent updates the value externally (e.g. country→dial sync)
  useEffect(() => {
    const p = parseValue(value);
    setCountryCode(p.countryCode);
    setLocal(p.local);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const emit = (code, num) => {
    const full = num.trim() ? `${code} ${num.trim()}` : '';
    onChange?.(full);
  };

  const handleCodeSelect = (code) => {
    setCountryCode(code);
    setOpen(false);
    emit(code, local);
  };

  const handleLocalChange = (e) => {
    const num = e.target.value.replace(/[^\d\s\-]/g, '');
    setLocal(num);
    emit(countryCode, num);
  };

  const selected = COUNTRIES.find((c) => c.code === countryCode) || COUNTRIES[0];

  return (
    <div className={`relative ${className}`} ref={dropRef}>
      <div className={`flex border rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-brand-300 ${error ? 'border-red-400' : 'border-gray-200'}`}>
        {/* Country code button */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 border-r border-gray-200 text-sm font-medium text-gray-700 flex-shrink-0 transition-colors"
        >
          <span className="text-base leading-none">{selected.flag}</span>
          <span className="text-xs">{selected.code}</span>
          <svg className={`w-3 h-3 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Phone number input */}
        <input
          type="tel"
          className="flex-1 px-3 py-2.5 text-sm text-gray-900 bg-white outline-none"
          placeholder={placeholder}
          value={local}
          onChange={handleLocalChange}
          required={required}
          inputMode="numeric"
        />
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {COUNTRIES.map((c) => (
            <button
              key={c.iso}
              type="button"
              onClick={() => handleCodeSelect(c.code)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors ${c.code === countryCode ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-700'}`}
            >
              <span className="text-base">{c.flag}</span>
              <span className="flex-1 text-left">{c.name}</span>
              <span className="text-gray-400 text-xs">{c.code}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}
