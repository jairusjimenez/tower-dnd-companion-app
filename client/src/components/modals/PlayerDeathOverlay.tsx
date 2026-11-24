import { useEffect, useRef, useState } from 'react';
import { useVtt } from '../../context/VttContext';

export function PlayerDeathOverlay() {
  const { session, state } = useVtt();
  const [splashVisible, setSplashVisible] = useState(false);
  const wasDeadRef = useRef(false);

  const me =
    session?.role === 'player' && session.characterId
      ? state?.characters?.[session.characterId]
      : undefined;
  const isDead = Boolean(me && Number(me.hp ?? 0) <= 0);

  useEffect(() => {
    if (isDead && !wasDeadRef.current) {
      wasDeadRef.current = true;
      setSplashVisible(true);
      const timer = window.setTimeout(() => {
        setSplashVisible(false);
      }, 4200);
      return () => window.clearTimeout(timer);
    }
    if (!isDead) {
      wasDeadRef.current = false;
      setSplashVisible(false);
    }
    return undefined;
  }, [isDead]);

  if (!isDead) return null;

  return (
    <>
      <div className="death-atmosphere-vignette" aria-hidden="true" />
      {splashVisible ? (
        <div
          id="player-death-splash"
          className="death-souls-banner"
          role="alert"
          aria-live="assertive"
        >
          <div className="death-souls-rule" />
          <div className="death-souls-text">YOU HAVE DIED</div>
          <div className="death-souls-sub">
            {me?.name} has fallen &bull; Spectating the battlefield
          </div>
          <div className="death-souls-rule" />
        </div>
      ) : (
        <div id="player-death-ribbon" className="death-spectate-ribbon" role="status">
          <span className="death-spectate-title">YOU HAVE DIED</span>
          <span className="death-spectate-sub">Spectating Map</span>
        </div>
      )}
    </>
  );
}
