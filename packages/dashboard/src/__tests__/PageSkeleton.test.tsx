import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PageSkeleton } from '../components/PageSkeleton';

describe('PageSkeleton', () => {
  it('renders skeleton placeholders', () => {
    const { container } = render(<PageSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it('contains a card wrapper', () => {
    const { container } = render(<PageSkeleton />);
    const card = container.querySelector('[data-testid="card"]');
    expect(card).toBeTruthy();
  });
});
