import React, { useEffect, useState, useRef } from "react";

interface Props {
  id: string;
  text: string;
  isRaw: boolean;
  targetLang?: string;
  color?: string;
  opacity?: number;
  fontSize?: string;
  onSpeak?: (text: string, lang: string) => void;
  isSpeaking?: boolean;
}

const TextItem: React.FC<Props> = ({
  id, text, isRaw, targetLang = "original", color, opacity, fontSize, onSpeak, isSpeaking = false
}) => {
  const [highlight, setHighlight] = useState(false);
  const [justFinalized, setJustFinalized] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
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

  const handleSpeak = () => {
    if (onSpeak && text && !isRaw) {
      onSpeak(text, targetLang);
    }
  };

  const style: React.CSSProperties = {
    color: textColor,
    fontWeight: isRaw ? 400 : 500,
    opacity: typeof opacity === 'number' ? opacity : (isRaw ? 0.75 : 1),
    marginRight: 6,
    transition: "color 0.6s ease-out, opacity 0.4s ease-in",
    fontSize: fontSize || "inherit",
    position: "relative",
    display: "inline",
    cursor: !isRaw && onSpeak ? "pointer" : "inherit",
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
    <span
      style={style}
      data-id={id}
      onClick={handleSpeak}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={!isRaw && onSpeak ? "클릭하여 읽기 / Click to hear" : ""}
    >
      {display}
      {!isRaw && onSpeak && (
        <span
          style={{
            marginLeft: "4px",
            fontSize: "0.75em",
            verticalAlign: "middle",
            opacity: isSpeaking ? 1 : isHovered ? 0.7 : 0.2,
            transition: "opacity 0.2s",
            animation: isSpeaking ? "pulse 1s ease-in-out infinite" : "none",
            display: "inline-block",
          }}
        >
          {isSpeaking ? "🔊" : "🔈"}
        </span>
      )}
    </span>
  );
};

export default React.memo(TextItem);
