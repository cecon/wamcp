import { Copy } from 'lucide-react';
import { Button } from './Button';

interface Props {
  label: string;
  secret: string;
  copyLabel: string;
}

/** Read-only secret (webhook signing secret, bot access token) with a copy button. */
export function SecretField({ label, secret, copyLabel }: Props) {
  return (
    <label>
      <span className="field-label">{label}</span>
      <span className="flex gap-2">
        <input className="field font-mono" readOnly value={secret} aria-label={label} />
        <Button
          color="slate"
          variant="faded"
          size="md"
          icon={Copy}
          aria-label={copyLabel}
          onClick={() => void navigator.clipboard?.writeText(secret)}
        />
      </span>
    </label>
  );
}
