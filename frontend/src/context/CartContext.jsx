import { createContext, useContext, useReducer, useCallback, useState, useEffect } from 'react';

const CartContext = createContext(null);

const STORAGE_KEY = 'dv_cart';

function loadFromStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [] };
    const parsed = JSON.parse(raw);
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

function cartReducer(state, action) {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existing = state.items.find((i) => i.id === action.item.id);
      if (existing) {
        return {
          ...state,
          items: state.items.map((i) =>
            i.id === action.item.id ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }
      return { ...state, items: [...state.items, { ...action.item, quantity: 1 }] };
    }
    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case 'UPDATE_QTY': {
      if (action.qty <= 0) {
        return { ...state, items: state.items.filter((i) => i.id !== action.id) };
      }
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id ? { ...i, quantity: action.qty } : i
        ),
      };
    }
    case 'CLEAR':
      return { items: [] };
    default:
      return state;
  }
}

export function CartProvider({ children }) {
  const [state, dispatch] = useReducer(cartReducer, undefined, loadFromStorage);
  const [cafeCurrency, setCafeCurrency] = useState(() => {
    try { return sessionStorage.getItem('dv_cart_currency') || 'INR'; } catch { return 'INR'; }
  });

  // Persist cart items to sessionStorage on every change
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items })); } catch { /* storage full */ }
  }, [state.items]);

  // Persist currency
  useEffect(() => {
    try { sessionStorage.setItem('dv_cart_currency', cafeCurrency); } catch { /* storage full */ }
  }, [cafeCurrency]);

  const addItem    = useCallback((item) => dispatch({ type: 'ADD_ITEM', item }), []);
  const removeItem = useCallback((id)   => dispatch({ type: 'REMOVE_ITEM', id }), []);
  const updateQty  = useCallback((id, qty) => dispatch({ type: 'UPDATE_QTY', id, qty }), []);
  const clearCart  = useCallback(() => {
    dispatch({ type: 'CLEAR' });
    try { sessionStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem('dv_cart_currency'); } catch { /* ignore */ }
  }, []);

  const total     = state.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ items: state.items, total, itemCount, cafeCurrency, setCafeCurrency, addItem, removeItem, updateQty, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
};
