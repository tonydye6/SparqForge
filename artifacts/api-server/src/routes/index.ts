import { Router, type IRouter } from "express";
import healthRouter from "./health";
import brandsRouter from "./brands";
import templatesRouter from "./templates";
import assetsRouter from "./assets";
import hashtagSetsRouter from "./hashtag-sets";
import campaignsRouter from "./campaigns";
import campaignVariantsRouter from "./campaign-variants";
import calendarEntriesRouter from "./calendar-entries";
import socialAccountsRouter from "./social-accounts";
import uploadRouter from "./upload";
import generateRouter from "./generate";
import downloadRouter from "./download";
import socialAuthRouter from "./social-auth";
import videoRouter from "./video";
import costLogsRouter from "./cost-logs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(brandsRouter);
router.use(templatesRouter);
router.use(assetsRouter);
router.use(hashtagSetsRouter);
router.use(campaignsRouter);
router.use(campaignVariantsRouter);
router.use(calendarEntriesRouter);
router.use(socialAccountsRouter);
router.use(uploadRouter);
router.use(generateRouter);
router.use(downloadRouter);
router.use(socialAuthRouter);
router.use(videoRouter);
router.use(costLogsRouter);

export default router;
