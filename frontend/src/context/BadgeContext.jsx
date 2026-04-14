import { createContext, useContext, useState, useCallback } from 'react';

const BadgeContext = createContext({ badges: {}, setBadge: () => {} });

export function BadgeProvider({ children }) {
  const [badges, setBadgesState] = useState({});

  const setBadge = useCallback((key, count) => {
    setBadgesState((prev) => {
      if (prev[key] === count) return prev;
      return { ...prev, [key]: count };
    });
  }, []);

  return (
    <BadgeContext.Provider value={{ badges, setBadge }}>
      {children}
    </BadgeContext.Provider>
  );
}

export const useBadges = () => useContext(BadgeContext);
