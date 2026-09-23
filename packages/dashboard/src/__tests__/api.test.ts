import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, BASE, UNAUTHORIZED_EVENT } from '../api';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(status: number, body: unknown, ok?: boolean) {
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    json: () => Promise.resolve(body),
  };
}

describe('api', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('BASE', () => {
    it('defaults to /api', () => {
      expect(BASE).toBe('/api');
    });
  });

  describe('get', () => {
    it('fetches data successfully', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { data: { id: 1, name: 'test' } }));
      const result = await api.get<{ id: number; name: string }>('/test');
      expect(result).toEqual({ id: 1, name: 'test' });
      expect(mockFetch).toHaveBeenCalledWith('/api/test', { headers: {} });
    });

    it('throws on 401 and dispatches unauthorized event', async () => {
      mockFetch.mockResolvedValue(mockResponse(401, { error: { message: 'Unauthorized' } }, false));
      const handler = vi.fn();
      window.addEventListener(UNAUTHORIZED_EVENT, handler);
      await expect(api.get('/test')).rejects.toThrow('Unauthorized');
      expect(handler).toHaveBeenCalled();
      window.removeEventListener(UNAUTHORIZED_EVENT, handler);
    });

    it('throws on non-ok response with error message', async () => {
      mockFetch.mockResolvedValue(mockResponse(404, { error: { message: 'Not found' } }, false));
      await expect(api.get('/test')).rejects.toThrow('Not found');
    });

    it('throws generic error when no error message in response', async () => {
      mockFetch.mockResolvedValue(mockResponse(500, {}, false));
      await expect(api.get('/test')).rejects.toThrow('Request failed: 500');
    });

    it('handles non-JSON response gracefully', async () => {
      mockFetch.mockResolvedValue({
        status: 500,
        ok: false,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });
      await expect(api.get('/test')).rejects.toThrow('Request failed: 500');
    });
  });

  describe('post', () => {
    it('posts data with JSON body', async () => {
      mockFetch.mockResolvedValue(mockResponse(201, { data: { id: 1 } }));
      const result = await api.post<{ id: number }>('/test', { name: 'test' });
      expect(result).toEqual({ id: 1 });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
    });

    it('posts without body when not provided', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { data: null }));
      await api.post('/test');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({ method: 'POST', body: undefined }),
      );
    });
  });

  describe('patch', () => {
    it('patches data with JSON body', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { data: { updated: true } }));
      const result = await api.patch<{ updated: boolean }>('/test/1', { name: 'updated' });
      expect(result).toEqual({ updated: true });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/test/1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'updated' }),
        }),
      );
    });
  });

  describe('delete', () => {
    it('deletes resource', async () => {
      mockFetch.mockResolvedValue(mockResponse(204, { data: null }));
      await api.delete('/test/1');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/test/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('login', () => {
    it('logs in successfully', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(200, { data: { user: { id: 1, email: 'test@example.com' } } }),
      );
      const user = await api.login('test@example.com', 'password');
      expect(user).toEqual({ id: 1, email: 'test@example.com' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com', password: 'password' }),
        }),
      );
    });

    it('throws on login failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(401, { error: { message: 'Invalid credentials' } }, false),
      );
      await expect(api.login('test@example.com', 'wrong')).rejects.toThrow('Invalid credentials');
    });
  });

  describe('register', () => {
    it('registers successfully', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(201, { data: { user: { id: 1, email: 'new@example.com' } } }),
      );
      const user = await api.register('new@example.com', 'password', 'Test User');
      expect(user).toEqual({ id: 1, email: 'new@example.com' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/register',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: 'new@example.com',
            password: 'password',
            name: 'Test User',
          }),
        }),
      );
    });

    it('throws on registration failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(400, { error: { message: 'Email already exists' } }, false),
      );
      await expect(api.register('exists@example.com', 'password')).rejects.toThrow(
        'Email already exists',
      );
    });
  });

  describe('logout', () => {
    it('calls logout endpoint', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, {}));
      await api.logout();
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    });

    it('handles logout failure gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      await expect(api.logout()).resolves.toBeUndefined();
    });
  });

  describe('changePassword', () => {
    it('changes password successfully', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { success: true }));
      const result = await api.changePassword('old', 'new');
      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/password',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ currentPassword: 'old', newPassword: 'new' }),
        }),
      );
    });

    it('throws on password change failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(400, { error: { message: 'Wrong current password' } }, false),
      );
      await expect(api.changePassword('wrong', 'new')).rejects.toThrow('Wrong current password');
    });
  });
});
