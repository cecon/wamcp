import { useState } from 'react';
import { http } from '../../api';
import type { Skill } from '../../adminTypes';
import { Modal } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../useAction';

interface Props {
  skill: Skill | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Skill form: name, description, instructions (markdown) and the MCP tools it may call. */
export function SkillModal({ skill, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: skill?.name || '',
    description: skill?.description || '',
    instructions: skill?.instructions || '',
    tools: skill?.tools.join(', ') || '',
  });
  const { error, busy, run } = useAction();
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <Modal
      title={skill ? 'Editar skill' : 'Adicionar skill'}
      description="As instruções dizem ao agente como executar; as ferramentas limitam o que ele pode chamar."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const body = {
              name: form.name.trim(),
              description: form.description.trim() || null,
              instructions: form.instructions,
              tools: form.tools
                .split(/[,\n]/)
                .map((t) => t.trim())
                .filter(Boolean),
            };
            await http(skill ? `/skills/${skill.id}` : '/skills', skill ? 'PUT' : 'POST', body);
            onSaved();
            onClose();
          });
        }}
      >
        <label>
          <span className="field-label">Nome</span>
          <input className="field" required maxLength={80} {...field('name')} />
        </label>
        <label>
          <span className="field-label">Descrição</span>
          <input className="field" maxLength={500} {...field('description')} />
        </label>
        <label>
          <span className="field-label">Instruções</span>
          <textarea className="field font-mono" rows={8} maxLength={20000} {...field('instructions')} />
        </label>
        <label>
          <span className="field-label">Ferramentas</span>
          <input className="field" placeholder="reply_conversation, catalog_*" {...field('tools')} />
        </label>
        <ModalFooter
          busy={busy}
          submit={skill ? 'Atualizar skill' : 'Criar skill'}
          onCancel={onClose}
          error={error}
        />
      </form>
    </Modal>
  );
}
