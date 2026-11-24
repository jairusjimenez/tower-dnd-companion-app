import React, { useEffect, useState } from 'react';
import { STARTER_WOODEN_WEAPONS } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { compressPortraitFileToDataUrl } from '../../utils/imageUpload';

type StarterKitCardSpec = {
  id: 'archer' | 'swordsman' | 'sword_shield' | 'mage';
  title: string;
  weapon: string;
  armor: string;
  defense: string;
  tag: string;
};

const STARTER_KIT_CARDS: StarterKitCardSpec[] = [
  {
    id: 'archer',
    title: 'Archer',
    weapon: 'Oak Shortbow (1d6+2)',
    armor: 'Scout Leather Tunic',
    defense: '+2 AC • +1 DR',
    tag: 'Ranged',
  },
  {
    id: 'swordsman',
    title: 'Swordsman',
    weapon: 'Iron Longsword (1d8+3)',
    armor: 'Trainee Brigandine',
    defense: '+2 AC • +1 DR',
    tag: 'Melee',
  },
  {
    id: 'sword_shield',
    title: 'Sword & Shield',
    weapon: 'Iron Broadsword (1d8+2)',
    armor: 'Oak Kite Shield & Initiate Leather Coat',
    defense: '+4 AC • +2 DR',
    tag: 'Defense',
  },
  {
    id: 'mage',
    title: 'Mage',
    weapon: 'Apprentice Mana Staff (1d6+2)',
    armor: 'Scholar Mana Robes & Cracked Shinsu Focus',
    defense: '+2 AC • +1 DR',
    tag: 'Magic',
  },
];

