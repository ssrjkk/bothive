import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Login from '../pages/Login';

vi.mock('../api', () => ({
  api: {
    login: vi.fn(),
    register: vi.fn(),
  },
  BASE: '/api',
}));

import { api } from '../api';

const mockLogin = vi.mocked(api.login);
const mockRegister = vi.mocked(api.register);

describe('Login page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders hero title', () => {
    render(<Login onLogin={() => {}} />);
    expect(screen.getByText('Command every bot from one hive.')).toBeInTheDocument();
  });

  it('renders feature list', () => {
    render(<Login onLogin={() => {}} />);
    expect(screen.getByText(/One control plane/)).toBeInTheDocument();
    expect(screen.getByText(/Sandboxed scripts/)).toBeInTheDocument();
    expect(screen.getByText(/Live logs/)).toBeInTheDocument();
  });

  it('renders platform chips', () => {
    render(<Login onLogin={() => {}} />);
    expect(screen.getByText('telegram')).toBeInTheDocument();
    expect(screen.getByText('twitch')).toBeInTheDocument();
    expect(screen.getByText('youtube')).toBeInTheDocument();
    expect(screen.getByText('twitter')).toBeInTheDocument();
    expect(screen.getByText('crypto')).toBeInTheDocument();
  });

  it('renders both tab labels', () => {
    render(<Login onLogin={() => {}} />);
    expect(screen.getByText('Create Account')).toBeInTheDocument();
    const signInTabs = screen.getAllByText('Sign In');
    expect(signInTabs.length).toBeGreaterThanOrEqual(1);
  });

  it('renders footer text', () => {
    render(<Login onLogin={() => {}} />);
    expect(screen.getByText(/BotHive v1.0.0/)).toBeInTheDocument();
  });

  it('calls api.login and onLogin on sign in form submit', async () => {
    mockLogin.mockResolvedValue({ id: '1', email: 'test@test.com' });
    const onLogin = vi.fn();
    render(<Login onLogin={onLogin} />);

    const forms = document.querySelectorAll('form');
    const loginForm = forms[0];
    const emailInput = loginForm.querySelector('#email') as HTMLInputElement;
    const passwordInput = loginForm.querySelector('#password') as HTMLInputElement;

    emailInput.value = 'test@test.com';
    passwordInput.value = 'password123';

    loginForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@test.com', 'password123');
    });

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalled();
    });
  });

  it('calls api.register on create account form submit', async () => {
    mockRegister.mockResolvedValue({ id: '1', email: 'new@test.com' });
    const onLogin = vi.fn();
    render(<Login onLogin={onLogin} />);

    const forms = document.querySelectorAll('form');
    const registerForm = forms[1];
    const emailInput = registerForm.querySelector('#email') as HTMLInputElement;
    const passwordInput = registerForm.querySelector('#password') as HTMLInputElement;

    emailInput.value = 'new@test.com';
    passwordInput.value = 'password123';

    registerForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('new@test.com', 'password123', '');
    });
  });
});
