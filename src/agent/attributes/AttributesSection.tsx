import type { CustomAttributes, FilterType, FilterValue } from '../types';
import { AttributeInput } from './AttributeInput';
import { useAttributeDefinitions } from './useAttributeDefinitions';

interface Props {
  model: FilterType;
  values: CustomAttributes | undefined;
  /** Persists one attribute (`null` removes it); a rejection shows the server message under the field. */
  onSave: (key: string, value: FilterValue | null) => Promise<void>;
}

/** Chatwoot "Atributos" accordion body: one typed input per definition of the model. */
export function AttributesSection({ model, values = {}, onSave }: Props) {
  const { definitions } = useAttributeDefinitions(model);
  if (definitions.length === 0)
    return (
      <p className="text-sm text-n-slate-11">
        Nenhum atributo personalizado. Um administrador pode criá-los em Configurações.
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      {definitions.map((d) => (
        <AttributeInput
          key={`${d.id}:${String(values[d.attribute_key] ?? '')}`}
          definition={d}
          value={values[d.attribute_key]}
          onSave={(value) => onSave(d.attribute_key, value)}
        />
      ))}
    </div>
  );
}
