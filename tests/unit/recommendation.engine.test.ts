import { scoreCrops } from "@/domain/services/RecommendationService";
import { Drainage, SunExposure, type Bed } from "@/domain/entities/Bed";
import { CropFamily, type Crop } from "@/domain/entities/Crop";

describe("recommendation engine", () => {
  it("applies rotation penalty", () => {
    const bed: Bed = {
      id: "b1",
      gardenId: "g1",
      name: "Bed 1",
      polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      sunExposure: SunExposure.FULL_SUN,
      drainage: Drainage.GOOD,
      containsPerennials: false,
      isRaisedBed: false,
      hasIrrigation: false,
      createdAt: "2026-02-01",
      updatedAt: "2026-02-01",
    };

    const crops: Crop[] = [{
      id: "tomato",
      commonName: "Tomato",
      family: CropFamily.NIGHTSHADE,
      preferredSun: [SunExposure.FULL_SUN],
      drainageTolerance: [Drainage.GOOD],
      minTempC: 10,
      maxTempC: 32,
      sowMonths: [2, 3, 4],
      transplantMonths: [3, 4, 5],
    }];

    const recs = scoreCrops({
      bed,
      crops,
      weather7d: [{ date: "2026-02-10", tempMinC: 12, tempMaxC: 24, precipMm: 2, precipProbPct: 20 }],
      sameFamilyRecent: { nightshade: true },
      now: new Date("2026-02-10"),
    });

    const top = recs[0];
    expect(top).toBeDefined();
    expect(top!.score).toBeLessThan(80);
    expect(top!.explanations.join(" ")).toContain("Rotation penalty");
  });
});
