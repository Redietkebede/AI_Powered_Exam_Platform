import express, { RequestHandler } from "express";
import { verifyToken } from "../middleware/verifyToken";

const router = express.Router();
const dashboard: RequestHandler = (req, res) => {
  if (req.user) {
    res.send(`Welcome user with UID: ${req.user!.uid}`);
  } else {
    res.status(401).send('Unauthorized');
  }
};

router.get("/dashboard", verifyToken, dashboard);

export default router;
