import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Avatar } from '../../src/agent/ui/Avatar';
import { ConversationCard } from '../../src/agent/conversations/ConversationCard';
import { conversation } from './fixtures';

describe('contact photos', () => {
  it('shows the WhatsApp photo and falls back to initials when it cannot load', () => {
    const { container } = render(<Avatar name="Edu Cecon" src="/api/v1/contacts/1/photo?v=1" size={32} />);
    const photo = container.querySelector('img')!;
    expect(photo).toHaveAttribute('src', '/api/v1/contacts/1/photo?v=1');
    fireEvent.error(photo);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('EC')).toBeInTheDocument();
  });

  it('uses initials when the contact has no photo', () => {
    const { container } = render(<Avatar name="Bia Lima" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('BL')).toBeInTheDocument();
  });

  it('puts the photo on the conversation card', () => {
    const withPhoto = { ...conversation, contact_avatar_url: '/api/v1/contacts/1/photo?v=9' };
    const { container } = render(
      <ConversationCard conversation={withPhoto} labels={[]} selected={false} onSelect={() => {}} />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/v1/contacts/1/photo?v=9');
  });
});
