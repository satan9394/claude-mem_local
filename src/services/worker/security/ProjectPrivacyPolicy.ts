import { ProviderConfigError, type ProviderMode, type ProjectClassification } from '../providers/types.js';
import { isLoopbackUrl } from './network-address.js';

export interface PrivacySettings {
  localOnly: boolean;
  defaultClassification: ProjectClassification;
  projects: Record<string, ProjectClassification>;
}

export class ProjectPrivacyPolicy {
  static classify(project: string, privacy: PrivacySettings): ProjectClassification {
    const normalizedProject = project.toLowerCase();
    let match: { path: string; classification: ProjectClassification } | null = null;
    for (const [path, classification] of Object.entries(privacy.projects)) {
      const normalizedPath = path.toLowerCase().replace(/[\\/]+$/, '');
      if (
        (normalizedProject === normalizedPath || normalizedProject.startsWith(`${normalizedPath}\\`) || normalizedProject.startsWith(`${normalizedPath}/`))
        && (!match || normalizedPath.length > match.path.length)
      ) {
        match = { path: normalizedPath, classification };
      }
    }
    return match?.classification ?? privacy.defaultClassification;
  }

  static assertAllowed(input: {
    project: string;
    mode: ProviderMode;
    destination: string;
    privacy: PrivacySettings;
  }): void {
    const loopback = isLoopbackUrl(input.destination);
    const classification = this.classify(input.project, input.privacy);

    if (input.privacy.localOnly && !loopback) {
      throw new ProviderConfigError('PRIVACY_POLICY_BLOCKED', 'local-only mode permits loopback destinations only');
    }
    if (classification === 'confidential' && input.mode === 'direct' && !loopback) {
      throw new ProviderConfigError('PRIVACY_POLICY_BLOCKED', 'confidential projects cannot use a remote direct provider');
    }
    if (input.mode === 'cc-switch-auto' && !loopback) {
      throw new ProviderConfigError('PRIVACY_POLICY_BLOCKED', 'CC Switch auto mode requires loopback');
    }
  }
}
