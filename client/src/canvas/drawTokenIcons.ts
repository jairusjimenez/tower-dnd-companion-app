import { TOKEN_ICON_META, type TokenIconId } from '@shared/index';

export function drawVectorTokenIcon(
  ctx: CanvasRenderingContext2D,
  iconId: TokenIconId,
  cx: number,
  cy: number,
  r: number,
): void {
  const meta = TOKEN_ICON_META[iconId] || TOKEN_ICON_META.goblin;
  const s = r * 0.72;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = meta.accent;
  ctx.fillStyle = meta.accent;
  ctx.lineWidth = Math.max(1.2, r * 0.11);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (iconId) {
    case 'goblin': {
      // Pointed ears + triangular head + sharp eyes
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, -s * 0.15);
      ctx.lineTo(-s * 1.05, -s * 0.45);
      ctx.lineTo(-s * 0.38, s * 0.2);
      ctx.moveTo(s * 0.45, -s * 0.15);
      ctx.lineTo(s * 1.05, -s * 0.45);
      ctx.lineTo(s * 0.38, s * 0.2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, s * 0.06, s * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.moveTo(-s * 0.28, -s * 0.05);
      ctx.lineTo(-s * 0.08, s * 0.05);
      ctx.lineTo(-s * 0.28, s * 0.12);
      ctx.moveTo(s * 0.28, -s * 0.05);
      ctx.lineTo(s * 0.08, s * 0.05);
      ctx.lineTo(s * 0.28, s * 0.12);
      ctx.fill();
      break;
    }
    case 'orc': {
      // Broad jaw + upturned tusks
      ctx.beginPath();
      ctx.roundRect(-s * 0.56, -s * 0.52, s * 1.12, s * 1.04, s * 0.28);
      ctx.fill();
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath();
      ctx.moveTo(-s * 0.34, s * 0.42);
      ctx.lineTo(-s * 0.22, s * 0.02);
      ctx.lineTo(-s * 0.12, s * 0.42);
      ctx.moveTo(s * 0.34, s * 0.42);
      ctx.lineTo(s * 0.22, s * 0.02);
      ctx.lineTo(s * 0.12, s * 0.42);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-s * 0.32, -s * 0.24, s * 0.2, s * 0.14);
      ctx.fillRect(s * 0.12, -s * 0.24, s * 0.2, s * 0.14);
      break;
    }
    case 'dragon': {
      // Swept horns + fierce snout
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.25);
      ctx.lineTo(-s * 0.85, -s * 0.82);
      ctx.lineTo(-s * 0.1, -s * 0.45);
      ctx.moveTo(s * 0.3, -s * 0.25);
      ctx.lineTo(s * 0.85, -s * 0.82);
      ctx.lineTo(s * 0.1, -s * 0.45);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.5);
      ctx.lineTo(s * 0.52, s * 0.05);
      ctx.lineTo(s * 0.28, s * 0.68);
      ctx.lineTo(-s * 0.28, s * 0.68);
      ctx.lineTo(-s * 0.52, s * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(-s * 0.24, -s * 0.06, s * 0.16, s * 0.14);
      ctx.fillRect(s * 0.08, -s * 0.06, s * 0.16, s * 0.14);
      break;
    }
    case 'serpent': {
      // S-coil serpent + forked tongue
      ctx.lineWidth = Math.max(2, r * 0.22);
      ctx.beginPath();
      ctx.moveTo(-s * 0.55, s * 0.65);
      ctx.bezierCurveTo(s * 0.65, s * 0.65, -s * 0.65, 0, s * 0.2, -s * 0.52);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.25, -s * 0.52, s * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.beginPath();
      ctx.moveTo(s * 0.46, -s * 0.52);
      ctx.lineTo(s * 0.72, -s * 0.52);
      ctx.lineTo(s * 0.85, -s * 0.64);
      ctx.moveTo(s * 0.72, -s * 0.52);
      ctx.lineTo(s * 0.85, -s * 0.4);
      ctx.stroke();
      break;
    }
    case 'spider': {
      // Abdomen + head + 8 legs
      ctx.beginPath();
      ctx.arc(0, s * 0.22, s * 0.36, 0, Math.PI * 2);
      ctx.arc(0, -s * 0.28, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const yOff = -s * 0.32 + i * s * 0.24;
          ctx.beginPath();
          ctx.moveTo(side * s * 0.2, yOff);
          ctx.lineTo(side * s * 0.68, yOff - s * 0.2);
          ctx.lineTo(side * s * 0.9, yOff + s * 0.12);
          ctx.stroke();
        }
      }
      break;
    }
    case 'undead': {
      // Skull
      ctx.beginPath();
      ctx.arc(0, -s * 0.14, s * 0.52, Math.PI * 0.85, Math.PI * 0.15, false);
      ctx.lineTo(s * 0.32, s * 0.58);
      ctx.lineTo(-s * 0.32, s * 0.58);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(-s * 0.2, -s * 0.1, s * 0.14, 0, Math.PI * 2);
      ctx.arc(s * 0.2, -s * 0.1, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-s * 0.18, s * 0.34, s * 0.08, s * 0.2);
      ctx.fillRect(s * 0.1, s * 0.34, s * 0.08, s * 0.2);
      break;
    }
    case 'knight': {
      // Visored helm + plume
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.85);
      ctx.quadraticCurveTo(s * 0.45, -s * 0.72, s * 0.32, -s * 0.38);
      ctx.lineTo(-s * 0.2, -s * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(-s * 0.48, -s * 0.46, s * 0.96, s * 1.02, s * 0.3);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-s * 0.34, -s * 0.12, s * 0.68, s * 0.16);
      ctx.fillRect(-s * 0.06, -s * 0.12, s * 0.12, s * 0.52);
      break;
    }
    case 'beast': {
      // Wolf/beast ears + snout
      ctx.beginPath();
      ctx.moveTo(-s * 0.48, -s * 0.12);
      ctx.lineTo(-s * 0.62, -s * 0.82);
      ctx.lineTo(-s * 0.1, -s * 0.42);
      ctx.moveTo(s * 0.48, -s * 0.12);
      ctx.lineTo(s * 0.62, -s * 0.82);
      ctx.lineTo(s * 0.1, -s * 0.42);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, s * 0.12, s * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(-s * 0.2, -s * 0.02, s * 0.1, 0, Math.PI * 2);
      ctx.arc(s * 0.2, -s * 0.02, s * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.14, s * 0.22);
      ctx.lineTo(s * 0.14, s * 0.22);
      ctx.lineTo(0, s * 0.38);
      ctx.fill();
      break;
    }
    case 'slime': {
      // Blob + cute menacing eyes
      ctx.beginPath();
      ctx.moveTo(-s * 0.68, s * 0.48);
      ctx.quadraticCurveTo(-s * 0.72, -s * 0.56, 0, -s * 0.62);
      ctx.quadraticCurveTo(s * 0.72, -s * 0.56, s * 0.68, s * 0.48);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(-s * 0.22, s * 0.04, s * 0.11, 0, Math.PI * 2);
      ctx.arc(s * 0.22, s * 0.04, s * 0.11, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'demon': {
      // Curved horns + fierce face
      ctx.beginPath();
      ctx.moveTo(-s * 0.35, -s * 0.2);
      ctx.quadraticCurveTo(-s * 0.88, -s * 0.55, -s * 0.55, -s * 0.88);
      ctx.quadraticCurveTo(-s * 0.45, -s * 0.48, -s * 0.15, -s * 0.4);
      ctx.moveTo(s * 0.35, -s * 0.2);
      ctx.quadraticCurveTo(s * 0.88, -s * 0.55, s * 0.55, -s * 0.88);
      ctx.quadraticCurveTo(s * 0.45, -s * 0.48, s * 0.15, -s * 0.4);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, s * 0.1, s * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-s * 0.26, -s * 0.02, s * 0.18, s * 0.12);
      ctx.fillRect(s * 0.08, -s * 0.02, s * 0.18, s * 0.12);
      break;
    }
    case 'golem': {
      // Angular monolith head
      ctx.beginPath();
      ctx.moveTo(-s * 0.46, -s * 0.64);
      ctx.lineTo(s * 0.46, -s * 0.64);
      ctx.lineTo(s * 0.62, s * 0.15);
      ctx.lineTo(s * 0.34, s * 0.64);
      ctx.lineTo(-s * 0.34, s * 0.64);
      ctx.lineTo(-s * 0.62, s * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-s * 0.36, -s * 0.14, s * 0.72, s * 0.18);
      break;
    }
    case 'insect': {
      // Mandibles + compound eyes
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, s * 0.35);
      ctx.lineTo(-s * 0.58, s * 0.82);
      ctx.lineTo(-s * 0.06, s * 0.58);
      ctx.moveTo(s * 0.2, s * 0.35);
      ctx.lineTo(s * 0.58, s * 0.82);
      ctx.lineTo(s * 0.06, s * 0.58);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.05, s * 0.48, s * 0.56, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.ellipse(-s * 0.24, -s * 0.1, s * 0.14, s * 0.22, -0.3, 0, Math.PI * 2);
      ctx.ellipse(s * 0.24, -s * 0.1, s * 0.14, s * 0.22, 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'boss': {
      // Crowned skull emblem
      ctx.beginPath();
      ctx.arc(0, s * 0.12, s * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.52, -s * 0.26);
      ctx.lineTo(-s * 0.52, -s * 0.78);
      ctx.lineTo(-s * 0.2, -s * 0.48);
      ctx.lineTo(0, -s * 0.88);
      ctx.lineTo(s * 0.2, -s * 0.48);
      ctx.lineTo(s * 0.52, -s * 0.78);
      ctx.lineTo(s * 0.52, -s * 0.26);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(-s * 0.18, s * 0.08, s * 0.12, 0, Math.PI * 2);
      ctx.arc(s * 0.18, s * 0.08, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'merchant': {
      // Coin pouch
      ctx.beginPath();
      ctx.moveTo(-s * 0.25, -s * 0.62);
      ctx.lineTo(s * 0.25, -s * 0.62);
      ctx.lineTo(s * 0.14, -s * 0.32);
      ctx.lineTo(s * 0.55, s * 0.12);
      ctx.quadraticCurveTo(s * 0.55, s * 0.68, 0, s * 0.68);
      ctx.quadraticCurveTo(-s * 0.55, s * 0.68, -s * 0.55, s * 0.12);
      ctx.lineTo(-s * 0.14, -s * 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#064e3b';
      ctx.font = `bold ${Math.max(8, Math.round(s * 0.72))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', 0, s * 0.2);
      break;
    }
    case 'quest_giver': {
      // Exclamation mark inside scroll/diamond
      ctx.beginPath();
      ctx.roundRect(-s * 0.2, -s * 0.72, s * 0.4, s * 0.88, s * 0.14);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, s * 0.52, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'skill_master': {
      // Crossed swords
      ctx.lineWidth = Math.max(1.8, r * 0.15);
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-dir * s * 0.62, s * 0.62);
        ctx.lineTo(dir * s * 0.62, -s * 0.62);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-dir * s * 0.48, s * 0.22);
        ctx.lineTo(-dir * s * 0.22, s * 0.48);
        ctx.stroke();
      }
      break;
    }
    case 'guard': {
      // Heater shield
      ctx.beginPath();
      ctx.moveTo(-s * 0.56, -s * 0.62);
      ctx.lineTo(s * 0.56, -s * 0.62);
      ctx.lineTo(s * 0.56, s * 0.04);
      ctx.quadraticCurveTo(0, s * 0.78, 0, s * 0.78);
      ctx.quadraticCurveTo(0, s * 0.78, -s * 0.56, s * 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1e3a8a';
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.42);
      ctx.lineTo(0, s * 0.48);
      ctx.moveTo(-s * 0.34, -s * 0.08);
      ctx.lineTo(s * 0.34, -s * 0.08);
      ctx.stroke();
      break;
    }
    case 'healer': {
      // Plus / Medical cross
      ctx.fillRect(-s * 0.2, -s * 0.66, s * 0.4, s * 1.32);
      ctx.fillRect(-s * 0.66, -s * 0.2, s * 1.32, s * 0.4);
      break;
    }
    case 'blacksmith': {
      // Hammer
      ctx.fillRect(-s * 0.58, -s * 0.64, s * 1.16, s * 0.44);
      ctx.fillRect(-s * 0.14, -s * 0.2, s * 0.28, s * 0.88);
      break;
    }
    case 'sage': {
      // 4-point arcane star
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.78);
      ctx.lineTo(s * 0.22, -s * 0.22);
      ctx.lineTo(s * 0.78, 0);
      ctx.lineTo(s * 0.22, s * 0.22);
      ctx.lineTo(0, s * 0.78);
      ctx.lineTo(-s * 0.22, s * 0.22);
      ctx.lineTo(-s * 0.78, 0);
      ctx.lineTo(-s * 0.22, -s * 0.22);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'villager':
    default: {
      // Hooded figure silhouette
      ctx.beginPath();
      ctx.arc(0, -s * 0.28, s * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.54, s * 0.66);
      ctx.quadraticCurveTo(0, -s * 0.05, s * 0.54, s * 0.66);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}

export function drawBossCrown(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const cw = Math.max(10, r * 0.85);
  const ch = Math.max(6, r * 0.46);
  const topY = cy - r - ch * 0.68;
  ctx.save();
  ctx.fillStyle = '#fbbf24';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - cw * 0.5, topY + ch);
  ctx.lineTo(cx - cw * 0.55, topY + ch * 0.15);
  ctx.lineTo(cx - cw * 0.22, topY + ch * 0.58);
  ctx.lineTo(cx, topY);
  ctx.lineTo(cx + cw * 0.22, topY + ch * 0.58);
  ctx.lineTo(cx + cw * 0.55, topY + ch * 0.15);
  ctx.lineTo(cx + cw * 0.5, topY + ch);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawNumberPip(ctx: CanvasRenderingContext2D, badge: string, cx: number, cy: number, r: number): void {
  const pr = Math.max(5.5, r * 0.36);
  const px = cx + r * 0.72;
  const py = cy + r * 0.72;
  ctx.save();
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(px, py, pr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.font = `bold ${Math.max(7, Math.round(pr * 1.12))}px Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badge, px, py + 0.5);
  ctx.restore();
}
