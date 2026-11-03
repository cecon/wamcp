// C3Theme
import { ActionDialog } from '@c3theme/ui';

import C3Provider from '../c3/C3Provider';
import { useAction } from '../settings/useAction';

interface Props {
  title: string;
  description: string;
  confirm: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

/** Confirmação de exclusão no C3Theme: mensagem, Cancelar e o botão de confirmar; erros ficam no diálogo. */
export function ConfirmModal({ title, description, confirm, onConfirm, onClose }: Props) {
  const { error, busy, run } = useAction();
  return (
    <C3Provider>
      <ActionDialog
        open
        title={title}
        description={description}
        confirmLabel={confirm}
        backLabel="Cancelar"
        tone="danger"
        loading={busy}
        error={error}
        onClose={onClose}
        onConfirm={() =>
          void run(async () => {
            await onConfirm();
            onClose();
          })
        }
      />
    </C3Provider>
  );
}
