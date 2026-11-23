import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type {
  AttackArea,
  Character,
  ChestLootSummary,
  EquipmentItem,
  FilteredGameState,
  InventoryItem,
  MapToken,
  Monster,
  MonsterDefeatSummary,
  RollLogEntry,
  SessionIdentity,
  ToastMessage,
  TokenIconId,
} from '@shared/index';
import { apiFetch, sendGameAction } from '../services/api';

export interface NpcDialogueState {
  beatId: string;
  tokenId: string;
  npcName: string;
  npcRole: string;
  iconId?: TokenIconId;
  dialogue: string;
  rewardType?: MapToken['rewardType'];
  rewardXp?: number;
  rewardGold?: number;
  rewardItemName?: string;
  rewardSkillDesc?: string;
  rewardClaimed?: boolean;
  claimedNotes?: string[];
}

export interface ObserveResultState {
  kind: 'monster' | 'player' | 'npc' | 'chest' | 'terrain';
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  iconId?: TokenIconId;
  monster?: Monster | null;
  weakSpotFound?: boolean;
  successChancePct?: number;
  rollPct?: number;
  bonusDamage?: number;
  bonusCritDamage?: number;
  floor?: number;
  player?: Character | null;
  npcRole?: string;
  dialogue?: string;
  chestName?: string;
  chestTier?: string;
  chestOpened?: boolean;
  terrainType?: string;
  description?: string;
  rollTotal?: number;
  rollFormula?: string;
}

export interface AttackRollOutcome {
  rawRoll: number;
  attackBonus: number;
  totalHit: number;
  targetAc: number;
  isCrit: boolean;
  isFumble: boolean;
  isHit: boolean;
}

export interface AttackRollRequest {
  monTok: MapToken;
  me: Character;
  wep: EquipmentItem | null;
  beatId: string;
  attackArea?: AttackArea;
  attackAreaModifier?: number;
  skillName?: string;
  diceFormulaOverride?: string;
  damageTypeOverride?: string;
  isSkill?: boolean;
  spell?: import('@shared/index').Spell | null;
  isSelfSpell?: boolean;
  healFormula?: string;
  effectSpec?: import('@shared/index').UnitEffectSpec | null;
  onComplete: (outcome: AttackRollOutcome | null) => void;
}

interface VttContextValue {
  session: SessionIdentity | null;
  state: FilteredGameState | null;
  authLoading: boolean;
  showOnboarding: boolean;
  setShowOnboarding: (v: boolean) => void;
  toasts: ToastMessage[];
  dismissToast: (id: string) => void;
  pushLocalToast: (toast: Partial<ToastMessage> & { message: string }) => void;
  latestStatus: { title: string; message: string; category: string; timestamp: string } | null;
  refreshState: () => Promise<void>;
  enterSession: (newSession: SessionIdentity, opts?: { showOnboarding?: boolean }) => Promise<void>;
  updateSessionIdentity: (nextSession: SessionIdentity) => void;
  logout: () => Promise<void>;
  sendAction: <T = Record<string, unknown>>(
    type: string,
    payload?: Record<string, unknown>,
    opts?: { throwOnError?: boolean },
  ) => Promise<T | undefined>;
  activeBeatDetailId: string | null;
  setActiveBeatDetailId: (id: string | null) => void;
  lastAutoOpenedBeatId: string | null;
  setLastAutoOpenedBeatId: (id: string | null) => void;
  activeBeatMapId: string | null;
  setActiveBeatMapId: (id: string | null) => void;
  accountModalOpen: boolean;
  setAccountModalOpen: (v: boolean) => void;
  dmCharModalId: string | null;
  setDmCharModalId: (id: string | null) => void;
  dmSessionModalOpen: boolean;
  setDmSessionModalOpen: (v: boolean) => void;
  tradeItemId: string | null;
  setTradeItemId: (id: string | null) => void;
  pendingConsumableUse: { characterId: string; item: InventoryItem } | null;
  setPendingConsumableUse: (req: { characterId: string; item: InventoryItem } | null) => void;
  attackRollRequest: AttackRollRequest | null;
  requestAttackRoll: (req: Omit<AttackRollRequest, 'onComplete'>) => Promise<AttackRollOutcome | null>;
  gachaModalOpen: boolean;
  setGachaModalOpen: (v: boolean) => void;
  gachaSpinData: Record<string, unknown> | null;
  setGachaSpinData: (d: Record<string, unknown> | null) => void;
  defeatedMonster: MonsterDefeatSummary | null;
  setDefeatedMonster: (d: MonsterDefeatSummary | null) => void;
  chestReveal: ChestLootSummary | null;
  setChestReveal: (c: ChestLootSummary | null) => void;
  activePromptModal: { beatId: string; promptId: string } | null;
  setActivePromptModal: (m: { beatId: string; promptId: string } | null) => void;
  activeNpcDialogue: NpcDialogueState | null;
  setActiveNpcDialogue: (d: NpcDialogueState | null) => void;
  activeObserveResult: ObserveResultState | null;
  setActiveObserveResult: (r: ObserveResultState | null) => void;
  diceRollModal: RollLogEntry | null;
  setDiceRollModal: (r: RollLogEntry | null) => void;
  tooltip: { tok: Partial<MapToken>; x: number; y: number } | null;
  showTooltip: (tok: Partial<MapToken>, x: number, y: number) => void;
  hideTooltip: () => void;
}

