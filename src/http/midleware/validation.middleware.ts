import type { NextFunction, Request, RequestHandler, Response } from "express";
import type QueryString from "qs";

export const validateRequestMiddleware = <T>(
  toDto: (query: QueryString.ParsedQs) => T | undefined,
  validationFunc: (request: T) => { success: boolean; data: string | T },
  value: string | "body" | "query" | "params" = "body",
  skipDto = false,
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const request: T = skipDto ? req[value] : toDto(req[value]);
      const validationResult = validationFunc(request);

      if (!validationResult.success) {
        throw new Error(validationResult.data as string);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
