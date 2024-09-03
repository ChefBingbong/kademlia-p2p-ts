import { createLogger, format, type Logger, transports } from "winston";
import type * as Transport from "winston-transport";
import config from "../config/config";

export class AppLogger {
      private logger: Logger;

      constructor() {
            this.initLogger();
      }

      private initLogger() {
            if (!this.logger) {
                  const transportsConfig: Transport[] = [new transports.Console()];
                  const customFormat = format.combine(
                        format.timestamp(),
                        this.customPrintf()
                  );

                  this.logger = createLogger({
                        format: customFormat,
                        transports: transportsConfig,
                        level: "debug",
                  });
            }
      }

      private customPrintf() {
            return format.printf(({ level, message, label, timestamp }) => {
                  return `${timestamp} | ${level
                        .toLowerCase()
                        .padEnd(5)} | ${label.padEnd(20)} | ${message}`;
            });
      }

      getLogger(label: string) {
            if (label.length > 30) {
                  throw new Error("Too long label");
            }
            return this.logger.child({ label });
      }
}
