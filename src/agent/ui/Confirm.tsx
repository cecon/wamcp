import { useAction } from '../settings/useAction';
import { Button } from './Button';
import { Modal } from './Overlay';

interface Props {
  title: string;
  description: string;
  confirm: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

/** Chatwoot delete confirmation: message, Cancel and a red confirm button; errors stay in the dialog. */
export function ConfirmModal({ title, description, confirm, onConfirm, onClose }: Props) {
  const { error, busy, run } = useAction();
  return (
    <Modal title={title} description={description} onClose={onClose}>
      {error && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-4">
        <Button color="slate" variant="faded" label="Cancelar" onClick={onClose} />
        <Button
          color="ruby"
          label={confirm}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await onConfirm();
              onClose();
            })
          }
        />
      </div>
    </Modal>
  );
}
