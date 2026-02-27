import React from "react";

interface Props {
  id: string;
  text: string;
  isRaw: boolean;
  targetLang?: string;
  color?: string;
  opacity?: number;
}

const TextItem: React.FC<Props> = ({ id, text, isRaw, targetLang = "original", color, opacity }) => {
  const display = targetLang === "en" ? ` ${text}` : text;
  const resolvedColor = color || (targetLang === "original" ? (isRaw ? "gray" : "black") : "black");
  return (
    <span
      key={id}
      style={{
        color: resolvedColor,
        fontWeight: isRaw ? (500 as any) : (700 as any),
        opacity: typeof opacity === 'number' ? opacity : (isRaw ? 0.7 : 1),
        marginRight: 6,
      }}
    >
      {display}
    </span>
  );
};

export default React.memo(TextItem);
