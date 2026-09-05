/**
 * Safe math expression evaluator. Token-based, no `eval` / `new Function`.
 *
 * Grammar (descending precedence):
 *   expr      = term (('+' | '-') term)*
 *   term      = factor (('*' | '/') factor)*
 *   factor    = power ('^' power)*
 *   power     = unary ('!' )?
 *   unary     = '-'? primary
 *   primary   = number | constant | func '(' expr ')' | '(' expr ')'
 *   constant  = 'pi' | 'e'
 *   func      = 'sin'|'cos'|'tan'|'asin'|'acos'|'atan'|'log'|'ln'|'sqrt'|'exp'|'abs'|'pow'
 *
 * Allowlist enforced at the token-recognition layer — anything not matching the
 * grammar throws CalcSyntaxError. No `globalThis`, no `Function` constructor, no
 * `eval`. Safe to feed user-pasted text.
 */

import { ToolError } from '../shared/tool-error';

/**
 * A grammar violation. Carries a `code` and the offending token so the widget can say
 * *which* syntax error in its own language instead of a bare "Syntax error".
 */
export class CalcSyntaxError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'CalcSyntaxError';
  }
}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '^' | '!' | ',' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'ident'; value: string };

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

const UNARY_FUNCTIONS: Record<string, (n: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  exp: Math.exp,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
};

const BINARY_FUNCTIONS: Record<string, (a: number, b: number) => number> = {
  pow: Math.pow,
};

