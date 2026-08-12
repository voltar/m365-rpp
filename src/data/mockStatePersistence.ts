const storagePrefix = "resourcePresencePlanner.mock.";
const storageVersion = 1;

interface PersistedEnvelope<T> {
  readonly version: number;
  readonly value: T;
}

export function loadPersistedMockState<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(storagePrefix + key);

    if (!raw) {
      return fallback;
    }

    const envelope = JSON.parse(raw) as PersistedEnvelope<T>;

    if (envelope.version !== storageVersion || envelope.value === undefined || envelope.value === null) {
      return fallback;
    }

    return envelope.value;
  } catch {
    return fallback;
  }
}

export function savePersistedMockState<T>(key: string, value: T): void {
  try {
    const envelope: PersistedEnvelope<T> = { version: storageVersion, value };
    window.localStorage.setItem(storagePrefix + key, JSON.stringify(envelope));
  } catch {
    // Persistence is best effort only: private mode or quota errors never break the prototype.
  }
}

export function clearPersistedMockState(): void {
  try {
    const keysToRemove: string[] = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);

      if (key?.startsWith(storagePrefix)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Best effort only.
  }
}

interface PersistedMockStateBundle {
  readonly version: number;
  readonly storageVersion: number;
  readonly state: Record<string, unknown>;
}

export function exportPersistedMockState(defaultState: Record<string, unknown> = {}): string {
  const state: Record<string, unknown> = {};

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const storageKey = window.localStorage.key(index);

    if (storageKey?.startsWith(storagePrefix)) {
      const key = storageKey.substring(storagePrefix.length);
      const raw = window.localStorage.getItem(storageKey);

      if (raw !== null) {
        try {
          state[key] = JSON.parse(raw);
        } catch {
          state[key] = raw;
        }
      }
    }
  }

  for (const [key, value] of Object.entries(defaultState)) {
    if (state[key] === undefined) {
      state[key] = { version: storageVersion, value };
    }
  }

  const bundle: PersistedMockStateBundle = {
    version: 1,
    storageVersion,
    state
  };

  return JSON.stringify(bundle, undefined, 2);
}

export function importPersistedMockState(serializedState: string): void {
  const parsed = JSON.parse(serializedState) as PersistedMockStateBundle;

  if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || typeof parsed.storageVersion !== "number" || !parsed.state || typeof parsed.state !== "object") {
    throw new Error("Invalid persisted mock state format.");
  }

  clearPersistedMockState();

  for (const [key, envelope] of Object.entries(parsed.state)) {
    try {
      window.localStorage.setItem(storagePrefix + key, JSON.stringify(envelope));
    } catch {
      // Best effort only.
    }
  }
}

export function hasPersistedMockState(): boolean {
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      if (window.localStorage.key(index)?.startsWith(storagePrefix)) {
        return true;
      }
    }
  } catch {
    // Best effort only.
  }

  return false;
}
