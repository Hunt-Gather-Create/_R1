// Throwaway probe for _R1#147: a deliberate type error, never imported by
// any test, to prove the new typecheck job goes red while test and
// reachability do not. Deleted with this branch before the real PR.
export const probeTypeError: number = "not a number";
