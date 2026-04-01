import { DateKey, HourKey } from "../types/stats.js";

export interface Formatter<T> {
  format(date?: Date | number): T;
}

export const getDateFormatter = (timeZone: string = "UTC") => {
  return {
    // yyyy-MM-dd
    dateFormatter: new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }) as Formatter<DateKey>,
    // ddd, hh
    hourFormatter: new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    }) as Formatter<HourKey>,
  };
};
