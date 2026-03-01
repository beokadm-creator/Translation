import React, { useEffect, useState, useRef } from "react";

interface Props {
  id: string;
  text: string;
  isRaw: boolean;
  targetLang?: string;
  color?: string;
  opacity?: number;
  fontSize?: string;
}

const TextItem: React.FC<Props> = ({ id, text, isRaw, targetLang = "original", color, opacity, fontSize }) => {
  const [highlight, setHighlight] = useState(false);
  const prevTextRef = useRef(text);

  useEffect(() => {
    // If text changed (e.g. from Raw to Refined, or Refined update), trigger highlight
    if (prevTextRef.current !== text) {
        // Wrap in Promise.resolve to avoid setState warning
        Promise.resolve().then(() => setHighlight(true));
        const timer = setTimeout(() => setHighlight(false), 800);
        prevTextRef.current = text;
        return () => clearTimeout(timer);
    }
  }, [text]);

  const display = targetLang === "en" ? ` ${text}` : text;
  
  // Base style
  const resolvedColor = color || (targetLang === "original" ? (isRaw ? "#9ca3af" : "white") : "white"); // Tailwind gray-400 or white
  
  // Transition style
  const style: React.CSSProperties = {
    color: highlight ? "#60a5fa" : resolvedColor, // Blue-400 on update
    fontWeight: isRaw ? 400 : 500,
    opacity: typeof opacity === 'number' ? opacity : (isRaw ? 0.7 : 1),
    marginRight: 6,
    transition: "color 0.5s ease-out, opacity 0.3s ease-in",
    fontSize: fontSize || "inherit"
  };

  return (
    <span style={style} data-id={id}>
      {display}
    </span>
  );
};

export default React.memo(TextItem);