const VttContext = createContext<VttContextValue | null>(null);

export function useVtt(): VttContextValue {
  const ctx = useContext(VttContext);
  if (!ctx) throw new Error('useVtt must be used within VttProvider');
  return ctx;
}

export function VttProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionIdentity | null>(null);
  const [state, setState] = useState<FilteredGameState | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [latestStatus, setLatestStatus] = useState<{ title: string; message: string; category: string; timestamp: string } | null>(null);

  const [activeBeatDetailId, setActiveBeatDetailId] = useState<string | null>(null);
  const activeBeatIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeBeatIdRef.current = activeBeatDetailId;
  }, [activeBeatDetailId]);
  const [lastAutoOpenedBeatId, setLastAutoOpenedBeatId] = useState<string | null>(null);
  const [activeBeatMapId, setActiveBeatMapId] = useState<string | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [dmCharModalId, setDmCharModalId] = useState<string | null>(null);
  const [dmSessionModalOpen, setDmSessionModalOpen] = useState(false);
  const [tradeItemId, setTradeItemId] = useState<string | null>(null);
  const [pendingConsumableUse, setPendingConsumableUse] = useState<{ characterId: string; item: InventoryItem } | null>(null);
  const [attackRollRequest, setAttackRollRequest] = useState<AttackRollRequest | null>(null);
  const [gachaModalOpen, setGachaModalOpen] = useState(false);
  const [gachaSpinData, setGachaSpinData] = useState<Record<string, unknown> | null>(null);
  const [defeatQueue, setDefeatQueue] = useState<MonsterDefeatSummary[]>([]);
  const defeatedMonster = defeatQueue[0] ?? null;
  const setDefeatedMonster = useCallback((next: MonsterDefeatSummary | null) => {
    if (next === null) {
      setDefeatQueue((prev) => prev.slice(1));
    } else {
      setDefeatQueue((prev) => {
        if (next.id && prev.some((item) => item.id === next.id)) return prev;
        return [...prev, next];
      });
    }
  }, []);
  const [chestReveal, setChestReveal] = useState<ChestLootSummary | null>(null);
  const [activePromptModal, setActivePromptModal] = useState<{ beatId: string; promptId: string } | null>(null);
  const [activeNpcDialogue, setActiveNpcDialogue] = useState<NpcDialogueState | null>(null);
  const [activeObserveResult, setActiveObserveResult] = useState<ObserveResultState | null>(null);
  const [diceRollModal, setDiceRollModal] = useState<RollLogEntry | null>(null);
  const [tooltip, setTooltip] = useState<{ tok: Partial<MapToken>; x: number; y: number } | null>(null);

  const sseRef = useRef<EventSource | null>(null);
  const seenToastIdsRef = useRef<Set<string>>(new Set());
  const seenRollIdRef = useRef<string | null>(null);
  const seenDefeatIdsRef = useRef<Set<string>>(new Set());
  const seededDefeatsRef = useRef<boolean>(false);

  const presentDefeatSummary = useCallback((summary: MonsterDefeatSummary) => {
    if (summary.id) {
      if (seenDefeatIdsRef.current.has(summary.id)) return;
      seenDefeatIdsRef.current.add(summary.id);
    }
    setDefeatQueue((prev) => {
      if (summary.id && prev.some((item) => item.id === summary.id)) return prev;
      return [...prev, summary];
    });
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushLocalToast = useCallback((toast: Partial<ToastMessage> & { message: string }) => {
    const id = toast.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (seenToastIdsRef.current.has(id)) return;
    seenToastIdsRef.current.add(id);

    const rawMsg = String(toast.message || '').trim();
    const displayMsg = /^SYSTEM:/i.test(rawMsg) ? rawMsg : `SYSTEM: ${rawMsg}`;
    const entry: ToastMessage = {
      id,
      timestamp: toast.timestamp || new Date().toISOString(),
      category: toast.category || 'info',
      title: toast.title || 'SYSTEM NOTICE',
      message: displayMsg,
      target: toast.target || 'all',
      sender: toast.sender || 'SYSTEM / DM',
      ...(toast.isDmBroadcast ? { isDmBroadcast: true } : {}),
    };
    setLatestStatus({
      title: entry.title,
      message: rawMsg.replace(/^SYSTEM:\s*/i, ''),
      category: entry.category,
      timestamp: entry.timestamp,
    });
    if (activeBeatIdRef.current && !toast.isDmBroadcast) {
      return;
    }
    setToasts((prev) => [entry, ...prev].slice(0, 6));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 8000);
  }, []);

  const disconnectSse = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }, []);

  const connectSse = useCallback(() => {
    disconnectSse();
    const es = new EventSource('/api/events');
    es.addEventListener('state', (ev) => {
      try {
        const next = JSON.parse((ev as MessageEvent).data) as FilteredGameState;
        setState(next);
      } catch {
        // Ignore malformed SSE payload
      }
    });
    es.addEventListener('toast', (ev) => {
      try {
        const t = JSON.parse((ev as MessageEvent).data) as ToastMessage;
        pushLocalToast(t);
      } catch {
        // Ignore malformed toast payload
      }
    });
    sseRef.current = es;
  }, [disconnectSse, pushLocalToast]);

  const refreshState = useCallback(async () => {
    const data = await apiFetch<FilteredGameState>('/api/state');
    setState(data);
  }, []);

  const enterSession = useCallback(
    async (newSession: SessionIdentity, opts?: { showOnboarding?: boolean }) => {
      seenDefeatIdsRef.current.clear();
      seededDefeatsRef.current = false;
      setSession(newSession);
      setActiveBeatDetailId(null);
      setLastAutoOpenedBeatId(null);
      setActiveBeatMapId(null);
      setShowOnboarding(Boolean(newSession.role === 'player' && opts?.showOnboarding));
      const data = await apiFetch<FilteredGameState>('/api/state');
      setState(data);
      connectSse();
    },
    [connectSse],
  );

  const updateSessionIdentity = useCallback((nextSession: SessionIdentity) => {
    setSession(nextSession);
  }, []);

  const logout = useCallback(async () => {
    disconnectSse();
    try {
      await apiFetch('/api/auth/logout', {});
    } catch {
      // Ignore logout network error
    }
    setSession(null);
    setState(null);
    seenDefeatIdsRef.current.clear();
    seededDefeatsRef.current = false;
    setDefeatQueue([]);
    setShowOnboarding(false);
    setActiveBeatDetailId(null);
    setLastAutoOpenedBeatId(null);
    setActiveBeatMapId(null);
    setAccountModalOpen(false);
    setDmCharModalId(null);
    setDmSessionModalOpen(false);
    setTradeItemId(null);
    setPendingConsumableUse(null);
    setAttackRollRequest(null);
    setGachaModalOpen(false);
    setGachaSpinData(null);
  }, [disconnectSse]);

  const sendAction = useCallback(
    async <T = Record<string, unknown>>(
      type: string,
      payload: Record<string, unknown> = {},
      opts?: { throwOnError?: boolean },
    ): Promise<T | undefined> => {
      if (!session) return undefined;
      try {
        const res = await sendGameAction<T>(type, payload);
        const anyRes = res as unknown as {
          defeatSummary?: MonsterDefeatSummary | null;
          defeatSummaries?: MonsterDefeatSummary[];
          damageOutcome?: { defeatSummary?: MonsterDefeatSummary | null };
          chestLootSummary?: ChestLootSummary | null;
          roll?: RollLogEntry | null;
          beat?: { prompts?: Array<{ triggeredStatCheckResults?: Array<{ characterId: string; characterName: string; statKey: string; statMod: number; floorBonus: number; roll: number; total: number; dc: number; passed: boolean; rewardSummary?: string }> }> };
        } | undefined;
        if (Array.isArray(anyRes?.defeatSummaries) && anyRes.defeatSummaries.length > 0) {
          for (const s of anyRes.defeatSummaries) presentDefeatSummary(s);
        } else {
          const summary = anyRes?.defeatSummary || anyRes?.damageOutcome?.defeatSummary || null;
          if (summary) presentDefeatSummary(summary);
        }
        if (anyRes?.chestLootSummary) setChestReveal(anyRes.chestLootSummary);
        if (anyRes?.roll) {
          seenRollIdRef.current = anyRes.roll.id;
          if (!activeBeatIdRef.current) {
            setDiceRollModal(anyRes.roll);
          }
        }
        await refreshState();
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Action failed';
        pushLocalToast({ title: 'ACTION ERROR', message: msg, category: 'warning' });
        if (opts?.throwOnError) throw err;
        return undefined;
      }
    },
    [presentDefeatSummary, pushLocalToast, refreshState, session],
  );

  // Show MonsterDefeatedModal when a monster is defeated asynchronously (e.g., via debuff DoT on turn start)
  useEffect(() => {
    if (!state) return;
    const defeats = state.recentMonsterDefeats || [];
    if (!seededDefeatsRef.current) {
      for (const d of defeats) {
        if (d.id) seenDefeatIdsRef.current.add(d.id);
      }
      seededDefeatsRef.current = true;
      return;
    }
    if (session?.role === 'player' && session.characterId) {
      const unseen = defeats.filter(
        (d) => d.id && !seenDefeatIdsRef.current.has(d.id) && d.killerCharacterId === session.characterId,
      );
      for (const entry of unseen) {
        presentDefeatSummary(entry);
      }
    }
  }, [presentDefeatSummary, session, state]);

  // Gracefully log out connected player if the DM resets the campaign or removes their character
  useEffect(() => {
    if (session?.role === 'player' && session.characterId && state && !state.characters?.[session.characterId]) {
      pushLocalToast({
        title: 'CAMPAIGN RESET',
        message: 'Your character was removed or the DM reset the campaign.',
        category: 'warning',
      });
      void logout();
    }
  }, [logout, pushLocalToast, session, state]);

  // Show DiceRollModal when a new stat-check or dice roll entry appears in rollLog
  useEffect(() => {
    const latestRoll = state?.rollLog?.[0];
    if (!latestRoll) return;
    if (seenRollIdRef.current === null) {
      // Seed initial roll ID on page load without popping a modal for historical rolls
      seenRollIdRef.current = latestRoll.id;
      return;
    }
    if (latestRoll.id !== seenRollIdRef.current) {
      seenRollIdRef.current = latestRoll.id;
      // Show modal if this roll belongs to the current user, or if it's a scenario stat check
      const myCharName = session?.characterId ? state?.characters?.[session.characterId]?.name : null;
      const isMyRoll =
        (session?.role === 'dm' && latestRoll.rollerRole === 'dm') ||
        (myCharName && latestRoll.rollerName === myCharName) ||
        /Stat Check/i.test(latestRoll.label || '');
      if (isMyRoll && !activeBeatIdRef.current) {
        setDiceRollModal(latestRoll);
      }
    }
  }, [state?.rollLog, session, state?.characters]);

  const requestAttackRoll = useCallback(
    (req: Omit<AttackRollRequest, 'onComplete'>): Promise<AttackRollOutcome | null> => {
      return new Promise((resolve) => {
        setAttackRollRequest({
          ...req,
          onComplete: (outcome) => {
            setAttackRollRequest(null);
            resolve(outcome);
          },
        });
      });
    },
    [],
  );

  const showTooltip = useCallback((tok: Partial<MapToken>, x: number, y: number) => {
    setTooltip({ tok, x, y });
  }, []);

  const hideTooltip = useCallback(() => {
    setTooltip(null);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await apiFetch<{ ok: boolean; session: SessionIdentity }>('/api/auth/me');
        if (active && me.session) {
          await enterSession(me.session);
        }
      } catch {
        // Not signed in
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => {
      active = false;
      disconnectSse();
    };
  }, [disconnectSse, enterSession]);

  return (
    <VttContext.Provider
      value={{
        session,
        state,
        authLoading,
        showOnboarding,
        setShowOnboarding,
        toasts,
        dismissToast,
        pushLocalToast,
        latestStatus,
        refreshState,
        enterSession,
        updateSessionIdentity,
        logout,
        sendAction,
        activeBeatDetailId,
        setActiveBeatDetailId,
        lastAutoOpenedBeatId,
        setLastAutoOpenedBeatId,
        activeBeatMapId,
        setActiveBeatMapId,
        accountModalOpen,
        setAccountModalOpen,
        dmCharModalId,
        setDmCharModalId,
        dmSessionModalOpen,
        setDmSessionModalOpen,
        tradeItemId,
        setTradeItemId,
        pendingConsumableUse,
        setPendingConsumableUse,
        attackRollRequest,
        requestAttackRoll,
        gachaModalOpen,
        setGachaModalOpen,
        gachaSpinData,
        setGachaSpinData,
        defeatedMonster,
        setDefeatedMonster,
        chestReveal,
        setChestReveal,
        activePromptModal,
        setActivePromptModal,
        activeNpcDialogue,
        setActiveNpcDialogue,
        activeObserveResult,
        setActiveObserveResult,
        diceRollModal,
        setDiceRollModal,
        tooltip,
        showTooltip,
        hideTooltip,
      }}
    >
      {children}
    </VttContext.Provider>
  );
}
