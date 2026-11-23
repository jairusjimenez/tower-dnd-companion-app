import { computeActiveEffectModifiers, computeReachableMoveCells } from '../../../shared';
import type { ActionRequestContext, ActionResult } from '../actions/types';
import { commitState, pushSystemToast } from './gameHelpers';

export interface AiDmHandlers {
  initiativeAction: (ctx: ActionRequestContext, payload: Record<string, unknown>) => ActionResult;
  monsterAttackAction: (ctx: ActionRequestContext, payload: Record<string, unknown>) => ActionResult;
}

export function runAiDmTurns(
  ctx: ActionRequestContext,
  handlers: AiDmHandlers,
  options?: { advanceCurrentMonsterFirst?: boolean },
): void {
  const beat = (ctx.state.storyBeats || []).find(
    (b) => b.aiDmEnabled && b.beatType !== 'narration' && b.status !== 'resolved' && b.status !== 'failed',
  );
  if (!beat || !beat.arena) return;
  if ((ctx.state.pendingReactions || []).length > 0) return;

  const dmCtx: ActionRequestContext = { ...ctx, role: 'dm' };

  if (options?.advanceCurrentMonsterFirst) {
    const cur = ctx.state.combat.combatants[ctx.state.combat.turnIndex];
    if (cur?.type === 'monster') {
      handlers.initiativeAction(dmCtx, { subAction: 'next_turn', _fromAiDm: true });
    }
  }

  const maxSteps = Math.max(2, (ctx.state.combat.combatants || []).length + 1);
  for (let step = 0; step < maxSteps; step++) {
    if (ctx.state.combat.combatants.length === 0) break;
    if (beat.status === 'failed' || beat.status === 'resolved') break;
    if ((ctx.state.pendingReactions || []).length > 0) break;

    const active = ctx.state.combat.combatants[ctx.state.combat.turnIndex];
    if (!active || active.type !== 'monster') break;

    const mon = (ctx.state.monsters || []).find((m) => m.id === active.id);
    const monTok = (beat.arena.tokens || []).find((t) => t.id === active.id);
    if (!mon || !monTok || Number(mon.hp ?? 0) <= 0) {
      handlers.initiativeAction(dmCtx, { subAction: 'next_turn', _fromAiDm: true });
      continue;
    }

    const effMods = computeActiveEffectModifiers(mon.activeEffects);
    if (effMods.stunned) {
      pushSystemToast(dmCtx, {
        title: `AI DM — ${mon.name}`,
        message: `${mon.name} is Stunned and skips its turn!`,
        category: 'info',
      });
      commitState(dmCtx);
      handlers.initiativeAction(dmCtx, { subAction: 'next_turn', _fromAiDm: true });
      continue;
    }

    const livingPlayers = (beat.arena.tokens || []).filter(
      (t) => t.type === 'player' && Number(ctx.state.characters[t.id]?.hp ?? 0) > 0,
    );
    if (livingPlayers.length === 0) break;

    let nearestPlayer = livingPlayers[0];
    let bestDist = Math.max(Math.abs(nearestPlayer.x - monTok.x), Math.abs(nearestPlayer.y - monTok.y));
    for (const pt of livingPlayers.slice(1)) {
      const d = Math.max(Math.abs(pt.x - monTok.x), Math.abs(pt.y - monTok.y));
      if (d < bestDist) {
        bestDist = d;
        nearestPlayer = pt;
      }
    }

    const monRange = Math.max(1, Number(mon.rangeSpaces || 2));
    const desiredRange = monRange <= 2 ? 1 : monRange;
    if (bestDist > desiredRange && !monTok.hasMovedThisTurn) {
      const maxSpaces = Math.max(1, 6 + effMods.speedDelta);
      const reachable = computeReachableMoveCells({
        startX: monTok.x,
        startY: monTok.y,
        maxSpaces,
        cols: beat.arena.cols,
        rows: beat.arena.rows,
        terrain: beat.arena.terrain,
      });
      const occupied = new Set(
        (beat.arena.tokens || []).filter((t) => t.id !== monTok.id).map((t) => `${t.x},${t.y}`),
      );
      let bestCell: { x: number; y: number } | null = null;
      let bestCheb = bestDist;
      let bestManh = Math.abs(nearestPlayer.x - monTok.x) + Math.abs(nearestPlayer.y - monTok.y);
      for (const c of reachable.cells) {
        if (occupied.has(`${c.x},${c.y}`)) continue;
        const cheb = Math.max(Math.abs(nearestPlayer.x - c.x), Math.abs(nearestPlayer.y - c.y));
        const manh = Math.abs(nearestPlayer.x - c.x) + Math.abs(nearestPlayer.y - c.y);
        if (cheb < bestCheb || (cheb === bestCheb && manh < bestManh)) {
          bestCheb = cheb;
          bestManh = manh;
          bestCell = c;
        }
      }
      if (bestCell) {
        monTok.x = bestCell.x;
        monTok.y = bestCell.y;
        monTok.hasMovedThisTurn = true;
        pushSystemToast(dmCtx, {
          title: `AI DM — ${mon.name}`,
          message: `${mon.name} advances to (${bestCell.x + 1}, ${bestCell.y + 1}) toward ${nearestPlayer.name}.`,
          category: 'info',
        });
        commitState(dmCtx);
        bestDist = bestCheb;
      }
    }

    if (bestDist <= Math.max(2, monRange + 1)) {
      const availSkills = (mon.skills || []).filter(
        (s) => Number(s.usesRemaining ?? s.maxUsesPerCombat ?? 0) > 0,
      );
      const lowHp = Number(mon.hp ?? 0) < Number(mon.maxHp || 1) * 0.45;
      const healSkill = lowHp ? availSkills.find((s) => Boolean(s.healFormula)) : undefined;
      const pickedSkill = healSkill || availSkills[0];

      handlers.monsterAttackAction(dmCtx, {
        monsterId: mon.id,
        targetCharacterId: nearestPlayer.id,
        ...(pickedSkill ? { skillId: pickedSkill.id } : {}),
      });

      if ((ctx.state.pendingReactions || []).length > 0) {
        break;
      }
    }

    handlers.initiativeAction(dmCtx, { subAction: 'next_turn', _fromAiDm: true });
  }
}
