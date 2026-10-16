/** Badge tones per document status (shared by finance pages). */
export const DOC_STATUS_TONE: Record<string, "neutral" | "accent" | "gold" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  sent: "accent",
  accepted: "success",
  declined: "danger",
  expired: "warning",
  paid: "success",
  void: "neutral",
};
