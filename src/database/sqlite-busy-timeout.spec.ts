import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import { mainConnectionOptions } from './main-connection';
import { AppModule } from '../app.module';

interface FactoryProvider {
  provide?: unknown;
  useFactory?: (config: ConfigService) => Record<string, unknown>;
}
interface DynamicModuleLike {
  imports?: DynamicModuleLike[];
  providers?: FactoryProvider[];
}

const config = (values: Record<string, unknown> = {}): ConfigService =>
  ({ get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback) }) as unknown as ConfigService;

/**
 * Every TypeORM options factory AppModule registers, found through its dynamic module imports. Only the
 * `TypeOrmModuleOptions` providers are taken: the DataSource factories beside them open a real connection.
 */
function typeOrmOptionFactories(): Array<(config: ConfigService) => Record<string, unknown>> {
  const found: Array<(config: ConfigService) => Record<string, unknown>> = [];
  const visit = (mod: DynamicModuleLike): void => {
    for (const p of mod.providers ?? []) {
      if (p?.provide === 'TypeOrmModuleOptions' && typeof p.useFactory === 'function') found.push(p.useFactory);
    }
    for (const child of mod.imports ?? []) if (child && typeof child === 'object') visit(child);
  };
  for (const imported of (Reflect.getMetadata('imports', AppModule) as DynamicModuleLike[]) ?? []) {
    if (imported && typeof imported === 'object') visit(imported);
  }
  return found;
}

// scripts/backup.sh holds a read transaction for the whole online copy of each SQLite file, which
// blocks app writes until it ends. better-sqlite3's 5 s default busy timeout failed those writes on
// a copy that ran longer, so both runtime connections wait as long as the backup's own timeout.
describe('SQLite busy timeout', () => {
  it('lets main-connection writes wait out an online backup', () => {
    expect(mainConnectionOptions(config())).toMatchObject({ type: 'better-sqlite3', timeout: 30_000 });
  });

  it('lets data-connection writes wait out an online backup', () => {
    const data = typeOrmOptionFactories()
      .map(factory => {
        try {
          return factory(config({ 'dataDatabase.type': 'sqlite' }));
        } catch {
          return null;
        }
      })
      .find(options => options?.name === 'data');
    expect(data).toMatchObject({ type: 'better-sqlite3', timeout: 30_000 });
  });
});
