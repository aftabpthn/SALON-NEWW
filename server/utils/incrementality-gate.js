import { incrementalityRepo } from "../repositories/incrementality.repo.js";

export function shouldOffer(data = {}) {
  const uplift = incrementalityRepo.getUpliftScore({
    tenantId: data.tenantId,
    branchId: data.branchId,
    clientId: data.clientId
  });

  if (!uplift) {
    const assignment = incrementalityRepo.assignToGroup({
      tenantId: data.tenantId,
      branchId: data.branchId,
      clientId: data.clientId,
      offerType: data.offerType || "happy_hours",
      discountPaise: data.discountPaise,
      holdoutPercent: data.holdoutPercent
    });
    return {
      offer: assignment.assignment === "treatment",
      reason: "experiment",
      assignmentId: assignment.id,
      assignment: assignment.assignment
    };
  }

  const offer = uplift.segment === "persuadable";
  return {
    offer,
    reason: uplift.segment,
    upliftScore: uplift.upliftScore
  };
}

export const incrementalityGate = { shouldOffer };
