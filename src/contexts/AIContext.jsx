import { createContext, useContext, useState } from 'react';

export const AIContext = createContext(null);

export function useAI() {
  return useContext(AIContext);
}

export function AIProvider({ children }) {
  // Pending action that Swap / Liquidity pages should apply on mount
  const [pendingAction, setPendingAction] = useState(null);
  // Whether the assistant panel is open
  const [isOpen, setIsOpen] = useState(false);

  function clearPendingAction() {
    setPendingAction(null);
  }

  return (
    <AIContext.Provider value={{
      pendingAction,
      setPendingAction,
      clearPendingAction,
      isOpen,
      setIsOpen,
    }}>
      {children}
    </AIContext.Provider>
  );
}
