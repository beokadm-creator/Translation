type ParsedItem = { refined?: string; en?: string; isMedicalContext?: boolean };

export const parseSmartly = (input: unknown): { text: string; isFinal: boolean; isMedical: boolean } => {
  if (!input) return { text: "", isFinal: false, isMedical: true };
  let data: ParsedItem | ParsedItem[] | string = input;
  if (typeof input === "string") {
    const cleaned = input.replace(/```json/g, "").replace(/```/g, "").trim();
    if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
      try { data = JSON.parse(cleaned); } catch { return { text: input, isFinal: false, isMedical: true }; }
    } else {
      return { text: input, isFinal: false, isMedical: true };
    }
  }
  if (Array.isArray(data)) {
    const combinedText = data.map((item: ParsedItem) => item?.refined || item?.en || "").join(" ").trim();
    const isMedical = data.some((item: ParsedItem) => item?.isMedicalContext !== false);
    return { text: combinedText, isFinal: true, isMedical };
  }
  if (typeof data === "object" && data !== null) {
    return { text: (data.refined || data.en || "").toString(), isFinal: true, isMedical: (data as ParsedItem).isMedicalContext !== false };
  }
  return { text: "", isFinal: false, isMedical: true };
};
