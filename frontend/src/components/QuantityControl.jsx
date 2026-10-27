// 40px circles with a 44px hit area — easy to tap with a thumb
export default function QuantityControl({ qty, onDecrement, onIncrement }) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onDecrement}
        aria-label="Remove one"
        className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 active:bg-gray-300 flex items-center justify-center text-base font-bold text-gray-700 transition-colors touch-manipulation"
      >
        −
      </button>
      <span className="w-7 text-center font-semibold text-base text-gray-900 tabular-nums" aria-live="polite">{qty}</span>
      <button
        type="button"
        onClick={onIncrement}
        aria-label="Add one more"
        className="w-10 h-10 rounded-full bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white flex items-center justify-center text-base font-bold transition-colors touch-manipulation"
      >
        +
      </button>
    </div>
  );
}
