/**
 * nonce.ts
 * The per-request CSP nonce, handed from entry.server.tsx to root.tsx.
 *
 * A context rather than load context: react-router-serve builds the load
 * context itself. On the client the value is empty — browsers hide a nonce
 * attribute from the DOM after parsing, and hydration does not re-run scripts.
 */
import { createContext, useContext } from "react";

export const NonceContext = createContext<string>("");
export const useNonce = () => useContext(NonceContext);
