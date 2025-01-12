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

