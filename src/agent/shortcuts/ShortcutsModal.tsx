import { Modal } from '../ui/Overlay';

/** Shortcuts shown in the help (Chatwoot keyboard shortcuts modal). */
const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['?'], label: 'Mostrar os atalhos de teclado' },
  { keys: ['Ctrl / ⌘', 'K'], label: 'Abrir a pesquisa' },
  { keys: ['Alt', 'J'], label: 'Próxima conversa' },
  { keys: ['Alt', 'K'], label: 'Conversa anterior' },
  { keys: ['Alt', 'E'], label: 'Resolver conversa' },
  { keys: ['Alt', 'O'], label: 'Reabrir conversa' },
  { keys: ['Alt', 'A'], label: 'Atribuir a mim' },
  { keys: ['Alt', 'L'], label: 'Adicionar etiquetas' },
  { keys: ['/'], label: 'Ir para o editor de mensagem' },
  { keys: ['Ctrl / ⌘', 'Enter'], label: 'Enviar mensagem' },
  { keys: ['Shift', 'Enter'], label: 'Nova linha na mensagem' },
  { keys: ['Esc'], label: 'Fechar janelas' },
];

/** Chatwoot "Atalhos do teclado" modal: one row per action with its key chips. */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Atalhos de teclado"
      description="Os atalhos não funcionam enquanto você digita em um campo, exceto os do editor."
      onClose={onClose}
    >
      <ul className="grid gap-x-8 sm:grid-cols-2">
        {SHORTCUTS.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3 border-b border-n-weak py-2">
            <span className="text-sm text-n-slate-12">{s.label}</span>
            <span className="flex shrink-0 gap-1">
              {s.keys.map((key) => (
                <kbd
                  key={key}
                  className="rounded-md bg-n-alpha-2 px-1.5 py-0.5 font-sans text-xs text-n-slate-12 outline outline-1 -outline-offset-1 outline-n-weak"
                >
                  {key}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
