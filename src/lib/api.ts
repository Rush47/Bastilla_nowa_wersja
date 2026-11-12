import type {
  AgentName,
  AppState,
  Bootstrap,
  ChatAttachmentPayload,
  CodexCliState,
  GitHubSyncState,
  Message,
  ServerHealth,
  Session,
  SvlCoreReport,
  TerminalExecResponse,
  TerminalKind,
} from './types';

export class ApiFailure extends Error {
  constructor(message: string, public code: number) {
    super(message);
  }
}

const SESSION_STORAGE_KEY = 'svl_operator_session_ticket';

export function getStoredSessionTicket(): string {
  try {
    return (
      window.sessionStorage.getItem(SESSION_STORAGE_KEY) ||
      window.localStorage.getItem(SESSION_STORAGE_KEY) ||
      ''
    );
  } catch {
    return '';
  }
}

export function setStoredSessionTicket(ticket: string | null) {
  try {
    if (ticket) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, ticket);
      window.localStorage.setItem(SESSION_STORAGE_KEY, ticket);
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const storedTicket = typeof window !== 'undefined' ? getStoredSessionTicket() : '';
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(storedTicket ? { 'X-SVL-Session': storedTicket } : {}),
      ...(init?.headers || {}),
    },
  });
  const result = await response
    .json()
    .catch(() => ({ error: 'Odpowiedź serwera nie jest prawidłowym JSON.' }));
  if (!response.ok) {
    throw new ApiFailure(result.error || `HTTP ${response.status}`, response.status);
  }
  return result as T;
}

export const api = {
  login: async (token: string) => {
    const res = await request<{ ok: boolean; sessionSource: string; sessionTicket?: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ token }),
      },
    );
    if (res.sessionTicket) {
      setStoredSessionTicket(res.sessionTicket);
    }
    return res;
  },
  logout: async () => {
    const res = await request<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
      body: '{}',
    });
    setStoredSessionTicket(null);
    return res;
  },
  linuxStatus: () =>
    request<{ connected: boolean; receivedAt: string | null; host: any; container: any }>(
      '/api/linux/status',
    ),
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),
  state: () => request<AppState>('/api/state'),
  health: () => request<ServerHealth>('/api/health'),
  codexStatus: () => request<CodexCliState>('/api/codex/status'),
  startCodexLogin: () =>
    request<{ ok: boolean; deviceAuth: NonNullable<CodexCliState['deviceAuth']> }>(
      '/api/codex/login',
      { method: 'POST', body: '{}' },
    ),
  connectAria: () =>
    request<{ ok: boolean; report: SvlCoreReport; rawJson: string; message?: Message }>(
      '/api/aria/connect',
      { method: 'POST', body: '{}' },
    ),
  execTerminal: (terminal: TerminalKind, command: string, cwd?: string) =>
    request<TerminalExecResponse>('/api/terminal/exec', {
      method: 'POST',
      body: JSON.stringify({ terminal, command, cwd }),
    }),
  githubStatus: () => request<GitHubSyncState>('/api/github/status'),
  githubSync: (action: 'status' | 'fetch' | 'pull' | 'push', writeToken?: string) =>
    request<{ ok: boolean; output: string; state: GitHubSyncState }>('/api/github/sync', {
      method: 'POST',
      body: JSON.stringify({ action }),
      ...(writeToken ? { headers: { Authorization: `Bearer ${writeToken}` } } : {}),
    }),
  restartServices: () =>
    request<{ ok: boolean; debian13Pid: number | null; message: string }>(
      '/api/services/restart',
      { method: 'POST', body: '{}' },
    ),
  createSession: () =>
    request<Session>('/api/sessions', {
      method: 'POST',
      body: '{}',
    }),
  archiveSession: (id: string) =>
    request<{ success: boolean }>(`/api/sessions/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      body: '{}',
    }),
  sendMessage: (
    sessionId: string,
    content: string,
    target: 'Wszyscy' | AgentName,
    attachments?: ChatAttachmentPayload[],
  ) =>
    request<{ user: Message; response: Message | null; provider: string | null }>(
      '/api/messages',
      {
        method: 'POST',
        body: JSON.stringify({ sessionId, content, target, attachments }),
      },
    ),
  updateAvatar: (name: string, value: string) =>
    request<{ success: boolean; avatars: Record<string, string> }>('/api/avatars', {
      method: 'PUT',
      body: JSON.stringify({ name, value }),
    }),
};
