import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { useAction } from '../../settings/useAction';
import { catalogApi } from '../catalogApi';
import type { Product } from '../types';
import { Thumb } from '../ui';

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  /** Saved product (photos need its id); absent while creating. */
  product?: Product;
  editable: boolean;
  onChanged: () => void;
}

/** Product photo: upload (png/jpg/webp ≤ 5 MB) and remove, multipart to /catalog/products/{id}/image. */
export function PhotoField({ product, editable, onChanged }: Props) {
  const [url, setUrl] = useState(product?.image_url ?? null);
  const input = useRef<HTMLInputElement>(null);
  const { error, busy, run } = useAction();
  const send = (file: File | undefined) => {
    if (!file || !product) return;
    void run(async () => {
      if (!TYPES.includes(file.type)) throw new Error('Envie uma imagem PNG, JPG ou WebP.');
      if (file.size > MAX_BYTES) throw new Error('A imagem deve ter no máximo 5 MB.');
      const saved = await catalogApi.uploadImage(product.id, file);
      setUrl(saved.image_url);
      onChanged();
    });
  };
  return (
    <div className="flex items-center gap-3">
      <Thumb src={url} alt={product ? `Foto de ${product.name}` : 'Sem foto'} size={72} />
      {!product ? (
        <p className="text-xs text-n-slate-11">Salve o item para adicionar uma foto.</p>
      ) : (
        editable && (
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <Button
                size="xs"
                variant="faded"
                icon={ImagePlus}
                label={url ? 'Trocar foto' : 'Enviar foto'}
                disabled={busy}
                onClick={() => input.current?.click()}
              />
              {url && (
                <Button
                  size="xs"
                  color="ruby"
                  variant="faded"
                  icon={Trash2}
                  label="Remover foto"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await catalogApi.removeImage(product.id);
                      setUrl(null);
                      onChanged();
                    })
                  }
                />
              )}
            </div>
            <input
              ref={input}
              type="file"
              hidden
              aria-label="Arquivo da foto"
              accept={TYPES.join(',')}
              onChange={(e) => {
                send(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {error && <p className="text-xs text-n-ruby-11">{error}</p>}
          </div>
        )
      )}
    </div>
  );
}
