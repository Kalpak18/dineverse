import { useRef, useEffect } from 'react';

/**
 * OtpInput — 6 separate digit boxes with auto-focus, backspace navigation, and paste support.
 *
 * Props:
 *   value      string   e.g. "123456" (partial values like "123" are fine)
 *   onChange   fn(str)  called with the full digit string on every change
 *   length     number   defaults to 6
 *   autoFocus  bool     focus the first box on mount
 *   disabled   bool
 */
export default function OtpInput({ value = '', onChange, length = 6, autoFocus = false, disabled = false }) {
  const inputs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || '');

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  const emit = (arr) => onChange?.(arr.join(''));

  const handleChange = (i, e) => {
    const char = e.target.value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = char;
    emit(next);
    if (char && i < length - 1) {
      inputs.current[i + 1]?.focus();
    }
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      if (digits[i]) {
        const next = [...digits];
        next[i] = '';
        emit(next);
      } else if (i > 0) {
        inputs.current[i - 1]?.focus();
      }
    }
    if (e.key === 'ArrowLeft'  && i > 0)          inputs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < length - 1) inputs.current[i + 1]?.focus();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    const next = Array.from({ length }, (_, i) => pasted[i] || '');
    emit(next);
    const focusIdx = Math.min(pasted.length, length - 1);
    inputs.current[focusIdx]?.focus();
  };

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (inputs.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[i]}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          className={`w-11 h-12 text-center text-xl font-bold rounded-xl border-2 outline-none transition-all select-none
            ${digits[i]
              ? 'border-brand-500 bg-brand-50 text-brand-700'
              : 'border-gray-200 bg-white text-gray-900'}
            focus:border-brand-400 focus:ring-2 focus:ring-brand-200
            disabled:opacity-50 disabled:cursor-not-allowed`}
        />
      ))}
    </div>
  );
}
