import type { PrismaClient } from '@nexpanel/database';
import type { ApiConfig } from './config.js';
import type { NodeManager } from './services/node-manager.js';
import type { RealtimeHub } from './services/realtime.js';
import type { ExtensionRegistry } from './services/extension-registry.js';
import type { TaskService } from './services/task-service.js';
import type { AIService } from './services/ai-service.js';
import type { AppService } from './services/app-service.js';

/** Dependency container threaded through routes and services. */
export interface AppContext {
  config: ApiConfig;
  db: PrismaClient;
  nodes: NodeManager;
  realtime: RealtimeHub;
  extensions: ExtensionRegistry;
  tasks: TaskService;
  apps: AppService;
  ai: AIService;
}
