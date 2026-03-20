import { Router, type IRouter } from "express";
import healthRouter from "./health";
import brandsRouter from "./brands";
import templatesRouter from "./templates";
import assetsRouter from "./assets";
import hashtagSetsRouter from "./hashtag-sets";
import campaignsRouter from "./campaigns";
import campaignVariantsRouter from "./campaign-variants";
import calendarEntriesRouter from "./calendar-entries";
import uploadRouter from "./upload";

const router: IRouter = Router();

router.use(healthRouter);
router.use(brandsRouter);
router.use(templatesRouter);
router.use(assetsRouter);
router.use(hashtagSetsRouter);
router.use(campaignsRouter);
router.use(campaignVariantsRouter);
router.use(calendarEntriesRouter);
router.use(uploadRouter);

export default router;
