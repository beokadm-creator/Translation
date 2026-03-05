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
  const [justFinalized, setJustFinalized] = useState(false);
  const prevTextRef = useRef(text);
  const prevIsRawRef = useRef(isRaw);

  useEffect(() => {
    const textChanged = prevTextRef.current !== text;
    const becameFinal = prevIsRawRef.current === true && isRaw === false;

    if (textChanged || becameFinal) {
      Promise.resolve().then(() => setHighlight(true));
      const timer = setTimeout(() => setHighlight(false), 900);
      prevTextRef.current = text;

      if (becameFinal) {
        Promise.resolve().then(() => setJustFinalized(true));
        const finalTimer = setTimeout(() => setJustFinalized(false), 1200);
        return () => { clearTimeout(timer); clearTimeout(finalTimer); };
      }

      prevIsRawRef.current = isRaw;
      return () => clearTimeout(timer);
    }

    prevIsRawRef.current = isRaw;
  }, [text, isRaw]);

  const display = targetLang === "en" ? ` ${text}` : text;

  // Color resolution
  const resolvedColor = color || (targetLang === "original"
    ? (isRaw ? "#a8b5c8" : "white")
    : "white");

  const textColor = highlight && !isRaw
    ? (justFinalized ? "#4ade80" : "#60a5fa")  // green flash on finalize, blue on update
    : resolvedColor;

  const style: React.CSSProperties = {
    color: textColor,
    fontWeight: isRaw ? 400 : 500,
    opacity: typeof opacity === 'number' ? opacity : (isRaw ? 0.75 : 1),
    marginRight: 6,
    transition: "color 0.6s ease-out, opacity 0.4s ease-in",
    fontSize: fontSize || "inherit",
    position: "relative",
    display: "inline",
  };

  if (isRaw) {
    return (
      <span
        style={style}
        data-id={id}
        className="text-item-raw"
      >
        {display}
        {/* Blinking cursor to indicate "still being processed" */}
        <span
          style={{
            display: "inline-block",
            width: "2px",
            height: "1em",
            backgroundColor: "#60a5fa",
            marginLeft: "3px",
            verticalAlign: "text-bottom",
            animation: "blink-cursor 1s step-end infinite",
          }}
        />
      </span>
    );
  }

  return (
    <span style={style} data-id={id}>
      {display}
    </span>
  );
};

export default React.memo(TextItem);
