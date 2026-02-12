export interface DomainModule {
  readonly name: "domain";
}

export function createDomainModule(): DomainModule {
  return { name: "domain" };
}

export * from "./decision.ts";
export * from "./mail.ts";
export * from "./persona.ts";
export * from "./persona_policy.ts";
export * from "./spec_creator.ts";
export * from "./task.ts";
