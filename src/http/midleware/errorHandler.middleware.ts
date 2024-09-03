import type { NextFunction, Request, Response } from "express";
import { App } from "../app";
import { extractError } from "../services/extractError";
import config from "../config/config";

export class HttpException extends Error {
  public status: number;
  public message: string;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.message = message;
  }
}

class ErrorMiddleware {
  handle(error: HttpException, req: Request, res: Response, next: NextFunction) {
    try {
      const status: number = error.status || 500;
      const message: string = extractError(error) || "Something went wrong";

      if (config.env !== "test") {
        App.log.error(`[${req.method}] ${req.path} >> StatusCode:: ${status}, Message:: ${message}`);
      }

      res.status(status).json({ message });
    } catch (error) {
      next(error);
    }
  }
}

export default new ErrorMiddleware().handle;
