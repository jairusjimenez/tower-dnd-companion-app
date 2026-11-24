import { useEffect } from 'react';
import { BeatDetailView } from './components/arena/BeatDetailView';
import { BeatMapModal } from './components/arena/BeatMapModal';
import { AccountModal } from './components/auth/AccountModal';
import { LoginView } from './components/auth/LoginView';
import { ToastStack } from './components/common/ToastStack';
import { TokenTooltip } from './components/common/TokenTooltip';
import { DmCharModal } from './components/dm/DmCharModal';
import { DmSessionModal } from './components/dm/DmSessionModal';
import { DmView } from './components/dm/DmView';
import { AttackRollModal } from './components/modals/AttackRollModal';
import { ChestRevealModal } from './components/modals/ChestRevealModal';
import { CombatClashModal } from './components/modals/CombatClashModal';
import { ConsumableConfirmModal } from './components/modals/ConsumableConfirmModal';
import { DiceRollModal } from './components/modals/DiceRollModal';
import { MonsterDefeatedModal } from './components/modals/MonsterDefeatedModal';
import { NpcDialogueModal } from './components/modals/NpcDialogueModal';
import { ObserveModal } from './components/modals/ObserveModal';
import { PassiveGachaModal } from './components/modals/PassiveGachaModal';
import { PlayerDeathOverlay } from './components/modals/PlayerDeathOverlay';
import { StoryBeatFinishedModal } from './components/modals/StoryBeatFinishedModal';
import { StoryPromptModal } from './components/modals/StoryPromptModal';
import { TradeModal } from './components/modals/TradeModal';
import { TurnNotificationModal } from './components/modals/TurnNotificationModal';
import { OnboardingView } from './components/onboarding/OnboardingView';
import { PlayerView } from './components/player/PlayerView';
import { useVtt } from './context/VttContext';

export function App() {
  const { session, state, authLoading, showOnboarding, activeBeatDetailId, setActiveBeatDetailId } = useVtt();

  const activeBeatExists = Boolean(
    activeBeatDetailId && state?.storyBeats?.some((b) => b.id === activeBeatDetailId),
  );

  useEffect(() => {
    if (activeBeatDetailId && state && !activeBeatExists) {
      setActiveBeatDetailId(null);
    }
  }, [activeBeatDetailId, activeBeatExists, setActiveBeatDetailId, state]);

  let primaryView = <LoginView />;
  if (authLoading) {
    primaryView = (
      <main className="view active">
        <div className="login-stage">
          <div className="login-shell">
            <section className="login-monolith" style={{ textAlign: 'center' }}>
              <div className="badge-tower mb-xs">TOWER SYSTEM INTERFACE</div>
              <h1 style={{ margin: '6px 0' }}>Connecting to Sovereign Spire...</h1>
              <p className="muted">Restoring authenticated session.</p>
            </section>
          </div>
        </div>
      </main>
    );
  } else if (session && state) {
    if (showOnboarding && session.role === 'player') {
      primaryView = <OnboardingView />;
    } else if (activeBeatExists) {
      primaryView = <BeatDetailView />;
    } else if (session.role === 'dm') {
      primaryView = <DmView />;
    } else {
      primaryView = <PlayerView />;
    }
  }

  return (
    <>
      {primaryView}
      <AccountModal />
      <BeatMapModal />
      <AttackRollModal />
      <ChestRevealModal />
      <CombatClashModal />
      <ConsumableConfirmModal />
      <DiceRollModal />
      <MonsterDefeatedModal />
      <NpcDialogueModal />
      <ObserveModal />
      <PassiveGachaModal />
      <PlayerDeathOverlay />
      <StoryBeatFinishedModal />
      <StoryPromptModal />
      <TradeModal />
      <TurnNotificationModal />
      <DmCharModal />
      <DmSessionModal />
      <ToastStack />
      <TokenTooltip />
    </>
  );
}
