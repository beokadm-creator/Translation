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
  const [mounted, setMounted] = useState(false);
  const [displayText, setDisplayText] = useState(text);
  const [isTransforming, setIsTransforming] = useState(false);
  
  const [highlight, setHighlight] = useState(false);
  const [justFinalized, setJustFinalized] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const prevIsRawRef = useRef(isRaw);

  // 1. Initial Mount Animation
  useEffect(() => {
    // slight delay to ensure CSS transition triggers
    const t = setTimeout(() => setMounted(true), 10);
    return () => clearTimeout(t);
  }, []);

  // 2. Smooth Text Transformation (Morphing)
  useEffect(() => {
    if (text !== displayText) {
      // Start morphing effect (blur/fade out)
      setIsTransforming(true);
      
      // Swap the text content halfway through the blur
      const swapTimer = setTimeout(() => {
        setDisplayText(text);
      }, 150);
      
      // End morphing effect (unblur/fade in)
      const endTimer = setTimeout(() => {
        setIsTransforming(false);
      }, 400);
      
      return () => { clearTimeout(swapTimer); clearTimeout(endTimer); };
    }
  }, [text, displayText]);

  // 3. Status Change Highlight (Raw -> Final)
  useEffect(() => {
    const becameFinal = prevIsRawRef.current === true && isRaw === false;

    if (becameFinal) {
      Promise.resolve().then(() => setHighlight(true));
      const timer = setTimeout(() => setHighlight(false), 900);
      
      Promise.resolve().then(() => setJustFinalized(true));
      const finalTimer = setTimeout(() => setJustFinalized(false), 1200);
      
      prevIsRawRef.current = isRaw;
      return () => { clearTimeout(timer); clearTimeout(finalTimer); };
    }

    prevIsRawRef.current = isRaw;
  }, [isRaw]);

  const display = targetLang === "en" ? ` ${displayText}` : displayText;

  // Color resolution
  const resolvedColor = color || (targetLang === "original"
    ? (isRaw ? "#a8b5c8" : "white")
    : "white");

  const textColor = highlight && !isRaw
    ? (justFinalized ? "#4ade80" : "#60a5fa")  // green flash on finalize
    : resolvedColor;

  const handleSpeak = () => {
    if (onSpeak && displayText && !isRaw) {
      onSpeak(displayText, targetLang);
    }
  };

  // 부드러운 전환을 위한 핵심 CSS 스타일링
  const style: React.CSSProperties = {
    color: isTransforming ? "transparent" : textColor,
    textShadow: isTransforming ? `0 0 8px ${textColor}` : "none",
    fontWeight: isRaw ? 400 : 500,
    opacity: !mounted ? 0 : (isTransforming ? 0.5 : (typeof opacity === 'number' ? opacity : (isRaw ? 0.75 : 1))),
    filter: !mounted ? "blur(4px)" : (isTransforming ? "blur(2px)" : "blur(0px)"),
    transform: !mounted ? "translateY(4px)" : "translateY(0)",
    marginRight: 6,
    transition: "color 0.3s ease, text-shadow 0.3s ease, opacity 0.4s ease, filter 0.4s ease, transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)",
    fontSize: fontSize || "inherit",
    position: "relative",
    display: "inline-block", // transform 적용을 위해 inline-block 사용
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
