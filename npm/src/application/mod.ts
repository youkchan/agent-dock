import type { DomainModule } from "../domain/mod.ts";

export interface ApplicationModule {
  readonly name: "application";
  readonly domain: DomainModule;
}

export function createApplicationModule(
  domain: DomainModule,
): ApplicationModule {
  return {
    name: "application",
    domain,
  };
}
