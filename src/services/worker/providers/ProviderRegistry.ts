import type { ActiveSession } from '../../worker-types.js';
import type { WorkerRef } from '../agents/types.js';
import { ProviderConfigError, type ProviderId } from './types.js';

export interface ConversationProvider {
  startSession(session: ActiveSession, worker?: WorkerRef): Promise<void>;
}

export interface ProviderRegistration {
  id: ProviderId;
  label: string;
  provider: ConversationProvider;
  isAvailable?: () => boolean;
}

export class ProviderRegistry {
  private readonly registrations = new Map<ProviderId, ProviderRegistration>();

  register(registration: ProviderRegistration): void {
    if (this.registrations.has(registration.id)) {
      throw new Error(`provider ${registration.id} is already registered`);
    }
    this.registrations.set(registration.id, registration);
  }

  get(id: ProviderId): ProviderRegistration | undefined {
    return this.registrations.get(id);
  }

  require(id: ProviderId): ProviderRegistration {
    const registration = this.registrations.get(id);
    if (!registration || registration.isAvailable?.() === false) {
      throw new ProviderConfigError('PROFILE_INVALID', `provider ${id} is unavailable`);
    }
    return registration;
  }

  list(): Array<{ id: ProviderId; label: string; available: boolean }> {
    return [...this.registrations.values()].map(registration => ({
      id: registration.id,
      label: registration.label,
      available: registration.isAvailable?.() !== false,
    }));
  }
}
