export interface ThresholdAlertData {
  userId: string;
  email: string;
  threshold: number;
}

export function isThesholdAlertData(data: unknown): data is ThresholdAlertData {
  return typeof data === 'object'
    && data !== null
    && data !== undefined
    && 'userId' in data
    && 'threshold' in data
    && 'email' in data
    && typeof data.userId === 'string'
    && typeof data.email === 'string'
    && typeof data.threshold === 'number';
}
