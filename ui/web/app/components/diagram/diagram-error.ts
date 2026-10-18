import { createContext } from "react";

/**
 * Where a Mermaid block reports a parse error it could not draw, so a "Draw
 * it" diagram can ask for its one repair. Null (the default) means nobody is
 * listening: a diagram a model wrote unasked just shows its source.
 */
export const DiagramErrorContext = createContext<((error: string) => void) | null>(null);
