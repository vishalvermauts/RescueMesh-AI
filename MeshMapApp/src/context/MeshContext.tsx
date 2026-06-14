import React, { createContext, useContext } from 'react';
import { useMobileMesh } from '../hooks/useMobileMesh';

// The context will hold the exact return type of useMobileMesh
type MeshContextType = ReturnType<typeof useMobileMesh>;

const MeshContext = createContext<MeshContextType | null>(null);

/**
 * Provider component — wraps the tab layout so that ONE instance
 * of useMobileMesh is shared across all tabs.
 * 
 * This prevents multiple BleManagers / scanners / advertisers from
 * fighting each other and crashing the BLE stack.
 */
export function MeshProvider({ children }: { children: React.ReactNode }) {
  const mesh = useMobileMesh();
  return <MeshContext.Provider value={mesh}>{children}</MeshContext.Provider>;
}

/**
 * Hook for consuming the shared mesh state.
 * Call this in any tab component instead of useMobileMesh() directly.
 */
export function useSharedMesh(): MeshContextType {
  const ctx = useContext(MeshContext);
  if (!ctx) {
    throw new Error('useSharedMesh must be used within a <MeshProvider>');
  }
  return ctx;
}
