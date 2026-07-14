import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import type { ProviderAuditInput, ProviderAuditRow } from '../../../sqlite/SessionStore.js';
import type { ModelCatalogService } from '../../providers/ModelCatalogService.js';
import type {
  CcSwitchImportSource,
  ImportProfilesOptions,
  ProviderConfigImporter,
  ProviderImportPreview,
} from '../../providers/ProviderConfigImporter.js';
import type { ProviderHealthService } from '../../providers/ProviderHealthService.js';
import type { SecretStore } from '../../providers/SecretStore.js';
import {
  parseProviderConfig,
  providerProfileSchema,
} from '../../providers/provider-config.js';
import { ProviderConfigError, type ProviderConfigV1, type ProviderProfile } from '../../providers/types.js';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { validateBody } from '../middleware/validateBody.js';

const projectSchema = z.object({ project: z.string().min(1).max(1024).optional() }).strict();
const profileInputSchema = providerProfileSchema.omit({ secretRef: true }).strict();
const activateSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('local'), legacyProvider: z.enum(['claude', 'gemini', 'openrouter']).optional() }).strict(),
  z.object({ mode: z.literal('cc-switch-auto') }).strict(),
  z.object({ mode: z.literal('direct'), profileId: z.string().min(1).max(80) }).strict(),
]);
const secretSchema = z.object({
  profileId: z.string().min(1).max(80),
  secret: z.string().min(1).max(32_768),
}).strict();
const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sql-export'), content: z.string().min(1).max(16 * 1024 * 1024) }).strict(),
  z.object({ kind: z.literal('sqlite'), path: z.string().min(1).max(1024) }).strict(),
]);
const importPreviewSchema = z.object({ source: sourceSchema }).strict();
const importProfilesSchema = z.object({
  source: sourceSchema,
  confirmImport: z.literal(true),
  copyApiKeys: z.boolean(),
  confirmApiKeyCopy: z.literal('COPY_API_KEYS').optional(),
}).strict();
const importConnectionSchema = z.object({
  baseUrl: z.string().min(1).max(300),
  providerName: z.string().trim().min(1).max(120).optional(),
}).strict();

interface ProviderRoutesOptions {
  getConfig: () => ProviderConfigV1;
  saveConfig: (config: ProviderConfigV1) => void;
  healthService: Pick<ProviderHealthService, 'status' | 'discoverCcSwitch' | 'testConnection'>;
  modelCatalog: Pick<ModelCatalogService, 'list'>;
  importer: Pick<ProviderConfigImporter, 'importConnection' | 'previewProfiles' | 'importProfiles'>;
  secretStore: Pick<SecretStore, 'put' | 'delete'>;
  audit: {
    record(input: ProviderAuditInput): void;
    list(limit?: number): ProviderAuditRow[];
  };
}

