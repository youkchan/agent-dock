import type { ApplicationModule } from "../application/mod.ts";

export interface InfrastructureModule {
  readonly name: "infrastructure";
  readonly application: ApplicationModule;
}

export function createInfrastructureModule(
  application: ApplicationModule,
): InfrastructureModule {
  return {
    name: "infrastructure",
    application,
  };
}
