import { z } from 'zod';
import {
  allocateStatAction,
  generateCharacterArtAction,
  grantXpAction,
  levelUpAction,
  resolvePassiveGachaAction,
  rollPassiveGachaAction,
  updateCharacterAction,
  updateCharacterProfileAction,
} from './characterActions';
import {
  inflictDamageAction,
  initiativeAction,
  monsterAttackAction,
  resolveReactionAction,
  rollDiceAction,
  spawnMonsterAction,
  updateMonsterAction,
} from './combatActions';
import { deityAction, equipmentAction, inventoryAction, spellAction } from './itemActions';
import { moveTokenAction, updateMapAction } from './mapActions';
import {
  broadcastToastAction,
  dmManageInvitesAction,
  resetCampaignAction,
  sessionControlAction,
  updateMechanicsAction,
  updateNotesAction,
} from './sessionActions';
import { storyAction } from './storyActions';
import type { ActionRequestContext, ActionResult } from './types';

const ActionEnvelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.unknown()).optional().default({}),
});

type ActionHandler = (ctx: ActionRequestContext, payload: Record<string, unknown>) => ActionResult | Promise<ActionResult>;

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  session_control: sessionControlAction,
  broadcast_toast: broadcastToastAction,
  dm_manage_invites: dmManageInvitesAction,
  update_mechanics: updateMechanicsAction,
  update_notes: updateNotesAction,
  reset_campaign: resetCampaignAction,
  spawn_monster: spawnMonsterAction,
  update_monster: updateMonsterAction,
  monster_attack: monsterAttackAction,
  resolve_reaction: resolveReactionAction,
  inflict_damage: inflictDamageAction,
  roll_dice: rollDiceAction,
  initiative_action: initiativeAction,
  spell_action: spellAction,
  deity_action: deityAction,
  equipment_action: equipmentAction,
  inventory_action: inventoryAction,
  update_character: updateCharacterAction,
  update_character_profile: updateCharacterProfileAction,
  generate_character_art: generateCharacterArtAction,
  move_token: moveTokenAction,
  update_map: updateMapAction,
  story_action: storyAction,
  allocate_stat: allocateStatAction,
  roll_passive_gacha: rollPassiveGachaAction,
  resolve_passive_gacha: resolvePassiveGachaAction,
  level_up: levelUpAction,
  grant_xp: grantXpAction,
};

export async function dispatchAction(ctx: ActionRequestContext, rawBody: unknown): Promise<ActionResult> {
  const parsed = ActionEnvelopeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return { status: 400, error: 'Action type and valid payload object are required.' };
  }
  const { type, payload } = parsed.data;
  const handler = ACTION_HANDLERS[type];
  if (!handler) {
    return { status: 400, error: `Unknown action type: ${type}` };
  }
  return await handler(ctx, payload);
}
