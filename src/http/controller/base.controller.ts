import { Request, Response } from "express";

class BaseController {
  public ping = async (req: Request, res: Response) => {
    res.json({ message: "success" });
  };

  public pingServer = async (req: Request, res: Response) => {
    res.json({ message: "success" });
  };

  public get = async (req: Request, res: Response) => {
    res.json({ message: "success" });
  };

  public getAllKeys = async (req: Request, res: Response) => {
    res.json({ message: "success" });
  };

  public findNode = async (req: Request, res: Response) => {
    res.json({ message: "success" });
  };

  public findValue = async (req: Request, res: Response) => {
    res.json({ message: "success" });
  };

  public store = async (req: Request, res: Response) => {
    res.json({ message: "success" });
  };
}

export default BaseController;
