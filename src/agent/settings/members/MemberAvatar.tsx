import type { RosterKind, AvatarChoices } from '../../adminTypes';
import { withDefaults } from './avatar';

const SKIN: Record<string, string> = { light: '#F6D3B8', tan: '#E0AC85', brown: '#B57A55', dark: '#7A4E35' };
const HAIR = '#3B2A22';

interface Props {
  choices?: AvatarChoices;
  kind: RosterKind;
  /** Varies the defaults between members (their id). */
  seed: number;
  size?: number;
  title?: string;
}

/** A member's illustrated avatar, drawn from its choices with the app's color tokens. */
export function MemberAvatar({ choices, kind, seed, size = 56, title }: Props) {
  const a = withDefaults(choices, kind, seed);
  const accent = `var(--color-n-${a.color}-9)`;
  const skin = SKIN[a.skin] ?? SKIN.light;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={title ?? 'Avatar'}
      className="shrink-0 rounded-full"
    >
      <circle cx="32" cy="32" r="32" fill={accent} opacity="0.18" />
      {/* Clothes */}
      <path d="M12 64c0-12 9-19 20-19s20 7 20 19z" fill={accent} />
      {a.outfit === 'suit' && <path d="M32 46l-5 18h10z" fill="#fff" opacity="0.9" />}
      {a.outfit === 'suit' && <path d="M32 47l-2 4 2 11 2-11z" fill={HAIR} />}
      {a.outfit === 'shirt' && <path d="M26 46l6 7 6-7" fill="none" stroke="#fff" strokeWidth="2" />}
      {a.outfit === 'hoodie' && (
        <path d="M22 47c3 5 17 5 20 0" fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="3" />
      )}
      {a.outfit === 'tshirt' && <path d="M27 46c2 3 8 3 10 0" fill="none" stroke="#fff" strokeWidth="2" />}
      {/* Neck and head */}
      <rect x="28" y="38" width="8" height="8" rx="3" fill={skin} />
      {a.hair === 'long' && <path d="M17 30c0-13 7-19 15-19s15 6 15 19v14H17z" fill={HAIR} />}
      <circle cx="32" cy="28" r="12" fill={skin} />
      {a.hair === 'short' && (
        <path d="M20 27c0-9 5-13 12-13s12 4 12 13c-3-4-7-6-12-6s-9 2-12 6z" fill={HAIR} />
      )}
      {a.hair === 'long' && (
        <path d="M20 27c0-9 5-13 12-13s12 4 12 13c-4-5-8-7-12-7s-8 2-12 7z" fill={HAIR} />
      )}
      {a.hair === 'curly' &&
        [20, 25, 30, 35, 40, 44].map((x, i) => (
          <circle key={x} cx={x} cy={i % 2 ? 17 : 20} r="5" fill={HAIR} />
        ))}
      {a.hair === 'bun' && (
        <>
          <circle cx="32" cy="12" r="5" fill={HAIR} />
          <path d="M20 26c0-8 5-12 12-12s12 4 12 12c-3-4-7-5-12-5s-9 1-12 5z" fill={HAIR} />
        </>
      )}
      {/* Face */}
      <circle cx="27.5" cy="29" r="1.5" fill={HAIR} />
      <circle cx="36.5" cy="29" r="1.5" fill={HAIR} />
      <path d="M28.5 34c2 2 5 2 7 0" fill="none" stroke={HAIR} strokeWidth="1.5" strokeLinecap="round" />
      {a.accessory === 'glasses' && (
        <g fill="none" stroke={HAIR} strokeWidth="1.5">
          <circle cx="27.5" cy="29" r="3.5" />
          <circle cx="36.5" cy="29" r="3.5" />
          <path d="M31 29h2" />
        </g>
      )}
      {a.accessory === 'headset' && (
        <g fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round">
          <path d="M19 29c0-9 6-14 13-14s13 5 13 14" />
          <rect x="17" y="27" width="4" height="7" rx="2" fill="#94a3b8" />
          <rect x="43" y="27" width="4" height="7" rx="2" fill="#94a3b8" />
          <path d="M45 34c0 4-3 6-8 6" strokeWidth="1.5" />
        </g>
      )}
      {a.accessory === 'cap' && (
        <path d="M19 23c0-7 6-10 13-10s13 3 13 10zM32 23h16c0 2-2 3-4 3H32z" fill={accent} />
      )}
    </svg>
  );
}
