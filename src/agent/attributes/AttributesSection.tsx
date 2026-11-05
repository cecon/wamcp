// material-ui
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

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
      <Typography variant="body2" color="text.secondary">
        Nenhum atributo personalizado. Um administrador pode criá-los em Configurações.
      </Typography>
    );
  return (
    <Stack spacing={1.5}>
      {definitions.map((d) => (
        <AttributeInput
          key={`${d.id}:${String(values[d.attribute_key] ?? '')}`}
          definition={d}
          value={values[d.attribute_key]}
          onSave={(value) => onSave(d.attribute_key, value)}
        />
      ))}
    </Stack>
  );
}
