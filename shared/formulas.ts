/**
 * Safe recursive-descent mathematical formula parser shared by server combat/stat
 * engines and client live preview calculators.
 */
export function evaluateFormula(expression: string | number, variables: Record<string, number> = {}): number {
  const tokens: Array<{ type: 'num'; val: number } | { type: 'id'; val: string } | { type: 'op'; val: string }> = [];
  const str = String(expression ?? '0').trim();
  let i = 0;

  while (i < str.length) {
    const ch = str[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = '';
      while (i < str.length && /[0-9.]/.test(str[i])) {
        numStr += str[i++];
      }
      const val = Number(numStr);
      if (Number.isNaN(val)) throw new Error(`Invalid number "${numStr}"`);
      tokens.push({ type: 'num', val });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = '';
      while (i < str.length && /[a-zA-Z0-9_]/.test(str[i])) {
        id += str[i++];
      }
      tokens.push({ type: 'id', val: id });
      continue;
    }
    if ('+-*/%(),'.includes(ch)) {
      tokens.push({ type: 'op', val: ch });
      i++;
      continue;
    }
    throw new Error(`Unsupported character "${ch}" in formula`);
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  const upperVars: Record<string, number> = {};
  for (const [k, v] of Object.entries(variables)) {
    upperVars[k.toUpperCase()] = Number(v ?? 0);
  }

  function parseExpression(): number {
    let val = parseTerm();
    while (peek()?.type === 'op' && (peek()!.val === '+' || peek()!.val === '-')) {
      const op = (consume() as { type: 'op'; val: string }).val;
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm(): number {
    let val = parseUnary();
    while (peek()?.type === 'op' && ['*', '/', '%'].includes(String(peek()!.val))) {
      const op = (consume() as { type: 'op'; val: string }).val;
      const rhs = parseUnary();
      if (op === '*') val *= rhs;
      else if (op === '/') val = rhs === 0 ? 0 : val / rhs;
      else val = rhs === 0 ? 0 : val % rhs;
    }
    return val;
  }

  function parseUnary(): number {
    if (peek()?.type === 'op' && peek()!.val === '-') {
      consume();
      return -parseUnary();
    }
    if (peek()?.type === 'op' && peek()!.val === '+') {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const tok = peek();
    if (!tok) return 0;

    if (tok.type === 'num') {
      consume();
      return tok.val;
    }

    if (tok.type === 'op' && tok.val === '(') {
      consume();
      const val = parseExpression();
      if (peek()?.type !== 'op' || peek()!.val !== ')') {
        throw new Error('Mismatched parentheses in formula');
      }
      consume();
      return val;
    }

    if (tok.type === 'id') {
      consume();
      const name = tok.val.toLowerCase();
      if (peek()?.type === 'op' && peek()!.val === '(') {
        consume();
        const args: number[] = [];
        if (!(peek()?.type === 'op' && peek()!.val === ')')) {
          args.push(parseExpression());
          while (peek()?.type === 'op' && peek()!.val === ',') {
            consume();
            args.push(parseExpression());
          }
        }
        if (peek()?.type !== 'op' || peek()!.val !== ')') {
          throw new Error(`Unclosed function call ${name}(...)`);
        }
        consume();
        if (name === 'floor') return Math.floor(args[0] ?? 0);
        if (name === 'ceil') return Math.ceil(args[0] ?? 0);
        if (name === 'round') return Math.round(args[0] ?? 0);
        if (name === 'abs') return Math.abs(args[0] ?? 0);
        if (name === 'min') return args.length ? Math.min(...args) : 0;
        if (name === 'max') return args.length ? Math.max(...args) : 0;
        throw new Error(`Unknown function "${name}"`);
      }

      const key = tok.val;
      const upperKey = key.toUpperCase();
      if (key in variables) return Number(variables[key] ?? 0);
      if (upperKey in upperVars) return upperVars[upperKey];
      return 0;
    }

    throw new Error(`Unexpected token in formula`);
  }

  if (tokens.length === 0) return 0;
  const result = parseExpression();
  if (pos < tokens.length) {
    throw new Error('Unexpected trailing tokens in formula');
  }
  return Number.isFinite(result) ? result : 0;
}

export const FEET_PER_SPACE = 5;

export function spacesFromSpeed(speedFt: number): number {
  return Math.max(1, Math.round(Number(speedFt || 30) / FEET_PER_SPACE));
}

export function spaceDistanceBetweenPoints(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function getGridLineCells(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  let cx = x0;
  let cy = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (cx !== x1 || cy !== y1) {
    if (!(cx === x0 && cy === y0) && !(cx === x1 && cy === y1)) {
      cells.push({ x: cx, y: cy });
    }
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
  return cells;
}

export type ArenaCanvasVariant = 'modal' | 'detail' | 'draft';

export function getArenaCellPx(cols: number, variant: ArenaCanvasVariant = 'modal'): number {
  const n = Math.max(8, Number(cols || 20));
  if (variant === 'draft') {
    return n <= 16 ? 26 : n <= 20 ? 22 : n <= 24 ? 19 : 16;
  }
  if (variant === 'detail') {
    return n <= 16 ? 34 : n <= 20 ? 28 : n <= 24 ? 25 : 22;
  }
  return n <= 16 ? 38 : n <= 20 ? 32 : n <= 24 ? 27 : 24;
}
