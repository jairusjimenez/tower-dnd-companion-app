import {
  computeActiveEffectModifiers,
  computeCharacterMoveSpaces,
  computePassiveModifiers,
  computeReachableMoveCells,
  spaceDistanceBetweenPoints,
  type Character,
  type MapToken,
  type StoryBeat,
} from '@shared/index';

export type NpcInteractReachResult =
  | { status: 'adjacent'; directDist: number }
  | { status: 'reachable'; x: number; y: number; steps: number; directDist: number; maxSpaces: number }
  | { status: 'unreachable'; directDist: number; maxSpaces: number };

export function findClosestNpcInteractCell({
  arena,
  myTok,
  npcTok,
  me,
  combatRound = 1,
  beatFloor = 1,
}: {
  arena: NonNullable<StoryBeat['arena']>;
  myTok: MapToken;
  npcTok: MapToken;
  me: Character;
  combatRound?: number;
  beatFloor?: number;
}): NpcInteractReachResult {
  const directDist = spaceDistanceBetweenPoints(
    Number(myTok.x || 0),
    Number(myTok.y || 0),
    Number(npcTok.x || 0),
    Number(npcTok.y || 0),
  );
  if (directDist <= 1) {
    return { status: 'adjacent', directDist };
  }

  const pMods = computePassiveModifiers(me);
  const effMods = computeActiveEffectModifiers(me.activeEffects);
  const r1Bonus = combatRound <= 1 ? (pMods.round1MoveBonus || 0) : 0;
  const maxSpaces = computeCharacterMoveSpaces({
    agi: me.stats?.AGI ?? me.stats?.DEX ?? 10,
    floor: beatFloor,
    passiveSpeedBonus: pMods.bonusSpeedSpaces,
    round1Bonus: r1Bonus,
    effectSpeedDelta: effMods.speedDelta,
  }).total;

  const blockingTokens = (arena.tokens || [])
    .filter((t) => t.id !== myTok.id && (t.type === 'monster' || t.type === 'npc'))
    .map((t) => ({ x: t.x, y: t.y }));

  const reachable = computeReachableMoveCells({
    startX: Number(myTok.x || 0),
    startY: Number(myTok.y || 0),
    maxSpaces,
    cols: arena.cols || 20,
    rows: arena.rows || 20,
    terrain: [...(arena.terrain || []), ...blockingTokens],
  });

  const candidates: Array<{ x: number; y: number; steps: number; euclid: number; cardinal: number }> = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const cx = Number(npcTok.x || 0) + dx;
      const cy = Number(npcTok.y || 0) + dy;
      const steps = reachable.distByKey.get(`${cx},${cy}`);
      if (steps === undefined) continue;
      candidates.push({
        x: cx,
        y: cy,
        steps,
        euclid: Math.hypot(cx - Number(myTok.x || 0), cy - Number(myTok.y || 0)),
        cardinal: dx === 0 || dy === 0 ? 0 : 1,
      });
    }
  }

  if (candidates.length === 0) {
    return { status: 'unreachable', directDist, maxSpaces };
  }

  candidates.sort((a, b) => a.steps - b.steps || a.euclid - b.euclid || a.cardinal - b.cardinal);
  const best = candidates[0];
  return {
    status: 'reachable',
    x: best.x,
    y: best.y,
    steps: best.steps,
    directDist,
    maxSpaces,
  };
}
