import { useState } from 'react';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { ConfirmModal } from '../../ui/Confirm';
import { SidePanel } from '../../ui/Overlay';
import { ModalFooter } from '../../ui/Settings';
import { useAction } from '../../settings/useAction';
import { catalogApi } from '../catalogApi';
import { GroupEditor } from '../groups/GroupEditor';
import { PizzaSection } from '../pizza/PizzaSection';
import type { CatalogItem, Category, Menu } from '../types';
import { ErrorList, Section } from '../ui';
import { useGroups } from '../useMenu';
import { ComboSection } from './ComboSection';
import { DetailsSection } from './DetailsSection';
import { GroupsSection } from './GroupsSection';
import { saveItem, toDraft, validateItem, type ItemDraft } from './itemDraft';
import { PhotoField } from './PhotoField';
import { PriceSection } from './PriceSection';
import { Simulator } from './Simulator';

interface Props {
  item?: CatalogItem;
  category: Category;
  menu: Menu;
  editable: boolean;
  onSaved: () => void;
  onClose: () => void;
}

type Tab = 'item' | 'simulator';

/** Side panel to create/edit an item (read-only for agents) with the order simulator alongside. */
export function ItemEditor({ item, category, menu, editable, onSaved, onClose }: Props) {
  const [draft, setDraft] = useState<ItemDraft>(() => toDraft(item, category, menu)),
    [tab, setTab] = useState<Tab>('item'),
    [errors, setErrors] = useState<string[]>([]),
    [creatingGroup, setCreatingGroup] = useState(false),
    [deleting, setDeleting] = useState(false);
  const { groups: library, reload: reloadLibrary } = useGroups();
  const { error, busy, run } = useAction();
  const set = (patch: Partial<ItemDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const title = item ? (editable ? `Editar ${item.product.name}` : item.product.name) : 'Novo item';
  const save = () => {
    const problems = validateItem(draft);
    setErrors(problems);
    if (problems.length) return;
    void run(async () => {
      await saveItem(draft, category, item);
      onSaved();
      onClose();
    });
  };

  return (
    <SidePanel title={title} onClose={onClose}>
      {item && (
        <div role="tablist" className="mb-4 flex gap-1 border-b border-n-weak">
          {(
            [
              ['item', 'Item'],
              ['simulator', 'Simulador'],
            ] as [Tab, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm',
                tab === value ? 'border-n-brand text-n-blue-11' : 'border-transparent text-n-slate-11',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === 'simulator' && item ? (
        <Simulator item={item} notesMax={menu.settings.notes_max_length} />
      ) : (
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <PhotoField product={item?.product} editable={editable} onChanged={onSaved} />
          <fieldset disabled={!editable} className="flex flex-col gap-5">
            <DetailsSection draft={draft} onChange={set} />
            <PriceSection draft={draft} onChange={set} />
            {draft.pizza && <PizzaSection pizza={draft.pizza} onChange={(pizza) => set({ pizza })} />}
            {draft.combo && (
              <ComboSection combo={draft.combo} menu={menu} onChange={(combo) => set({ combo })} />
            )}
            <GroupsSection
              links={draft.links}
              library={library}
              editable={editable}
              onChange={(links) => set({ links })}
              onCreateGroup={() => setCreatingGroup(true)}
            />
          </fieldset>
          {!editable && (
            <Section title="Somente leitura">
              <p className="text-sm text-n-slate-11">Somente administradores podem alterar o cardápio.</p>
            </Section>
          )}
          <ErrorList errors={errors} />
          {editable ? (
            <ModalFooter
              busy={busy}
              submit={item ? 'Salvar item' : 'Criar item'}
              onCancel={onClose}
              error={error}
            />
          ) : (
            <Button color="slate" variant="faded" label="Fechar" className="self-end" onClick={onClose} />
          )}
          {editable && item && (
            <Button
              color="ruby"
              variant="link"
              label="Excluir item"
              className="self-start"
              onClick={() => setDeleting(true)}
            />
          )}
        </form>
      )}
      {creatingGroup && (
        <SidePanel title="Novo grupo de complementos" onClose={() => setCreatingGroup(false)}>
          <GroupEditor
            editable
            onCancel={() => setCreatingGroup(false)}
            onSaved={(group) => {
              setCreatingGroup(false);
              reloadLibrary();
              set({
                links: [
                  ...draft.links,
                  { group_id: group.id, min: 0, max: 1, position: draft.links.length, group },
                ],
              });
            }}
          />
        </SidePanel>
      )}
      {deleting && item && (
        <ConfirmModal
          title="Excluir item"
          description={`Excluir “${item.product.name}” do cardápio?`}
          confirm="Sim, excluir"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await catalogApi.deleteItem(item.id);
            onSaved();
            onClose();
          }}
        />
      )}
    </SidePanel>
  );
}
