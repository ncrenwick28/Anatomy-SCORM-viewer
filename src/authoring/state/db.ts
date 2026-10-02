import { ProjectStore } from '../../storage/ProjectStore';

let opening: Promise<ProjectStore> | null = null;

/** Lazily opened singleton connection to the project database. */
export function getDb(): Promise<ProjectStore> {
  opening ??= ProjectStore.open();
  return opening;
}

/** Tests can reset the connection after replacing indexedDB. */
export function resetDb(): void {
  opening = null;
}
