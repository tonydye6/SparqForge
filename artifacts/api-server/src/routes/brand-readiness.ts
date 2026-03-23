import { Router, type IRouter } from "express";
import { checkBrandReadiness } from "../lib/brand-readiness.js";

const router: IRouter = Router();

router.get("/brand-readiness/:brandId", async (req, res): Promise<void> => {
  const { brandId } = req.params;

  if (!brandId) {
    res.status(400).json({ error: "brandId is required" });
    return;
  }

  const result = await checkBrandReadiness(brandId);
  res.json(result);
});

export default router;
