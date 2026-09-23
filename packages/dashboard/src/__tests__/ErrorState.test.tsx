import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorState } from '../components/ErrorState';

describe('ErrorState', () => {
  it('renders error message from string', () => {
    render(<ErrorState error="Something broke" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Something broke')).toBeInTheDocument();
  });

  it('renders error message from Error object', () => {
    render(<ErrorState error={new Error('Network failure')} />);
    expect(screen.getByText('Network failure')).toBeInTheDocument();
  });

  it('renders fallback for unknown error types', () => {
    render(<ErrorState error={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders default message when error is empty', () => {
    render(<ErrorState error="" />);
    expect(screen.getByText('An unexpected error occurred.')).toBeInTheDocument();
  });

  it('shows retry button when onRetry is provided', () => {
    const onRetry = vi.fn();
    render(<ErrorState error="Error" onRetry={onRetry} />);
    const button = screen.getByRole('button', { name: /retry/i });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show retry button when onRetry is not provided', () => {
    render(<ErrorState error="Error" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
