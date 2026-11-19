import React, { useEffect, useState } from 'react';
import { STARTER_WOODEN_WEAPONS } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { compressPortraitFileToDataUrl } from '../../utils/imageUpload';

export function OnboardingView() {
  const { session, state, sendAction, setShowOnboarding, pushLocalToast } = useVtt();
  const ch = session?.characterId ? state?.characters?.[session.characterId] : undefined;

  const [step, setStep] = useState(1);
  const [name, setName] = useState(ch?.name || '');
  const [race, setRace] = useState('Human');
  const [className, setClassName] = useState('Adventurer');

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
        pickedWeapon.offHand ? `${pickedWeapon.offHand.name} (+${pickedWeapon.offHand.acBonus} AC${pickedWeapon.offHand.drBonus ? `, +${pickedWeapon.offHand.drBonus} DR` : ''})` : '',
        pickedWeapon.boots ? `${pickedWeapon.boots.name} (+${pickedWeapon.boots.acBonus} AC)` : '',
        pickedWeapon.head ? `${pickedWeapon.head.name} (+${pickedWeapon.head.acBonus} AC)` : '',
      ]
        .filter(Boolean)
        .join(' • ')
    : '';

  const finishOnboarding = () => {
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
      prompt: artPrompt.trim() || ch?.name || 'Tower Climber',
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
      pushLocalToast({ title: 'PORTRAIT UPLOADED', message: 'Your character portrait is ready!', category: 'loot' });
    } catch (err) {
      pushLocalToast({ title: 'UPLOAD ERROR', message: err instanceof Error ? err.message : 'Failed to upload image.', category: 'warning' });
    } finally {
      ev.target.value = '';
    }
  };

  const stepTitles: Record<number, string> = {
    1: 'Step 1 of 4 — Create Your Character',
    2: 'Step 2 of 4 — Choose Starting Equipment',
    3: 'Step 3 of 4 — Upload Image or Generate AI Art',
    4: 'Step 4 of 4 — The Tower & Game Mechanics',
  };

  return (
    <section id="player-onboarding-view" className="view active app-shell player-shell">
      <header className="topbar">
        <div className="topbar-left">
          <span className="badge-tower">AWAKENING</span>
          <div>
            <strong id="onb-char-name">Welcome, {ch?.name || 'Climber'}</strong>
            <div className="muted small" id="onb-step-subtitle">{stepTitles[step] || stepTitles[1]}</div>
          </div>
        </div>
        <div className="topbar-right">
          <button type="button" id="btn-onb-enter" className="btn btn-sm btn-outline" onClick={finishOnboarding}>
            Skip to Player Screen &rarr;
          </button>
        </div>
      </header>

      <main className="app-content" style={{ maxWidth: '820px', margin: '0 auto' }}>
        <div className="btn-row mb-sm" id="onb-step-pills" style={{ justifyContent: 'center', gap: '8px' }}>
          {[
            { num: 1, label: '1. Create Character' },
            { num: 2, label: '2. Starting Equipment' },
            { num: 3, label: '3. Portrait & AI Art' },
            { num: 4, label: '4. The Tower & Mechanics' },
          ].map((p) => (
            <span key={p.num} className={`tag ${p.num === step ? 'tag-cyan' : p.num < step ? 'tag-green' : ''}`}>
              {p.label}
            </span>
          ))}
        </div>

        {step === 1 && (
          <div id="onb-step-1" className="panel card-glow-cyan">
            <div className="panel-header"><h3>Step 1: Create Your Character</h3></div>
            <p className="muted small">Choose your Climber's name, race, and combat role before entering the Tower.</p>
            <form id="onb-char-form" className="stack-form mt-sm" onSubmit={handleSaveProfile}>
              <label>
                <span>Character Name</span>
                <input
                  id="onb-char-name-input"
                  type="text"
                  maxLength={48}
                  placeholder="e.g. Bam, Rachel, Khun Aguero"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div className="grid-2">
                <label>
                  <span>Race</span>
                  <select id="onb-char-race" required value={race} onChange={(e) => setRace(e.target.value)}>
                    <option value="Human">Human</option>
                  </select>
                </label>
                <label>
                  <span>Class / Role</span>
                  <select id="onb-char-class" required value={className} onChange={(e) => setClassName(e.target.value)}>
                    <option value="Adventurer">Adventurer</option>
                  </select>
                </label>
              </div>
              <div className="btn-row mt-sm" style={{ justifyContent: 'flex-end' }}>
                <button type="submit" className="btn btn-cyan btn-lg btn-glow-cyan">Save Character &amp; Next &rarr;</button>
              </div>
            </form>
          </div>
        )}

        {step === 2 && (
          <div id="onb-step-2" className="panel card-glow-cyan">
            <div className="panel-header"><h3>Step 2: Choose Starting Equipment</h3></div>
            <p className="muted small">Pick a preset starter loadout or customize your starting wooden weapon.</p>
            <form id="onb-equip-form" className="stack-form mt-sm" onSubmit={handleSaveEquipment}>
              <label>
                <span>Starter Loadout</span>
                <select id="onb-equip-kit" value={kit} onChange={(e) => setKit(e.target.value)}>
                  <option value="archer">Archer Starter Equipment (Oak Shortbow • Scout Leather Tunic)</option>
                  <option value="swordsman">Swordsman Starter Equipment (Iron Longsword • Trainee Brigandine)</option>
                  <option value="sword_shield">Sword &amp; Shield Starter Equipment (Iron Broadsword • Oak Kite Shield • Leather Coat)</option>
                  <option value="mage">Mage Starter Equipment (Apprentice Mana Staff • Scholar Robes • Shinsu Focus)</option>
                  <option value="custom">Custom Starter Equipment (Choose Wooden Melee or Ranged)</option>
                </select>
              </label>

              {kit === 'custom' && (
                <div id="onb-custom-equip-box" className="stack-form">
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
                  <div id="onb-custom-armor-preview" className="small muted">Fitted Armor: {armorSummary}</div>
                </div>
              )}

              <div className="btn-row mt-md" style={{ justifyContent: 'space-between' }}>
                <button type="button" id="btn-onb-equip-back" className="btn btn-outline" onClick={() => setStep(1)}>
                  &larr; Back
                </button>
                <button type="submit" className="btn btn-cyan btn-lg btn-glow-cyan">Equip &amp; Next: Portrait &rarr;</button>
              </div>
            </form>
          </div>
        )}

        {step === 3 && (
          <div id="onb-step-3" className="panel card-glow-gold">
            <div className="panel-header"><h3>Step 3: Upload Image or Generate AI Art</h3></div>
            <p className="muted small">This portrait becomes your character icon on all Story Beat Arena Maps.</p>
            <div style={{ textAlign: 'center', margin: '12px 0' }}>
              <img
                id="onb-art-preview"
                src={ch?.portraitUrl || ''}
                alt="Character Portrait Preview"
                style={{ width: '200px', height: '200px', objectFit: 'cover', borderRadius: '14px', border: '2px solid var(--cyan)' }}
              />
            </div>
            <div className="stack-form">
              <label>
                <span>Option A: Upload Your Own Image</span>
                <input id="onb-art-upload" type="file" accept="image/*" onChange={handleUploadArt} />
              </label>
              <div className="panel-subheader mt-xs"><span>Option B: Generate AI Character Art</span></div>
              <div className="grid-2">
                <label>
                  <span>Art Prompt</span>
                  <input
                    id="onb-art-prompt"
                    type="text"
                    placeholder="e.g. Silver-haired elf mage with cyan staff"
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
            <div className="btn-row mt-md" style={{ justifyContent: 'space-between' }}>
              <button type="button" id="btn-onb-step3-back" className="btn btn-outline" onClick={() => setStep(2)}>
                &larr; Back
              </button>
              <button type="button" id="btn-onb-step3-next" className="btn btn-cyan btn-lg btn-glow-cyan" onClick={() => setStep(4)}>
                Next: The Tower &amp; Mechanics &rarr;
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div id="onb-step-4" className="stack">
            <div className="panel card-glow-cyan">
              <div className="panel-header"><h3>Step 4: The World, The Tower &amp; Your Objective</h3></div>
              <p className="small">
                You have been summoned into <strong>The Tower</strong> — an ascending spire of distinct realms (from <strong>1F Forest</strong> to <strong>2F Desert</strong>, <strong>3F Underworld</strong>, and uncharted floors above). Each floor contains live <strong>Story Beats</strong>, NPCs, traps, and Floor Guardians.
              </p>
              <ul className="small" style={{ margin: '6px 0 0 18px', lineHeight: 1.6 }}>
                <li><strong>Story Beats &amp; Exploration</strong>: Cooperate with your party, move across tactical Arena Maps, avoid impassable terrain, open <strong>Treasure Chests</strong>, and talk to <strong>NPCs</strong> for Items, Skill Books, and XP.</li>
                <li><strong>Combat &amp; Loot</strong>: Strike monsters with weapons or free-flow magic, react in real time when attacked (Counter, Parry, or Spell), and claim monster loot drops.</li>
              </ul>
            </div>

            <div className="panel">
              <div className="panel-header"><h3>Stats, Modifiers &amp; Milestone Awakenings</h3></div>
              <p className="small">
                You begin at <strong>Level 1</strong> with <strong>10 free stat points</strong> (plus <strong>+2</strong> every level up). Modifiers use <code>floor((SCORE - 10) / 2)</code>.
              </p>
              <ul className="small" style={{ margin: '6px 0 0 18px', lineHeight: 1.55 }}>
                <li><strong>STR</strong>: Melee power &bull; <strong>AGI</strong>: Initiative &amp; evasion &bull; <strong>VIT</strong>: Endurance &amp; HP</li>
                <li><strong>INT</strong>: Spell power &amp; MP &bull; <strong>PER</strong>: Accuracy &amp; range &bull; <strong>LUCK</strong>: Crits &amp; loot</li>
                <li><strong>Milestone Awakenings</strong>: Reaching <strong>20, 40, 60, 80, and 100</strong> in any stat automatically unlocks Awakened Abilities!</li>
              </ul>
              <div className="btn-row mt-md" style={{ justifyContent: 'space-between' }}>
                <button type="button" id="btn-onb-step4-back" className="btn btn-outline" onClick={() => setStep(3)}>
                  &larr; Back
                </button>
                <button type="button" id="btn-onb-finish" className="btn btn-cyan btn-lg btn-glow-cyan" onClick={finishOnboarding}>
                  Enter Player Screen &rarr;
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </section>
  );
}
