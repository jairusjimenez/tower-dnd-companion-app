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
import { PassiveGachaModal } from './components/modals/PassiveGachaModal';
import { TradeModal } from './components/modals/TradeModal';
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
      <PassiveGachaModal />
      <TradeModal />
      <DmCharModal />
      <DmSessionModal />
      <ToastStack />
      <TokenTooltip />
    </>
  );
}
