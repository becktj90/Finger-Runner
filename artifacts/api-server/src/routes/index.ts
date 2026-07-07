import { Router, type IRouter } from "express";
import healthRouter from "./health";
import savesRouter from "./saves";

const router: IRouter = Router();

router.use(healthRouter);
router.use(savesRouter);

export default router;
