import { createPlatform, type Platform } from './platform';
import { env, maxMode, publicBaseUrl, telegramMode } from './config';
import { AdminRepository } from './repositories/admin-repository';
import { AnalysisRepository } from './repositories/analysis-repository';
import { AuditRepository } from './repositories/audit-repository';
import { BackupRepository } from './repositories/backup-repository';
import { ChatRepository } from './repositories/chat-repository';
import { DeliveryRepository } from './repositories/delivery-repository';
import { DirectorateRepository } from './repositories/directorate-repository';
import { GapRepository } from './repositories/gap-repository';
import { GuideRepository } from './repositories/guide-repository';
import { IncidentRepository } from './repositories/incident-repository';
import { MaxUpdateRepository } from './repositories/max-update-repository';
import { MessageRepository } from './repositories/message-repository';
import { MetricsRepository } from './repositories/metrics-repository';
import { RecipientRepository } from './repositories/recipient-repository';
import { ReportRepository } from './repositories/report-repository';
import { SettingsRepository } from './repositories/settings-repository';
import { SubscriptionRepository } from './repositories/subscription-repository';
import { UpdateRepository } from './repositories/update-repository';
import { AiClient } from './integrations/ai-client';
import { AccessService } from './services/access-service';
import { AdminService } from './services/admin-service';
import { AlertService } from './services/alert-service';
import { AnalysisService } from './services/analysis-service';
import { AuditService } from './services/audit-service';
import { BotCommandService } from './services/bot-command-service';
import { BotService } from './services/bot-service';
import { ChannelBots } from './services/channel-bots';
import { ChatService } from './services/chat-service';
import { DeliveryService } from './services/delivery-service';
import { DigestService } from './services/digest-service';
import { DirectorateService } from './services/directorate-service';
import { GapService } from './services/gap-service';
import { GuideService } from './services/guide-service';
import { IncidentService } from './services/incident-service';
import { IngestionService } from './services/ingestion-service';
import { IntakeService } from './services/intake-service';
import { MaxBotService } from './services/max-bot-service';
import { MaxCommandService } from './services/max-command-service';
import { MaxIngestionService } from './services/max-ingestion-service';
import { MaxIntakeService } from './services/max-intake-service';
import { MessageService } from './services/message-service';
import { OnDemandRepository } from './repositories/on-demand-repository';
import { OnDemandService } from './services/on-demand-service';
import { CallbackRouter } from './services/callback-router';
import { IncidentSettingsService } from './services/incident-settings-service';
import { MaintenanceService } from './services/maintenance-service';
import { MonitorService } from './services/monitor-service';
import { OverviewService } from './services/overview-service';
import { RateLimiter } from './services/rate-limiter';
import { RecipientService } from './services/recipient-service';
import { ReportService } from './services/report-service';
import { RuntimeState } from './services/runtime-state';
import { SettingsService } from './services/settings-service';
import { SpikeService } from './services/spike-service';
import { SubscriptionService } from './services/subscription-service';
import { SummarySchedulerService } from './services/summary-scheduler-service';
import { TechAlertService } from './services/tech-alert-service';

/**
 * Composition root: репозитории получают platform.db/storage, сервисы — репозитории.
 * Один экземпляр на процесс — его используют и роуты, и фоновые воркеры.
 */
