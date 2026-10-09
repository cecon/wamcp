import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MfaSection } from '../../src/agent/profile/MfaSection';
import { encodeQr, penalty } from '../../src/agent/profile/qr/encode';
import { fakeApi, status } from './fake-api';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/wamcp:admin%40example.com?secret=${SECRET}&issuer=wamcp`;
const CODES = Array.from({ length: 10 }, (_, i) => `abcd${i}-ef${i}12`);

/** A finder pattern: 7×7 dark ring, light ring, 3×3 dark core. */
function hasFinder(m: boolean[][], x: number, y: number) {
  for (let dy = 0; dy < 7; dy++)
    for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if (m[y + dy][x + dx] !== (ring !== 2)) return false;
    }
  return true;
}

describe('QR code encoder', () => {
  it('builds valid symbols of the smallest version with finder patterns and timing', () => {
    const small = encodeQr('hi');
    expect(small).toHaveLength(21);
    const uri = encodeQr(URI);
    expect(uri).toHaveLength(41);
    const size = uri.length;
    expect([hasFinder(uri, 0, 0), hasFinder(uri, size - 7, 0), hasFinder(uri, 0, size - 7)]).toEqual([
      true,
      true,
      true,
    ]);
    expect(uri[6].slice(8, size - 8)).toEqual(Array.from({ length: size - 16 }, (_, i) => i % 2 === 0));
    expect(uri[size - 8][8]).toBe(true);
    const large = encodeQr('x'.repeat(400));
    expect(large).toHaveLength(4 * 15 + 17);
    expect(encodeQr(URI, 3)).not.toEqual(encodeQr(URI, 5));
    expect(penalty(uri)).toBeLessThanOrEqual(
      Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map((m) => penalty(encodeQr(URI, m)))),
    );
    expect(() => encodeQr('x'.repeat(3000))).toThrow('Texto longo demais');
  });
});

describe('two-factor authentication', () => {
  it('enables with the QR code and a code, then shows the backup codes once', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let tries = 0;
    const api = fakeApi({
      'GET /profile/mfa': { enabled: false },
      'POST /profile/mfa': { secret: SECRET, otpauth_uri: URI },
      'POST /profile/mfa/verify': () => {
        if (++tries === 1) throw status(422, 'Código inválido');
        return { backup_codes: CODES };
      },
    });
    const user = userEvent.setup();
    render(<MfaSection />);
    expect(await screen.findByText('A verificação em duas etapas está desativada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ativar verificação em duas etapas' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ativar verificação em duas etapas' });
    const qr = within(dialog).getByRole('img', { name: 'QR Code para o aplicativo autenticador' });
    expect(qr.getAttribute('viewBox')).toBe('0 0 49 49');
    expect(within(dialog).getByLabelText('Chave secreta')).toHaveTextContent(SECRET);
    await user.click(within(dialog).getByRole('button', { name: 'Copiar' }));
    expect(await within(dialog).findByRole('button', { name: 'Copiada' })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(SECRET);
    const code = within(dialog).getByLabelText('Código de verificação');
    await user.type(code, '12a3456');
    expect(code).toHaveValue('123456');
    await user.click(within(dialog).getByRole('button', { name: 'Verificar e ativar' }));
    expect(await within(dialog).findByText('Código inválido')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Verificar e ativar' }));

    const codes = await screen.findByRole('dialog', { name: 'Salve seus códigos de recuperação' });
    expect(
      within(codes)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(CODES);
    expect(api.called('POST', '/profile/mfa/verify')[1].body).toEqual({ code: '123456' });
    await user.click(within(codes).getByRole('button', { name: 'Copiar todos' }));
    expect(await within(codes).findByRole('button', { name: 'Copiados' })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(CODES.join('\n'));
    await user.click(within(codes).getByRole('button', { name: 'Baixar' }));
    expect(click).toHaveBeenCalledTimes(1);
    await user.click(within(codes).getByRole('button', { name: 'Concluir' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('A verificação em duas etapas está ativa')).toBeInTheDocument();
  });

  it('cancels enrolment and reports a failed start', async () => {
    let starts = 0;
    fakeApi({
      'GET /profile/mfa': () => {
        throw status(500, 'offline');
      },
      'POST /profile/mfa': () => {
        if (++starts === 1) throw status(422, 'A verificação em duas etapas já está ativa');
        return { secret: SECRET, otpauth_uri: URI };
      },
    });
    const user = userEvent.setup();
    render(<MfaSection />);
    await user.click(await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('já está ativa');
    await user.click(screen.getByRole('button', { name: 'Ativar verificação em duas etapas' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ativar verificação em duas etapas' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables with the password and a code', async () => {
    let tries = 0;
    const api = fakeApi({
      'GET /profile/mfa': { enabled: true },
      'DELETE /profile/mfa': () => {
        if (++tries === 1) throw status(422, 'Senha incorreta');
        return { ok: true };
      },
    });
    const user = userEvent.setup();
    render(<MfaSection />);
    expect(await screen.findByText('A verificação em duas etapas está ativa')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desativar verificação em duas etapas' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desativar verificação em duas etapas' });
    await user.type(within(dialog).getByLabelText('Senha'), 'senha-segura-123');
    await user.type(within(dialog).getByLabelText('Código de verificação'), 'abcd0-ef012');
    await user.click(within(dialog).getByRole('button', { name: 'Desativar' }));
    expect(await within(dialog).findByText('Senha incorreta')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Desativar' }));
    expect(await screen.findByText('A verificação em duas etapas está desativada')).toBeInTheDocument();
    expect(api.called('DELETE', '/profile/mfa')[1].body).toEqual({
      password: 'senha-segura-123',
      code: 'abcd0-ef012',
    });
  });
});
