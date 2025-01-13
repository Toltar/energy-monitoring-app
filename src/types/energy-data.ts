export interface EnergyUsageDataInput {
  date: string;
  usage: number;
}

export interface EnergyUsageDatabaseEntry {
  userId: string;
  date: string;
  usage: number;
  timestamp: string;
}

export function isEnergyUsageDatabaseEntry(entry: unknown): entry is EnergyUsageDatabaseEntry {
  return typeof entry === 'object'
    && entry !== null
    && entry !== undefined
    && 'userId' in entry
    && typeof entry.userId === 'string'
    && 'date' in entry
    && typeof entry.date === 'string'
    && 'usage' in entry
    && typeof entry.usage === 'number'
}

