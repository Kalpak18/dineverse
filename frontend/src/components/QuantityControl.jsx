export default function QuantityControl({ qty, onDecrement, onIncrement }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onDecrement}
        className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-700 transition-colors"
      >
        −
      </button>
      <span className="w-6 text-center font-semibold text-sm text-gray-900">{qty}</span>
      <button
        onClick={onIncrement}
        className="w-7 h-7 rounded-full bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center text-sm font-bold transition-colors"
      >
        +
      </button>
    </div>
  );
}