function KitIcon({ id }: { id: StarterKitCardSpec['id'] }) {
  if (id === 'archer') {
    return (
      <svg viewBox="0 0 36 36" width="28" height="28" fill="none" aria-hidden="true">
        <path d="M9 27C10.5 17 17 10.5 27 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="9" y1="27" x2="27" y2="9" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.55" />
        <line x1="11" y1="25" x2="29" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M23 7h6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (id === 'swordsman') {
    return (
      <svg viewBox="0 0 36 36" width="28" height="28" fill="none" aria-hidden="true">
        <path d="M27 7l-11 11-3-3L24 4l3 3z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
        <path d="M11 16l9 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M14 22l-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === 'sword_shield') {
    return (
      <svg viewBox="0 0 36 36" width="28" height="28" fill="none" aria-hidden="true">
        <path d="M18 6l9 4v7c0 6-4 10.5-9 13-5-2.5-9-7-9-13v-7l9-4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M18 11v12M13.5 16h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 36 36" width="28" height="28" fill="none" aria-hidden="true">
      <line x1="9" y1="29" x2="23" y2="15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="25" cy="11" r="4.5" stroke="currentColor" strokeWidth="2" />
      <path d="M25 4v2M25 16v2M18 11h2M30 11h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function OnboardingView() {
  const {
    session,
    state,
    sendAction,
    setShowOnboarding,
    setActiveBeatDetailId,
    setLastAutoOpenedBeatId,
    pushLocalToast,
  } = useVtt();
  const ch = session?.characterId ? state?.characters?.[session.characterId] : undefined;

  const [step, setStep] = useState(1);
  const [name, setName] = useState(ch?.name || 'New Adventurer');
  const race = 'Human';
  const className = 'Adventurer';

  const [kit, setKit] = useState('archer');
  const [customStyle, setCustomStyle] = useState<'melee' | 'ranged'>('melee');
  const [customWeaponId, setCustomWeaponId] = useState(STARTER_WOODEN_WEAPONS.melee[0].id);

  const [artPrompt, setArtPrompt] = useState('');
  const [artStyle, setArtStyle] = useState('Korean Manhwa Webtoon');

  useEffect(() => {
    if (ch?.name && !name) {
      setName(ch.name);
    }
  }, [ch?.name]);

  const customList = STARTER_WOODEN_WEAPONS[customStyle] || STARTER_WOODEN_WEAPONS.melee;
  const pickedWeapon = customList.find((w) => w.id === customWeaponId) || customList[0];

  const armorSummary = pickedWeapon
    ? [
        `${pickedWeapon.body.name} (+${pickedWeapon.body.acBonus} AC, +${pickedWeapon.body.drBonus} DR)`,
        pickedWeapon.offHand
          ? `${pickedWeapon.offHand.name} (+${pickedWeapon.offHand.acBonus} AC${pickedWeapon.offHand.drBonus ? `, +${pickedWeapon.offHand.drBonus} DR` : ''})`
          : '',
        pickedWeapon.boots ? `${pickedWeapon.boots.name} (+${pickedWeapon.boots.acBonus} AC)` : '',
        pickedWeapon.head ? `${pickedWeapon.head.name} (+${pickedWeapon.head.acBonus} AC)` : '',
      ]
        .filter(Boolean)
        .join(' • ')
    : '';

  const finishOnboarding = () => {
    const currentPresentedBeat = state
      ? (state.storyBeats || []).slice().reverse().find((b) => b.presented && b.status === 'active') ||
        (state.storyBeats || []).slice().reverse().find((b) => b.presented)
      : undefined;
    if (currentPresentedBeat) {
      setLastAutoOpenedBeatId(currentPresentedBeat.id);
    }
    setActiveBeatDetailId(null);
    setShowOnboarding(false);
    window.scrollTo(0, 0);
  };

  const handleSaveProfile = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session?.characterId) return;
    const res = await sendAction('update_character_profile', {
      characterId: session.characterId,
      name: name.trim(),
      race,
      className,
    });
    if (!res) return;
    setStep(2);
    window.scrollTo(0, 0);
  };

  const handleSaveEquipment = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session?.characterId) return;
    const res = await sendAction('equipment_action', {
      subAction: 'choose_starter',
      characterId: session.characterId,
      kit,
      customCategory: customStyle,
      customWeaponId: pickedWeapon?.id || '',
    });
    if (!res) return;
    setStep(3);
    window.scrollTo(0, 0);
  };

  const handleGenArt = async () => {
    if (!session?.characterId) return;
    const res = await sendAction<{ engine?: string }>('generate_character_art', {
      characterId: session.characterId,
      prompt: artPrompt.trim() || ch?.name || 'Tower Adventurer',
      style: artStyle,
    });
    pushLocalToast({ title: 'PORTRAIT READY', message: `Portrait updated via ${res?.engine || 'synth'}!`, category: 'loot' });
  };

  const handleUploadArt = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file || !session?.characterId) return;
    try {
      const dataUrl = await compressPortraitFileToDataUrl(file);
      await sendAction('generate_character_art', {
        characterId: session.characterId,
        uploadedImageDataUrl: dataUrl,
        prompt: 'Uploaded Portrait',
        style: 'Custom Upload',
      });
      pushLocalToast({ title: 'PORTRAIT UPLOADED', message: 'Your Adventurer portrait is ready!', category: 'loot' });
    } catch (err) {
      pushLocalToast({ title: 'UPLOAD ERROR', message: err instanceof Error ? err.message : 'Failed to upload image.', category: 'warning' });
    } finally {
      ev.target.value = '';
    }
  };

  const stepLabels: Record<number, string> = {
    1: 'Identity',
    2: 'Loadout',
    3: 'Portrait',
    4: 'The Tower',
  };

  const displayName = name.trim() || ch?.name || 'New Adventurer';

  return (
    <section id="player-onboarding-view" className="view active onb-deck-shell">
      {/* Edge-to-edge thin gradient progress bar + compact header */}
      <header className="onb-topbar">
        <div className="onb-progress-track" aria-hidden="true">
          <div className="onb-progress-fill" style={{ width: `${step * 25}%` }} />
        </div>
        <div className="onb-topbar-inner">
          <div className="onb-step-pill" id="onb-step-subtitle">
            <span>Step {step} of 4</span>
            <span className="onb-step-dot">&bull;</span>
            <span>{stepLabels[step] || 'Identity'}</span>
          </div>
          <button type="button" id="btn-onb-enter" className="onb-skip-btn" onClick={finishOnboarding}>
            Skip &rarr;
          </button>
        </div>
      </header>

      <main className="onb-main">
        {step === 1 && (
          <div id="onb-step-1" className="onb-step-stack">
            {/* Hero Identity Preview */}
            <div className="onb-hero-identity">
              <div className="onb-avatar-ring">
                {ch?.portraitUrl ? (
                  <img src={ch.portraitUrl} alt={displayName} className="onb-avatar-img" />
                ) : (
                  <svg viewBox="0 0 64 64" width="44" height="44" fill="none" aria-hidden="true">
                    <circle cx="32" cy="23" r="10" stroke="#7dd3fc" strokeWidth="2.2" />
                    <path d="M14 52c2.5-9.5 9.5-14 18-14s15.5 4.5 18 14" stroke="#7dd3fc" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                )}
                <span className="onb-lv-badge">Lv {ch?.level || 1}</span>
              </div>
              <h2 className="onb-hero-name" id="onb-char-name">{displayName}</h2>
              <p className="onb-hero-sub">{race} &bull; {className}</p>
            </div>

            <form id="onb-char-form" className="onb-card stack-form" onSubmit={handleSaveProfile}>
              <label>
                <span>Adventurer Name</span>
                <input
                  id="onb-char-name-input"
                  type="text"
                  maxLength={48}
                  placeholder="e.g. Bam, Sung Jin-Woo, Khun"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>

              <div className="onb-identity-tiles">
                <div className="onb-identity-tile is-active">
                  <span className="onb-tile-kicker">Race</span>
                  <strong>Human</strong>
                  <span className="onb-tile-meta">Tower Initiate</span>
                </div>
                <div className="onb-identity-tile is-active">
                  <span className="onb-tile-kicker">Role</span>
                  <strong>Adventurer</strong>
                  <span className="onb-tile-meta">Versatile Class</span>
                </div>
              </div>

              <div className="onb-stat-strip" aria-label="Starting vitals">
                <div className="onb-stat-pill">
                  <span className="onb-stat-val">{ch?.maxHp ?? 24}</span>
                  <span className="onb-stat-lbl">HP</span>
                </div>
                <div className="onb-stat-pill">
                  <span className="onb-stat-val">{ch?.maxMp ?? 15}</span>
                  <span className="onb-stat-lbl">MP</span>
                </div>
                <div className="onb-stat-pill">
                  <span className="onb-stat-val">{ch?.unspentStatPoints ?? 6}</span>
                  <span className="onb-stat-lbl">Stat Pts</span>
                </div>
              </div>
            </form>

            <div className="onb-footer">
              <div className="onb-footer-inner">
                <button type="submit" form="onb-char-form" className="btn btn-cyan btn-lg btn-glow-cyan onb-cta-full">
                  Continue to Loadout &rarr;
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div id="onb-step-2" className="onb-step-stack">
            <div className="onb-section-head">
              <h2>Choose Your Starter Kit</h2>
              <p className="muted small">Each kit includes your starting weapon and protective armor.</p>
            </div>

            <form id="onb-equip-form" className="stack-form" onSubmit={handleSaveEquipment}>
              <div className="onb-kit-grid" role="radiogroup" aria-label="Starter equipment kits">
                {STARTER_KIT_CARDS.map((card) => {
                  const selected = kit === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      className={`onb-kit-card${selected ? ' is-selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => setKit(card.id)}
                    >
                      {selected && (
                        <span className="onb-kit-check" aria-hidden="true">
                          <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
                            <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      )}
                      <div className="onb-kit-icon">
                        <KitIcon id={card.id} />
                      </div>
                      <strong className="onb-kit-title">{card.title}</strong>
                      <div className="onb-kit-gear">
                        <span className="onb-kit-weapon">{card.weapon}</span>
                        <span className="onb-kit-armor">Armor: {card.armor}</span>
                        <span className="onb-kit-def">{card.defense}</span>
                      </div>
                      <span className="onb-kit-tag">{card.tag}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                id="btn-onb-custom-kit"
                className={`onb-custom-toggle${kit === 'custom' ? ' is-selected' : ''}`}
                aria-pressed={kit === 'custom'}
                onClick={() => setKit('custom')}
              >
                <div>
                  <strong>Custom Wooden Weapon</strong>
                  <span className="muted small">Pick a wooden melee or ranged weapon + fitted armor</span>
                </div>
                <span aria-hidden="true">{kit === 'custom' ? 'Selected' : 'Choose →'}</span>
              </button>

              {kit === 'custom' && (
                <div id="onb-custom-equip-box" className="onb-card stack-form">
                  <div className="grid-2">
                    <label>
                      <span>Combat Style</span>
                      <select
                        id="onb-custom-style"
                        value={customStyle}
                        onChange={(e) => {
                          const nextStyle = e.target.value === 'ranged' ? 'ranged' : 'melee';
                          setCustomStyle(nextStyle);
                          setCustomWeaponId(STARTER_WOODEN_WEAPONS[nextStyle][0].id);
                        }}
                      >
                        <option value="melee">Melee (Wooden Weapons)</option>
                        <option value="ranged">Ranged (Wooden Equipment)</option>
                      </select>
                    </label>
                    <label>
                      <span>Starter Wooden Weapon</span>
                      <select id="onb-custom-weapon" value={pickedWeapon?.id || ''} onChange={(e) => setCustomWeaponId(e.target.value)}>
                        {customList.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({w.damageDice} {w.damageType}{w.rangeSpaces > 1 ? ` • ${w.rangeSpaces} Sp` : ''})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div id="onb-custom-armor-preview" className="onb-armor-preview">
                    <strong>Included Armor:</strong> {armorSummary}
                  </div>
                </div>
              )}
            </form>

            <div className="onb-footer">
              <div className="onb-footer-inner onb-footer-split">
                <button type="button" id="btn-onb-equip-back" className="btn btn-outline" onClick={() => setStep(1)}>
                  &larr; Back
                </button>
                <button type="submit" form="onb-equip-form" className="btn btn-cyan btn-lg btn-glow-cyan">
                  Equip &amp; Next: Portrait &rarr;
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div id="onb-step-3" className="onb-step-stack">
            <div className="onb-section-head">
              <h2>Adventurer Portrait</h2>
              <p className="muted small">Displayed as your Adventurer token on all Story Beat Arena Maps.</p>
            </div>

            <div className="onb-portrait-stage">
              <img
                id="onb-art-preview"
                src={ch?.portraitUrl || ''}
                alt="Adventurer Portrait Preview"
                className="onb-portrait-img"
              />
            </div>

            <div className="onb-card stack-form">
              <label className="onb-upload-box">
                <span>Upload Your Own Portrait</span>
                <input id="onb-art-upload" type="file" accept="image/*" onChange={handleUploadArt} />
              </label>

              <div className="onb-divider"><span>Or Generate AI Character Art</span></div>

              <div className="grid-2">
                <label>
                  <span>Art Prompt</span>
                  <input
                    id="onb-art-prompt"
                    type="text"
                    placeholder="e.g. Silver-haired mage with cyan staff"
                    value={artPrompt}
                    onChange={(e) => setArtPrompt(e.target.value)}
                  />
                </label>
                <label>
                  <span>Art Style</span>
                  <select id="onb-art-style" value={artStyle} onChange={(e) => setArtStyle(e.target.value)}>
                    <option value="Korean Manhwa Webtoon">Korean Manhwa Webtoon</option>
                    <option value="Dark Fantasy Oil Painting">Dark Fantasy Oil Painting</option>
                    <option value="Anime Concept Art">Anime Concept Art</option>
                    <option value="Pixel RPG Sprite">Pixel RPG Sprite</option>
                  </select>
                </label>
              </div>
              <button type="button" id="btn-onb-gen-art" className="btn btn-gold" onClick={handleGenArt}>
                Generate AI Art
              </button>
            </div>

            <div className="onb-footer">
              <div className="onb-footer-inner onb-footer-split">
                <button type="button" id="btn-onb-step3-back" className="btn btn-outline" onClick={() => setStep(2)}>
                  &larr; Back
                </button>
                <button type="button" id="btn-onb-step3-next" className="btn btn-cyan btn-lg btn-glow-cyan" onClick={() => setStep(4)}>
                  Next: The Tower &rarr;
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div id="onb-step-4" className="onb-step-stack">
            <div className="onb-section-head">
              <h2>The Tower &amp; Mechanics</h2>
              <p className="muted small">Essential survival briefing for new Adventurers.</p>
            </div>

            <div className="onb-card stack-form">
              <h3 className="onb-card-title">The Game &amp; The World</h3>
              <p className="small">
                A live, DM-led tactical RPG set inside <strong>The Tower</strong> — a 100-floor spire of shifting realms, hidden NPCs, lethal traps, and Floor Guardians. Play through branching <strong>Story Beats</strong> and grid-based <strong>Arena Battles</strong> in real time with your party.
              </p>
              <div className="onb-realm-chips">
                <span className="tag tag-cyan">1F–100F Ascent</span>
                <span className="tag tag-gold">Live DM</span>
                <span className="tag tag-green">Co-op Party</span>
              </div>
            </div>

            <div className="onb-card stack-form">
              <h3 className="onb-card-title">Tactical Combat &amp; Live Reactions</h3>
              <ul className="onb-brief-list">
                <li><strong>Your Turn</strong>: Move around obstacles, <strong>Observe</strong> nearby enemies to reveal hidden HP &amp; Weak Spots, use <strong>1 Consumable</strong>, and either <strong>Attack</strong> or <strong>Cast a Spell</strong>.</li>
                <li><strong>Opposed Dice Clashes</strong>: When a monster strikes you, react live with <strong>Counter / Parry</strong>, <strong>Block / Dodge</strong>, or a <strong>Reaction Spell</strong>.</li>
                <li><strong>Fallen State</strong>: Hit <strong>0 HP</strong> and you drop out of turn order to spectate the battlefield until revived.</li>
              </ul>
            </div>

            <div className="onb-card stack-form">
              <h3 className="onb-card-title">Stats &amp; Awakenings</h3>
              <p className="small">
                Start at <strong>Level 1</strong> with <strong>6 free stat points</strong> (<strong>+2</strong> per level, plus <strong>+1 bonus</strong> every 3 levels). Higher stats grant steadily stronger bonuses that scale even harder at high scores — <strong>VIT</strong> directly boosts Max HP and <strong>INT</strong> boosts Max MP.
              </p>
              <div className="onb-stat-grid">
                <div><strong>STR</strong><span>Melee Power</span></div>
                <div><strong>AGI</strong><span>Init &amp; Dodge</span></div>
                <div><strong>VIT</strong><span>HP &amp; Endurance</span></div>
                <div><strong>INT</strong><span>Spells &amp; MP</span></div>
                <div><strong>PER</strong><span>Hit &amp; Range</span></div>
                <div><strong>LUCK</strong><span>Crits &amp; Loot</span></div>
              </div>
              <div className="onb-milestone-row">
                <span className="muted small">Awakening Milestones:</span>
                <div className="onb-milestone-pills">
                  {[20, 40, 60, 80, 100].map((m) => (
                    <span key={m} className="tag tag-cyan">{m}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="onb-card stack-form">
              <h3 className="onb-card-title">Builds, Gacha &amp; Prep Rules</h3>
              <ul className="onb-brief-list">
                <li><strong>Passive Gacha</strong>: Spend <strong>Mana Stones</strong> to roll from <strong>200 Passive Skills</strong> across 7 tiers (Normal &rarr; Mythic); climbing higher floors improves rare odds.</li>
                <li><strong>Spells, Loot &amp; Deities</strong>: Unlock and craft elemental spells as you level, claim Boss Chests, and awaken <strong>Patron Deities</strong> on higher floors.</li>
                <li><strong>Prep Lock</strong>: Allocate stats and swap gear <em>between</em> Story Beats — once a live Story Beat begins, your loadout locks in until it&apos;s cleared.</li>
              </ul>
            </div>

            <div className="onb-footer">
              <div className="onb-footer-inner onb-footer-split">
                <button type="button" id="btn-onb-step4-back" className="btn btn-outline" onClick={() => setStep(3)}>
                  &larr; Back
                </button>
                <button type="button" id="btn-onb-finish" className="btn btn-cyan btn-lg btn-glow-cyan" onClick={finishOnboarding}>
                  Enter The Tower &rarr;
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </section>
  );
}
