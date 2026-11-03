// material-ui
import TextField from '@mui/material/TextField';

interface ValueProps {
  id: string;
  value: string;
  options: [string, string][] | null;
  multiline?: boolean;
  onChange: (value: string) => void;
}

/** Valor de uma condição/ação: select quando há opções, texto ou textarea quando é livre (mesmos `aria-label`). */
export function ValueInput({ id, value, options, multiline, onChange }: ValueProps) {
  if (options)
    return (
      <TextField
        select
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{
          select: { native: true },
          inputLabel: { shrink: true },
          htmlInput: { 'aria-label': id },
        }}
        sx={{ minWidth: 160 }}
      >
        <option value="">Selecione…</option>
        {options.map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue}>
            {label}
          </option>
        ))}
      </TextField>
    );
  return (
    <TextField
      size="small"
      multiline={multiline}
      minRows={multiline ? 2 : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { 'aria-label': id, maxLength: multiline ? 4096 : 200 } }}
      sx={multiline ? { flexBasis: '100%' } : { minWidth: 160 }}
    />
  );
}
