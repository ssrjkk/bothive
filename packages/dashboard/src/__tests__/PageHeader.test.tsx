import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from '../components/PageHeader';

describe('PageHeader', () => {
  it('renders title', () => {
    render(<PageHeader title="Test Page" />);
    expect(screen.getByText('Test Page')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<PageHeader title="Test" description="A description" />);
    expect(screen.getByText('A description')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    render(<PageHeader title="Test" />);
    expect(screen.queryByText('A description')).not.toBeInTheDocument();
  });

  it('renders extra content when provided', () => {
    render(<PageHeader title="Test" extra={<button>Action</button>} />);
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
  });

  it('does not render extra when not provided', () => {
    const { container } = render(<PageHeader title="Test" />);
    const outerDiv = container.firstChild;
    expect(outerDiv?.childNodes.length).toBe(1);
  });

  it('renders React nodes as title', () => {
    render(<PageHeader title={<span data-testid="custom-title">Custom</span>} />);
    expect(screen.getByTestId('custom-title')).toBeInTheDocument();
  });
});