export function buildContainer(platform: Platform = createPlatform()) {
  const db = platform.db;
  const state = new RuntimeState();

  const repos = {
    admins: new AdminRepository(db),
    analysis: new AnalysisRepository(db),
    audit: new AuditRepository(db),
    chats: new ChatRepository(db),
    deliveries: new DeliveryRepository(db),
    directorates: new DirectorateRepository(db),
    gaps: new GapRepository(db),
    incidents: new IncidentRepository(db),
    messages: new MessageRepository(db),
    metrics: new MetricsRepository(db),
    recipients: new RecipientRepository(db),
    reports: new ReportRepository(db),
    settings: new SettingsRepository(db),
    subscriptions: new SubscriptionRepository(db),
    updates: new UpdateRepository(db),
    maxUpdates: new MaxUpdateRepository(db),
    backup: new BackupRepository(db, platform.storage),
    guide: new GuideRepository(platform.storage),
  };

  const ai = new AiClient();
  const bot = new BotService(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_WEBHOOK_SECRET, telegramMode, state);
  const maxBot = new MaxBotService(env.MAX_BOT_TOKEN, maxMode, state);
  const channelBots = new ChannelBots(bot, maxBot);
  const audit = new AuditService(repos.audit);
  const settings = new SettingsService(repos.settings, audit);
  const admins = new AdminService(repos.admins, audit);
  const gaps = new GapService(repos.gaps, settings);
  const subscriptions = new SubscriptionService(repos.subscriptions, repos.recipients, repos.chats, audit);
  const chats = new ChatService(repos.chats, settings, audit, bot, maxBot, gaps, subscriptions);
  const recipients = new RecipientService(repos.recipients, repos.deliveries, subscriptions, bot, maxBot, audit, repos.directorates);
  const guide = new GuideService(repos.guide);
  const access = new AccessService(repos.directorates);
  const directorates = new DirectorateService(repos.directorates, access, admins, chats, subscriptions, bot, audit);
  const techAlerts = new TechAlertService(repos.settings, repos.deliveries, repos.recipients, state);
  const alerts = new AlertService(repos.deliveries, repos.incidents, subscriptions, state, chats);
  const incidents = new IncidentService(repos.incidents, repos.deliveries, alerts, settings, recipients, channelBots, audit);
  const spikes = new SpikeService(repos.messages, incidents, settings);
  const analysis = new AnalysisService(repos.messages, repos.analysis, ai, chats, incidents, spikes, settings, state);
  const onDemandRepo = new OnDemandRepository(db);
  const onDemand = new OnDemandService(onDemandRepo, repos.deliveries, recipients, subscriptions, chats, settings, channelBots, audit, state);
  const commands = new BotCommandService(bot, recipients, subscriptions, chats, settings, onDemand, directorates);
  const maxCommands = new MaxCommandService(maxBot, recipients, subscriptions, chats, settings, onDemand, directorates);
  const callbacks = new CallbackRouter(onDemand, new IncidentSettingsService(recipients, channelBots), incidents);
  const ingestion = new IngestionService(repos.updates, repos.messages, chats, gaps, commands, recipients, techAlerts, callbacks, state);
  const intake = new IntakeService(bot, ingestion, gaps, settings, state, `${publicBaseUrl}/api/telegram/webhook`);
  const maxIngestion = new MaxIngestionService(repos.maxUpdates, repos.messages, chats, gaps, maxCommands, recipients, techAlerts, callbacks, state);
  const maxIntake = new MaxIntakeService(maxBot, maxIngestion, gaps, settings, state, `${publicBaseUrl}/api/max/webhook`);
  const digests = new DigestService(repos.reports, repos.analysis, ai, chats, incidents, gaps, settings, state);
  const reports = new ReportService(repos.reports, repos.deliveries, digests, subscriptions, recipients, chats, settings, audit, state, directorates);
  const scheduler = new SummarySchedulerService(repos.reports, repos.messages, digests, reports, subscriptions, settings, state);
  const deliveries = new DeliveryService(
    repos.deliveries,
    recipients,
    subscriptions,
    incidents,
    alerts,
    reports,
    chats,
    settings,
    bot,
    maxBot,
    new RateLimiter(),
    new RateLimiter(),
    audit,
    state,
    onDemand,
  );
  const maintenance = new MaintenanceService(
    repos.messages,
    repos.incidents,
    repos.reports,
    repos.deliveries,
    repos.updates,
    repos.maxUpdates,
    repos.analysis,
    repos.audit,
    repos.gaps,
    repos.admins,
    repos.backup,
    settings,
    onDemandRepo,
    repos.directorates,
  );
  const monitor = new MonitorService(state, techAlerts, repos.deliveries, repos.messages, incidents, intake, maxIntake);
  const overview = new OverviewService(
    repos.metrics,
    repos.analysis,
    repos.deliveries,
    repos.incidents,
    repos.messages,
    repos.updates,
    gaps,
    state,
    bot,
    maxBot,
    ai,
  );

  return {
    state,
    access,
    directorates,
    bot,
    maxBot,
    ai,
    audit,
    settings,
    admins,
    gaps,
    chats,
    subscriptions,
    recipients,
    techAlerts,
    alerts,
    incidents,
    spikes,
    analysis,
    ingestion,
    intake,
    maxIngestion,
    maxIntake,
    digests,
    reports,
    scheduler,
    deliveries,
    maintenance,
    monitor,
    overview,
    onDemand,
    guide,
    messages: new MessageService(repos.messages, repos.analysis),
  };
}

export type Container = ReturnType<typeof buildContainer>;

let instance: Container | null = null;

export function getContainer(): Container {
  instance ??= buildContainer();
  return instance;
}