export class ProviderRoutes extends BaseRouteHandler {
  constructor(private readonly options: ProviderRoutesOptions) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/providers/status', this.handleStatus.bind(this));
    app.post('/api/providers/discover', validateBody(z.object({}).strict()), this.handleDiscover.bind(this));
    app.post('/api/providers/test', validateBody(projectSchema), this.handleTest.bind(this));
    app.get('/api/providers/profiles', this.handleListProfiles.bind(this));
    app.get('/api/providers/:id/models', this.handleModels.bind(this));
    app.post('/api/providers/profiles', validateBody(profileInputSchema), this.handleCreateProfile.bind(this));
    app.put('/api/providers/profiles/:id', validateBody(profileInputSchema), this.handleUpdateProfile.bind(this));
    app.delete('/api/providers/profiles/:id', this.handleDeleteProfile.bind(this));
    app.post('/api/providers/activate', validateBody(activateSchema), this.handleActivate.bind(this));
    app.post('/api/providers/secrets', validateBody(secretSchema), this.handlePutSecret.bind(this));
    app.delete('/api/providers/secrets/:profileId', this.handleDeleteSecret.bind(this));
    app.post('/api/providers/import/connection', validateBody(importConnectionSchema), this.handleImportConnection.bind(this));
    app.post('/api/providers/import/preview', validateBody(importPreviewSchema), this.handleImportPreview.bind(this));
    app.post('/api/providers/import/profiles', validateBody(importProfilesSchema), this.handleImportProfiles.bind(this));
    app.get('/api/providers/audit', this.handleAudit.bind(this));
  }

  private handleStatus = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const project = ProviderRoutes.firstString(req.query.project) ?? 'unknown';
    res.json(await this.options.healthService.status(project));
  });

  private handleDiscover = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    const result = await this.options.healthService.discoverCcSwitch();
    res.json({
      status: 'healthy',
      url: result.url,
      port: Number(new URL(result.url).port || 80),
      source: result.source,
      ...(result.version ? { version: result.version } : {}),
    });
  });

  private handleTest = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const result = await this.options.healthService.testConnection(req.body.project ?? 'unknown');
    this.options.audit.record({
      action: 'provider_test', providerId: result.providerId, profileId: result.profileId,
      mode: this.options.getConfig().providerMode, outcome: 'success', redactionCount: result.redactionCount,
    });
    res.json(result);
  });

  private handleListProfiles = this.wrapHandler((_req: Request, res: Response): void => {
    res.json({ profiles: this.options.getConfig().providerProfiles.map(profile => ({ ...profile })) });
  });

  private handleModels = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const profile = this.requireProfile(this.toStringParam(req.params.id));
    res.json(await this.options.modelCatalog.list(profile, this.options.getConfig().privacy));
  });

  private handleCreateProfile = this.wrapHandler((req: Request, res: Response): void => {
    const current = cloneConfig(this.options.getConfig());
    if (current.providerProfiles.some(profile => profile.id === req.body.id)) {
      throw new ProviderConfigError('PROFILE_INVALID', 'provider profile id already exists');
    }
    current.providerProfiles.push(req.body as ProviderProfile);
    this.save(current);
    this.options.audit.record({ action: 'profile_create', profileId: req.body.id, outcome: 'success' });
    res.status(201).json({ profile: req.body });
  });

  private handleUpdateProfile = this.wrapHandler((req: Request, res: Response): void => {
    const id = this.toStringParam(req.params.id);
    if (req.body.id !== id) throw new ProviderConfigError('PROFILE_INVALID', 'profile id cannot be changed');
    const current = cloneConfig(this.options.getConfig());
    const index = current.providerProfiles.findIndex(profile => profile.id === id);
    if (index < 0) throw new ProviderConfigError('PROFILE_INVALID', 'provider profile was not found');
    const secretRef = current.providerProfiles[index].secretRef;
    current.providerProfiles[index] = { ...req.body, ...(secretRef ? { secretRef } : {}) } as ProviderProfile;
    this.save(current);
    this.options.audit.record({ action: 'profile_update', profileId: id, outcome: 'success' });
    res.json({ profile: current.providerProfiles[index] });
  });

  private handleDeleteProfile = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const id = this.toStringParam(req.params.id);
    const current = cloneConfig(this.options.getConfig());
    const profile = current.providerProfiles.find(item => item.id === id);
    if (!profile) throw new ProviderConfigError('PROFILE_INVALID', 'provider profile was not found');
    if (profile.secretRef) await this.options.secretStore.delete(profile.secretRef);
    current.providerProfiles = current.providerProfiles.filter(item => item.id !== id);
    if (current.activeProviderProfileId === id) {
      current.activeProviderProfileId = null;
      current.providerMode = 'local';
    }
    this.save(current);
    this.options.audit.record({ action: 'profile_delete', profileId: id, outcome: 'success' });
    res.status(204).end();
  });

  private handleActivate = this.wrapHandler((req: Request, res: Response): void => {
    const current = cloneConfig(this.options.getConfig());
    if (req.body.mode === 'local') {
      current.providerMode = 'local';
      current.activeProviderProfileId = null;
      if (req.body.legacyProvider) current.legacyProvider = req.body.legacyProvider;
    } else if (req.body.mode === 'cc-switch-auto') {
      current.providerMode = 'cc-switch-auto';
      current.activeProviderProfileId = null;
    } else {
      const profile = current.providerProfiles.find(item => item.id === req.body.profileId && item.enabled);
      if (!profile) throw new ProviderConfigError('PROFILE_INVALID', 'direct provider profile is missing or disabled');
      if (!profile.secretRef) throw new ProviderConfigError('SECRET_UNAVAILABLE', 'direct provider secret is not stored');
      current.providerMode = 'direct';
      current.activeProviderProfileId = profile.id;
    }
    this.save(current);
    this.options.audit.record({
      action: 'provider_activate', mode: current.providerMode,
      profileId: current.activeProviderProfileId ?? undefined, outcome: 'success',
    });
    res.json({
      success: true,
      mode: current.providerMode,
      activeProviderProfileId: current.activeProviderProfileId,
    });
  });

  private handlePutSecret = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const current = cloneConfig(this.options.getConfig());
    const profile = current.providerProfiles.find(item => item.id === req.body.profileId);
    if (!profile) throw new ProviderConfigError('PROFILE_INVALID', 'provider profile was not found');
    profile.secretRef = await this.options.secretStore.put(profile.id, req.body.secret);
    this.save(current);
    this.options.audit.record({ action: 'secret_put', profileId: profile.id, outcome: 'success' });
    res.json({ success: true, profileId: profile.id, secretStored: true });
  });

  private handleDeleteSecret = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const id = this.toStringParam(req.params.profileId);
    const current = cloneConfig(this.options.getConfig());
    const profile = current.providerProfiles.find(item => item.id === id);
    if (!profile) throw new ProviderConfigError('PROFILE_INVALID', 'provider profile was not found');
    if (profile.secretRef) await this.options.secretStore.delete(profile.secretRef);
    delete profile.secretRef;
    if (current.activeProviderProfileId === id && current.providerMode === 'direct') {
      current.providerMode = 'local';
      current.activeProviderProfileId = null;
    }
    this.save(current);
    this.options.audit.record({ action: 'secret_delete', profileId: id, outcome: 'success' });
    res.status(204).end();
  });

  private handleImportConnection = this.wrapHandler((req: Request, res: Response): void => {
    const metadata = this.options.importer.importConnection(req.body);
    const current = cloneConfig(this.options.getConfig());
    current.providerMode = 'cc-switch-auto';
    current.activeProviderProfileId = null;
    current.ccSwitch.explicitUrl = metadata.baseUrl;
    this.save(current);
    res.json(metadata);
  });

  private handleImportPreview = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const preview = await this.options.importer.previewProfiles(req.body.source as CcSwitchImportSource);
    this.options.audit.record({ action: 'import_preview', outcome: 'success' });
    res.json(preview);
  });

  private handleImportProfiles = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const current = cloneConfig(this.options.getConfig());
    const options: ImportProfilesOptions = {
      confirmImport: req.body.confirmImport,
      copyApiKeys: req.body.copyApiKeys,
      existingProfileIds: current.providerProfiles.map(profile => profile.id),
      ...(req.body.confirmApiKeyCopy ? { confirmApiKeyCopy: req.body.confirmApiKeyCopy } : {}),
    };
    const profiles = await this.options.importer.importProfiles(req.body.source as CcSwitchImportSource, options);
    current.providerProfiles.push(...profiles);
    this.save(current);
    this.options.audit.record({ action: 'import_profiles', outcome: 'success' });
    res.status(201).json({ profiles });
  });

  private handleAudit = this.wrapHandler((req: Request, res: Response): void => {
    const rawLimit = ProviderRoutes.firstString(req.query.limit);
    const limit = rawLimit ? Number(rawLimit) : 100;
    res.json({ events: this.options.audit.list(Number.isFinite(limit) ? limit : 100) });
  });

  private requireProfile(id: string): ProviderProfile {
    const profile = this.options.getConfig().providerProfiles.find(item => item.id === id);
    if (!profile) throw new ProviderConfigError('PROFILE_INVALID', 'provider profile was not found');
    return profile;
  }

  private save(config: ProviderConfigV1): void {
    this.options.saveConfig(parseProviderConfig(config));
  }
}

function cloneConfig(config: ProviderConfigV1): ProviderConfigV1 {
  return structuredClone(config);
}
