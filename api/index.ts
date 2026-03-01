import type { Request, Response } from "express";
import { startServer } from "../server";

let appPromise: ReturnType<typeof startServer> | null = null;

export default async function handler(req: Request, res: Response) {
  if (!appPromise) {
    appPromise = startServer({ listen: false, includeFrontend: false });
  }

  const app = await appPromise;
  return app(req, res);
}