function factorial(n: number): number {
  if (!Number.isFinite(n) || n < 0 || n !== Math.floor(n) || n > 170) return Number.NaN;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i] ?? '';
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const start = i;
      while (i < input.length && /[0-9.]/.test(input[i] ?? '')) i++;
      const num = Number.parseFloat(input.slice(start, i));
      if (!Number.isFinite(num))
        throw new CalcSyntaxError('invalidNumber', `Invalid number at ${start}`, { pos: start });
      tokens.push({ kind: 'num', value: num });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < input.length && /[a-zA-Z_]/.test(input[i] ?? '')) i++;
      tokens.push({ kind: 'ident', value: input.slice(start, i) });
      continue;
    }
    if (
      ch === '+' ||
      ch === '-' ||
      ch === '*' ||
      ch === '/' ||
      ch === '^' ||
      ch === '!' ||
      ch === ','
    ) {
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i++;
      continue;
    }
    throw new CalcSyntaxError('unexpectedChar', `Unexpected character "${ch}" at ${i}`, {
      char: ch,
      pos: i,
    });
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private consume(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new CalcSyntaxError('unexpectedEnd', 'Unexpected end of input');
    this.pos++;
    return t;
  }
  private expectOp(op: string): void {
    const t = this.peek();
    if (!t || t.kind !== 'op' || t.value !== op)
      throw new CalcSyntaxError('expectedToken', `Expected "${op}"`, { token: op });
    this.consume();
  }

  parseExpr(): number {
    return this.parseTerm();
  }

  // expr = term (('+' | '-') term)*
  private parseTerm(): number {
    let left = this.parseFactor();
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== 'op' || (t.value !== '+' && t.value !== '-')) break;
      this.consume();
      const right = this.parseFactor();
      left = t.value === '+' ? left + right : left - right;
    }
    return left;
  }

  // term = factor (('*' | '/') factor)*
  private parseFactor(): number {
    let left = this.parsePower();
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== 'op' || (t.value !== '*' && t.value !== '/')) break;
      this.consume();
      const right = this.parsePower();
      left = t.value === '*' ? left * right : left / right;
    }
    return left;
  }

  // power = postfix ('^' power)*  (right-assoc)
  private parsePower(): number {
    const left = this.parsePostfix();
    const t = this.peek();
    if (t && t.kind === 'op' && t.value === '^') {
      this.consume();
      const right = this.parsePower();
      return left ** right;
    }
    return left;
  }

  // postfix = unary ('!')?
  private parsePostfix(): number {
    let v = this.parseUnary();
    const t = this.peek();
    if (t && t.kind === 'op' && t.value === '!') {
      this.consume();
      v = factorial(v);
    }
    return v;
  }

  // unary = '-'? primary
  private parseUnary(): number {
    const t = this.peek();
    if (t && t.kind === 'op' && t.value === '-') {
      this.consume();
      return -this.parsePrimary();
    }
    if (t && t.kind === 'op' && t.value === '+') {
      this.consume();
      return this.parsePrimary();
    }
    return this.parsePrimary();
  }

  // primary = number | constant | func '(' args ')' | '(' expr ')'
  private parsePrimary(): number {
    const t = this.consume();
    if (t.kind === 'num') return t.value;
    if (t.kind === 'lparen') {
      const v = this.parseExpr();
      this.expectOp = this.expectOp.bind(this);
      const next = this.peek();
      if (!next || next.kind !== 'rparen')
        throw new CalcSyntaxError('expectedClose', 'Expected ")"');
      this.consume();
      return v;
    }
    if (t.kind === 'ident') {
      const name = t.value;
      // Constant (pi, e) — only if not followed by '('
      const after = this.peek();
      const isCall = after && after.kind === 'lparen';
      if (!isCall) {
        const c = CONSTANTS[name];
        if (c === undefined)
          throw new CalcSyntaxError('unknownIdentifier', `Unknown identifier "${name}"`, { name });
        return c;
      }
      // Function call
      this.consume(); // '('
      const args: number[] = [this.parseExpr()];
      while (true) {
        const next = this.peek();
        if (next && next.kind === 'op' && next.value === ',') {
          this.consume();
          args.push(this.parseExpr());
        } else break;
      }
      const close = this.peek();
      if (!close || close.kind !== 'rparen')
        throw new CalcSyntaxError('expectedClose', 'Expected ")"');
      this.consume();
      if (name in UNARY_FUNCTIONS) {
        if (args.length !== 1)
          throw new CalcSyntaxError('takesOneArg', `${name}() takes 1 argument`, { name });
        const fn = UNARY_FUNCTIONS[name];
        if (!fn)
          throw new CalcSyntaxError('unknownFunction', `Unknown function "${name}"`, { name });
        return fn(args[0] ?? 0);
      }
      if (name in BINARY_FUNCTIONS) {
        if (args.length !== 2)
          throw new CalcSyntaxError('takesTwoArgs', `${name}() takes 2 arguments`, { name });
        const fn = BINARY_FUNCTIONS[name];
        if (!fn)
          throw new CalcSyntaxError('unknownFunction', `Unknown function "${name}"`, { name });
        return fn(args[0] ?? 0, args[1] ?? 0);
      }
      throw new CalcSyntaxError('unknownFunction', `Unknown function "${name}"`, { name });
    }
    throw new CalcSyntaxError('unexpectedToken', 'Unexpected token');
  }
}

/**
 * The evaluator's answer with the failure kept structured: `error` is the English label the
 * display has always shown ('Syntax error' / 'Error'), `code` + `params` say which failure so
 * the widget can render a specific, localized message instead.
 */
export type EvalResult =
  | { ok: true; value: number | '' }
  | {
      ok: false;
      error: 'Syntax error' | 'Error';
      code: string;
      params: Record<string, string | number>;
    };

export function evaluate(input: string): EvalResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: '' };
  try {
    const tokens = tokenize(trimmed);
    if (tokens.length === 0) return { ok: true, value: '' };
    const parser = new Parser(tokens);
    const result = parser.parseExpr();
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return { ok: false, error: 'Error', code: 'notFinite', params: {} };
    }
    return { ok: true, value: result };
  } catch (e) {
    if (e instanceof CalcSyntaxError) {
      return { ok: false, error: 'Syntax error', code: e.code, params: e.params };
    }
    return { ok: false, error: 'Error', code: 'unknown', params: {} };
  }
}

/** String-or-number form kept for callers and tests that only branch on the label. */
export function evaluateExpression(input: string): number | string {
  const result = evaluate(input);
  return result.ok ? result.value : result.error;
}
