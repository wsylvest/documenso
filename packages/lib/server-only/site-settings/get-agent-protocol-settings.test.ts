import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findFirstMock = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    siteSettings: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

const { AGENT_PROTOCOL_SETTINGS_CACHE_TTL_MS, clearAgentProtocolSettingsCache, getAgentProtocolSettings } =
  await import('./get-agent-protocol-settings');

const row = (data: unknown) => ({
  id: 'agent.protocols',
  enabled: true,
  data,
  lastModifiedByUserId: null,
  lastModifiedAt: new Date(),
});

describe('getAgentProtocolSettings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T10:00:00.000Z'));
    findFirstMock.mockReset();
    clearAgentProtocolSettingsCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enables both protocols when the setting row does not exist', async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(getAgentProtocolSettings()).resolves.toEqual({ mcpEnabled: true, acpEnabled: true });
    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: 'agent.protocols' } });
  });

  it('returns the stored switches', async () => {
    findFirstMock.mockResolvedValue(row({ mcpEnabled: false, acpEnabled: true }));

    await expect(getAgentProtocolSettings()).resolves.toEqual({ mcpEnabled: false, acpEnabled: true });
  });

  it('fills in missing keys with enabled', async () => {
    findFirstMock.mockResolvedValue(row({ acpEnabled: false }));

    await expect(getAgentProtocolSettings()).resolves.toEqual({ mcpEnabled: true, acpEnabled: false });
  });

  it('falls back to the defaults when the row does not parse', async () => {
    findFirstMock.mockResolvedValue(row({ mcpEnabled: 'nope' }));

    await expect(getAgentProtocolSettings()).resolves.toEqual({ mcpEnabled: true, acpEnabled: true });
  });

  it('caches the lookup for the TTL and refreshes afterwards', async () => {
    findFirstMock.mockResolvedValue(row({ mcpEnabled: false, acpEnabled: false }));

    await getAgentProtocolSettings();
    await getAgentProtocolSettings();

    expect(findFirstMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(AGENT_PROTOCOL_SETTINGS_CACHE_TTL_MS - 1);
    await getAgentProtocolSettings();

    expect(findFirstMock).toHaveBeenCalledTimes(1);

    findFirstMock.mockResolvedValue(row({ mcpEnabled: true, acpEnabled: true }));

    vi.advanceTimersByTime(1);

    await expect(getAgentProtocolSettings()).resolves.toEqual({ mcpEnabled: true, acpEnabled: true });
    expect(findFirstMock).toHaveBeenCalledTimes(2);
  });

  it('clearing the cache forces the next lookup to hit the database', async () => {
    findFirstMock.mockResolvedValue(row({ mcpEnabled: false, acpEnabled: true }));

    await getAgentProtocolSettings();

    clearAgentProtocolSettingsCache();
    findFirstMock.mockResolvedValue(null);

    await expect(getAgentProtocolSettings()).resolves.toEqual({ mcpEnabled: true, acpEnabled: true });
    expect(findFirstMock).toHaveBeenCalledTimes(2);
  });
});
