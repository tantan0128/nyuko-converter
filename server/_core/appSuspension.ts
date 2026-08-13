import type { NextFunction, Request, Response } from "express";

export function appSuspensionMiddleware(_req: Request, res: Response, next: NextFunction) {
  if (process.env.APP_SUSPENDED === "true") {
    return res
      .status(503)
      .type("text/html")
      .send("<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><title>一時停止中</title></head><body><h1>入庫変換アプリは一時停止中です</h1><p>現在、アプリは利用できません。</p></body></html>");
  }

  next();
}
