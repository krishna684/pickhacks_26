import type { Request, Response } from "express";
import { startServer } from "../server";

let appPromise: ReturnType<typeof startServer> | null = null;

export default async function handler(req: Request, res: Response) {
  try {
    if (!appPromise) {
      appPromise = startServer({ listen: false, includeFrontend: false });
    }

    const app = await appPromise;
    return app(req, res);
  } catch (error: any) {
    appPromise = null;

    const message =
      typeof error?.message === "string" && error.message.trim().length > 0
        ? error.message
        : "Server initialization failed.";

    return res.status(500).json({
      error: {
        code: "SERVER_INIT_FAILED",
        message,
      },
    });
  }
}
