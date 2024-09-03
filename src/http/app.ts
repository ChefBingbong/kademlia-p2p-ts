import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import hpp from "hpp";
import type { Logger } from "winston";
import config from "../config/config";
import { AppLogger } from "../utils/logger";
import errorHandlingMiddleware from "./midleware/errorHandler.middleware";

export class App extends AppLogger {
      public isListening = false;

      public app: express.Application;
      public port: string | number;
      static log: Logger;

      constructor() {
            super();
            this.app = express();
            this.port = config.port;

            this.configureMiddlewares();
            this.configureRoutes();
            this.configureErrorHandling();

            App.log = this.getLogger("on-ramp-api-logger");
      }

      private configureMiddlewares(): void {
            this.app.use(cors({ origin: "*" }));
            this.app.use(hpp());
            this.app.use(helmet());
            this.app.use(compression());
            this.app.use(express.json());
            this.app.use(express.urlencoded({ extended: true }));
      }

      private configureRoutes(routes: Routes[]): void {
            this.app.get("/", (req, res) => {
                  res.status(200).send({ result: "ok" });
            });

            // biome-ignore lint/complexity/noForEach: <explanation>
            routes.forEach((route) => {
                  const basePath = route.isSandbox ? "/sandbox" : "/";
                  this.app.use(basePath, route.router);
            });
      }

      private configureErrorHandling(): void {
            this.app.use(errorHandlingMiddleware);
      }

      public listen(): void {
            if (this.isListening) {
                  App.log.warn("App is already listening.");
                  return;
            }

            this.app.listen(this.port, () => {
                  this.isListening = true;
                  App.log.info(`======= ENV: ${config.env} =======`);
                  App.log.info(`🚀 App listening on the port ${this.port}`);
            });
      }

      public getServer() {
            return this.app;
      }
}
