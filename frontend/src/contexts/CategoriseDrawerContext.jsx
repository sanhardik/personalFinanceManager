import { createContext, useContext, useState } from 'react';

const CategoriseDrawerContext = createContext({ isOpen: false, open: () => {}, close: () => {} });

export function CategoriseDrawerProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <CategoriseDrawerContext.Provider value={{ isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) }}>
      {children}
    </CategoriseDrawerContext.Provider>
  );
}

export const useCategoriseDrawer = () => useContext(CategoriseDrawerContext);
