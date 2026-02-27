export const parseSmartly = (input: any): { text: string; isFinal: boolean; isMedical: boolean } => {
  if (!input) return { text: "", isFinal: false, isMedical: true };
  let data: any = input;
  if (typeof input === "string") {
    const cleaned = input.replace(/```json/g, "").replace(/```/g, "").trim();
    if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
      try { data = JSON.parse(cleaned); } catch { return { text: input, isFinal: false, isMedical: true }; }
    } else {
      return { text: input, isFinal: false, isMedical: true };
    }
  }
  if (Array.isArray(data)) {
    const combinedText = data.map((item: any) => item?.refined || item?.en || "").join(" ").trim();
    const isMedical = data.some((item: any) => item?.isMedicalContext !== false);
    return { text: combinedText, isFinal: true, isMedical };
  }
  if (typeof data === "object") {
    return { text: (data.refined || data.en || "").toString(), isFinal: true, isMedical: data.isMedicalContext !== false };
  }
  return { text: "", isFinal: false, isMedical: true };
};

