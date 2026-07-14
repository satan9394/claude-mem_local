import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import type { ProviderAuditInput } from '../../../sqlite/SessionStore.js';
import { ProjectPrivacyPolicy } from '../../security/ProjectPrivacyPolicy.js';
import { isLoopbackUrl } from '../../security/network-address.js';
import { parseProviderConfig } from '../../providers/provider-config.js';
import { ProviderConfigError, type ProviderConfigV1, type ProjectClassification } from '../../providers/types.js';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { validateBody } from '../middleware/validateBody.js';

const classificationSchema = z.object({
  project: z.string().trim().min(1).max(1024),
  classification: z.enum(['public', 'internal', 'confidential']),
}).strict();
const deleteClassificationSchema = z.object({ project: z.string().trim().min(1).max(1024) }).strict();

interface PrivacyRoutesOptions {
  getConfig: () => ProviderConfigV1;
  saveConfig: (config: ProviderConfigV1) => void;
  audit: { record(input: ProviderAuditInput): void };
}

export class PrivacyRoutes extends BaseRouteHandler {
  constructor(private readonly options: PrivacyRoutesOptions) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/privacy/diagnostics', this.handleDiagnostics.bind(this));
    app.post('/api/privacy/classification', validateBody(classificationSchema), this.handleSetClassification.bind(this));
    app.delete('/api/privacy/classification', validateBody(deleteClassificationSchema), this.handleDeleteClassification.bind(this));
  }

  private handleDiagnostics = this.wrapHandler((req: Request, res: Response): void => {
    const project = PrivacyRoutes.firstString(req.query.project) ?? 'unknown';
    const config = this.options.getConfig();
    const classification = ProjectPrivacyPolicy.classify(project, config.privacy);
    const destination = destinationFor(config);
    let allowed = true;
    let code: string | undefined;
    if (destination) {
      try {
        ProjectPrivacyPolicy.assertAllowed({ project, mode: config.providerMode, destination, privacy: config.privacy });
      } catch (error) {
        allowed = false;
        code = error instanceof ProviderConfigError ? error.code : 'PRIVACY_POLICY_BLOCKED';
      }
    }
    res.json({
      classification,
      mode: config.providerMode,
      localOnly: config.privacy.localOnly,
      destinationClass: destinationClass(config, destination),
      allowed,
      ...(code ? { code } : {}),
    });
  });

  private handleSetClassification = this.wrapHandler((req: Request, res: Response): void => {
    const current = structuredClone(this.options.getConfig());
    current.privacy.projects[req.body.project] = req.body.classification as ProjectClassification;
    this.options.saveConfig(parseProviderConfig(current));
    this.options.audit.record({
      action: 'provider_resolve', mode: current.providerMode, outcome: 'success',
      classification: req.body.classification,
    });
    res.json({
      success: true,
      classification: req.body.classification,
      projectRuleCount: Object.keys(current.privacy.projects).length,
    });
  });

  private handleDeleteClassification = this.wrapHandler((req: Request, res: Response): void => {
    const current = structuredClone(this.options.getConfig());
    delete current.privacy.projects[req.body.project];
    this.options.saveConfig(parseProviderConfig(current));
    res.status(204).end();
  });
}

function destinationFor(config: ProviderConfigV1): string | undefined {
  if (config.providerMode === 'cc-switch-auto') return config.ccSwitch.explicitUrl || 'http://127.0.0.1:15721';
  if (config.providerMode === 'direct') {
    return config.providerProfiles.find(profile => profile.id === config.activeProviderProfileId)?.baseUrl;
  }
  return undefined;
}

function destinationClass(config: ProviderConfigV1, destination: string | undefined): string {
  if (config.providerMode === 'local') return 'legacy-local-mode';
  if (!destination) return 'unconfigured';
  return isLoopbackUrl(destination) ? 'loopback' : 'remote';
}
