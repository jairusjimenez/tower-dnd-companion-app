import crypto from 'node:crypto';

export function rollSingleDie(sides: number): number {
  const safeSides = Math.max(1, Math.min(100, Math.trunc(Number(sides) || 20)));
  return crypto.randomInt(1, safeSides + 1);
}

export interface DiceRollOptions {
  count?: number;
  sides?: number;
  modifier?: number;
  mode?: string;
  formula?: string;
}

export interface ServerDiceRollOutput {
  count: number;
  sides: number;
  modifier: number;
  mode: string;
  formula: string;
  breakdown: string;
  rolls: number[];
  dropped: number[];
  diceTotal: number;
  total: number;
  isCrit: boolean;
  isFumble: boolean;
}

export function rollDiceServer({
  count = 1,
  sides = 20,
  modifier = 0,
  mode = 'normal',
  formula = '',
}: DiceRollOptions): ServerDiceRollOutput {
  let parsedCount = Math.max(1, Math.min(30, Math.trunc(Number(count) || 1)));
  let parsedSides = Math.max(1, Math.min(100, Math.trunc(Number(sides) || 20)));
  let parsedMod = Math.trunc(Number(modifier) || 0);

  if (formula && typeof formula === 'string') {
    const clean = formula.replace(/\s+/g, '');
    const m = clean.match(/^(\d+)?d(\d+)([+-]\d+)?$/i);
    if (m) {
      parsedCount = Math.max(1, Math.min(30, Number(m[1] || 1)));
      parsedSides = Math.max(1, Math.min(100, Number(m[2])));
      parsedMod = parsedMod + Number(m[3] || 0);
    } else if (/^[+-]?\d+$/.test(clean)) {
      parsedCount = 1;
      parsedSides = 1;
      parsedMod = Number(clean) - 1;
    }
  }

  let rolls: number[] = [];
  let dropped: number[] = [];
  let diceTotal = 0;

  if ((mode === 'advantage' || mode === 'disadvantage') && parsedCount === 1) {
    const a = rollSingleDie(parsedSides);
    const b = rollSingleDie(parsedSides);
    const keep = mode === 'advantage' ? Math.max(a, b) : Math.min(a, b);
    const drop = mode === 'advantage' ? Math.min(a, b) : Math.max(a, b);
    rolls = [keep];
    dropped = [drop];
    diceTotal = keep;
  } else if (mode === 'exploding' && parsedSides > 1) {
    for (let i = 0; i < parsedCount; i++) {
      let guard = 0;
      let r = rollSingleDie(parsedSides);
      rolls.push(r);
      diceTotal += r;
      while (r === parsedSides && guard < 5) {
        guard++;
        r = rollSingleDie(parsedSides);
        rolls.push(r);
        diceTotal += r;
      }
    }
  } else {
    for (let i = 0; i < parsedCount; i++) {
      const r = rollSingleDie(parsedSides);
      rolls.push(r);
      diceTotal += r;
    }
  }

  const total = diceTotal + parsedMod;
  const modSuffix = parsedMod === 0 ? '' : parsedMod > 0 ? `+${parsedMod}` : `${parsedMod}`;
  const displayFormula = `${parsedCount}d${parsedSides}${modSuffix}`;
  const modBreakdown = parsedMod === 0 ? '' : parsedMod > 0 ? ` + ${parsedMod}` : ` - ${Math.abs(parsedMod)}`;
  const breakdown = `[${rolls.join(', ')}]${modBreakdown} = ${total}`;
  const isCrit = parsedSides >= 20 && parsedCount === 1 && rolls[0] === parsedSides;
  const isFumble = parsedSides >= 20 && parsedCount === 1 && rolls[0] === 1;

  return {
    count: parsedCount,
    sides: parsedSides,
    modifier: parsedMod,
    mode,
    formula: displayFormula,
    breakdown,
    rolls,
    dropped,
    diceTotal,
    total,
    isCrit,
    isFumble,
  };
}
