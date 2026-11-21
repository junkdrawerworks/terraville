// Types for edge-guard.js, the house kit's module (kept as the kit has it): see that file for what it does.
export interface EdgeGuard {
  /** Whether a Back now would be a slip: a finger down on a surface, or one taken from it within slipMs. */
  slip(): boolean;
  /** Watch another surface. */
  watch(el: Element): void;
}

export function guardEdges(options?: {
  surfaces?: Element[];
  history?: boolean;
  onBack?: (() => void) | null;
  slipMs?: number;
}): EdgeGuard;
