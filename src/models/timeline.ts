export interface TimelineDay {
  readonly date: Date;
  readonly key: string;
  readonly dayOfMonth: number;
  readonly isWeekend: boolean;
  readonly isToday: boolean;
}

export interface TimelineMonth {
  readonly key: string;
  readonly label: string;
  readonly startColumn: number;
  readonly span: number;
}

export interface TimelineWeek {
  readonly key: string;
  readonly label: string;
  readonly dateInterval: string;
  readonly startColumn: number;
  readonly span: number;
}
